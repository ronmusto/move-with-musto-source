#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import preferredServiceAreaTownList from '../src/lib/preferred-service-area-towns.json' with { type: 'json' };
import { assertMassachusettsListings } from './mls-pin-cleaner-lib.mjs';
import { coordinateIsInMassachusetts } from './massachusetts-coordinate-guard.mjs';
import reviewedCoordinateOverrides from './mls-coordinate-overrides.json' with { type: 'json' };

import {
    auditTimestamp,
    geocodeAuditFailure,
    GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
    parseGeocodeAuditLedger,
    REDACTED_GEOCODE_REQUEST_COMPONENTS,
    safeProviderStatus,
    validIsoTimestamp,
} from './geocode/audit-events.mjs';
import {
    acquireGeocodeRunLock,
    createGeocodeAuditWriter,
    createImmutableGeocodeAuditMirror,
} from './geocode/audit-storage.mjs';

// Preserve the existing CLI/library API while the implementations have focused owners.
export {
    assertValidGeocodeAuditEvent,
    GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
    parseGeocodeAuditLedger,
} from './geocode/audit-events.mjs';
export {
    acquireGeocodeRunLock,
    createGeocodeAuditWriter,
    createImmutableGeocodeAuditMirror,
} from './geocode/audit-storage.mjs';

export const GOOGLE_GEOCODE_CACHE_SCHEMA_VERSION = 'move-with-musto.google-geocode-cache.v1';
export const GOOGLE_GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MLS_INGEST_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
export const GOOGLE_GEOCODE_ROTATION_CYCLES = 8;
// Eight three-day ingest cycles refresh the service-area cache in about 24
// days. The remaining six days are recovery margin before Google's 30-day
// cache boundary.
export const GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS =
    MLS_INGEST_INTERVAL_MS * GOOGLE_GEOCODE_ROTATION_CYCLES;
export const GOOGLE_GEOCODE_REFRESH_WINDOW_MS =
    GOOGLE_GEOCODE_CACHE_TTL_MS - GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS;
export const GOOGLE_GEOCODE_LIST_PRICE_USD_PER_REQUEST = 0.005;
export const GOOGLE_GEOCODE_MONTHLY_FREE_USAGE_CAP = 10_000;
export const PROJECTED_30_DAY_INGEST_CYCLES = 10;
export const DEFAULT_GEOCODE_CHECKPOINT_EVERY = 25;
export const MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION = 500;
export const MAX_EMERGENCY_URGENT_ONLY_REQUESTS = 2_000;

const defaultOutputDir = '.mls-publish';
const defaultCachePath = '.mls-geocode-cache/google-geocoding-cache.json';
export const DEFAULT_GEOCODE_AUDIT_LOG_PATH = '.mls-geocode-audit/google-geocoding-requests.jsonl';
export const PREFERRED_SERVICE_AREA_TOWNS = Object.freeze([...preferredServiceAreaTownList]);
const preferredServiceAreaTowns = new Set(
    PREFERRED_SERVICE_AREA_TOWNS.map((town) => town.toUpperCase()),
);
const reviewedCoordinateEntries = reviewedCoordinateOverrides?.entries ?? {};

function parseNonNegativeInteger(flag, value, minimum = 0) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum) {
        throw new Error(`${flag} requires an integer of at least ${minimum}.`);
    }

    return parsed;
}

export function parseArgs(argv) {
    const args = {
        output: defaultOutputDir,
        cache: defaultCachePath,
        auditLog: DEFAULT_GEOCODE_AUDIT_LOG_PATH,
        immutableAuditBucket: null,
        immutableAuditPrefix: null,
        limit: Number.POSITIVE_INFINITY,
        dryRun: false,
        allowLargeRun: false,
        batchSize: 0,
        batchIndex: 0,
        emergencyUrgentOnly: false,
        includeProactiveRefresh: false,
        proactiveRefreshLimit: 0,
        preferredOnly: false,
        checkpointEvery: DEFAULT_GEOCODE_CHECKPOINT_EVERY,
        recoverAuditFromCache: false,
        auditGapMaxRequests: 0,
        auditGapId: null,
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        const hasValue = typeof next === 'string' && !next.startsWith('--');

        if (arg === '--output' && hasValue) {
            args.output = next;
            index += 1;
        } else if (arg === '--cache' && hasValue) {
            args.cache = next;
            index += 1;
        } else if (arg === '--audit-log' && hasValue) {
            args.auditLog = next;
            index += 1;
        } else if (arg.startsWith('--audit-log=')) {
            const auditLog = arg.slice('--audit-log='.length).trim();
            if (!auditLog) {
                throw new Error('--audit-log requires a value.');
            }
            args.auditLog = auditLog;
        } else if (arg === '--immutable-audit-bucket' && hasValue) {
            args.immutableAuditBucket = next;
            index += 1;
        } else if (arg.startsWith('--immutable-audit-bucket=')) {
            const immutableAuditBucket = arg.slice('--immutable-audit-bucket='.length).trim();
            if (!immutableAuditBucket) {
                throw new Error('--immutable-audit-bucket requires a value.');
            }
            args.immutableAuditBucket = immutableAuditBucket;
        } else if (arg === '--immutable-audit-prefix' && hasValue) {
            args.immutableAuditPrefix = next;
            index += 1;
        } else if (arg.startsWith('--immutable-audit-prefix=')) {
            const immutableAuditPrefix = arg.slice('--immutable-audit-prefix='.length).trim();
            if (!immutableAuditPrefix) {
                throw new Error('--immutable-audit-prefix requires a value.');
            }
            args.immutableAuditPrefix = immutableAuditPrefix;
        } else if (arg === '--batch-size' && hasValue) {
            args.batchSize = parseNonNegativeInteger('--batch-size', next);
            index += 1;
        } else if (arg === '--batch-index' && hasValue) {
            args.batchIndex = parseNonNegativeInteger('--batch-index', next);
            index += 1;
        } else if (arg === '--limit' && hasValue) {
            args.limit = parseNonNegativeInteger('--limit', next);
            index += 1;
        } else if (arg.startsWith('--limit=')) {
            args.limit = parseNonNegativeInteger('--limit', arg.slice('--limit='.length));
        } else if (arg === '--checkpoint-every' && hasValue) {
            args.checkpointEvery = parseNonNegativeInteger('--checkpoint-every', next, 1);
            index += 1;
        } else if (arg.startsWith('--checkpoint-every=')) {
            args.checkpointEvery = parseNonNegativeInteger(
                '--checkpoint-every',
                arg.slice('--checkpoint-every='.length),
                1,
            );
        } else if (arg === '--audit-gap-max-requests' && hasValue) {
            args.auditGapMaxRequests = parseNonNegativeInteger('--audit-gap-max-requests', next);
            index += 1;
        } else if (arg.startsWith('--audit-gap-max-requests=')) {
            args.auditGapMaxRequests = parseNonNegativeInteger(
                '--audit-gap-max-requests',
                arg.slice('--audit-gap-max-requests='.length),
            );
        } else if (arg === '--audit-gap-id' && hasValue) {
            args.auditGapId = next;
            index += 1;
        } else if (arg.startsWith('--audit-gap-id=')) {
            const auditGapId = arg.slice('--audit-gap-id='.length).trim();
            if (!auditGapId) {
                throw new Error('--audit-gap-id requires a value.');
            }
            args.auditGapId = auditGapId;
        } else if (arg === '--dry-run' || arg === '--no-network') {
            args.dryRun = true;
        } else if (arg === '--allow-large-run') {
            args.allowLargeRun = true;
        } else if (arg === '--emergency-urgent-only') {
            args.emergencyUrgentOnly = true;
        } else if (arg === '--include-proactive-refresh') {
            args.includeProactiveRefresh = true;
        } else if (arg === '--proactive-refresh-limit' && hasValue) {
            args.proactiveRefreshLimit = parseNonNegativeInteger(
                '--proactive-refresh-limit',
                next,
                1,
            );
            index += 1;
        } else if (arg.startsWith('--proactive-refresh-limit=')) {
            args.proactiveRefreshLimit = parseNonNegativeInteger(
                '--proactive-refresh-limit',
                arg.slice('--proactive-refresh-limit='.length),
                1,
            );
        } else if (arg === '--preferred-only' || arg === '--service-area-only') {
            args.preferredOnly = true;
        } else if (arg === '--recover-audit-from-cache') {
            args.recoverAuditFromCache = true;
        } else if (
            arg === '--output' ||
            arg === '--cache' ||
            arg === '--audit-log' ||
            arg === '--immutable-audit-bucket' ||
            arg === '--immutable-audit-prefix' ||
            arg === '--batch-size' ||
            arg === '--batch-index' ||
            arg === '--limit' ||
            arg === '--proactive-refresh-limit' ||
            arg === '--checkpoint-every' ||
            arg === '--audit-gap-max-requests' ||
            arg === '--audit-gap-id'
        ) {
            throw new Error(`${arg} requires a value.`);
        } else {
            throw new Error(`Unknown MLS geocode option: ${arg}`);
        }
    }

    if (Boolean(args.immutableAuditBucket) !== Boolean(args.immutableAuditPrefix)) {
        throw new Error(
            '--immutable-audit-bucket and --immutable-audit-prefix must be provided together.',
        );
    }

    if (args.includeProactiveRefresh !== (args.proactiveRefreshLimit > 0)) {
        throw new Error(
            '--include-proactive-refresh and a positive --proactive-refresh-limit must be provided together.',
        );
    }
    if (args.proactiveRefreshLimit > MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION) {
        throw new Error(
            `--proactive-refresh-limit cannot exceed ${MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION}.`,
        );
    }
    if (args.emergencyUrgentOnly && args.includeProactiveRefresh) {
        throw new Error(
            '--emergency-urgent-only cannot be combined with proactive refresh options.',
        );
    }

    return args;
}

