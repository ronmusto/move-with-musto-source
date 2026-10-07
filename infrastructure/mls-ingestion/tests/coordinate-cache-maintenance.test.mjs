import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    COORDINATE_CACHE_BUCKET_NAME: 'test-coordinates',
    DELIVERY_BUCKET_NAME: 'test-delivery',
    DELIVERY_DISTRIBUTION_ID: 'TESTDIST',
    ALERTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:test-alerts',
    FRESHNESS_HOURS: '60',
});

const [
    { prunePrivateCoordinateObjects },
    { aws },
    { CACHE_SCHEMA_VERSION, listingCacheKey },
    { summarizeCoordinateCache, validateReviewedCoordinateCacheObject },
] = await Promise.all([
    import('../handlers/maintenance.mjs'),
    import('../handlers/aws.mjs'),
    import('../seed-coordinate-cache.mjs'),
    import('../validate-coordinate-cache-seed.mjs'),
]);

const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const LEDGER_SHA256 = 'a'.repeat(64);
const CACHE_KEY = 'cache/google-geocoding-cache.json';
const HANDLERS_URL = new URL('../handlers/', import.meta.url);

async function assertRelativeImportClosure(moduleUrl, visited = new Set()) {
    if (visited.has(moduleUrl.href)) return;
    visited.add(moduleUrl.href);
    const source = await readFile(moduleUrl, 'utf8');
    const relativeImports = source.split('\n').flatMap((line) => {
        const match = line.match(/from '(\.[^']+)'/u);
        return match ? [match[1]] : [];
    });
    for (const specifier of relativeImports) {
        const importedUrl = new URL(specifier, moduleUrl);
        assert.ok(
            importedUrl.href.startsWith(HANDLERS_URL.href),
            `${moduleUrl.pathname} imports ${specifier} outside the handlers/ Lambda package.`,
        );
        await assertRelativeImportClosure(importedUrl, visited);
    }
}

function listing(listingNumber, line) {
    return {
        listingNumber,
        address: { line, town: 'Burlington', state: 'MA', zip: '01803' },
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
        address: `${sourceListing.address.line}, Burlington, MA, 01803, USA`,
        addressKey,
        lat: 42.5048,
        lng: -71.1956,
        precision: 'ROOFTOP',
        validation: 'exact_state_zip_address',
        validatedState: 'MA',
        validatedPostalCode: '01803',
        geocodedAt: '2026-07-01T12:00:00.000Z',
        expiresAt: '2026-07-31T12:00:00.000Z',
        ...overrides,
    };
}

function reviewedCacheObject(metadataOverrides = {}, { includeNearExpiry = true } = {}) {
    const retained = listing('100', '1 Main St');
    const pruned = listing('101', '2 Main St');
    const body = `${JSON.stringify({
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: 'google_geocoding',
        cacheTtlDays: 30,
        updatedAt: '2026-07-13T10:00:00.000Z',
        entries: {
            [listingCacheKey(retained)]: cacheEntry(retained),
            ...(includeNearExpiry
                ? {
                    [listingCacheKey(pruned)]: cacheEntry(pruned, {
                        geocodedAt: '2026-06-15T12:00:00.000Z',
                        expiresAt: '2026-07-14T12:00:00.000Z',
                    }),
                }
                : {}),
        },
    }, null, 2)}\n`;
    const summary = summarizeCoordinateCache({
        cacheText: body,
        latestLockedLedgerSha256: LEDGER_SHA256,
        now: NOW,
    });
    return {
        body,
        response: {
            Body: { transformToString: async () => body },
            ETag: 'reviewed-cache-etag',
            ContentLength: Buffer.byteLength(body),
            ChecksumSHA256: summary.checksumSha256,
            Metadata: {
                ...summary.metadata,
                'review-ticket': 'review-123',
                ...metadataOverrides,
            },
        },
    };
}

function mockSingleCacheObject(t, object, key = CACHE_KEY) {
    const originalS3Send = aws.s3.send;
    const commands = [];
    aws.s3.send = async (command) => {
        commands.push(command);
        if (command.constructor.name === 'ListObjectsV2Command') {
            return { Contents: [{ Key: key }], IsTruncated: false };
        }
        if (command.constructor.name === 'GetObjectCommand') {
            return object.response;
        }
        if (command.constructor.name === 'PutObjectCommand') {
            return { ETag: 'updated-cache-etag' };
        }
        throw new Error(`Unexpected S3 command ${command.constructor.name}.`);
    };
    t.after(() => {
        aws.s3.send = originalS3Send;
    });
    return commands;
}

