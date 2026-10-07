import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CACHE_SCHEMA_VERSION,
    DESTINATION_KEY,
    createCoordinateCacheSeedArtifact,
    listingCacheKey,
    validateCoordinateCacheDocument,
} from '../seed-coordinate-cache.mjs';
import {
    summarizeCoordinateCache,
    validateReviewedCoordinateCacheObject,
} from '../validate-coordinate-cache-seed.mjs';

const now = Date.parse('2026-07-13T12:00:00.000Z');
const ledgerSha256 = 'a'.repeat(64);

function listing(listingNumber, line, town = 'Burlington', state = 'MA', zip = '01803') {
    return {
        listingNumber,
        address: { line, town, state, zip },
    };
}

function cacheEntry(sourceListing, overrides = {}) {
    const addressKey = [
        sourceListing.address.line,
        sourceListing.address.town,
        sourceListing.address.state,
        sourceListing.address.zip,
    ].map((value) => String(value).toLowerCase()).join('|');
    return {
        listingNumber: sourceListing.listingNumber,
        address: `${sourceListing.address.line}, ${sourceListing.address.town}, MA, ${sourceListing.address.zip}, USA`,
        addressKey,
        lat: 42.5048,
        lng: -71.1956,
        precision: 'ROOFTOP',
        validation: 'exact_state_zip_address',
        validatedState: 'MA',
        validatedPostalCode: sourceListing.address.zip,
        geocodedAt: '2026-07-01T12:00:00.000Z',
        expiresAt: '2026-07-31T12:00:00.000Z',
        ...overrides,
    };
}

function preferredIndex(listings) {
    return {
        schemaVersion: 1,
        id: 'preferred',
        generatedAt: '2026-07-13T04:00:00.000Z',
        listings,
    };
}

function cache(entries) {
    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: 'google_geocoding',
        cacheTtlDays: 30,
        updatedAt: '2026-07-13T10:00:00.000Z',
        entries,
    };
}

test('seed keeps only fresh exact current service-area coordinates and preserves rotation state', () => {
    const retained = listing('100', '1 Main St');
    const expired = listing('101', '2 Main St');
    const overlong = listing('102', '3 Main St');
    const wrongStateCoordinate = listing('103', '4 Main St');
    const changedAddress = listing('104', '5 New Main St');
    const outsideService = listing('900', '1 State St', 'Springfield', 'MA', '01103');
    const retainedKey = listingCacheKey(retained);
    const changedOldAddress = listing('104', '5 Old Main St');
    const artifact = createCoordinateCacheSeedArtifact({
        cache: cache({
            [retainedKey]: cacheEntry(retained, {
                rotationDueAt: '2026-07-25T12:00:00.000Z',
                lastRefreshAttemptAt: '2026-07-10T12:00:00.000Z',
                forbiddenRawGoogleResult: { shouldNotSurvive: true },
            }),
            [listingCacheKey(expired)]: cacheEntry(expired, {
                geocodedAt: '2026-06-01T12:00:00.000Z',
                expiresAt: '2026-07-01T12:00:00.000Z',
            }),
            [listingCacheKey(overlong)]: cacheEntry(overlong, {
                expiresAt: '2026-08-01T12:00:00.001Z',
            }),
            [listingCacheKey(wrongStateCoordinate)]: cacheEntry(wrongStateCoordinate, {
                lat: 42.7654,
                lng: -71.4676,
            }),
            [listingCacheKey(changedOldAddress)]: cacheEntry(changedOldAddress),
            [listingCacheKey(outsideService)]: cacheEntry(outsideService, {
                lat: 42.1015,
                lng: -72.5898,
            }),
        }),
        preferredIndex: preferredIndex([
            retained,
            expired,
            overlong,
            wrongStateCoordinate,
            changedAddress,
        ]),
        latestLockedLedgerSha256: ledgerSha256,
        now,
    });

    assert.deepEqual(Object.keys(artifact.cache.entries), [retainedKey]);
    assert.equal(artifact.cache.entries[retainedKey].rotationDueAt, '2026-07-25T12:00:00.000Z');
    assert.equal(artifact.cache.entries[retainedKey].lastRefreshAttemptAt, '2026-07-10T12:00:00.000Z');
    assert.equal(Object.hasOwn(artifact.cache.entries[retainedKey], 'forbiddenRawGoogleResult'), false);
    assert.equal(artifact.summary.destinationKey, DESTINATION_KEY);
    assert.equal(artifact.summary.sourceEntryCount, 6);
    assert.equal(artifact.summary.serviceAreaListingCount, 5);
    assert.equal(artifact.summary.retainedEntryCount, 1);
    assert.equal(artifact.summary.latestLockedLedgerSha256, ledgerSha256);
    assert.match(artifact.summary.cacheSha256, /^[a-f0-9]{64}$/u);
});

