import { createHash, randomUUID } from 'node:crypto';
import {
    ACTION_TRANSITIONS,
    ALLOWED_SOURCE_FILES,
    COMMERCIAL_UPDATE_FILES,
    CORE_UPDATE_FILES,
    MANIFEST_SCHEMA_VERSION,
    MAX_FILE_BYTES,
    MAX_PACKAGE_BYTES,
    REFERENCE_FILES,
    RUN_RECORD_TTL_DAYS,
} from './constants.mjs';

const allowedFileSet = new Set(ALLOWED_SOURCE_FILES);
const hexSha256Pattern = /^[a-f0-9]{64}$/;
const base64Sha256Pattern = /^[A-Za-z0-9+/]{43}=$/;
export const MAX_CONTROL_REQUEST_BYTES = 32 * 1024;

export class ClientError extends Error {
    constructor(statusCode, message, code = 'INVALID_REQUEST') {
        super(message);
        this.name = 'ClientError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function jsonResponse(statusCode, body, extraHeaders = {}) {
    return {
        statusCode,
        headers: {
            'cache-control': 'no-store',
            'content-type': 'application/json; charset=utf-8',
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    };
}

export function parseJsonBody(event) {
    if (!event?.body) {
        return {};
    }

    if (typeof event.body !== 'string') {
        throw new ClientError(400, 'The request body must be valid JSON.', 'INVALID_JSON');
    }
    // Control messages contain upload metadata, not file bytes. Bound them
    // before parsing; the separate presigned S3 upload handles large files.
    const encodedLimit = event.isBase64Encoded
        ? 4 * Math.ceil(MAX_CONTROL_REQUEST_BYTES / 3)
        : MAX_CONTROL_REQUEST_BYTES;
    if (Buffer.byteLength(event.body, 'utf8') > encodedLimit) {
        throw new ClientError(413, 'The request body is too large.', 'REQUEST_TOO_LARGE');
    }
    const body = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
    if (Buffer.byteLength(body, 'utf8') > MAX_CONTROL_REQUEST_BYTES) {
        throw new ClientError(413, 'The request body is too large.', 'REQUEST_TOO_LARGE');
    }

    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw new ClientError(400, 'The request body must be valid JSON.', 'INVALID_JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new ClientError(400, 'The request body must be an object.', 'INVALID_REQUEST');
    }
    return parsed;
}

function normalizeGroupClaim(value) {
    if (Array.isArray(value)) {
        return value
            .filter((group) => typeof group === 'string')
            .map((group) => group.trim())
            .filter(Boolean);
    }
    if (typeof value !== 'string') {
        return [];
    }

    let serializedGroups = value.trim();
    if (!serializedGroups) {
        return [];
    }
    if (serializedGroups.startsWith('[') && serializedGroups.endsWith(']')) {
        try {
            const parsedGroups = JSON.parse(serializedGroups);
            if (Array.isArray(parsedGroups)) {
                return normalizeGroupClaim(parsedGroups);
            }
        } catch {
            serializedGroups = serializedGroups.slice(1, -1);
        }
    }
    return serializedGroups.split(',').map((group) => group.trim()).filter(Boolean);
}

export function operatorIdentity(event) {
    const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
    const groupsValue = claims['cognito:groups'];
    const groups = normalizeGroupClaim(groupsValue);
    if (!groups.includes('mls-operators')) {
        throw new ClientError(403, 'This account is not authorized to manage MLS imports.', 'FORBIDDEN');
    }

    const subject = String(claims.sub ?? '').trim();
    if (!subject) {
        throw new ClientError(401, 'A valid operator session is required.', 'UNAUTHORIZED');
    }

    return {
        subject,
        email: String(claims.email ?? '').trim().toLowerCase(),
    };
}

function normalizeSourceModifiedAt(value) {
    const timestamp = new Date(value);
    if (!value || Number.isNaN(timestamp.getTime())) {
        throw new ClientError(400, 'Every file needs its original modified time.', 'INVALID_FILE_TIMESTAMP');
    }
    if (timestamp.getTime() > Date.now() + (5 * 60 * 1000)) {
        throw new ClientError(400, 'A file modified time cannot be in the future.', 'INVALID_FILE_TIMESTAMP');
    }
    return timestamp.toISOString();
}

export function validateUploadFiles(rawFiles, { useCurrentReferences = true } = {}) {
    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
        throw new ClientError(400, 'Select the MLS PIN text files before continuing.', 'FILES_REQUIRED');
    }

    const seen = new Set();
    let totalBytes = 0;
    const files = rawFiles.map((rawFile) => {
        const name = String(rawFile?.name ?? '').trim();
        if (!allowedFileSet.has(name)) {
            throw new ClientError(400, `${name || 'An unnamed file'} is not part of the approved MLS PIN package.`, 'FILE_NOT_ALLOWED');
        }
        if (seen.has(name)) {
            throw new ClientError(400, `${name} was selected more than once.`, 'DUPLICATE_FILE');
        }
        seen.add(name);

        const size = Number(rawFile?.size);
        if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) {
            throw new ClientError(400, `${name} must be between 1 byte and ${MAX_FILE_BYTES} bytes.`, 'INVALID_FILE_SIZE');
        }
        totalBytes += size;

        const sha256 = String(rawFile?.sha256 ?? '').trim().toLowerCase();
        const checksumSha256 = String(rawFile?.checksumSha256 ?? '').trim();
        if (!hexSha256Pattern.test(sha256) || !base64Sha256Pattern.test(checksumSha256)) {
            throw new ClientError(400, `${name} is missing a valid SHA-256 checksum.`, 'INVALID_CHECKSUM');
        }

        return {
            name,
            size,
            sha256,
            checksumSha256,
            sourceModifiedAt: normalizeSourceModifiedAt(rawFile?.sourceModifiedAt),
        };
    });

