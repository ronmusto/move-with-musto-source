const DAY_MS = 24 * 60 * 60 * 1000;

export const COORDINATE_EXPIRY_MARGIN_MS = DAY_MS;
export const MAXIMUM_COORDINATE_CACHE_AGE_MS = 30 * DAY_MS;

function validCoordinate(entry) {
    return entry &&
        typeof entry === 'object' &&
        Number.isFinite(entry.lat) &&
        Number.isFinite(entry.lng);
}

function validFutureExpiry(entry, cutoff) {
    const expiresAt = Date.parse(entry?.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > cutoff;
}

function validPrivateCacheWindow(entry, now) {
    const geocodedAt = Date.parse(entry?.geocodedAt);
    const expiresAt = Date.parse(entry?.expiresAt);
    return Number.isFinite(geocodedAt) &&
        Number.isFinite(expiresAt) &&
        geocodedAt <= now &&
        expiresAt > geocodedAt &&
        expiresAt - geocodedAt <= MAXIMUM_COORDINATE_CACHE_AGE_MS;
}

function pruneEntries(entries, keep) {
    const retained = {};
    let removedCount = 0;

    for (const [key, entry] of Object.entries(entries)) {
        if (keep(entry)) {
            retained[key] = entry;
        } else {
            removedCount += 1;
        }
    }

    return { retained, removedCount };
}

/**
 * Removes coordinates before they can reach their per-entry expiry. The
 * private Google cache has stronger timestamp requirements than the public
 * sidecar because it retains geocoding evidence beyond lat/lng/expiry.
 */
export function pruneCoordinateDocument(document, now = Date.now()) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw new Error('Coordinate cache object must contain a JSON object.');
    }

    const cutoff = now + COORDINATE_EXPIRY_MARGIN_MS;
    if (document.entries && typeof document.entries === 'object' && !Array.isArray(document.entries)) {
        const { retained, removedCount } = pruneEntries(document.entries, (entry) => (
            validCoordinate(entry) &&
            validFutureExpiry(entry, cutoff) &&
            validPrivateCacheWindow(entry, now)
        ));
        return {
            document: {
                ...document,
                updatedAt: new Date(now).toISOString(),
                entries: retained,
            },
            kind: 'private-cache',
            removedCount,
            remainingCount: Object.keys(retained).length,
        };
    }

    if (
        document.coordinates &&
        typeof document.coordinates === 'object' &&
        !Array.isArray(document.coordinates)
    ) {
        const { retained, removedCount } = pruneEntries(document.coordinates, (entry) => (
            validCoordinate(entry) && validFutureExpiry(entry, cutoff)
        ));
        return {
            document: { ...document, coordinates: retained },
            kind: 'coordinate-index',
            removedCount,
            remainingCount: Object.keys(retained).length,
        };
    }

    throw new Error('Coordinate cache object has an unsupported schema.');
}

export function withCoordinateCount(manifest, coordinateCount) {
    if (
        !manifest ||
        typeof manifest !== 'object' ||
        Array.isArray(manifest) ||
        !manifest.coordinateIndex ||
        typeof manifest.coordinateIndex !== 'object' ||
        !Number.isSafeInteger(coordinateCount) ||
        coordinateCount < 0
    ) {
        throw new Error('MLS search manifest cannot accept a coordinate count update.');
    }

    return {
        ...manifest,
        coordinateIndex: {
            ...manifest.coordinateIndex,
            coordinateCount,
        },
    };
}

export function publicCoordinateCount(document) {
    if (
        !document ||
        typeof document !== 'object' ||
        Array.isArray(document) ||
        !document.coordinates ||
        typeof document.coordinates !== 'object' ||
        Array.isArray(document.coordinates)
    ) {
        throw new Error('Public coordinate index cannot be counted.');
    }
    return Object.keys(document.coordinates).length;
}

export function publicManifestNeedsCoordinateReconciliation(manifest, coordinateDocument) {
    return manifest?.coordinateIndex?.coordinateCount !== publicCoordinateCount(coordinateDocument);
}
