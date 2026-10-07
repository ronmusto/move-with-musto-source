const RUN_ID_PATTERN = /^\d{14}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MANIFEST_FILE = 'commercial-search-manifest.json';
const INDEX_FILE = 'commercial-search-index.json';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const COMMERCIAL_SCHEMA_VERSION = 2;

export const COMMERCIAL_CURRENT_KEY = 'commercial/current.json';
export const COMMERCIAL_GENERATIONS_PREFIX = 'commercial/generations';

function plainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
    return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function validTimestamp(value, now) {
    const timestamp = Date.parse(value);
    return typeof value === 'string' && Number.isFinite(timestamp) && timestamp <= now + MAX_CLOCK_SKEW_MS;
}

export function assertCommercialGenerationId(value) {
    if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
        throw new Error('Commercial current pointer contains an invalid generation identifier.');
    }
    return value;
}

export function validateCommercialManifest(manifest, now = Date.now()) {
    if (
        !plainObject(manifest)
        || manifest.schemaVersion !== COMMERCIAL_SCHEMA_VERSION
        || !validTimestamp(manifest.generatedAt, now)
        || !Number.isSafeInteger(manifest.totalListingCount)
        || manifest.totalListingCount < 0
        || manifest.index?.file !== INDEX_FILE
        || manifest.index?.listingCount !== manifest.totalListingCount
    ) {
        throw new Error('Commercial publication manifest failed schema validation.');
    }
    return manifest;
}

export function createCommercialCurrentPointer(generation, manifest, now = Date.now()) {
    assertCommercialGenerationId(generation);
    const parsedManifest = validateCommercialManifest(manifest, now);
    return {
        schemaVersion: COMMERCIAL_SCHEMA_VERSION,
        generation,
        generatedAt: parsedManifest.generatedAt,
        manifestFile: MANIFEST_FILE,
    };
}

export function parseCommercialCurrentPointer(value, now = Date.now()) {
    if (
        !plainObject(value)
        || !exactKeys(value, ['schemaVersion', 'generation', 'generatedAt', 'manifestFile'])
        || value.schemaVersion !== COMMERCIAL_SCHEMA_VERSION
        || value.manifestFile !== MANIFEST_FILE
        || !validTimestamp(value.generatedAt, now)
    ) {
        throw new Error('Commercial current pointer failed schema validation.');
    }
    assertCommercialGenerationId(value.generation);
    return value;
}

export function activeCommercialPublicationKeys(pointer) {
    const parsed = parseCommercialCurrentPointer(pointer);
    const prefix = `${COMMERCIAL_GENERATIONS_PREFIX}/${parsed.generation}`;
    return {
        prefix,
        manifestKey: `${prefix}/${MANIFEST_FILE}`,
        indexKey: `${prefix}/${INDEX_FILE}`,
    };
}
