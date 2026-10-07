import { createHash } from 'node:crypto';
import { listingCacheKey, MAX_CACHE_TTL_MS, validateCoordinateCacheDocument } from './seed-coordinate-cache.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

// Recovery for older builds without full checkpoints. No provider precision is
// inferred from a public sidecar; retain an explicit unknown-recovery marker.
export function recoverAuditedCoordinates({ cache, index, sidecar, events, now = Date.now() }) {
    const entries = { ...cache.entries };
    const listings = new Map(index.listings.map((listing) => [String(listing.listingNumber), listing]));
    const completed = events.filter((event) => event.eventType === 'request_completed' && event.outcome === 'resolved');
    if (!completed.length || !events.some((event) => event.eventType === 'run_completed' && event.outcome === 'completed')) {
        throw new Error('Recovery requires a completed, audited geocoding batch.');
    }
    let recovered = 0;
    for (const event of completed) {
        const listing = listings.get(String(event.listingNumber));
        const position = sidecar.coordinates?.[event.listingNumber];
        if (!listing || !position) throw new Error('Audited coordinate has no matching listing and sidecar entry.');
        const key = listingCacheKey(listing);
        const addressKey = key.slice(key.indexOf('|') + 1);
        if (hash(key) !== event.cacheEntryIdentitySha256 || hash(addressKey) !== event.addressIdentitySha256 ||
            position.expiresAt !== event.cacheExpiresAt) throw new Error('Audited coordinate identity or expiry mismatch.');
        const geocodedAt = Date.parse(position.expiresAt) - MAX_CACHE_TTL_MS;
        if (geocodedAt > Date.parse(event.occurredAt) || Date.parse(position.expiresAt) <= now + 86400000) {
            throw new Error('Audited coordinate timestamps are unsafe for recovery.');
        }
        if (entries[key] && Date.parse(entries[key].geocodedAt) >= geocodedAt) continue;
        entries[key] = {
            listingNumber: listing.listingNumber,
            address: [listing.address.line, listing.address.town, listing.address.state, listing.address.zip, 'USA'].join(', '),
            addressKey, lat: position.lat, lng: position.lng,
            precision: 'UNKNOWN_RECOVERED', validation: 'audited_sidecar_recovery',
            geocodedAt: new Date(geocodedAt).toISOString(), expiresAt: position.expiresAt,
        };
        recovered += 1;
    }
    const document = { ...cache, entries, updatedAt: new Date(now).toISOString() };
    validateCoordinateCacheDocument(document, now);
    return { document, recovered, resolvedCount: completed.length };
}