    if (totalBytes > MAX_PACKAGE_BYTES) {
        throw new ClientError(400, `The selected package is larger than ${MAX_PACKAGE_BYTES} bytes.`, 'PACKAGE_TOO_LARGE');
    }

    const missingCore = CORE_UPDATE_FILES.filter((name) => !seen.has(name));
    if (missingCore.length > 0) {
        throw new ClientError(400, `The update is missing: ${missingCore.join(', ')}.`, 'CORE_FILES_MISSING');
    }

    const missingReferences = REFERENCE_FILES.filter((name) => !seen.has(name));
    if (!useCurrentReferences && missingReferences.length > 0) {
        throw new ClientError(400, `Include the reference files or choose current reference tables: ${missingReferences.join(', ')}.`, 'REFERENCE_FILES_MISSING');
    }

    const includedCommercialFiles = COMMERCIAL_UPDATE_FILES.filter((name) => seen.has(name));
    if (includedCommercialFiles.length > 0 && includedCommercialFiles.length !== COMMERCIAL_UPDATE_FILES.length) {
        const missingCommercial = COMMERCIAL_UPDATE_FILES.filter((name) => !seen.has(name));
        throw new ClientError(
            400,
            `Commercial exports must be included together. Missing: ${missingCommercial.join(', ')}.`,
            'COMMERCIAL_PACKAGE_INCOMPLETE',
        );
    }

    return {
        files: files.sort((left, right) => left.name.localeCompare(right.name)),
        totalBytes,
        missingReferences,
        usesCurrentReferences: useCurrentReferences && missingReferences.length > 0,
        includesCommercial: includedCommercialFiles.length === COMMERCIAL_UPDATE_FILES.length,
    };
}

export function createRunId(now = new Date()) {
    const timestamp = now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    return `${timestamp}-${randomUUID()}`;
}

export function runExpiresAtEpoch(now = Date.now()) {
    return Math.floor((now + (RUN_RECORD_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
}

export function buildCanonicalManifest({ runId, createdAt, completedAt, createdBy, packageData }) {
    const manifest = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        runId,
        createdAt,
        completedAt,
        createdBy: {
            subject: createdBy.subject,
            email: createdBy.email,
        },
        sourcePackage: {
            totalBytes: packageData.totalBytes,
            usesCurrentReferences: packageData.usesCurrentReferences,
            missingReferences: [...packageData.missingReferences].sort(),
            includesCommercial: Boolean(packageData.includesCommercial),
            newestSourceModifiedAt: packageData.files
                .map((file) => file.sourceModifiedAt)
                .sort()
                .at(-1),
            files: packageData.files.map((file) => ({
                name: file.name,
                size: file.size,
                sha256: file.sha256,
                checksumSha256: file.checksumSha256,
                sourceModifiedAt: file.sourceModifiedAt,
            })),
        },
    };
    const body = `${JSON.stringify(manifest)}\n`;
    return {
        manifest,
        body,
        sha256: createHash('sha256').update(body).digest('hex'),
    };
}

export function assertTransition(action, currentState) {
    const transition = ACTION_TRANSITIONS[action];
    if (!transition) {
        throw new ClientError(400, 'Choose validate, approve, reject, or publish.', 'UNKNOWN_ACTION');
    }
    if (!transition.from.includes(currentState)) {
        throw new ClientError(409, `${action} is not available while this import is ${currentState}.`, 'INVALID_STATE_TRANSITION');
    }
    return transition;
}

export function safeRunId(value) {
    const runId = String(value ?? '').trim();
    if (!/^\d{14}-[0-9a-f-]{36}$/.test(runId)) {
        throw new ClientError(400, 'The import identifier is invalid.', 'INVALID_RUN_ID');
    }
    return runId;
}