async function loadDotEnv(envPath = '.env') {
    try {
        const text = await readFile(envPath, 'utf8');
        text.split(/\r?\n/).forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex < 1) {
                return;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            const value = trimmed.slice(separatorIndex + 1).trim().replace(/^"|"$/g, '');
            if (key && process.env[key] === undefined) {
                process.env[key] = value;
            }
        });
    } catch {
        // Optional convenience for local runs.
    }
}

async function readJson(filePath, fallback = null) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return fallback;
        }

        throw new Error(`Unable to read JSON from ${filePath}: ${error.message}`, { cause: error });
    }
}

async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonAtomic(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
}

function sha256(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function geocodeRequestIdentity(listing) {
    return {
        listingNumber: String(listing.listingNumber ?? '').trim(),
        addressIdentitySha256: sha256(addressKey(listing)),
        cacheEntryIdentitySha256: sha256(geocodeCacheKey(listing)),
    };
}

function geocodeRequestError(message, auditMetadata) {
    const error = new Error(message);
    Object.assign(error, auditMetadata);
    return error;
}

function normalizeAddressPart(value) {
    return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function addressLabel(listing) {
    return [
        listing.address?.line,
        listing.address?.town,
        listing.address?.state,
        listing.address?.zip,
        'USA',
    ].filter(Boolean).join(', ');
}

function addressKey(listing) {
    return [
        listing.address?.line,
        listing.address?.town,
        listing.address?.state,
        listing.address?.zip,
    ].map(normalizeAddressPart).join('|');
}

export function geocodeCacheKey(listing) {
    return `${normalizeAddressPart(listing.listingNumber)}|${addressKey(listing)}`;
}

function reviewedCoordinateForListing(listing, now) {
    const override = reviewedCoordinateEntries[geocodeCacheKey(listing)];
    if (
        !override ||
        normalizedListingNumber(override.listingNumber) !== normalizedListingNumber(listing.listingNumber) ||
        normalizeAddressPart(override.addressKey) !== normalizeAddressPart(addressKey(listing)) ||
        !coordinateIsInMassachusetts(override)
    ) {
        return null;
    }

    return {
        lat: override.lat,
        lng: override.lng,
        source: override.source,
        precision: override.precision,
        geocodedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString(),
    };
}

export function isFreshMapPosition(mapPosition, now = Date.now()) {
    if (!mapPosition || typeof mapPosition !== 'object') {
        return false;
    }

    const geocodedAt = Date.parse(mapPosition.geocodedAt);
    const expiresAt = Date.parse(mapPosition.expiresAt);
    return Number.isFinite(mapPosition.lat) &&
        Number.isFinite(mapPosition.lng) &&
        Number.isFinite(geocodedAt) &&
        Number.isFinite(expiresAt) &&
        geocodedAt <= now &&
        expiresAt > now &&
        expiresAt - geocodedAt <= GOOGLE_GEOCODE_CACHE_TTL_MS;
}

export function mapPositionNeedsRefresh(mapPosition, now = Date.now()) {
    if (!isFreshMapPosition(mapPosition, now)) {
        return true;
    }

    return Date.parse(mapPosition.expiresAt) <= now + GOOGLE_GEOCODE_REFRESH_WINDOW_MS;
}

function validRotationDueAt(entry) {
    const dueAt = Date.parse(entry?.rotationDueAt);
    const geocodedAt = Date.parse(entry?.geocodedAt);
    const expiresAt = Date.parse(entry?.expiresAt);
    return Number.isFinite(dueAt) &&
        Number.isFinite(geocodedAt) &&
        Number.isFinite(expiresAt) &&
        dueAt >= geocodedAt &&
        dueAt <= expiresAt;
}

function rotationDueTimestamp(entry) {
    return validRotationDueAt(entry) ? Date.parse(entry.rotationDueAt) : null;
}

function rotationSortTimestamp(entry) {
    const lastAttemptedAt = Date.parse(entry?.lastRefreshAttemptAt);
    if (Number.isFinite(lastAttemptedAt)) {
        return lastAttemptedAt;
    }

    const geocodedAt = Date.parse(entry?.geocodedAt);
    return Number.isFinite(geocodedAt) ? geocodedAt : Number.POSITIVE_INFINITY;
}

function compareRotationCandidates(first, second) {
    return rotationSortTimestamp(first.entry) - rotationSortTimestamp(second.entry) ||
        Date.parse(first.entry.expiresAt) - Date.parse(second.entry.expiresAt) ||
        first.listingNumber.localeCompare(second.listingNumber) ||
        first.cacheKey.localeCompare(second.cacheKey);
}

function initialRotationSchedule(candidates, now) {
    if (candidates.length === 0) {
        return [];
    }

    const scheduled = candidates.filter(({ entry }) => validRotationDueAt(entry));
    const unscheduled = candidates
        .filter(({ entry }) => !validRotationDueAt(entry))
        .sort(compareRotationCandidates);
    if (unscheduled.length === 0) {
        return [];
    }

    const perCycleTarget = Math.ceil(candidates.length / GOOGLE_GEOCODE_ROTATION_CYCLES);
    const cycleLoads = Array.from({ length: GOOGLE_GEOCODE_ROTATION_CYCLES }, () => 0);
    for (const { entry } of scheduled) {
        const dueAt = rotationDueTimestamp(entry);
        const cycleIndex = Math.max(0, Math.min(
            GOOGLE_GEOCODE_ROTATION_CYCLES - 1,
            Math.ceil((dueAt - now) / MLS_INGEST_INTERVAL_MS),
        ));
        cycleLoads[cycleIndex] += 1;
    }

    return unscheduled.map((candidate) => {
        let cycleIndex = cycleLoads.findIndex((count) => count < perCycleTarget);
        if (cycleIndex < 0) {
            cycleIndex = GOOGLE_GEOCODE_ROTATION_CYCLES - 1;
        }
        cycleLoads[cycleIndex] += 1;

        const geocodedAt = Date.parse(candidate.entry.geocodedAt);
        const expiresAt = Date.parse(candidate.entry.expiresAt);
        const targetRefreshAt = geocodedAt + GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS;
        const staggeredRefreshAt = now + (cycleIndex * MLS_INGEST_INTERVAL_MS);
        const dueAt = Math.max(
            now,
            Math.min(staggeredRefreshAt, targetRefreshAt, expiresAt),
        );
        return {
            cacheKey: candidate.cacheKey,
            rotationDueAt: new Date(dueAt).toISOString(),
        };
    });
}

function rotationTargetDeadlineTimestamp(entry) {
    return Math.min(
        Date.parse(entry.geocodedAt) + GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS,
        Date.parse(entry.expiresAt),
    );
}

function analyzeRotationDeadlineCapacity({
    candidates,
    deadlineForEntry,
    requestLimit,
    urgentRequestCount,
    now,
}) {
    if (!Number.isFinite(requestLimit)) {
        return {
            withinCapacity: true,
            firstViolation: null,
        };
    }

    const deadlineGroups = new Map();
    for (const candidate of candidates) {
        const deadline = deadlineForEntry(candidate.entry);
        deadlineGroups.set(deadline, (deadlineGroups.get(deadline) ?? 0) + 1);
    }

    let requiredRequests = urgentRequestCount;
    for (const [deadline, count] of [...deadlineGroups].sort(
        ([first], [second]) => first - second,
    )) {
        requiredRequests += count;
        const cyclesAvailable = Math.max(
            1,
            Math.floor((deadline - now) / MLS_INGEST_INTERVAL_MS) + 1,
        );
        const availableRequests = cyclesAvailable * requestLimit;
        if (requiredRequests > availableRequests) {
            return {
                withinCapacity: false,
                firstViolation: {
                    deadline: new Date(deadline).toISOString(),
                    cyclesAvailable,
                    requiredRequests,
                    availableRequests,
                    shortfall: requiredRequests - availableRequests,
                },
            };
        }
    }

    return {
        withinCapacity: true,
        firstViolation: null,
    };
}

function publicMapPositionFromCacheEntry(entry) {
    return {
        lat: entry.lat,
        lng: entry.lng,
        source: 'google_geocoding',
        precision: entry.precision,
        geocodedAt: entry.geocodedAt,
        expiresAt: entry.expiresAt,
    };
}

function cacheEntryFromGeocode(listing, result, now) {
    const geocodedAt = new Date(now).toISOString();
    const expiresAt = new Date(now + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString();

    return {
        listingNumber: listing.listingNumber,
        address: addressLabel(listing),
        addressKey: addressKey(listing),
        lat: result.lat,
        lng: result.lng,
        precision: result.precision,
        validation: result.validation,
        validatedState: result.validatedState,
        validatedPostalCode: result.validatedPostalCode,
        geocodedAt,
        expiresAt,
    };
}

function normalizedCache(cache, now = Date.now()) {
    return {
        schemaVersion: GOOGLE_GEOCODE_CACHE_SCHEMA_VERSION,
        provider: 'google_geocoding',
        cacheTtlDays: 30,
        updatedAt: new Date(now).toISOString(),
        entries: cache?.entries && typeof cache.entries === 'object' ? cache.entries : {},
    };
}

async function readGeocodeAuditEvents(filePath) {
    let text;
    try {
        text = await readFile(filePath, 'utf8');
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    if (text && !text.endsWith('\n')) {
        throw new Error('The geocode audit ledger ends with an incomplete JSONL record.');
    }
    return parseGeocodeAuditLedger(text);
}

function cacheRecoveryEvidenceIdentity(cacheKey, entry) {
    return sha256([
        cacheKey,
        entry?.geocodedAt ?? '',
        entry?.expiresAt ?? '',
    ].join('|'));
}

function recoverableCacheEntries(cache) {
    const entries = cache?.entries && typeof cache.entries === 'object'
        ? Object.entries(cache.entries)
        : [];

    return entries
        .filter(([, entry]) => (
            entry &&
            typeof entry === 'object' &&
            String(entry.listingNumber ?? '').trim() &&
            Number.isFinite(entry.lat) &&
            Number.isFinite(entry.lng) &&
            validIsoTimestamp(entry.geocodedAt) &&
            validIsoTimestamp(entry.expiresAt)
        ))
        .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey));
}

/**
 * Backfills evidence from an interrupted pre-ledger run without making a
 * network request or inventing per-request start/completion events. Re-running
 * against the same cache snapshot is idempotent for recovered entries and the
 * bounded historical gap, while the JSONL file itself remains append-only.
 */
export async function recoverGeocodeAuditFromCache({
    auditClock = Date.now,
    auditLogPath = DEFAULT_GEOCODE_AUDIT_LOG_PATH,
    cache,
    historicalGapId = '',
    maxUnloggedRequestCount = 0,
    onAuditEvent = null,
    recoveryId = randomUUID(),
}) {
    const safeGapMaximum = parseNonNegativeInteger(
        'maxUnloggedRequestCount',
        maxUnloggedRequestCount,
    );
    const safeHistoricalGapId = String(historicalGapId ?? '').trim();
    if (safeGapMaximum > 0 && !/^[a-z0-9._-]{1,128}$/i.test(safeHistoricalGapId)) {
        throw new Error(
            'historicalGapId is required for a nonzero gap and may contain only letters, numbers, dot, underscore, and hyphen.',
        );
    }
    const appendAuditEvent = onAuditEvent ?? createGeocodeAuditWriter(auditLogPath);
    const existingEvents = await readGeocodeAuditEvents(auditLogPath);
    const recoveredEvidence = new Set(
        existingEvents
            .filter((event) => event.eventType === 'cache_success_recovered')
            .map((event) => event.recoveryEvidenceIdentitySha256)
            .filter(Boolean),
    );
    const completedCacheEvidence = new Set(
        existingEvents
            .filter((event) => event.eventType === 'request_completed' && event.outcome === 'resolved')
            .map((event) => `${event.cacheEntryIdentitySha256}|${event.cacheExpiresAt}`)
            .filter(Boolean),
    );
    const existingGaps = new Map(
        existingEvents
            .filter((event) => event.eventType === 'historical_gap')
            .map((event) => [event.historicalGapIdentitySha256, event]),
    );
    const entries = recoverableCacheEntries(cache);
    const cacheSnapshotIdentitySha256 = sha256(entries
        .map(([cacheKey, entry]) => cacheRecoveryEvidenceIdentity(cacheKey, entry))
        .join('|'));
    const historicalGapIdentitySha256 = safeHistoricalGapId
        ? sha256(`historical_gap|${safeHistoricalGapId}`)
        : null;
    const existingGap = historicalGapIdentitySha256
        ? existingGaps.get(historicalGapIdentitySha256)
        : null;
    if (
        existingGap &&
        existingGap.maximumPotentialRequestCount !== safeGapMaximum
    ) {
        throw new Error(
            `Historical gap ${safeHistoricalGapId} already exists with a different maximum request count.`,
        );
    }
    let recovered = 0;
    let alreadyRecorded = 0;

    await appendAuditEvent({
        schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
        eventType: 'audit_recovery_started',
        occurredAt: auditTimestamp(auditClock),
        provider: 'google_geocoding',
        recoveryId,
        cacheSnapshotIdentitySha256,
        confirmedCacheEntryCount: entries.length,
        outcome: 'started',
    });

    for (let index = 0; index < entries.length; index += 1) {
        const [cacheKey, entry] = entries[index];
        const recoveryEvidenceIdentitySha256 = cacheRecoveryEvidenceIdentity(cacheKey, entry);
        const cacheEntryIdentitySha256 = sha256(cacheKey);
        const completedEvidenceKey = `${cacheEntryIdentitySha256}|${validIsoTimestamp(entry.expiresAt)}`;
        if (
            recoveredEvidence.has(recoveryEvidenceIdentitySha256) ||
            completedCacheEvidence.has(completedEvidenceKey)
        ) {
            alreadyRecorded += 1;
            continue;
        }

        await appendAuditEvent({
            schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
            eventType: 'cache_success_recovered',
            occurredAt: auditTimestamp(auditClock),
            provider: 'google_geocoding',
            recoveryId,
            recoverySequence: index + 1,
            listingNumber: String(entry.listingNumber).trim(),
            addressIdentitySha256: sha256(entry.addressKey ?? cacheKey),
            cacheEntryIdentitySha256,
            recoveryEvidenceIdentitySha256,
            cacheGeocodedAt: validIsoTimestamp(entry.geocodedAt),
            cacheExpiresAt: validIsoTimestamp(entry.expiresAt),
            cacheTimestampSemantics: 'ENRICHMENT_RUN_SNAPSHOT_NOT_REQUEST_TIME',
            evidenceSource: 'private_geocode_cache',
            outcome: 'confirmed_success_recovered',
        });
        recoveredEvidence.add(recoveryEvidenceIdentitySha256);
        recovered += 1;
    }

    let historicalGapRecorded = false;
    if (safeGapMaximum > 0 && !existingGap) {
        await appendAuditEvent({
            schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
            eventType: 'historical_gap',
            occurredAt: auditTimestamp(auditClock),
            provider: 'google_geocoding',
            recoveryId,
            historicalGapId: safeHistoricalGapId,
            historicalGapIdentitySha256,
            cacheSnapshotIdentitySha256,
            minimumPotentialRequestCount: 0,
            maximumPotentialRequestCount: safeGapMaximum,
            reasonCode: 'INTERRUPTED_BEFORE_AUDIT_LEDGER',
            outcome: 'uncertain',
        });
        historicalGapRecorded = true;
    }

    await appendAuditEvent({
        schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
        eventType: 'audit_recovery_completed',
        occurredAt: auditTimestamp(auditClock),
        provider: 'google_geocoding',
        recoveryId,
        cacheSnapshotIdentitySha256,
        confirmedCacheEntryCount: entries.length,
        recoveredEntryCount: recovered,
        previouslyRecordedEntryCount: alreadyRecorded,
        historicalGapRecorded,
        outcome: 'completed',
    });

    return {
        cacheSnapshotIdentitySha256,
        confirmedCacheEntryCount: entries.length,
        recoveredEntryCount: recovered,
        previouslyRecordedEntryCount: alreadyRecorded,
        historicalGapRecorded,
    };
}

function normalizedListingNumber(value) {
    return normalizeAddressPart(value);
}

function cacheEntryListingNumber(cacheKey, entry) {
    return normalizedListingNumber(entry?.listingNumber || String(cacheKey).split('|')[0]);
}

function cacheEntryMatchesListing(entry, listing) {
    return normalizedListingNumber(entry?.listingNumber) === normalizedListingNumber(listing.listingNumber) &&
        normalizeAddressPart(entry?.addressKey) === normalizeAddressPart(addressKey(listing)) &&
        (
            !isPreferredServiceAreaListing(listing) ||
            coordinateIsInMassachusetts(entry)
        );
}

export function pruneGeocodeCacheEntries(
    cache,
    index,
    now = Date.now(),
    { preferredOnly = false } = {},
) {
    if (!index || !Array.isArray(index.listings)) {
        throw new Error('MLS geocode input is missing listings.');
    }

    const activeListingsByKey = new Map(
        index.listings.map((listing) => [geocodeCacheKey(listing), listing]),
    );

    return Object.fromEntries(Object.entries(normalizedCache(cache, now).entries).filter(
        ([cacheKey, entry]) => {
            const listing = activeListingsByKey.get(cacheKey);
            return Boolean(
                listing &&
                (!preferredOnly || isPreferredServiceAreaListing(listing)) &&
                isFreshMapPosition(entry, now) &&
                cacheEntryMatchesListing(entry, listing),
            );
        },
    ));
}

function normalizedRequestLimit(limit) {
    return Number.isFinite(limit)
        ? Math.max(0, Math.trunc(limit))
        : Number.POSITIVE_INFINITY;
}

function roundedUsd(value) {
    return Number(value.toFixed(3));
}

export function estimateGeocodeCost(requestCount) {
    const requests = Math.max(0, Math.trunc(Number(requestCount) || 0));
    return {
        requests,
        grossListPriceUsd: roundedUsd(requests * GOOGLE_GEOCODE_LIST_PRICE_USD_PER_REQUEST),
        withFullMonthlyFreeUsageAvailableUsd: roundedUsd(
            Math.max(0, requests - GOOGLE_GEOCODE_MONTHLY_FREE_USAGE_CAP) *
                GOOGLE_GEOCODE_LIST_PRICE_USD_PER_REQUEST,
        ),
    };
}

export function isPreferredServiceAreaListing(listing) {
    return normalizeAddressPart(listing?.address?.state).toUpperCase() === 'MA' &&
        preferredServiceAreaTowns.has(normalizeAddressPart(listing?.address?.town).toUpperCase());
}

export function buildGeocodePlan({
    cache,
    emergencyUrgentOnly = false,
    includeProactiveRefresh = false,
    index,
    batchSize = 0,
    batchIndex = 0,
    limit = Number.POSITIVE_INFINITY,
    now = Date.now(),
    preferredOnly = false,
    proactiveRefreshLimit = 0,
}) {
    if (!index || !Array.isArray(index.listings)) {
        throw new Error('MLS search index is missing listings.');
    }
    assertMassachusettsListings(index.listings, 'MLS geocode input');

    const normalizedProactiveRefreshLimit = normalizedRequestLimit(proactiveRefreshLimit);
    if (includeProactiveRefresh !== (normalizedProactiveRefreshLimit > 0)) {
        throw new Error(
            'Proactive refresh requires both includeProactiveRefresh and a positive proactiveRefreshLimit.',
        );
    }
    if (normalizedProactiveRefreshLimit > MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION) {
        throw new Error(
            `proactiveRefreshLimit cannot exceed ${MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION}.`,
        );
    }
    if (emergencyUrgentOnly && includeProactiveRefresh) {
        throw new Error(
            'emergencyUrgentOnly cannot be combined with proactive refresh options.',
        );
    }

    if (!Number.isSafeInteger(batchSize) || batchSize < 0 || batchSize > 900 ||
        !Number.isSafeInteger(batchIndex) || batchIndex < 0 || (!batchSize && batchIndex)) {
        throw new Error('Invalid geocoding batch: size must be 0..900 and index must be nonnegative.');
    }
    if (batchSize && (includeProactiveRefresh || emergencyUrgentOnly || Number.isFinite(limit))) {
        throw new Error('Automatic batches require uncapped urgent-only selection.');
    }
    const partitionListings = index.listings
        .map((listing, listingIndex) => ({ listing, listingIndex, key: geocodeCacheKey(listing) }))
        .filter(({ listing }) => !preferredOnly || isPreferredServiceAreaListing(listing))
        .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    const batchCount = batchSize ? Math.max(1, Math.ceil(partitionListings.length / batchSize)) : 1;
    if (batchIndex >= batchCount) throw new Error('Geocoding batch index exceeds the source inventory.');
    const partitionIndices = batchSize ? new Set(partitionListings
        .slice(batchIndex * batchSize, (batchIndex + 1) * batchSize)
        .map(({ listingIndex }) => listingIndex)) : null;
    const batch = batchSize ? {
        schemaVersion: 1, index: batchIndex, count: batchCount, size: batchSize,
        fingerprint: createHash('sha256').update(JSON.stringify(partitionListings.map(({ key }) => key))).digest('hex'),
    } : null;
    const entries = normalizedCache(cache, now).entries;
    const entriesByListingNumber = new Map();
    for (const [cacheKey, entry] of Object.entries(entries)) {
        const listingNumber = cacheEntryListingNumber(cacheKey, entry);
        if (!listingNumber) {
            continue;
        }

        const existing = entriesByListingNumber.get(listingNumber) ?? [];
        existing.push({ cacheKey, entry });
        entriesByListingNumber.set(listingNumber, existing);
    }

    const counts = {
        totalListings: index.listings.length,
        preferredListings: 0,
        excludedOutsidePreferredScope: 0,
        cached: 0,
        fresh: 0,
        refreshDue: 0,
        missing: 0,
        expired: 0,
        changed: 0,
    };
    const urgentItems = [];
    const rotationCandidates = [];

    index.listings.forEach((listing, listingIndex) => {
        const cacheKey = geocodeCacheKey(listing);
        const exactEntry = entries[cacheKey];
        const preferred = isPreferredServiceAreaListing(listing);
        let reason;

        if (preferred) {
            counts.preferredListings += 1;
        }
        if (preferredOnly && !preferred) {
            counts.excludedOutsidePreferredScope += 1;
            return;
        }

        if (reviewedCoordinateForListing(listing, now)) {
            counts.cached += 1;
            counts.fresh += 1;
            return;
        }

        if (exactEntry && cacheEntryMatchesListing(exactEntry, listing)) {
            counts.cached += 1;
            if (isFreshMapPosition(exactEntry, now)) {
                rotationCandidates.push({
                    cacheKey,
                    entry: exactEntry,
                    listingIndex,
                    listingNumber: String(listing.listingNumber ?? '').trim(),
                    town: String(listing.address?.town ?? '').trim(),
                    state: String(listing.address?.state ?? '').trim(),
                    preferred,
                });
                return;
            } else {
                reason = 'expired';
            }
        } else {
            const priorEntries = entriesByListingNumber.get(
                normalizedListingNumber(listing.listingNumber),
            ) ?? [];
            reason = priorEntries.length > 0 ? 'changed' : 'missing';
        }

        counts[reason] += 1;
        urgentItems.push({
            listingIndex,
            listingNumber: String(listing.listingNumber ?? '').trim(),
            town: String(listing.address?.town ?? '').trim(),
            state: String(listing.address?.state ?? '').trim(),
            reason,
            preferred,
        });
    });

    const scheduleUpdates = initialRotationSchedule(rotationCandidates, now);
    const scheduledDueAtByKey = new Map(
        scheduleUpdates.map((update) => [update.cacheKey, Date.parse(update.rotationDueAt)]),
    );
    const rotationItems = rotationCandidates
        .map((candidate) => ({
            ...candidate,
            reason: 'refresh_due',
            rotationDueAt: scheduledDueAtByKey.get(candidate.cacheKey) ??
                rotationDueTimestamp(candidate.entry),
        }))
        .filter((candidate) => candidate.rotationDueAt <= now);
    counts.refreshDue = rotationItems.length;
    counts.fresh += rotationCandidates.length - rotationItems.length;

    const reasonPriority = new Map([
        ['expired', 0],
        ['changed', 1],
        ['missing', 2],
        ['refresh_due', 3],
    ]);
    const workItems = [...urgentItems, ...rotationItems];
    workItems.sort((first, second) => {
        if (first.preferred !== second.preferred) {
            return first.preferred ? -1 : 1;
        }

        const reasonDifference = reasonPriority.get(first.reason) - reasonPriority.get(second.reason);
        if (reasonDifference !== 0) {
            return reasonDifference;
        }

        if (first.reason === 'refresh_due' && second.reason === 'refresh_due') {
            const dueDifference = first.rotationDueAt - second.rotationDueAt;
            if (dueDifference !== 0) {
                return dueDifference;
            }
        }

        return first.listingNumber.localeCompare(second.listingNumber) ||
            first.listingIndex - second.listingIndex;
    });

    const requestLimit = normalizedRequestLimit(limit);
    const orderedUrgentItems = workItems.filter((item) => item.reason !== 'refresh_due');
    const orderedProactiveItems = workItems.filter((item) => item.reason === 'refresh_due');
    const selectedUrgentItems = orderedUrgentItems
        .filter((item) => !partitionIndices || partitionIndices.has(item.listingIndex))
        .slice(0, requestLimit);
    const remainingOverallSlots = Number.isFinite(requestLimit)
        ? Math.max(0, requestLimit - selectedUrgentItems.length)
        : Number.POSITIVE_INFINITY;
    const proactiveSelectionEnabled = includeProactiveRefresh;
    const selectedProactiveItems = proactiveSelectionEnabled
        ? orderedProactiveItems.slice(
            0,
            Math.min(normalizedProactiveRefreshLimit, remainingOverallSlots),
        )
        : [];
    const selectedItems = [...selectedUrgentItems, ...selectedProactiveItems];
    const preferredNeeded = workItems.filter((item) => item.preferred).length;
    const preferredSelected = selectedItems.filter((item) => item.preferred).length;
    const requestEligibleListings = urgentItems.length + rotationCandidates.length;
    const targetRequestsPerCycle = Math.ceil(
        requestEligibleListings / GOOGLE_GEOCODE_ROTATION_CYCLES,
    );
    const proactiveRequestsPerCycle = proactiveSelectionEnabled
        ? Math.min(requestLimit, normalizedProactiveRefreshLimit)
        : 0;
    const configuredCapacity = Number.isFinite(proactiveRequestsPerCycle)
        ? proactiveRequestsPerCycle * GOOGLE_GEOCODE_ROTATION_CYCLES
        : Number.POSITIVE_INFINITY;
    const projectedThirtyDayRequests = targetRequestsPerCycle * PROJECTED_30_DAY_INGEST_CYCLES;
    const targetDeadlineCapacity = analyzeRotationDeadlineCapacity({
        candidates: rotationCandidates,
        deadlineForEntry: rotationTargetDeadlineTimestamp,
        requestLimit: proactiveRequestsPerCycle,
        urgentRequestCount: urgentItems.length,
        now,
    });
    const deadlineCapacity = analyzeRotationDeadlineCapacity({
        candidates: rotationCandidates,
        deadlineForEntry: (entry) => Date.parse(entry.expiresAt),
        requestLimit: proactiveRequestsPerCycle,
        urgentRequestCount: urgentItems.length,
        now,
    });

    return {
        generatedAt: new Date(now).toISOString(),
        scope: preferredOnly ? 'preferred-service-area' : 'all-reviewed-listings',
        cacheTtlDays: GOOGLE_GEOCODE_CACHE_TTL_MS / (24 * 60 * 60 * 1000),
        counts,
        requests: {
            needed: workItems.length,
            selected: selectedItems.length,
            deferred: workItems.length - selectedItems.length,
            preferredNeeded,
            preferredSelected,
            urgent: {
                needed: orderedUrgentItems.length,
                selected: selectedUrgentItems.length,
                deferred: orderedUrgentItems.length - selectedUrgentItems.length,
            },
            proactive: {
                enabled: proactiveSelectionEnabled,
                configuredLimit: proactiveSelectionEnabled
                    ? normalizedProactiveRefreshLimit
                    : 0,
                due: orderedProactiveItems.length,
                selected: selectedProactiveItems.length,
                deferred: orderedProactiveItems.length - selectedProactiveItems.length,
            },
        },
        rotation: {
            ingestIntervalDays: MLS_INGEST_INTERVAL_MS / (24 * 60 * 60 * 1000),
            cycleCount: GOOGLE_GEOCODE_ROTATION_CYCLES,
            targetRefreshDays: GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS / (24 * 60 * 60 * 1000),
            requestEligibleListings,
            scheduledCacheEntries: rotationCandidates.length,
            dueThisCycle: rotationItems.length,
            scheduleUpdates,
            targetRequestsPerCycle,
            configuredRequestLimit: requestLimit,
            configuredProactiveRefreshLimit: proactiveRequestsPerCycle,
            sustainableInventoryCapacity: configuredCapacity,
            inventoryWithinConfiguredCapacity: requestEligibleListings <= configuredCapacity,
            targetDeadlineCapacity,
            deadlineCapacity,
            projectedThirtyDayRequests,
            projectedThirtyDayGrossListPriceUsd: estimateGeocodeCost(
                projectedThirtyDayRequests,
            ).grossListPriceUsd,
            projectedThirtyDayWithinFreeUsageCap:
                projectedThirtyDayRequests <= GOOGLE_GEOCODE_MONTHLY_FREE_USAGE_CAP,
            freeUsageRemainingUnknown: true,
        },
        costEstimate: {
            currency: 'USD',
            pricePerRequestUsd: GOOGLE_GEOCODE_LIST_PRICE_USD_PER_REQUEST,
            monthlyFreeUsageCap: GOOGLE_GEOCODE_MONTHLY_FREE_USAGE_CAP,
            freeUsageAlreadyConsumedUnknown: true,
            selected: estimateGeocodeCost(selectedItems.length),
            selectedUrgent: estimateGeocodeCost(selectedUrgentItems.length),
            selectedProactive: estimateGeocodeCost(selectedProactiveItems.length),
            allNeeded: estimateGeocodeCost(workItems.length),
        },
        emergency: {
            urgentOnly: emergencyUrgentOnly,
            maximumRequestLimit: MAX_EMERGENCY_URGENT_ONLY_REQUESTS,
            urgentRequestCount: urgentItems.length,
            selectedUrgentRequestCount: selectedItems.filter(
                (item) => item.reason !== 'refresh_due',
            ).length,
            deferredRefreshDueCount: emergencyUrgentOnly ? rotationItems.length : 0,
        },
        batch,
        workItems,
        selectedItems,
    };
}

export function assertSafeGeocodePlan(
    plan,
    {
        allowLargeRun = false,
        maximumWithoutConfirmation = MAX_GEOCODE_REQUESTS_WITHOUT_CONFIRMATION,
    } = {},
) {
    if (plan.emergency?.urgentOnly) {
        const configuredRequestLimit = plan.rotation?.configuredRequestLimit;
        if (!Number.isFinite(configuredRequestLimit) ||
            configuredRequestLimit > MAX_EMERGENCY_URGENT_ONLY_REQUESTS) {
            throw new Error(
                `Emergency urgent-only geocoding requires a finite --limit no greater than ${MAX_EMERGENCY_URGENT_ONLY_REQUESTS}.`,
            );
        }
        if (plan.emergency.selectedUrgentRequestCount !== plan.emergency.urgentRequestCount) {
            throw new Error(
                `Emergency urgent-only geocoding requires all ${plan.emergency.urgentRequestCount} ` +
                `missing, changed, or expired addresses to fit within the configured --limit of ` +
                `${configuredRequestLimit}; refusing partial urgent coverage.`,
            );
        }
        if (plan.selectedItems?.some((item) => item.reason === 'refresh_due')) {
            throw new Error(
                'Emergency urgent-only geocoding cannot select a still-valid refresh_due cache entry.',
            );
        }
        const planNow = Date.parse(plan.generatedAt);
        const deferredItems = plan.workItems?.filter(
            (item) => item.reason === 'refresh_due',
        ) ?? [];
        if (!Number.isFinite(planNow) || deferredItems.some(
            (item) => !isFreshMapPosition(item.entry, planNow),
        )) {
            throw new Error(
                'Emergency urgent-only geocoding may defer only exact-address cache entries that remain unexpired.',
            );
        }
    }

    if (!plan.emergency?.urgentOnly &&
        plan.requests?.proactive?.enabled &&
        plan.rotation?.inventoryWithinConfiguredCapacity === false) {
        throw new Error(
            `The explicit proactive refresh cap of ` +
            `${plan.rotation.configuredProactiveRefreshLimit} requests per run cannot sustain the ` +
            `${plan.rotation.targetRefreshDays}-day ` +
            `service-area coordinate rotation. ${plan.rotation.requestEligibleListings} request-eligible ` +
            `listings require about ${plan.rotation.targetRequestsPerCycle} requests per three-day cycle, ` +
            `above the proactive cap. Keep proactive refresh disabled and use a separately reviewed ` +
            'higher-frequency cadence, reduce the service-area inventory, or use a compliant lower-cost ' +
            'coordinate provider before a paid proactive run.',
        );
    }

    if (!plan.emergency?.urgentOnly &&
        plan.requests?.proactive?.enabled &&
        plan.rotation?.deadlineCapacity?.withinCapacity === false) {
        const violation = plan.rotation.deadlineCapacity.firstViolation;
        throw new Error(
            `The coordinate backlog cannot be cleared by ${violation.deadline} before the ` +
            `earliest legal cache expiry. ${violation.requiredRequests} urgent or expiring requests ` +
            `compete for ${violation.availableRequests} configured request slots across ` +
            `${violation.cyclesAvailable} remaining three-day cycle(s), a shortfall of ` +
            `${violation.shortfall}. Increase the reviewed hard ceiling, reduce service-area ` +
            'inventory, or restore a newer compliant cache before a paid run.',
        );
    }

    if (!allowLargeRun && plan.requests.selected > maximumWithoutConfirmation) {
        throw new Error(
            `Refusing ${plan.requests.selected} Google geocodes without explicit confirmation. ` +
            `Use --limit ${maximumWithoutConfirmation} for a bounded batch or --allow-large-run after reviewing the dry-run estimate.`,
        );
    }
}

function googleAddressComponent(result, type, key = 'short_name') {
    const component = result?.address_components?.find((candidate) =>
        Array.isArray(candidate?.types) && candidate.types.includes(type));
    return String(component?.[key] ?? '').trim();
}

function normalizedPostalCode(value) {
    const match = String(value ?? '').trim().match(/^\d{5}/);
    return match?.[0] ?? '';
}

export function validatedGoogleGeocodeResult(body, expectedAddress) {
    if (!body || body.status !== 'OK' || !Array.isArray(body.results) || body.results.length !== 1) {
        return null;
    }

    const result = body.results[0];
    const location = result?.geometry?.location;
    const precision = String(result?.geometry?.location_type ?? '').trim().toUpperCase();
    const expectedState = String(expectedAddress?.state ?? '').trim().toUpperCase();
    const expectedZip = normalizedPostalCode(expectedAddress?.zip);
    const returnedState = googleAddressComponent(result, 'administrative_area_level_1').toUpperCase();
    const returnedZip = normalizedPostalCode(googleAddressComponent(result, 'postal_code', 'long_name'));
    const returnedCountry = googleAddressComponent(result, 'country').toUpperCase();
    const resultTypes = new Set(Array.isArray(result?.types) ? result.types : []);
    const addressLevelResult = [
        'street_address',
        'premise',
        'subpremise',
        'establishment',
    ].some((type) => resultTypes.has(type));

    if (
        result.partial_match === true ||
        !Number.isFinite(location?.lat) ||
        !Number.isFinite(location?.lng) ||
        (
            isPreferredServiceAreaListing({ address: expectedAddress }) &&
            !coordinateIsInMassachusetts(location)
        ) ||
        returnedCountry !== 'US' ||
        !expectedState ||
        returnedState !== expectedState ||
        !expectedZip ||
        returnedZip !== expectedZip ||
        !addressLevelResult ||
        !precision ||
        precision === 'APPROXIMATE'
    ) {
        return null;
    }

    return {
        lat: location.lat,
        lng: location.lng,
        precision,
        validatedState: returnedState,
        validatedPostalCode: returnedZip,
        validation: 'exact_state_zip_address',
    };
}

async function geocodeAddress(apiKey, address, expectedAddress) {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('components', [
        'country:US',
        `administrative_area:${String(expectedAddress?.state ?? '').trim().toUpperCase()}`,
        `postal_code:${normalizedPostalCode(expectedAddress?.zip)}`,
    ].join('|'));

    let response;
    try {
        response = await fetch(url);
    } catch (cause) {
        throw geocodeRequestError(
            'Google Geocoding request failed before receiving a response.',
            { auditCode: 'GOOGLE_NETWORK_ERROR', cause },
        );
    }

    if (!response.ok) {
        throw geocodeRequestError(
            `Google Geocoding returned HTTP ${response.status}.`,
            { auditCode: 'GOOGLE_HTTP_ERROR', httpStatus: response.status },
        );
    }

    let body;
    try {
        body = await response.json();
    } catch (cause) {
        throw geocodeRequestError(
            'Google Geocoding returned a response that could not be decoded.',
            { auditCode: 'GOOGLE_INVALID_RESPONSE', cause },
        );
    }

    if (body.status === 'ZERO_RESULTS') {
        return null;
    }

    if (body.status !== 'OK') {
        const providerStatus = safeProviderStatus(body.status) ?? 'UNKNOWN_STATUS';
        throw geocodeRequestError(
            `Google Geocoding returned ${providerStatus}.`,
            { auditCode: 'GOOGLE_STATUS_ERROR', providerStatus },
        );
    }

    return validatedGoogleGeocodeResult(body, expectedAddress);
}

async function readPublication(outputDir) {
    const publicDir = path.join(outputDir, 'public');
    const indexPath = path.join(publicDir, 'mls-search-index.json');
    const detailsDir = path.join(publicDir, 'listings');
    const index = await readJson(indexPath);
    const detailEntries = await readdir(detailsDir, { withFileTypes: true });
    const details = new Map();

    for (const entry of detailEntries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
            details.set(entry.name, await readJson(path.join(detailsDir, entry.name)));
        }
    }

    return { details, detailsDir, index, indexPath };
}

function detailFileNameFor(listing) {
    return `${encodeURIComponent(String(listing.listingNumber ?? '').trim())}.json`;
}

function assignMapPosition(listing, mapPosition) {
    if (mapPosition) {
        listing.mapPosition = mapPosition;
        return;
    }

    delete listing.mapPosition;
}

async function noOpCheckpoint(_cache, _progress) {
    // Programmatic callers may opt out of persistent checkpoints.
}

async function missingAuditEventWriter(_event) {
    throw new Error(
        'A durable geocode audit writer is required before running Google geocoding requests.',
    );
}

export async function enrichPublicationCoordinates({
    apiKey,
    auditClock = Date.now,
    auditRunId = randomUUID(),
    cache,
    checkpointEvery = DEFAULT_GEOCODE_CHECKPOINT_EVERY,
    details,
    dryRun = false,
    emergencyUrgentOnly = false,
    geocode = geocodeAddress,
    includeProactiveRefresh = false,
    index,
    batchSize = 0,
    batchIndex = 0,
    limit = Number.POSITIVE_INFINITY,
    now = Date.now(),
    preferredOnly = false,
    proactiveRefreshLimit = 0,
    onAuditEvent = missingAuditEventWriter,
    onCheckpoint = noOpCheckpoint,
    requestIdFactory = randomUUID,
}) {
    const plan = buildGeocodePlan({
        batchSize,
        batchIndex,
        cache,
        emergencyUrgentOnly,
        includeProactiveRefresh,
        index,
        limit,
        now,
        preferredOnly,
        proactiveRefreshLimit,
    });
    if (dryRun) {
        return {
            cache: normalizedCache(cache, now),
            plan,
            stats: {
                enriched: plan.counts.fresh,
                cached: plan.counts.fresh,
                fresh: plan.counts.fresh,
                missing: plan.counts.missing,
                expired: plan.counts.expired,
                changed: plan.counts.changed,
                fetched: 0,
                unresolved: 0,
                skippedForLimit: plan.requests.urgent.deferred,
                deferredProactiveRefreshes: plan.requests.proactive.deferred,
            },
        };
    }

    if (plan.requests.selected > 0 && !String(apiKey ?? '').trim()) {
        throw new Error('Set GOOGLE_MAPS_API_KEY before running paid MLS geocoding.');
    }
    if (plan.requests.selected > 0 && onAuditEvent === missingAuditEventWriter) {
        throw new Error(
            'A durable geocode audit writer is required before running Google geocoding requests.',
        );
    }

    const safeCheckpointEvery = parseNonNegativeInteger(
        'checkpointEvery',
        checkpointEvery,
        1,
    );
    const entries = pruneGeocodeCacheEntries(cache, index, now, { preferredOnly });
    for (const update of plan.rotation.scheduleUpdates) {
        if (entries[update.cacheKey]) {
            entries[update.cacheKey] = {
                ...entries[update.cacheKey],
                rotationDueAt: update.rotationDueAt,
            };
        }
    }
    let fetched = 0;
    let cached = 0;
    let unresolved = 0;
    let enriched = 0;
    let lastCheckpointFetched = 0;
    let checkpointHasWritten = false;
    let requestSequence = 0;

    for (const listing of index.listings) {
        const key = geocodeCacheKey(listing);
        let entry = entries[key];
        if (
            entry &&
            isPreferredServiceAreaListing(listing) &&
            !coordinateIsInMassachusetts(entry)
        ) {
            delete entries[key];
            entry = null;
        }
        const reviewedMapPosition = reviewedCoordinateForListing(listing, now);
        const mapPosition = reviewedMapPosition ?? (
            entry && cacheEntryMatchesListing(entry, listing)
                ? publicMapPositionFromCacheEntry(entry)
                : null
        );

        if (mapPosition) {
            cached += 1;
        }
        assignMapPosition(listing, mapPosition);

        const detail = details.get(detailFileNameFor(listing));
        if (detail) {
            assignMapPosition(detail, mapPosition);
        }

        if (mapPosition) {
            enriched += 1;
        }
    }

    function cacheSnapshot() {
        return {
            schemaVersion: GOOGLE_GEOCODE_CACHE_SCHEMA_VERSION,
            provider: 'google_geocoding',
            cacheTtlDays: 30,
            updatedAt: new Date(now).toISOString(),
            entries: { ...entries },
        };
    }

    async function checkpoint(force = false) {
        if (fetched === lastCheckpointFetched && (!force || checkpointHasWritten)) {
            return;
        }

        if (!force && fetched - lastCheckpointFetched < safeCheckpointEvery) {
            return;
        }

        await onCheckpoint(cacheSnapshot(), {
            fetched,
            unresolved,
            remainingSelected: plan.requests.selected - fetched,
        });
        lastCheckpointFetched = fetched;
        checkpointHasWritten = true;
    }

    // Persist expiry, removal, and address-change pruning before the first
    // network request. A first-request or first-audit-write failure must not
    // leave legally expired Google coordinates in the prior cache snapshot.
    if (plan.requests.selected > 0) {
        await checkpoint(true);
    }

    for (const item of plan.selectedItems) {
        const listing = index.listings[item.listingIndex];
        const existingEntry = entries[geocodeCacheKey(listing)];
        requestSequence += 1;
        const requestContext = {
            provider: 'google_geocoding',
            runId: auditRunId,
            requestId: requestIdFactory(),
            sequence: requestSequence,
            ...geocodeRequestIdentity(listing),
            requestReason: item.reason,
        };

        // This append is awaited and fsynced by the CLI writer before the
        // request function is allowed to execute.
        await onAuditEvent({
            schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
            eventType: 'request_started',
            occurredAt: auditTimestamp(auditClock),
            ...requestContext,
            httpMethod: 'GET',
            requestHost: 'maps.googleapis.com',
            requestPath: '/maps/api/geocode/json',
            requestComponents: REDACTED_GEOCODE_REQUEST_COMPONENTS,
            providerSku: 'Geocoding',
            transmissionState: 'prepared',
            outcome: 'prepared',
        });

        let result;
        try {
            result = await geocode(apiKey, addressLabel(listing), listing.address);
        } catch (error) {
            let auditWriteError = null;
            let checkpointError = null;

            try {
                await onAuditEvent({
                    schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
                    eventType: 'request_failed',
                    occurredAt: auditTimestamp(auditClock),
                    ...requestContext,
                    outcome: 'failed',
                    ...geocodeAuditFailure(error),
                });
            } catch (auditError) {
                auditWriteError = auditError;
            }

            try {
                await checkpoint(true);
            } catch (errorDuringCheckpoint) {
                checkpointError = errorDuringCheckpoint;
            }

            if (auditWriteError || checkpointError) {
                throw new AggregateError(
                    [error, auditWriteError, checkpointError].filter(Boolean),
                    'A Google geocode request failed and its recovery records could not be fully persisted.',
                    { cause: error },
                );
            }

            throw error;
        }

        fetched += 1;
        let mapPosition;
        if (result) {
            const key = geocodeCacheKey(listing);
            const listingNumber = normalizedListingNumber(listing.listingNumber);
            for (const [existingKey, entry] of Object.entries(entries)) {
                if (
                    existingKey !== key &&
                    cacheEntryListingNumber(existingKey, entry) === listingNumber
                ) {
                    delete entries[existingKey];
                }
            }

            const entry = cacheEntryFromGeocode(listing, result, now);
            entries[key] = {
                ...entry,
                rotationDueAt: new Date(
                    now + GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS,
                ).toISOString(),
            };
            mapPosition = publicMapPositionFromCacheEntry(entry);
            if (!existingEntry) {
                enriched += 1;
            }
        } else {
            unresolved += 1;
            // A proactive refresh can fail while the existing coordinate is
            // still legally current. Preserve that current value until its
            // expiresAt boundary rather than creating an avoidable map gap.
            mapPosition = existingEntry && isFreshMapPosition(existingEntry, now)
                ? publicMapPositionFromCacheEntry(existingEntry)
                : null;
            if (existingEntry && isFreshMapPosition(existingEntry, now)) {
                const expiresAt = Date.parse(existingEntry.expiresAt);
                const retryDelay = expiresAt - now <= (3 * MLS_INGEST_INTERVAL_MS)
                    ? MLS_INGEST_INTERVAL_MS
                    : 2 * MLS_INGEST_INTERVAL_MS;
                entries[geocodeCacheKey(listing)] = {
                    ...existingEntry,
                    lastRefreshAttemptAt: new Date(now).toISOString(),
                    rotationDueAt: new Date(Math.min(now + retryDelay, expiresAt)).toISOString(),
                };
            }
        }

        assignMapPosition(listing, mapPosition);
        const detail = details.get(detailFileNameFor(listing));
        if (detail) {
            assignMapPosition(detail, mapPosition);
        }

        try {
            await onAuditEvent({
                schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
                eventType: 'request_completed',
                occurredAt: auditTimestamp(auditClock),
                ...requestContext,
                outcome: result ? 'resolved' : 'unresolved',
                cacheExpiresAt: mapPosition?.expiresAt ?? null,
            });
        } catch (auditError) {
            try {
                await checkpoint(true);
            } catch (checkpointError) {
                throw new AggregateError(
                    [auditError, checkpointError],
                    'A completed Google geocode could not be fully persisted to the audit ledger or cache checkpoint.',
                    { cause: checkpointError },
                );
            }

            throw new Error(
                'A completed Google geocode could not be appended to the durable audit ledger; stopped before another request.',
                { cause: auditError },
            );
        }

        await checkpoint();
    }

    await checkpoint(true);

    return {
        cache: cacheSnapshot(),
        plan,
        stats: {
            enriched,
            cached,
            fresh: plan.counts.fresh,
            refreshDue: plan.counts.refreshDue,
            missing: plan.counts.missing,
            expired: plan.counts.expired,
            changed: plan.counts.changed,
            fetched,
            unresolved,
            skippedForLimit: plan.requests.urgent.deferred,
            deferredProactiveRefreshes: plan.requests.proactive.deferred,
        },
    };
}

function formatUsd(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
    }).format(value);
}

