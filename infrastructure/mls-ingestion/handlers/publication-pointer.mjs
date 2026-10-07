const RUN_ID_PATTERN = /^\d{14}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MANIFEST_FILE = 'mls-search-manifest.json';
const COORDINATE_FILE = 'mls-coordinate-index.json';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const PUBLIC_CURRENT_KEY = 'mls/current.json';
export const PUBLIC_GENERATIONS_PREFIX = 'mls/generations';

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

export function assertGenerationId(value) {
    if (typeof value !== 'string' || !RUN_ID_PATTERN.test(value)) {
        throw new Error('MLS current pointer contains an invalid generation identifier.');
    }
    return value;
}

export function createCurrentPointer(generation, manifest, now = Date.now()) {
    assertGenerationId(generation);
    if (
        !plainObject(manifest) ||
        manifest.schemaVersion !== 1 ||
        !validTimestamp(manifest.generatedAt, now) ||
        manifest.coordinateIndex?.file !== COORDINATE_FILE
    ) {
        throw new Error('Cannot create an MLS current pointer from an invalid publication manifest.');
    }

    return {
        schemaVersion: 1,
        generation,
        generatedAt: manifest.generatedAt,
        manifestFile: MANIFEST_FILE,
    };
}

export function parseCurrentPointer(value, now = Date.now()) {
    if (
        !plainObject(value) ||
        !exactKeys(value, ['schemaVersion', 'generation', 'generatedAt', 'manifestFile']) ||
        value.schemaVersion !== 1 ||
        value.manifestFile !== MANIFEST_FILE ||
        !validTimestamp(value.generatedAt, now)
    ) {
        throw new Error('MLS current pointer failed schema validation.');
    }

    assertGenerationId(value.generation);
    return value;
}

export function activePublicationKeys(pointer) {
    const parsed = parseCurrentPointer(pointer);
    const prefix = `${PUBLIC_GENERATIONS_PREFIX}/${parsed.generation}`;
    return {
        prefix,
        manifestKey: `${prefix}/${MANIFEST_FILE}`,
        coordinateKey: `${prefix}/${COORDINATE_FILE}`,
    };
}

export function validateActiveManifest(pointer, manifest, now = Date.now()) {
    const parsed = parseCurrentPointer(pointer, now);
    if (
        !plainObject(manifest) ||
        manifest.schemaVersion !== 1 ||
        manifest.generatedAt !== parsed.generatedAt ||
        manifest.coordinateIndex?.file !== COORDINATE_FILE ||
        !Number.isSafeInteger(manifest.coordinateIndex?.coordinateCount) ||
        manifest.coordinateIndex.coordinateCount < 0
    ) {
        throw new Error('The active MLS manifest does not match the current pointer.');
    }
    return manifest;
}

export function activePublicationAgeHours(pointer, manifest, now = Date.now()) {
    const activeManifest = validateActiveManifest(pointer, manifest, now);
    return (now - Date.parse(activeManifest.generatedAt)) / (60 * 60 * 1000);
}
