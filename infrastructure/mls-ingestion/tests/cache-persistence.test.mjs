import assert from 'node:assert/strict';
import test from 'node:test';
import { persistCoordinateCache, mergeCoordinateCaches } from '../persist-coordinate-cache.mjs';
import { summarizeCoordinateCache } from '../validate-coordinate-cache-seed.mjs';

const NOW = Date.parse('2026-09-17T21:00:00Z');
const LEDGER = 'a'.repeat(64);
function entry(id, geocodedAt = '2026-09-15T21:00:00Z') {
    return { listingNumber: id, address: `${id} Main St, Burlington, MA, 01803, USA`,
        addressKey: `${id} main st|burlington|ma|01803`, lat: 42.5048, lng: -71.1956,
        precision: 'ROOFTOP', geocodedAt,
        expiresAt: new Date(Date.parse(geocodedAt) + 30 * 86400000).toISOString() };
}
function cache(...entries) {
    return { schemaVersion: 'move-with-musto.google-geocode-cache.v1', provider: 'google_geocoding',
        cacheTtlDays: 30, updatedAt: new Date(NOW).toISOString(),
        entries: Object.fromEntries(entries.map((e) => [`${e.listingNumber}|${e.addressKey}`, e])) };
}
function response(document, etag = 'latest') {
    const text = `${JSON.stringify(document)}\n`;
    const summary = summarizeCoordinateCache({ cacheText: text, latestLockedLedgerSha256: LEDGER, now: NOW });
    return { text, response: { ETag: etag, ContentLength: Buffer.byteLength(text),
        ChecksumSHA256: summary.checksumSha256, Metadata: summary.metadata } };
}
const conflict = () => Object.assign(new Error('conflict'), { name: 'PreconditionFailed' });

test('maintenance between read and save keeps its deletions and saves completed geocodes', async () => {
    const old = entry('1', '2026-08-20T21:00:00Z');
    const retained = entry('2');
    const fresh = entry('3', '2026-09-17T20:00:00Z');
    const base = cache(old, retained);
    const local = cache(old, retained, fresh);
    const writes = [];
    let checkpoint;
    const result = await persistCoordinateCache({ base, local, etag: 'original', ledgerSha256: LEDGER, now: () => NOW,
        store: {
            checkpoint: async (text) => { checkpoint = JSON.parse(text); },
            read: async () => response(cache(retained)),
            put: async (text, metadata, etag) => {
                assert.ok(checkpoint);
                writes.push({ cache: JSON.parse(text), metadata, etag });
                if (writes.length === 1) throw conflict();
            },
        } });
    assert.equal(result.attempts, 2);
    assert.equal(writes[0].etag, 'original');
    assert.equal(writes[1].etag, 'latest');
    assert.deepEqual(writes[1].cache.entries, cache(retained, fresh).entries);
    assert.equal(Object.keys(checkpoint.entries).length, 3);
});

test('merge preserves newer concurrent work, deletes only unchanged base entries and prunes expiry margin', () => {
    const old = entry('1');
    const newer = entry('1', '2026-09-17T20:30:00Z');
    const localUpdate = entry('1', '2026-09-17T20:00:00Z');
    const expiredSoon = entry('2', '2026-08-19T21:00:00Z');
    const otherWriter = entry('3');
    const result = mergeCoordinateCaches(cache(old), cache(localUpdate, expiredSoon), cache(newer, otherWriter), NOW);
    assert.deepEqual(result.entries, cache(newer, otherWriter).entries);
    assert.deepEqual(mergeCoordinateCaches(cache(old), cache(), cache(newer), NOW).entries, cache(newer).entries);
    assert.deepEqual(mergeCoordinateCaches(cache(old), cache(), cache(old), NOW).entries, {});
});

test('rotation-only metadata cannot resurrect a concurrently removed entry', () => {
    const original = entry('1');
    const changed = { ...original, rotationDueAt: '2026-09-29T21:00:00Z' };
    assert.deepEqual(mergeCoordinateCaches(cache(original), cache(changed), cache(), NOW).entries, {});
});

test('exhausted conflicts preserve checkpoint and never perform an unconditional write', async () => {
    const document = cache(entry('1'));
    let checkpoints = 0;
    let writes = 0;
    await assert.rejects(persistCoordinateCache({ base: document, local: document, etag: 'original', ledgerSha256: LEDGER,
        now: () => NOW, store: {
            checkpoint: async () => { checkpoints += 1; },
            read: async () => response(document),
            put: async (_text, _metadata, etag) => { assert.ok(etag); writes += 1; throw conflict(); },
        } }), /conflict/);
    assert.equal(checkpoints, 1);
    assert.equal(writes, 4);
});

test('corrupt concurrent cache and access failures fail closed', async () => {
    const document = cache(entry('1'));
    for (const corrupt of [true, false]) {
        let writes = 0;
        await assert.rejects(persistCoordinateCache({ base: document, local: document, etag: 'original', ledgerSha256: LEDGER,
            now: () => NOW, store: {
                checkpoint: async () => {},
                read: async () => ({ ...response(document), text: '{}' }),
                put: async () => { writes += 1; throw corrupt ? conflict() : new Error('AccessDenied'); },
            } }));
        assert.equal(writes, 1);
    }
});