function printGeocodePlan(plan) {
    const { counts, requests, costEstimate, rotation } = plan;
    console.log(
        plan.scope === 'preferred-service-area'
            ? `Google geocode scope: canonical service area only; ` +
                `${counts.excludedOutsidePreferredScope} out-of-service listings excluded.`
            : 'Google geocode scope: all reviewed Massachusetts listings.',
    );
    console.log(
        `MLS geocode plan: ${counts.totalListings} listings; ` +
        `${counts.cached} exact-address cache records ` +
        `(${counts.fresh} fresh, ${counts.refreshDue} due for proactive refresh, ${counts.expired} expired); ` +
        `${counts.missing} missing; ${counts.changed} changed.`,
    );
    console.log(
        `Urgent Google requests: ${requests.urgent.needed} needed; ` +
        `${requests.urgent.selected} selected; ${requests.urgent.deferred} deferred.`,
    );
    console.log(
        requests.proactive.enabled
            ? `Proactive Google refreshes: ${requests.proactive.due} due; ` +
                `${requests.proactive.selected} selected; ${requests.proactive.deferred} deferred; ` +
                `explicit cap ${requests.proactive.configuredLimit}.`
            : `Proactive Google refreshes: disabled by default; ${requests.proactive.due} due; ` +
                `0 selected; ${requests.proactive.deferred} deferred. Enable only with both ` +
                '--include-proactive-refresh and --proactive-refresh-limit N.',
    );
    console.log(
        `Total Google requests selected: ${requests.selected}; ${requests.preferredSelected} of ` +
        `${requests.preferredNeeded} potential preferred-area requests selected.`,
    );
    if (plan.emergency.urgentOnly) {
        console.log(
            `Emergency urgent-only mode: all ${plan.emergency.urgentRequestCount} missing, changed, ` +
            `or expired addresses selected; ${plan.emergency.deferredRefreshDueCount} still-valid ` +
            'refresh_due cache entries deferred.',
        );
    }
    console.log(
        `Selected-request gross estimate: up to ${formatUsd(costEstimate.selected.grossListPriceUsd)} ` +
        `(${formatUsd(costEstimate.selectedUrgent.grossListPriceUsd)} urgent; ` +
        `${formatUsd(costEstimate.selectedProactive.grossListPriceUsd)} proactive) ` +
        `at list price. The ${costEstimate.monthlyFreeUsageCap.toLocaleString('en-US')}-request ` +
        'monthly allowance is account-wide; remaining usage is unknown and is not deducted here.',
    );
    if (requests.proactive.enabled) {
        console.log(
            `Coordinate rotation: ${rotation.targetRequestsPerCycle.toLocaleString('en-US')} requests per ` +
            `${rotation.ingestIntervalDays}-day cycle for ${rotation.requestEligibleListings.toLocaleString('en-US')} ` +
            `request-eligible service listings; approximately ${rotation.projectedThirtyDayRequests.toLocaleString('en-US')} ` +
            `requests (${formatUsd(rotation.projectedThirtyDayGrossListPriceUsd)} gross list price) per 30 days.`,
        );
    }
    if (requests.proactive.enabled && !rotation.projectedThirtyDayWithinFreeUsageCap) {
        console.warn(
            `WARNING: the steady rotation alone exceeds the ${costEstimate.monthlyFreeUsageCap.toLocaleString('en-US')}-request monthly allowance.`,
        );
    }
    if (requests.proactive.enabled && !rotation.inventoryWithinConfiguredCapacity) {
        console.warn(
            `WARNING: the explicit ${rotation.configuredProactiveRefreshLimit}-request proactive cap ` +
            `cannot sustain the ${rotation.targetRefreshDays}-day rotation; capacity is ` +
            `${rotation.sustainableInventoryCapacity.toLocaleString('en-US')} listings. Use a separately ` +
            'reviewed higher-frequency cadence, smaller inventory, or compliant lower-cost provider.',
        );
    }
    if (requests.proactive.enabled && !rotation.deadlineCapacity.withinCapacity) {
        const violation = rotation.deadlineCapacity.firstViolation;
        console.warn(
            `WARNING: ${violation.shortfall.toLocaleString('en-US')} coordinate requests cannot ` +
            `fit before the ${violation.deadline} rotation deadline at the configured run limit.`,
        );
    }
    if (requests.proactive.enabled && !rotation.targetDeadlineCapacity.withinCapacity) {
        const violation = rotation.targetDeadlineCapacity.firstViolation;
        console.warn(
            `WARNING: the preferred 24-day rotation target is short by ` +
            `${violation.shortfall.toLocaleString('en-US')} request slots before ${violation.deadline}; ` +
            'the six-day recovery margin is being consumed even though legal expiry capacity remains.',
        );
    }
    console.warn(
        'Google free usage is account-wide and prior-month usage is not inferred from this cache; ' +
        'treat the gross estimate as payable unless billing metrics confirm remaining allowance.',
    );
}

