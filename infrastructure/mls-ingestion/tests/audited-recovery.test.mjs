import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { recoverAuditedCoordinates } from '../recover-audited-coordinates.mjs';
const hash = (value) => createHash('sha256').update(value).digest('hex');
function fixture() {
    const now = Date.parse('2026-09-17T22:00:00Z');
    const expiresAt = '2026-10-17T21:00:00.000Z';
    const listing = { listingNumber: '1', address: { line: '1 Main St', town: 'Burlington', state: 'MA', zip: '01803' } };
    return { now, cache: { schemaVersion: 'move-with-musto.google-geocode-cache.v1', provider: 'google_geocoding', cacheTtlDays: 30, updatedAt: new Date(now).toISOString(), entries: {} },
        index: { listings: [listing] }, sidecar: { coordinates: { '1': { lat: 42.5048, lng: -71.1956, expiresAt } } },
        events: [{ eventType: 'request_completed', outcome: 'resolved', occurredAt: '2026-09-17T21:01:00Z', listingNumber: '1', cacheExpiresAt: expiresAt,
            addressIdentitySha256: hash('1 main st|burlington|ma|01803'), cacheEntryIdentitySha256: hash('1|1 main st|burlington|ma|01803') },
        { eventType: 'run_completed', outcome: 'completed' }] };
}
test('audited sidecar recovery retains original expiry and never invents provider precision', () => {
    const result = recoverAuditedCoordinates(fixture());
    const entry = Object.values(result.document.entries)[0];
    assert.equal(result.recovered, 1);
    assert.equal(entry.geocodedAt, '2026-09-17T21:00:00.000Z');
    assert.equal(entry.expiresAt, '2026-10-17T21:00:00.000Z');
    assert.equal(entry.precision, 'UNKNOWN_RECOVERED');
});
test('recovery rejects mismatched address, expiry, missing results and incomplete audits', () => {
    for (const change of [
        (f) => { f.index.listings[0].address.line = '2 Main St'; },
        (f) => { f.sidecar.coordinates['1'].expiresAt = '2026-10-18T21:00:00Z'; },
        (f) => { f.sidecar.coordinates = {}; },
        (f) => { f.events.pop(); },
    ]) {
        const input = fixture(); change(input);
        assert.throws(() => recoverAuditedCoordinates(input));
    }
});
