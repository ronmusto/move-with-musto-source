// Pure event schema and redaction rules: no filesystem, listing data, or network dependencies.
export const GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION = 'move-with-musto.google-geocode-audit.v1';
export const REDACTED_GEOCODE_REQUEST_COMPONENTS =
    'country:US|administrative_area:MA|postal_code:REDACTED';

export function auditTimestamp(clock = Date.now) {
    const timestamp = new Date(clock());
    if (!Number.isFinite(timestamp.getTime())) {
        throw new Error('The geocode audit clock returned an invalid timestamp.');
    }

    return timestamp.toISOString();
}

export function validIsoTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

const geocodeAuditEventTypes = new Set([
    'run_started',
    'run_completed',
    'run_failed',
    'request_started',
    'request_completed',
    'request_failed',
    'audit_recovery_started',
    'cache_success_recovered',
    'historical_gap',
    'audit_recovery_completed',
]);

const forbiddenGeocodeAuditKeys = new Set([
    'address',
    'apikey',
    'error_message',
    'errormessage',
    'formattedaddress',
    'key',
    'lat',
    'lng',
    'precision',
    'rawresponse',
    'responsebody',
    'result',
    'results',
]);

const allowedGeocodeAuditKeys = new Set([
    'schemaVersion',
    'eventType',
    'occurredAt',
    'provider',
    'outcome',
    'runId',
    'selectedRequestCount',
    'neededRequestCount',
    'deferredRequestCount',
    'completedRequestCount',
    'resolvedRequestCount',
    'unresolvedRequestCount',
    'failureCode',
    'httpStatus',
    'providerStatus',
    'requestId',
    'sequence',
    'listingNumber',
    'addressIdentitySha256',
    'cacheEntryIdentitySha256',
    'requestReason',
    'cacheExpiresAt',
    'httpMethod',
    'requestHost',
    'requestPath',
    'requestComponents',
    'providerSku',
    'transmissionState',
    'recoveryId',
    'recoverySequence',
    'cacheSnapshotIdentitySha256',
    'confirmedCacheEntryCount',
    'recoveryEvidenceIdentitySha256',
    'cacheGeocodedAt',
    'cacheTimestampSemantics',
    'evidenceSource',
    'historicalGapId',
    'historicalGapIdentitySha256',
    'minimumPotentialRequestCount',
    'maximumPotentialRequestCount',
    'reasonCode',
    'recoveredEntryCount',
    'previouslyRecordedEntryCount',
    'historicalGapRecorded',
    'dataPersisted',
]);

export const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha256Pattern = /^[a-f0-9]{64}$/;
const listingNumberPattern = /^\d{1,16}$/;
const nonnegativeIntegerFields = new Set([
    'selectedRequestCount',
    'neededRequestCount',
    'deferredRequestCount',
    'completedRequestCount',
    'resolvedRequestCount',
    'unresolvedRequestCount',
    'confirmedCacheEntryCount',
    'recoveredEntryCount',
    'previouslyRecordedEntryCount',
    'minimumPotentialRequestCount',
    'maximumPotentialRequestCount',
]);
const hashFields = new Set([
    'addressIdentitySha256',
    'cacheEntryIdentitySha256',
    'cacheSnapshotIdentitySha256',
    'recoveryEvidenceIdentitySha256',
    'historicalGapIdentitySha256',
]);
const auditOutcomeByEventType = Object.freeze({
    run_started: new Set(['started']),
    run_completed: new Set(['completed']),
    run_failed: new Set(['failed']),
    request_started: new Set(['prepared']),
    request_completed: new Set(['resolved', 'unresolved']),
    request_failed: new Set(['failed']),
    audit_recovery_started: new Set(['started']),
    cache_success_recovered: new Set(['confirmed_success_recovered']),
    historical_gap: new Set(['uncertain']),
    audit_recovery_completed: new Set(['completed']),
});
const auditFailureCodes = new Set([
    'GEOCODE_REQUEST_FAILED',
    'GOOGLE_NETWORK_ERROR',
    'GOOGLE_HTTP_ERROR',
    'GOOGLE_INVALID_RESPONSE',
    'GOOGLE_STATUS_ERROR',
]);
const googleProviderStatuses = new Set([
    'OVER_DAILY_LIMIT',
    'OVER_QUERY_LIMIT',
    'REQUEST_DENIED',
    'INVALID_REQUEST',
    'UNKNOWN_ERROR',
    'UNKNOWN_STATUS',
]);
const geocodeRequestReasons = new Set(['missing', 'changed', 'expired', 'refresh_due']);