async function main() {
    await loadDotEnv();
    const args = parseArgs(process.argv);
    const outputDir = path.resolve(args.output);
    const cachePath = path.resolve(args.cache);
    const auditLogPath = path.resolve(args.auditLog);
    const apiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();
    const now = Date.now();
    const immutableAuditMirror = args.immutableAuditBucket
        ? createImmutableGeocodeAuditMirror({
            bucket: args.immutableAuditBucket,
            prefix: args.immutableAuditPrefix,
            sensitiveValues: [apiKey],
            temporaryDirectory: path.join(path.dirname(auditLogPath), 'immutable-events'),
        })
        : null;

    if ((args.auditGapMaxRequests > 0 || args.auditGapId) && !args.recoverAuditFromCache) {
        throw new Error(
            '--audit-gap-max-requests and --audit-gap-id are only valid with --recover-audit-from-cache.',
        );
    }

    if (args.recoverAuditFromCache) {
        if (args.dryRun) {
            throw new Error('--recover-audit-from-cache cannot be combined with --dry-run or --no-network.');
        }

        const recoveryId = randomUUID();
        const releaseRunLock = await acquireGeocodeRunLock(`${cachePath}.run.lock`, {
            runId: recoveryId,
        });
        let recovery;
        try {
            recovery = await recoverGeocodeAuditFromCache({
                auditLogPath,
                cache: await readJson(cachePath, {}),
                historicalGapId: args.auditGapId,
                maxUnloggedRequestCount: args.auditGapMaxRequests,
                recoveryId,
            });
        } finally {
            await releaseRunLock();
        }
        console.log(
            `Geocode audit recovery appended ${recovery.recoveredEntryCount} confirmed cache successes; ` +
            `${recovery.previouslyRecordedEntryCount} were already present.`,
        );
        if (args.auditGapMaxRequests > 0) {
            console.log(
                recovery.historicalGapRecorded
                    ? `Recorded one historical uncertainty gap covering 0..${args.auditGapMaxRequests} possible requests.`
                    : 'The matching historical uncertainty gap was already present.',
            );
        }
        console.log(`Append-only geocode request ledger: ${auditLogPath}.`);
        return;
    }

    let cache;
    let publication;
    let plan;

    if (args.dryRun) {
        cache = await readJson(cachePath, {});
        publication = await readPublication(outputDir);
        plan = buildGeocodePlan({
            cache,
            batchSize: args.batchSize,
            batchIndex: args.batchIndex,
            emergencyUrgentOnly: args.emergencyUrgentOnly,
            includeProactiveRefresh: args.includeProactiveRefresh,
            index: publication.index,
            limit: args.limit,
            now,
            preferredOnly: args.preferredOnly,
            proactiveRefreshLimit: args.proactiveRefreshLimit,
        });
        printGeocodePlan(plan);
        console.log('Dry run complete: no Google requests were made and no files were written.');
        return;
    }

    const auditRunId = randomUUID();
    const appendAuditEvent = createGeocodeAuditWriter(auditLogPath, {
        mirrorEvent: immutableAuditMirror,
        sensitiveValues: [apiKey],
    });
    const releaseRunLock = await acquireGeocodeRunLock(`${cachePath}.run.lock`, {
        runId: auditRunId,
    });
    let result;
    let runStarted = false;
    try {
        // Re-read all mutable inputs only after holding the exclusive lock so
        // a just-finished process cannot leave this run with a stale plan.
        cache = await readJson(cachePath, {});
        publication = await readPublication(outputDir);
        plan = buildGeocodePlan({
            cache,
            batchSize: args.batchSize,
            batchIndex: args.batchIndex,
            emergencyUrgentOnly: args.emergencyUrgentOnly,
            includeProactiveRefresh: args.includeProactiveRefresh,
            index: publication.index,
            limit: args.limit,
            now,
            preferredOnly: args.preferredOnly,
            proactiveRefreshLimit: args.proactiveRefreshLimit,
        });
        printGeocodePlan(plan);
        assertSafeGeocodePlan(plan, { allowLargeRun: args.allowLargeRun });
        if (plan.requests.selected > 0 && !apiKey) {
            throw new Error('Set GOOGLE_MAPS_API_KEY before running paid MLS geocoding.');
        }

        if (plan.requests.selected > 0) {
            await appendAuditEvent({
                schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
                eventType: 'run_started',
                occurredAt: auditTimestamp(),
                provider: 'google_geocoding',
                runId: auditRunId,
                selectedRequestCount: plan.requests.selected,
                neededRequestCount: plan.requests.needed,
                deferredRequestCount: plan.requests.deferred,
                outcome: 'started',
            });
            runStarted = true;
        }

        result = await enrichPublicationCoordinates({
            apiKey,
            auditRunId,
            cache,
            checkpointEvery: args.checkpointEvery,
            batchSize: args.batchSize,
            batchIndex: args.batchIndex,
            details: publication.details,
            emergencyUrgentOnly: args.emergencyUrgentOnly,
            includeProactiveRefresh: args.includeProactiveRefresh,
            index: publication.index,
            limit: args.limit,
            now,
            preferredOnly: args.preferredOnly,
            proactiveRefreshLimit: args.proactiveRefreshLimit,
            onAuditEvent: plan.requests.selected > 0 ? appendAuditEvent : undefined,
            onCheckpoint: async (checkpointCache, progress) => {
                await writeJsonAtomic(cachePath, checkpointCache);
                console.log(
                    `Private cache checkpoint: ${progress.fetched} requests completed; ` +
                    `${progress.remainingSelected} selected requests remain.`,
                );
            },
        });

        await writeJson(publication.indexPath, publication.index);
        for (const [fileName, detail] of publication.details) {
            await writeJson(path.join(publication.detailsDir, fileName), detail);
        }
        await writeJsonAtomic(cachePath, result.cache);
        if (result.plan.batch) {
            await writeJson(path.join(outputDir, "review/geocode-batch.json"), {
                ...result.plan.batch, buildId: process.env.CODEBUILD_BUILD_ID,
            });
        }

        if (runStarted) {
            await appendAuditEvent({
                schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
                eventType: 'run_completed',
                occurredAt: auditTimestamp(),
                provider: 'google_geocoding',
                runId: auditRunId,
                completedRequestCount: result.stats.fetched,
                resolvedRequestCount: result.stats.fetched - result.stats.unresolved,
                unresolvedRequestCount: result.stats.unresolved,
                dataPersisted: true,
                outcome: 'completed',
            });
        }
    } catch (error) {
        if (runStarted) {
            try {
                await appendAuditEvent({
                    schemaVersion: GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
                    eventType: 'run_failed',
                    occurredAt: auditTimestamp(),
                    provider: 'google_geocoding',
                    runId: auditRunId,
                    outcome: 'failed',
                    ...geocodeAuditFailure(error),
                });
            } catch (auditError) {
                throw new AggregateError(
                    [error, auditError],
                    'The geocode run failed and its final run-level audit event could not be persisted.',
                    { cause: auditError },
                );
            }
        }
        throw error;
    } finally {
        await releaseRunLock();
    }

    console.log(`MLS coordinate enrichment updated ${result.stats.enriched} listings.`);
    console.log(
        `Cache hits: ${result.stats.cached}; Google geocodes: ${result.stats.fetched}; ` +
        `unresolved: ${result.stats.unresolved}; urgent skipped by overall limit: ` +
        `${result.stats.skippedForLimit}; proactive refreshes deferred: ` +
        `${result.stats.deferredProactiveRefreshes}.`,
    );
    console.log(`Private 30-day geocode cache written to ${cachePath}.`);
    if (plan.requests.selected > 0) {
        console.log(`Append-only geocode request ledger: ${auditLogPath}.`);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
