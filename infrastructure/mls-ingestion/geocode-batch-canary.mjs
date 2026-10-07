import assert from 'node:assert/strict';
import { buildGeocodePlan } from '../../scripts/enrich-mls-coordinates.mjs';

// Synthetic addresses only; this canary never constructs a geocoder or uses a key.
const listings = Array.from({ length: 1301 }, (_, index) => ({
    listingNumber: String(index), address: { line: `${index + 1} Synthetic Street`, town: 'Boston', state: 'MA', zip: '02108' },
}));
const first = buildGeocodePlan({ index: { listings }, cache: {}, preferredOnly: true, batchSize: 900, batchIndex: 0 });
const last = buildGeocodePlan({ index: { listings: [...listings].reverse() }, cache: {}, preferredOnly: true, batchSize: 900, batchIndex: 1 });
assert.equal(first.batch.count, 2);
assert.equal(first.batch.fingerprint, last.batch.fingerprint);
assert.equal(first.selectedItems.length, 900);
assert.equal(last.selectedItems.length, 401);
assert.equal(new Set([...first.selectedItems, ...last.selectedItems].map((item) => item.listingNumber)).size, 1301);
console.log('Automatic geocode parts cover 1301 synthetic listings exactly once; zero Google requests.');
