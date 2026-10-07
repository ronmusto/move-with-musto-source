import { createHmac, timingSafeEqual } from 'node:crypto';
import { cloudFrontViewerIp } from './viewer-address.mjs';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { aws, requiredEnvironment } from './aws.mjs';
import {
    buildContactEmail,
    ContactPayloadError,
    MAX_REQUEST_BYTES,
    parseContactPayload,
} from './contact-domain.mjs';

const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
    'https://movewithmusto.com',
    'https://www.movewithmusto.com',
]);
const DEFAULT_RATE_LIMIT_MAXIMUM = 5;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
let cachedTurnstileSecret;

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

function viewerIp(event) {
    return cloudFrontViewerIp(header(event, 'cloudfront-viewer-address'));
}

function allowedOrigins() {
    const configured = String(process.env.CONTACT_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    return new Set(configured.length > 0 ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function parseEventBody(event) {
    if (event?.isBase64Encoded) {
        const decoded = Buffer.from(String(event.body ?? ''), 'base64').toString('utf8');
        if (Buffer.byteLength(decoded, 'utf8') > MAX_REQUEST_BYTES) {
            throw new ContactPayloadError('Request body is too large.');
        }
        return JSON.parse(decoded);
    }

    const body = String(event?.body ?? '');
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) {
        throw new ContactPayloadError('Request body is too large.');
    }
    return JSON.parse(body);
}

async function consumeRateLimit({ ipAddress, now = Date.now() }) {
    const tableName = requiredEnvironment('CONTACT_RATE_LIMIT_TABLE_NAME');
    const windowSeconds = Number(process.env.CONTACT_RATE_LIMIT_WINDOW_SECONDS)
        || DEFAULT_RATE_LIMIT_WINDOW_SECONDS;
    const maximum = Number(process.env.CONTACT_RATE_LIMIT_MAXIMUM)
        || DEFAULT_RATE_LIMIT_MAXIMUM;
    const window = Math.floor(now / (windowSeconds * 1000));
    const hashSalt = requiredEnvironment('CONTACT_RATE_LIMIT_HASH_SALT');
    const key = createHmac('sha256', hashSalt).update(`${ipAddress}|${window}`).digest('hex');

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

async function turnstileSecret() {
    const secretArn = String(process.env.TURNSTILE_SECRET_ARN ?? '').trim();
    if (!secretArn) return '';
    if (cachedTurnstileSecret !== undefined) return cachedTurnstileSecret;
    const result = await aws.secrets.send(new GetSecretValueCommand({ SecretId: secretArn }));
    const raw = String(result.SecretString ?? '').trim();
    if (!raw) throw new Error('Turnstile secret is empty.');
    try {
        const parsed = JSON.parse(raw);
        cachedTurnstileSecret = String(parsed.secret ?? parsed.secretKey ?? '').trim();
    } catch {
        cachedTurnstileSecret = raw;
    }
    if (!cachedTurnstileSecret) throw new Error('Turnstile secret is invalid.');
    return cachedTurnstileSecret;
}

async function verifyTurnstile({ token, ipAddress }) {
    const secret = await turnstileSecret();
    if (!secret) return true;
    if (!token || typeof token !== 'string' || token.length > 2048) return false;

    const body = new URLSearchParams({
        secret,
        response: token,
        remoteip: ipAddress,
    });
    const challengeResponse = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(5000),
    });
    if (!challengeResponse.ok) return false;
    const result = await challengeResponse.json();
    return result?.success === true;
}

async function sendInquiryEmail(inquiry) {
    const fromAddress = requiredEnvironment('CONTACT_FROM_EMAIL');
    const recipient = requiredEnvironment('CONTACT_RECIPIENT_EMAIL');
    const email = buildContactEmail(inquiry);
    await aws.ses.send(new SendEmailCommand({
        FromEmailAddress: `Move With Musto Website <${fromAddress}>`,
        Destination: { ToAddresses: [recipient] },
        ReplyToAddresses: [inquiry.email],
        Content: {
            Simple: {
                Subject: { Data: email.subject, Charset: 'UTF-8' },
                Body: { Text: { Data: email.body, Charset: 'UTF-8' } },
            },
        },
    }));
}

export function createContactHandler({
    consumeLimit = consumeRateLimit,
    sendEmail = sendInquiryEmail,
    verifyChallenge = verifyTurnstile,
} = {}) {
    return async function contactHandler(event) {
        const id = requestId(event);
        try {
            if (event?.requestContext?.http?.method !== 'POST') return response(405, 'method_not_allowed');
            if (!hasTrustedOriginToken(event)) return response(403, 'request_not_allowed');
            if (!allowedOrigins().has(header(event, 'origin'))) return response(403, 'origin_not_allowed');
            if (!/^application\/json(?:\s*;|$)/iu.test(header(event, 'content-type'))) {
                return response(415, 'unsupported_media_type');
            }

            const rawPayload = parseEventBody(event);
            const inquiry = parseContactPayload(rawPayload);
            if (inquiry.honeypot) {
                console.info(JSON.stringify({ event: 'contact_inquiry_suppressed', requestId: id }));
                return response(202, 'accepted');
            }

            const ipAddress = viewerIp(event);
            if (!ipAddress) return response(403, 'request_not_allowed');
            if (!await consumeLimit({ ipAddress })) return response(429, 'try_again_later');
            if (!await verifyChallenge({ token: rawPayload.turnstileToken, ipAddress })) {
                return response(403, 'challenge_failed');
            }

            await sendEmail(inquiry);
            console.info(JSON.stringify({
                event: 'contact_inquiry_sent',
                requestId: id,
                category: inquiry.source.category,
                attachedHomeCount: inquiry.attachedListings.length,
            }));
            return response(202, 'accepted');
        } catch (error) {
            if (error instanceof ContactPayloadError || error instanceof SyntaxError) {
                return response(400, error instanceof ContactPayloadError ? error.code : 'invalid_json');
            }
            console.error(JSON.stringify({
                event: 'contact_inquiry_failed',
                requestId: id,
                errorName: String(error?.name ?? 'Error').slice(0, 120),
            }));
            return response(503, 'temporarily_unavailable');
        }
    };
}

export const handler = createContactHandler();