function assertStrictAuditScalarMetadata(event, context) {
    if (!auditOutcomeByEventType[event.eventType]?.has(event.outcome)) {
        throw new Error(`The geocode audit ${context} has an invalid outcome.`);
    }

    for (const key of nonnegativeIntegerFields) {
        if (Object.hasOwn(event, key) && (!Number.isSafeInteger(event[key]) || event[key] < 0)) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    for (const key of hashFields) {
        if (Object.hasOwn(event, key) && !sha256Pattern.test(String(event[key] ?? ''))) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    for (const key of ['cacheExpiresAt', 'cacheGeocodedAt']) {
        if (Object.hasOwn(event, key) && event[key] !== null && !validIsoTimestamp(event[key])) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    if (Object.hasOwn(event, 'failureCode') && !auditFailureCodes.has(event.failureCode)) {
        throw new Error(`The geocode audit ${context} has invalid failureCode.`);
    }
    if (Object.hasOwn(event, 'providerStatus') && !googleProviderStatuses.has(event.providerStatus)) {
        throw new Error(`The geocode audit ${context} has invalid providerStatus.`);
    }
    if (
        Object.hasOwn(event, 'httpStatus') &&
        (!Number.isInteger(event.httpStatus) || event.httpStatus < 100 || event.httpStatus > 599)
    ) {
        throw new Error(`The geocode audit ${context} has invalid httpStatus.`);
    }
    if (Object.hasOwn(event, 'requestReason') && !geocodeRequestReasons.has(event.requestReason)) {
        throw new Error(`The geocode audit ${context} has invalid requestReason.`);
    }
    if (Object.hasOwn(event, 'listingNumber') && !listingNumberPattern.test(event.listingNumber)) {
        throw new Error(`The geocode audit ${context} has invalid listingNumber.`);
    }
    for (const key of ['runId', 'requestId', 'recoveryId']) {
        if (Object.hasOwn(event, key) && !uuidPattern.test(String(event[key] ?? ''))) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    for (const key of ['sequence', 'recoverySequence']) {
        if (Object.hasOwn(event, key) && (!Number.isSafeInteger(event[key]) || event[key] < 1)) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    const fixedRequestMetadata = {
        httpMethod: 'GET',
        requestHost: 'maps.googleapis.com',
        requestPath: '/maps/api/geocode/json',
        providerSku: 'Geocoding',
        transmissionState: 'prepared',
    };
    for (const [key, expected] of Object.entries(fixedRequestMetadata)) {
        if (Object.hasOwn(event, key) && event[key] !== expected) {
            throw new Error(`The geocode audit ${context} has invalid ${key}.`);
        }
    }
    if (
        Object.hasOwn(event, 'requestComponents') &&
        !['country:US', REDACTED_GEOCODE_REQUEST_COMPONENTS].includes(event.requestComponents)
    ) {
        throw new Error(`The geocode audit ${context} has invalid requestComponents.`);
    }
    if (
        Object.hasOwn(event, 'historicalGapId') &&
        !/^pre-ledger-\d{4}-\d{2}-\d{2}$/u.test(event.historicalGapId)
    ) {
        throw new Error(`The geocode audit ${context} has invalid historicalGapId.`);
    }
    if (Object.hasOwn(event, 'reasonCode') && event.reasonCode !== 'INTERRUPTED_BEFORE_AUDIT_LEDGER') {
        throw new Error(`The geocode audit ${context} has invalid reasonCode.`);
    }
    if (
        Object.hasOwn(event, 'cacheTimestampSemantics') &&
        event.cacheTimestampSemantics !== 'ENRICHMENT_RUN_SNAPSHOT_NOT_REQUEST_TIME'
    ) {
        throw new Error(`The geocode audit ${context} has invalid cacheTimestampSemantics.`);
    }
    if (Object.hasOwn(event, 'evidenceSource') && event.evidenceSource !== 'private_geocode_cache') {
        throw new Error(`The geocode audit ${context} has invalid evidenceSource.`);
    }
    if (Object.hasOwn(event, 'historicalGapRecorded') && typeof event.historicalGapRecorded !== 'boolean') {
        throw new Error(`The geocode audit ${context} has invalid historicalGapRecorded.`);
    }
    if (Object.hasOwn(event, 'dataPersisted') && typeof event.dataPersisted !== 'boolean') {
        throw new Error(`The geocode audit ${context} has invalid dataPersisted.`);
    }
}

function assertNoForbiddenAuditFields(value, context = 'event') {
    if (!value || typeof value !== 'object') {
        return;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
        if (forbiddenGeocodeAuditKeys.has(key.toLowerCase())) {
            throw new Error(`The geocode audit ${context} contains forbidden field ${key}.`);
        }
        assertNoForbiddenAuditFields(nestedValue, context);
    }
}

export function assertValidGeocodeAuditEvent(event, context = 'event') {
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
        throw new Error(`The geocode audit ${context} is not a JSON object.`);
    }
    if (event.schemaVersion !== GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION) {
        throw new Error(`The geocode audit ${context} has an unsupported schemaVersion.`);
    }
    if (!geocodeAuditEventTypes.has(event.eventType)) {
        throw new Error(`The geocode audit ${context} has an unsupported eventType.`);
    }
    if (!validIsoTimestamp(event.occurredAt)) {
        throw new Error(`The geocode audit ${context} has an invalid occurredAt timestamp.`);
    }
    if (event.provider !== 'google_geocoding' || typeof event.outcome !== 'string') {
        throw new Error(`The geocode audit ${context} has invalid provider or outcome metadata.`);
    }

    for (const key of Object.keys(event)) {
        if (!allowedGeocodeAuditKeys.has(key)) {
            throw new Error(`The geocode audit ${context} contains unsupported field ${key}.`);
        }
    }
    assertStrictAuditScalarMetadata(event, context);

    if (event.eventType.startsWith('request_')) {
        if (
            !uuidPattern.test(String(event.runId ?? '')) ||
            !uuidPattern.test(String(event.requestId ?? '')) ||
            !Number.isInteger(event.sequence) ||
            event.sequence < 1 ||
            !listingNumberPattern.test(String(event.listingNumber ?? '')) ||
            !sha256Pattern.test(String(event.addressIdentitySha256 ?? '')) ||
            !sha256Pattern.test(String(event.cacheEntryIdentitySha256 ?? ''))
        ) {
            throw new Error(`The geocode audit ${context} has invalid request identity metadata.`);
        }
        if (event.eventType === 'request_started' && (
            event.httpMethod !== 'GET' ||
            event.requestHost !== 'maps.googleapis.com' ||
            event.requestPath !== '/maps/api/geocode/json' ||
            ![
                'country:US',
                REDACTED_GEOCODE_REQUEST_COMPONENTS,
            ].includes(event.requestComponents) ||
            event.providerSku !== 'Geocoding' ||
            event.transmissionState !== 'prepared' ||
            event.outcome !== 'prepared'
        )) {
            throw new Error(`The geocode audit ${context} has invalid prepared-request metadata.`);
        }
    } else if (event.eventType.startsWith('run_') && !uuidPattern.test(String(event.runId ?? ''))) {
        throw new Error(`The geocode audit ${context} has no runId.`);
    } else if (
        (
            event.eventType.startsWith('audit_recovery_') ||
            event.eventType === 'cache_success_recovered' ||
            event.eventType === 'historical_gap'
        ) &&
        !uuidPattern.test(String(event.recoveryId ?? ''))
    ) {
        throw new Error(`The geocode audit ${context} has no recoveryId.`);
    }

    if (event.eventType === 'run_completed' && event.dataPersisted !== true) {
        throw new Error(`The geocode audit ${context} does not confirm final data persistence.`);
    }

    assertNoForbiddenAuditFields(event, context);
}

export function parseGeocodeAuditLedger(text) {
    const ledgerText = String(text ?? '');
    const lines = ledgerText.split(/\r?\n/);
    return lines
        .map((line, index) => ({ line: line.trim(), lineNumber: index + 1, index }))
        .filter(({ line, index }) => {
            if (line) {
                return true;
            }
            const isSingleTrailingTerminator = index === lines.length - 1 && ledgerText.endsWith('\n');
            if (!isSingleTrailingTerminator && ledgerText) {
                throw new Error(`The geocode audit ledger contains a blank record on line ${index + 1}.`);
            }
            return false;
        })
        .map(({ line, lineNumber }) => {
            let event;
            try {
                event = JSON.parse(line);
            } catch {
                throw new Error(`The geocode audit ledger contains invalid JSON on line ${lineNumber}.`);
            }
            assertValidGeocodeAuditEvent(event, `ledger line ${lineNumber}`);
            return event;
        });
}

export function serializeGeocodeAuditEvent(event, {
    context = 'new event',
    sensitiveValues = [],
} = {}) {
    assertValidGeocodeAuditEvent(event, context);
    const serializedEvent = JSON.stringify(event);
    const forbiddenValues = sensitiveValues
        .map((value) => String(value ?? ''))
        .filter(Boolean);
    if (
        /AIza[0-9A-Za-z_-]{20,}/.test(serializedEvent) ||
        forbiddenValues.some((value) => serializedEvent.includes(value))
    ) {
        throw new Error('The geocode audit event contains a sensitive value; refusing to persist it.');
    }

    return serializedEvent;
}

export function safeProviderStatus(value) {
    const status = String(value ?? '').trim().toUpperCase();
    return /^[A-Z_]{1,64}$/.test(status) ? status : null;
}

export function geocodeAuditFailure(error) {
    const failureCode = /^[A-Z_]{1,64}$/.test(String(error?.auditCode ?? ''))
        ? error.auditCode
        : 'GEOCODE_REQUEST_FAILED';
    const failure = { failureCode };

    if (Number.isInteger(error?.httpStatus) && error.httpStatus >= 100 && error.httpStatus <= 599) {
        failure.httpStatus = error.httpStatus;
    }

    const providerStatus = safeProviderStatus(error?.providerStatus);
    if (providerStatus) {
        failure.providerStatus = providerStatus;
    }

    // Deliberately omit error.message, error.cause, response bodies, and other
    // arbitrary values: they can contain the key, address, coordinates, or raw
    // Google result content.
    return failure;
}