test('maintenance preserves reviewed lineage and recomputes pruned cache metadata', async (t) => {
    const current = reviewedCacheObject();
    const commands = mockSingleCacheObject(t, current);

    const result = await prunePrivateCoordinateObjects(NOW);

    assert.deepEqual(result, { changedObjects: 1, removedEntries: 1 });
    const get = commands.find((command) => command.constructor.name === 'GetObjectCommand');
    assert.equal(get.input.ChecksumMode, 'ENABLED');

    const put = commands.find((command) => command.constructor.name === 'PutObjectCommand');
    assert.ok(put);
    assert.equal(put.input.IfMatch, current.response.ETag);
    assert.equal(put.input.ChecksumAlgorithm, 'SHA256');
    assert.equal(put.input.Metadata['seed-schema'], current.response.Metadata['seed-schema']);
    assert.equal(put.input.Metadata['latest-locked-ledger-sha256'], LEDGER_SHA256);
    assert.equal(put.input.Metadata['review-ticket'], 'review-123');
    assert.equal(put.input.Metadata['entry-count'], '1');
    assert.equal(put.input.Metadata['earliest-expiry'], '2026-07-31T12:00:00.000Z');
    assert.equal(put.input.Metadata['latest-expiry'], '2026-07-31T12:00:00.000Z');
    assert.equal(
        put.input.Metadata['cache-sha256'],
        createHash('sha256').update(put.input.Body).digest('hex'),
    );
    assert.notEqual(put.input.Metadata['cache-sha256'], current.response.Metadata['cache-sha256']);

    const replacementChecksum = createHash('sha256').update(put.input.Body).digest('base64');
    const replacement = validateReviewedCoordinateCacheObject({
        cacheText: put.input.Body,
        objectResponse: {
            ETag: 'updated-cache-etag',
            ContentLength: Buffer.byteLength(put.input.Body),
            ChecksumSHA256: replacementChecksum,
            Metadata: put.input.Metadata,
        },
        now: NOW,
    });
    assert.equal(replacement.entryCount, 1);
    assert.equal(replacement.latestLockedLedgerSha256, LEDGER_SHA256);
});

test('maintenance relative imports remain inside its handlers package', async () => {
    await assertRelativeImportClosure(new URL('maintenance.mjs', HANDLERS_URL));
});

test('complete batch cache checkpoints receive the same per-entry retention and provenance checks', async (t) => {
    const key = 'runs/test-run/cache-checkpoints/46.json';
    const commands = mockSingleCacheObject(t, reviewedCacheObject(), key);
    assert.deepEqual(await prunePrivateCoordinateObjects(NOW), { changedObjects: 1, removedEntries: 1 });
    const put = commands.find((command) => command.constructor.name === 'PutObjectCommand');
    assert.equal(put.input.Key, key);
    assert.equal(put.input.Metadata['entry-count'], '1');
    assert.equal(put.input.Metadata['latest-locked-ledger-sha256'], LEDGER_SHA256);
});

test('maintenance authenticates reviewed metadata before pruning entries that have since expired', async (t) => {
    const current = reviewedCacheObject();
    const commands = mockSingleCacheObject(t, current);
    const maintenanceNow = Date.parse('2026-07-15T12:00:00.000Z');

    const result = await prunePrivateCoordinateObjects(maintenanceNow);

    assert.deepEqual(result, { changedObjects: 1, removedEntries: 1 });
    const put = commands.find((command) => command.constructor.name === 'PutObjectCommand');
    assert.ok(put);
    assert.equal(put.input.Metadata['entry-count'], '1');
    assert.equal(put.input.Metadata['latest-locked-ledger-sha256'], LEDGER_SHA256);
    assert.deepEqual(
        Object.keys(JSON.parse(put.input.Body).entries),
        [listingCacheKey(listing('100', '1 Main St'))],
    );
});

test('maintenance fails closed on missing lineage even when no pruning is due', async (t) => {
    const current = reviewedCacheObject({
        'latest-locked-ledger-sha256': undefined,
    }, { includeNearExpiry: false });
    const commands = mockSingleCacheObject(t, current);

    await assert.rejects(
        prunePrivateCoordinateObjects(NOW),
        /locked-ledger SHA-256/u,
    );
    assert.equal(
        commands.some((command) => ['PutObjectCommand', 'DeleteObjectCommand'].includes(command.constructor.name)),
        false,
    );
});
