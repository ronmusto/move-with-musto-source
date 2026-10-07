import { createHmac, timingSafeEqual } from 'node:crypto';
import { cloudFrontViewerIp } from './viewer-address.mjs';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { aws, requiredEnvironment } from './aws.mjs';

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
    'https://movewithmusto.com',
    'https://www.movewithmusto.com',
]);
const DEFAULT_RATE_LIMIT_MAXIMUM = 10;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
const MAX_REQUEST_BYTES = 4096;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function response(statusCode, code) {
    return {
        statusCode,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ ok: statusCode < 400, code }),
    };
}

function header(event, name) {
    const headers = event?.headers ?? {};
    return String(headers[name] ?? headers[name.toLowerCase()] ?? '').trim();
}

function requestId(event) {
    return String(event?.requestContext?.requestId ?? 'unknown').slice(0, 128);
}

function hasTrustedOriginToken(event) {
    const expected = Buffer.from(requiredEnvironment('CONTACT_ORIGIN_TOKEN'), 'utf8');
    const received = Buffer.from(header(event, 'x-move-with-musto-origin'), 'utf8');
    return expected.length === received.length && expected.length > 0 && timingSafeEqual(expected, received);
}

function allowedOrigins() {
    const configured = String(process.env.UNSUBSCRIBE_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function viewerIp(event) {
    return cloudFrontViewerIp(header(event, 'cloudfront-viewer-address'));
}

function parseEmail(event) {
    const encodedBody = String(event?.body ?? '');
    const body = event?.isBase64Encoded
        ? Buffer.from(encodedBody, 'base64').toString('utf8')
        : encodedBody;
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        throw new RangeError('Request body is too large.');
    }

    const payload = JSON.parse(body);
    const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
        throw new TypeError('A valid email address is required.');
    }
    return email;
}

async function consumeRateLimit({ ipAddress, now = Date.now() }) {
    const tableName = requiredEnvironment('UNSUBSCRIBE_RATE_LIMIT_TABLE_NAME');
    const windowSeconds = Number(process.env.UNSUBSCRIBE_RATE_LIMIT_WINDOW_SECONDS)
        || DEFAULT_RATE_LIMIT_WINDOW_SECONDS;
    const maximum = Number(process.env.UNSUBSCRIBE_RATE_LIMIT_MAXIMUM)
        || DEFAULT_RATE_LIMIT_MAXIMUM;
    const window = Math.floor(now / (windowSeconds * 1000));
    const hashSalt = requiredEnvironment('UNSUBSCRIBE_RATE_LIMIT_HASH_SALT');
    const key = createHmac('sha256', hashSalt)
        .update(`unsubscribe|${ipAddress}|${window}`)
        .digest('hex');

    try {
        await aws.dynamo.send(new UpdateCommand({
            TableName: tableName,
            Key: { key },
            UpdateExpression: 'SET expiresAtEpoch = :expiresAt ADD submissionCount :one',
            ConditionExpression: 'attribute_not_exists(submissionCount) OR submissionCount < :maximum',
            ExpressionAttributeValues: {
                ':expiresAt': Math.floor(now / 1000) + windowSeconds + 60,
                ':one': 1,
                ':maximum': maximum,
            },
        }));
        return true;
    } catch (error) {
        if (error?.name === 'ConditionalCheckFailedException') return false;
        throw error;
    }
}

async function recordSuppression(email, now = new Date()) {
    const emailHash = createHmac('sha256', requiredEnvironment('DO_NOT_CONTACT_HASH_KEY'))
        .update(email)
        .digest('hex');
    const requestedAt = now.toISOString();

    await aws.dynamo.send(new UpdateCommand({
        TableName: requiredEnvironment('DO_NOT_CONTACT_TABLE_NAME'),
        Key: { emailHash },
        UpdateExpression: [
            'SET #status = :status',
            '#source = :source',
            'lastRequestedAt = :requestedAt',
            'firstRequestedAt = if_not_exists(firstRequestedAt, :requestedAt)',
        ].join(', '),
        ExpressionAttributeNames: {
            '#status': 'status',
            '#source': 'source',
        },
        ExpressionAttributeValues: {
            ':status': 'do_not_contact',
            ':source': 'move-with-musto-unsubscribe-page',
            ':requestedAt': requestedAt,
        },
    }));
}

export function createUnsubscribeHandler({
    consumeLimit = consumeRateLimit,
    writeSuppression = recordSuppression,
} = {}) {
    return async function unsubscribeHandler(event) {
        const id = requestId(event);
        try {
            if (event?.requestContext?.http?.method !== 'POST') return response(405, 'method_not_allowed');
            if (!hasTrustedOriginToken(event)) return response(403, 'request_not_allowed');
            if (!allowedOrigins().has(header(event, 'origin'))) return response(403, 'origin_not_allowed');
            if (!/^application\/json(?:\s*;|$)/iu.test(header(event, 'content-type'))) {
                return response(415, 'unsupported_media_type');
            }

            const ipAddress = viewerIp(event);
            if (!ipAddress) return response(403, 'request_not_allowed');
            const email = parseEmail(event);
            if (!await consumeLimit({ ipAddress })) return response(429, 'try_again_later');

            await writeSuppression(email);
            console.info(JSON.stringify({
                event: 'unsubscribe_suppression_recorded',
                requestId: id,
            }));
            return response(202, 'accepted');
        } catch (error) {
            if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) {
                return response(400, 'invalid_request');
            }
            console.error(JSON.stringify({
                event: 'unsubscribe_suppression_failed',
                requestId: id,
                errorName: String(error?.name ?? 'Error').slice(0, 120),
            }));
            return response(503, 'temporarily_unavailable');
        }
    };
}

export const handler = createUnsubscribeHandler();