test('seed fails closed on invalid cache/listing schemas and ledger provenance', () => {
    const retained = listing('100', '1 Main St');
    const validCache = cache({ [listingCacheKey(retained)]: cacheEntry(retained) });
    const validIndex = preferredIndex([retained]);

    assert.throws(() => createCoordinateCacheSeedArtifact({
        cache: { ...validCache, schemaVersion: 'unknown' },
        preferredIndex: validIndex,
        latestLockedLedgerSha256: ledgerSha256,
        now,
    }), /must use move-with-musto\.google-geocode-cache\.v1/u);
    assert.throws(() => createCoordinateCacheSeedArtifact({
        cache: validCache,
        preferredIndex: preferredIndex([listing('100', '1 Main St', 'Nashua', 'NH', '03060')]),
        latestLockedLedgerSha256: ledgerSha256,
        now,
    }), /non-Massachusetts/u);
    assert.throws(() => createCoordinateCacheSeedArtifact({
        cache: validCache,
        preferredIndex: validIndex,
        latestLockedLedgerSha256: 'not-a-sha',
        now,
    }), /locked-ledger SHA-256/u);
});

test('seed refuses to produce an empty or rotation-invalid artifact', () => {
    const retained = listing('100', '1 Main St');
    assert.throws(() => createCoordinateCacheSeedArtifact({
        cache: cache({
            [listingCacheKey(retained)]: cacheEntry(retained, {
                rotationDueAt: '2026-08-01T12:00:00.000Z',
            }),
        }),
        preferredIndex: preferredIndex([retained]),
        latestLockedLedgerSha256: ledgerSha256,
        now,
    }), /No fresh, exact/u);
});

test('reviewed cloud cache requires matching S3 checksum, metadata, and locked-ledger provenance', () => {
    const retained = listing('100', '1 Main St');
    const cacheText = `${JSON.stringify(cache({
        [listingCacheKey(retained)]: cacheEntry(retained),
    }), null, 2)}\n`;
    const prepared = summarizeCoordinateCache({
        cacheText,
        latestLockedLedgerSha256: ledgerSha256,
        now,
    });
    const objectResponse = {
        ETag: '"reviewed-cache-etag"',
        ContentLength: Buffer.byteLength(cacheText),
        ChecksumSHA256: prepared.checksumSha256,
        Metadata: prepared.metadata,
    };

    const reviewed = validateReviewedCoordinateCacheObject({ cacheText, objectResponse, now });
    assert.equal(reviewed.entryCount, 1);
    assert.equal(reviewed.eTag, '"reviewed-cache-etag"');
    assert.equal(reviewed.latestLockedLedgerSha256, ledgerSha256);

    assert.throws(() => validateReviewedCoordinateCacheObject({
        cacheText,
        objectResponse: { ...objectResponse, Metadata: {} },
        now,
    }), /must retain move-with-musto\.coordinate-cache-seed\.v1 provenance/u);
    assert.throws(() => validateReviewedCoordinateCacheObject({
        cacheText,
        objectResponse: { ...objectResponse, ChecksumSHA256: Buffer.alloc(32).toString('base64') },
        now,
    }), /full-object checksum/u);
});

test('reviewed cloud cache rejects empty, expired, and out-of-service documents', () => {
    assert.throws(() => validateCoordinateCacheDocument(cache({}), now), /at least one fresh/u);

    const expired = listing('100', '1 Main St');
    assert.throws(() => validateCoordinateCacheDocument(cache({
        [listingCacheKey(expired)]: cacheEntry(expired, {
            geocodedAt: '2026-06-01T12:00:00.000Z',
            expiresAt: '2026-07-01T12:00:00.000Z',
        }),
    }), now), /invalid entry/u);

    const outsideService = listing('900', '1 State St', 'Springfield', 'MA', '01103');
    assert.throws(() => validateCoordinateCacheDocument(cache({
        [listingCacheKey(outsideService)]: cacheEntry(outsideService, {
            lat: 42.1015,
            lng: -72.5898,
        }),
    }), now), /invalid entry/u);
});
