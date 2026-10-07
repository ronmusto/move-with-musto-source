import { createHash } from 'node:crypto';

export const CACHE_SCHEMA_VERSION = 'move-with-musto.google-geocode-cache.v1';
export const SEED_SUMMARY_SCHEMA_VERSION = 'move-with-musto.coordinate-cache-seed.v1';

const MAX_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const base64Sha256Pattern = /^[A-Za-z0-9+/]{43}=$/u;

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function parsePositiveInteger(value, description) {
    if (!/^\d+$/u.test(String(value ?? ''))) {
        throw new Error(`${description} must be a positive integer.`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${description} must be a positive integer.`);
    }
    return parsed;
}

function normalizedSha256(value, description) {
    const normalized = String(value ?? '').toLowerCase();
    if (!sha256Pattern.test(normalized)) {
        throw new Error(`${description} must be exactly 64 hexadecimal characters.`);
    }
    return normalized;
}

function sha256Hex(text) {
    return createHash('sha256').update(text).digest('hex');
}

function sha256Base64(text) {
    return createHash('sha256').update(text).digest('base64');
}

function parseCache(cacheText) {
    try {
        return JSON.parse(cacheText);
    } catch (error) {
        throw new Error(`The reviewed coordinate cache is not valid JSON: ${error.message}`, { cause: error });
    }
}

function validateMaintenanceCacheDocument(cache, now) {
    if (!Number.isFinite(now)) {
        throw new Error('The coordinate-cache validation clock is invalid.');
    }
    if (!isRecord(cache) || cache.schemaVersion !== CACHE_SCHEMA_VERSION) {
        throw new Error(`The reviewed coordinate cache must use ${CACHE_SCHEMA_VERSION}.`);
    }
    if (cache.provider !== 'google_geocoding' || cache.cacheTtlDays !== 30 || !isRecord(cache.entries)) {
        throw new Error('The reviewed coordinate cache has invalid provider, TTL, or entries metadata.');
    }
    const updatedAt = parseTimestamp(cache.updatedAt);
    if (updatedAt === null || updatedAt > now + (5 * 60 * 1000)) {
        throw new Error('The reviewed coordinate cache has an invalid updatedAt timestamp.');
    }

    const entries = Object.entries(cache.entries);
    if (entries.length === 0) {
        throw new Error('The reviewed coordinate cache must contain at least one fresh entry.');
    }
    const expirations = entries.map(([cacheKey, entry]) => {
        const geocodedAt = parseTimestamp(entry?.geocodedAt);
        const expiresAt = parseTimestamp(entry?.expiresAt);
        if (
            !isRecord(entry) ||
            !Number.isFinite(entry.lat) ||
            !Number.isFinite(entry.lng) ||
            geocodedAt === null ||
            expiresAt === null ||
            geocodedAt > now ||
            expiresAt <= geocodedAt ||
            expiresAt - geocodedAt > MAX_CACHE_TTL_MS
        ) {
            throw new Error(`The reviewed coordinate cache contains invalid entry ${cacheKey || '(missing key)'}.`);
        }
        return expiresAt;
    });

    return {
        entryCount: entries.length,
        earliestExpiresAt: new Date(Math.min(...expirations)).toISOString(),
        latestExpiresAt: new Date(Math.max(...expirations)).toISOString(),
        updatedAt: new Date(updatedAt).toISOString(),
    };
}

export function coordinateCacheMetadata(summary, latestLockedLedgerSha256) {
    const ledgerSha256 = normalizedSha256(
        latestLockedLedgerSha256,
        'The reviewed cache locked-ledger SHA-256',
    );
    return {
        'seed-schema': SEED_SUMMARY_SCHEMA_VERSION,
        'entry-count': String(summary.entryCount),
        'earliest-expiry': summary.earliestExpiresAt,
        'latest-expiry': summary.latestExpiresAt,
        'latest-locked-ledger-sha256': ledgerSha256,
        'cache-sha256': summary.cacheSha256,
    };
}

export function summarizeCoordinateCache({
    cacheText,
    latestLockedLedgerSha256,
    now = Date.now(),
    validateDocument = validateMaintenanceCacheDocument,
}) {
    const cache = parseCache(cacheText);
    const documentSummary = validateDocument(cache, now);
    const cacheSha256 = sha256Hex(cacheText);
    const summary = {
        schemaVersion: SEED_SUMMARY_SCHEMA_VERSION,
        ...documentSummary,
        cacheSha256,
        checksumSha256: sha256Base64(cacheText),
        latestLockedLedgerSha256: normalizedSha256(
            latestLockedLedgerSha256,
            'The reviewed cache locked-ledger SHA-256',
        ),
    };
    return {
        ...summary,
        metadata: coordinateCacheMetadata(summary, summary.latestLockedLedgerSha256),
    };
}

export function validateReviewedCoordinateCacheObject({
    cacheText,
    objectResponse,
    now = Date.now(),
    validateDocument = validateMaintenanceCacheDocument,
}) {
    if (!isRecord(objectResponse) || !isRecord(objectResponse.Metadata)) {
        throw new Error('The reviewed coordinate cache is missing its S3 object response or metadata.');
    }
    if (typeof objectResponse.ETag !== 'string' || !objectResponse.ETag.trim()) {
        throw new Error('The reviewed coordinate cache is missing its S3 ETag.');
    }
    if (!base64Sha256Pattern.test(String(objectResponse.ChecksumSHA256 ?? ''))) {
        throw new Error('The reviewed coordinate cache is missing its full-object S3 SHA-256 checksum.');
    }
    const contentLength = Number(objectResponse.ContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength !== Buffer.byteLength(cacheText)) {
        throw new Error('The reviewed coordinate cache S3 content length does not match its downloaded bytes.');
    }

    const metadata = objectResponse.Metadata;
    if (metadata['seed-schema'] !== SEED_SUMMARY_SCHEMA_VERSION) {
        throw new Error(`The reviewed coordinate cache must retain ${SEED_SUMMARY_SCHEMA_VERSION} provenance.`);
    }
    const expectedEntryCount = parsePositiveInteger(metadata['entry-count'], 'The reviewed cache entry count');
    const expectedCacheSha256 = normalizedSha256(metadata['cache-sha256'], 'The reviewed cache SHA-256');
    const latestLockedLedgerSha256 = normalizedSha256(
        metadata['latest-locked-ledger-sha256'],
        'The reviewed cache locked-ledger SHA-256',
    );
    if (sha256Hex(cacheText) !== expectedCacheSha256) {
        throw new Error('The reviewed coordinate cache bytes do not match their S3 metadata SHA-256.');
    }
    if (sha256Base64(cacheText) !== objectResponse.ChecksumSHA256) {
        throw new Error('The reviewed coordinate cache bytes do not match the S3 full-object checksum.');
    }

    const summary = summarizeCoordinateCache({
        cacheText,
        latestLockedLedgerSha256,
        now,
        validateDocument,
    });
    if (
        summary.entryCount !== expectedEntryCount ||
        metadata['earliest-expiry'] !== summary.earliestExpiresAt ||
        metadata['latest-expiry'] !== summary.latestExpiresAt
    ) {
        throw new Error('The reviewed coordinate cache content does not match its count or expiry metadata.');
    }

    return {
        ...summary,
        eTag: objectResponse.ETag,
    };
}
