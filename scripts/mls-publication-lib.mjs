import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { coordinateIsInMassachusetts } from './massachusetts-coordinate-guard.mjs';
import { parseMlsOpenHouseTimestamp } from './mls-open-house-time.mjs';
import { sanitizePublicHttpsUrl } from './public-url-safety.mjs';
import {
    fairHousingReviewFlags,
    GOOGLE_GEOCODE_COORDINATE_TTL_MS,
    listingIsMassachusetts,
    listingMatchesPreferredServiceArea,
    MLS_ALLOWED_STATE,
    MLS_COORDINATE_INDEX_FILE,
    MLS_COORDINATE_INDEX_SCHEMA_VERSION,
    MLS_SEARCH_MANIFEST_FILE,
    MLS_SEARCH_SHARD_FILES,
    MLS_SEARCH_SHARD_SCHEMA_VERSION,
    MLS_PIN_PUBLIC_DISCLAIMER,
    validateComplianceConfig,
} from './mls-pin-cleaner-lib.mjs';

export const MLS_PIN_MAX_PUBLIC_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
const SEARCH_DELIVERY_FILES = [
    MLS_SEARCH_MANIFEST_FILE,
    MLS_SEARCH_SHARD_FILES.preferred,
    MLS_COORDINATE_INDEX_FILE,
];
const ALLOWED_TOP_LEVEL_ENTRIES = new Set([
    'listings',
    'mls-search-index.json',
    ...SEARCH_DELIVERY_FILES,
]);
const PUBLICATION_MODES = new Set(['import-pending', 'live']);
const PROHIBITED_FIELD_KEYS = new Set([
    'entryonly',
    'expirationdate',
    'firmremarks',
    'listdatereceived',
    'publicrecord',
    'showingbuyeragent',
    'showingfacilitator',
    'showingsubagent',
    'specialshowinginstructions',
    'typeoflistingagreement',
]);
const PROHIBITED_PUBLIC_COORDINATE_KEYS = new Set([
    'geocodedat',
    'lat',
    'latitude',
    'lng',
    'longitude',
    'mapposition',
]);

function requireText(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`MLS publication is missing ${label}.`);
    }
}

function assertValidPublicationMode(mode) {
    if (!PUBLICATION_MODES.has(mode)) {
        throw new Error('MLS publication mode must be import-pending or live.');
    }
}

function assertNoProhibitedFields(value, location) {
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertNoProhibitedFields(item, `${location}[${index}]`));
        return;
    }

    if (!value || typeof value !== 'object') {
        return;
    }

    for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (PROHIBITED_FIELD_KEYS.has(normalizedKey)) {
            throw new Error(`MLS publication contains prohibited field ${key} at ${location}.`);
        }
        if (PROHIBITED_PUBLIC_COORDINATE_KEYS.has(normalizedKey)) {
            throw new Error(
                `MLS public listing data contains coordinate field ${key} at ${location}; ` +
                'coordinates belong only in the expiring sidecar.',
            );
        }
        assertNoProhibitedFields(child, `${location}.${key}`);
    }
}

function validateListing(listing, location, _now) {
    requireText(listing?.listingNumber, `${location}.listingNumber`);
    requireText(listing?.propertyType, `${location}.propertyType`);
    requireText(listing?.status?.code, `${location}.status.code`);
    requireText(listing?.status?.label, `${location}.status.label`);
    if (listing?.status?.isActive !== true) {
        throw new Error(`MLS publication requires an active status flag at ${location}.status.isActive.`);
    }
    if (!Number.isFinite(listing?.listPrice)) {
        throw new Error(`MLS publication is missing ${location}.listPrice.`);
    }
    requireText(listing?.address?.line, `${location}.address.line`);
    requireText(listing?.address?.town, `${location}.address.town`);
    requireText(listing?.address?.state, `${location}.address.state`);
    if (!listingIsMassachusetts(listing)) {
        throw new Error(
            `MLS publication requires Massachusetts-only state ${MLS_ALLOWED_STATE} ` +
            `at ${location}.address.state.`,
        );
    }
    if (listing?.virtualTourUrl && !sanitizePublicHttpsUrl(listing.virtualTourUrl)) {
        throw new Error(`MLS publication has an unsafe ${location}.virtualTourUrl.`);
    }
    requireText(listing?.attribution?.listingOffice, `${location}.attribution.listingOffice`);
    requireText(listing?.attribution?.listingAgent, `${location}.attribution.listingAgent`);
    const fairHousingFlags = fairHousingReviewFlags(listing?.remarks);
    if (fairHousingFlags.length > 0) {
        throw new Error(
            `MLS publication requires fair-housing review at ${location}.remarks ` +
            `(${fairHousingFlags.map((flag) => flag.code).join(', ')}).`,
        );
    }
    if (Object.hasOwn(listing, 'mapPosition')) {
        throw new Error(
            `MLS public ${location} must not embed mapPosition; coordinates belong only in the expiring sidecar.`,
        );
    }
    if (Object.hasOwn(listing, 'openHouseCount')) {
        if (!Number.isInteger(listing.openHouseCount) || listing.openHouseCount < 0) {
            throw new Error(`MLS publication has invalid ${location}.openHouseCount.`);
        }
        if (
            !Array.isArray(listing.openHouseEndTimes) ||
            listing.openHouseEndTimes.length !== listing.openHouseCount ||
            listing.openHouseEndTimes.some((end) => !Number.isFinite(parseMlsOpenHouseTimestamp(end)))
        ) {
            throw new Error(
                `MLS publication requires valid ${location}.openHouseEndTimes for static-data aging.`,
            );
        }
    }
    if (Object.hasOwn(listing, 'openHouses')) {
        if (!Array.isArray(listing.openHouses) || listing.openHouses.some((openHouse) => {
            const start = parseMlsOpenHouseTimestamp(openHouse?.start);
            const end = parseMlsOpenHouseTimestamp(openHouse?.end);
            return !Number.isFinite(start) ||
                !Number.isFinite(end) ||
                end < start ||
                (openHouse?.url && !sanitizePublicHttpsUrl(openHouse.url));
        })) {
            throw new Error(`MLS publication has invalid ${location}.openHouses.`);
        }
    }
    assertNoProhibitedFields(listing, location);
}

export function assertFreshMlsTimestamp(generatedAt, now = Date.now()) {
    const timestamp = Date.parse(generatedAt);
    if (!Number.isFinite(timestamp)) {
        throw new Error('MLS publication has an invalid generatedAt timestamp.');
    }

    const age = now - timestamp;
    if (age < -FUTURE_CLOCK_TOLERANCE_MS) {
        throw new Error('MLS publication generatedAt timestamp is unexpectedly in the future.');
    }
    if (age > MLS_PIN_MAX_PUBLIC_AGE_MS) {
        throw new Error('MLS publication is older than the MLS PIN three-day refresh limit.');
    }
}

function assertFreshSourceTimestamp(value, label, now) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        throw new Error(`MLS source snapshot has an invalid ${label} timestamp.`);
    }

    const age = now - timestamp;
    if (age < -FUTURE_CLOCK_TOLERANCE_MS) {
        throw new Error(`MLS source snapshot ${label} timestamp is unexpectedly in the future.`);
    }
    if (age > MLS_PIN_MAX_PUBLIC_AGE_MS) {
        throw new Error(`MLS source snapshot ${label} is older than the MLS PIN three-day refresh limit.`);
    }
}

function validateSourceSnapshot(sourceSnapshot, now) {
    if (!sourceSnapshot || typeof sourceSnapshot !== 'object') {
        throw new Error('MLS live publication is missing source snapshot metadata.');
    }

    requireText(sourceSnapshot.capturedAt, 'sourceSnapshot.capturedAt');
    requireText(sourceSnapshot.latestSalesFileModifiedAt, 'sourceSnapshot.latestSalesFileModifiedAt');
    assertFreshSourceTimestamp(sourceSnapshot.capturedAt, 'capturedAt', now);
    assertFreshSourceTimestamp(sourceSnapshot.latestSalesFileModifiedAt, 'latestSalesFileModifiedAt', now);

    if (!Array.isArray(sourceSnapshot.salesFiles) || sourceSnapshot.salesFiles.length === 0) {
        throw new Error('MLS source snapshot is missing sales file metadata.');
    }

    // MLS reference tables can legitimately have older MLS update dates. The
    // live freshness gate applies only to the active sales/listing exports.
    sourceSnapshot.salesFiles.forEach((file, index) => {
        const location = `sourceSnapshot.salesFiles[${index}]`;
        requireText(file?.name, `${location}.name`);
        requireText(file?.propertyClass, `${location}.propertyClass`);
        requireText(file?.modifiedAt, `${location}.modifiedAt`);
        if (!Number.isFinite(file?.sizeBytes) || file.sizeBytes < 0) {
            throw new Error(`MLS publication is missing ${location}.sizeBytes.`);
        }
        assertFreshSourceTimestamp(file.modifiedAt, `${file.name} modifiedAt`, now);
    });
}

function normalizeValidationOptions(optionsOrNow = {}) {
    if (typeof optionsOrNow === 'number') {
        return {
            mode: 'import-pending',
            now: optionsOrNow,
        };
    }

    return {
        mode: optionsOrNow.mode ?? 'import-pending',
        now: optionsOrNow.now ?? Date.now(),
    };
}

function validateSearchManifestBase(manifest, index, now) {
    if (!manifest || typeof manifest !== 'object') {
        throw new Error('MLS sharded search delivery is missing its manifest.');
    }
    if (manifest.schemaVersion !== MLS_SEARCH_SHARD_SCHEMA_VERSION) {
        throw new Error('MLS search manifest has an unsupported schema version.');
    }
    if (manifest.generatedAt !== index.generatedAt) {
        throw new Error('MLS search manifest does not match the search-index generation.');
    }
    if (manifest.source !== index.source || manifest.disclaimer !== index.disclaimer) {
        throw new Error('MLS search manifest metadata does not match the search index.');
    }
    validateComplianceConfig(manifest.compliance);
    if (!isDeepStrictEqual(manifest.compliance, index.compliance)) {
        throw new Error('MLS search manifest compliance metadata does not match the search index.');
    }
    assertFreshMlsTimestamp(manifest.generatedAt, now);
    if (!Number.isInteger(manifest.totalListingCount) || manifest.totalListingCount !== index.listings.length) {
        throw new Error('MLS search manifest listing count does not match the search index.');
    }
    const facetValues = (readValue) => Array.from(new Set(
        index.listings.map(readValue).filter(Boolean),
    )).sort((first, second) => first.localeCompare(second));
    const expectedFacets = {
        states: facetValues((listing) => listing.address.state),
        counties: facetValues((listing) => listing.address.county),
        towns: facetValues((listing) => listing.address.town),
        propertyTypes: facetValues((listing) => listing.propertyType),
    };
    if (!isDeepStrictEqual(manifest.facets, expectedFacets)) {
        throw new Error('MLS search manifest facets do not match the search index.');
    }
    if (!Array.isArray(manifest.shards) || manifest.shards.length !== 1) {
        throw new Error('MLS public search manifest must describe exactly one service-area shard.');
    }
    if (
        !manifest.coordinateIndex ||
        manifest.coordinateIndex.file !== MLS_COORDINATE_INDEX_FILE ||
        !Number.isInteger(manifest.coordinateIndex.coordinateCount) ||
        manifest.coordinateIndex.coordinateCount < 0
    ) {
        throw new Error('MLS search manifest has an invalid coordinate-index descriptor.');
    }
}

function validateCoordinateIndex({ index, manifest, coordinateIndex, now }) {
    if (
        !coordinateIndex ||
        coordinateIndex.schemaVersion !== MLS_COORDINATE_INDEX_SCHEMA_VERSION ||
        coordinateIndex.generatedAt !== index.generatedAt ||
        !coordinateIndex.coordinates ||
        typeof coordinateIndex.coordinates !== 'object' ||
        Array.isArray(coordinateIndex.coordinates)
    ) {
        throw new Error('MLS coordinate index does not match its manifest generation.');
    }

    const actualKeys = Object.keys(coordinateIndex.coordinates).sort();
    if (manifest.coordinateIndex.coordinateCount !== actualKeys.length) {
        throw new Error('MLS coordinate index count does not match its manifest.');
    }

    const listingNumbers = new Set(index.listings.map((listing) => listing.listingNumber));
    // Listing freshness and coordinate freshness are separate clocks. A
    // coordinate can be refreshed after the MLS export was generated, so its
    // expiry is bounded from validation time, not the export's generatedAt.
    // The sidecar builder separately enforces expiresAt - geocodedAt <= 30 days.
    const maximumExpiresAt = now + GOOGLE_GEOCODE_COORDINATE_TTL_MS +
        FUTURE_CLOCK_TOLERANCE_MS;
    for (const listingNumber of actualKeys) {
        const coordinate = coordinateIndex.coordinates[listingNumber];
        const expiresAt = Date.parse(coordinate?.expiresAt);
        if (
            !listingNumbers.has(listingNumber) ||
            !coordinate ||
            !isDeepStrictEqual(Object.keys(coordinate).sort(), ['expiresAt', 'lat', 'lng']) ||
            !Number.isFinite(coordinate.lat) ||
            !Number.isFinite(coordinate.lng) ||
            !coordinateIsInMassachusetts(coordinate) ||
            !Number.isFinite(expiresAt) ||
            expiresAt <= now ||
            !Number.isFinite(maximumExpiresAt) ||
            expiresAt > maximumExpiresAt
        ) {
            throw new Error(`MLS coordinate sidecar has invalid or expired listing ${listingNumber}.`);
        }
    }
}

function validateSearchDelivery({
    index,
    manifest,
    searchShards,
    coordinateIndex,
    topLevelEntries,
    now,
}) {
    const deliveryEntries = SEARCH_DELIVERY_FILES.filter((fileName) => topLevelEntries.includes(fileName));
    const hasDelivery = deliveryEntries.length > 0 ||
        manifest !== undefined ||
        searchShards !== undefined ||
        coordinateIndex !== undefined;

    if (!hasDelivery) {
        return;
    }
    if (deliveryEntries.length !== SEARCH_DELIVERY_FILES.length) {
        throw new Error('MLS sharded search delivery is incomplete.');
    }

    validateSearchManifestBase(manifest, index, now);
    validateCoordinateIndex({ index, manifest, coordinateIndex, now });
    if (!searchShards || typeof searchShards !== 'object') {
        throw new Error('MLS sharded search delivery is missing shard payloads.');
    }

    const descriptorById = new Map(manifest.shards.map((descriptor) => [descriptor?.id, descriptor]));
    const combinedListings = new Map();

    for (const id of ['preferred']) {
        const expectedFile = MLS_SEARCH_SHARD_FILES[id];
        const descriptor = descriptorById.get(id);
        if (
            !descriptor ||
            descriptor.file !== expectedFile ||
            !Number.isInteger(descriptor.listingCount) ||
            descriptor.listingCount < 0
        ) {
            throw new Error(`MLS search manifest has an invalid ${id} shard descriptor.`);
        }

        const shard = searchShards[id];
        if (
            !shard ||
            shard.schemaVersion !== MLS_SEARCH_SHARD_SCHEMA_VERSION ||
            shard.id !== id ||
            shard.generatedAt !== index.generatedAt ||
            !Array.isArray(shard.listings) ||
            shard.listings.length !== descriptor.listingCount
        ) {
            throw new Error(`MLS search ${id} shard does not match its manifest descriptor.`);
        }

        shard.listings.forEach((listing, listingIndex) => {
            const location = `searchShard.${id}.listings[${listingIndex}]`;
            if (Object.hasOwn(listing, 'mapPosition')) {
                throw new Error(`MLS search ${id} shard must not embed mapPosition data.`);
            }
            validateListing(listing, location, now);
            const belongsToPreferred = listingMatchesPreferredServiceArea(listing);
            if ((id === 'preferred') !== belongsToPreferred) {
                throw new Error(`MLS search ${id} shard contains a listing from the wrong service-area partition.`);
            }
            if (combinedListings.has(listing.listingNumber)) {
                throw new Error(`MLS search shards contain duplicate listing ${listing.listingNumber}.`);
            }
            combinedListings.set(listing.listingNumber, listing);
        });
    }

    if (combinedListings.size !== index.listings.length) {
        throw new Error('MLS search shards do not contain the complete search index.');
    }
    index.listings.forEach((listing) => {
        if (!isDeepStrictEqual(combinedListings.get(listing.listingNumber), listing)) {
            throw new Error(`MLS search shards do not match search-index listing ${listing.listingNumber}.`);
        }
    });
}

/**
 * @param {{
 *   index: any,
 *   detailFiles: Array<{ name: string, value: any }>,
 *   topLevelEntries: string[],
 *   manifest?: any,
 *   searchShards?: any,
 *   coordinateIndex?: any,
 *   now?: number,
 *   mode?: string,
 * }} publication
 */
export function validateMlsPublication({
    index,
    detailFiles,
    topLevelEntries,
    manifest = undefined,
    searchShards = undefined,
    coordinateIndex = undefined,
    now = Date.now(),
    mode = 'import-pending',
}) {
    assertValidPublicationMode(mode);
    const unexpectedEntries = topLevelEntries.filter((entry) => !ALLOWED_TOP_LEVEL_ENTRIES.has(entry));
    if (unexpectedEntries.length > 0) {
        throw new Error(`MLS public directory contains non-publishable artifacts: ${unexpectedEntries.join(', ')}`);
    }

    if (index?.disclaimer !== MLS_PIN_PUBLIC_DISCLAIMER) {
        throw new Error('MLS publication does not contain the required MLS PIN consumer-use disclaimer.');
    }
    validateComplianceConfig(index?.compliance);
    assertFreshMlsTimestamp(index?.generatedAt, now);
    if (mode === 'live') {
        validateSourceSnapshot(index?.sourceSnapshot, now);
    }

    if (!Array.isArray(index?.listings) || index.listings.length === 0) {
        throw new Error('MLS publication search index contains no listings.');
    }

    const expectedDetails = new Set();
    index.listings.forEach((listing, indexPosition) => {
        validateListing(listing, `searchIndex.listings[${indexPosition}]`, now);
        if (!listingMatchesPreferredServiceArea(listing)) {
            throw new Error(
                `MLS public search index contains out-of-service listing ${listing.listingNumber}.`,
            );
        }
        expectedDetails.add(`${encodeURIComponent(listing.listingNumber.trim())}.json`);
    });

    validateSearchDelivery({
        index,
        manifest,
        searchShards,
        coordinateIndex,
        topLevelEntries,
        now,
    });

    const actualDetails = new Set(detailFiles.map((detail) => detail.name));
    const missingDetails = [...expectedDetails].filter((name) => !actualDetails.has(name));
    const staleDetails = [...actualDetails].filter((name) => !expectedDetails.has(name));
    if (missingDetails.length > 0 || staleDetails.length > 0) {
        throw new Error(
            `MLS detail files do not match the search index. Missing: ${missingDetails.length}; stale: ${staleDetails.length}.`,
        );
    }

    detailFiles.forEach((detail) => {
        validateListing(detail.value, `listings/${detail.name}`, now);
        if (!listingMatchesPreferredServiceArea(detail.value)) {
            throw new Error(`MLS public detail ${detail.name} contains an out-of-service listing.`);
        }
        if (detail.value.generatedAt !== index.generatedAt) {
            throw new Error(`MLS detail ${detail.name} does not match the search-index generation.`);
        }
    });
    return {
        listingCount: index.listings.length,
        generatedAt: index.generatedAt,
    };
}

export async function validateMlsPublicationDirectory(directory, optionsOrNow = {}) {
    const options = normalizeValidationOptions(optionsOrNow);
    const entries = await readdir(directory, { withFileTypes: true });
    const topLevelEntries = entries.map((entry) => entry.name);
    const index = JSON.parse(await readFile(path.join(directory, 'mls-search-index.json'), 'utf8'));
    const hasSearchDelivery = SEARCH_DELIVERY_FILES.some((fileName) => topLevelEntries.includes(fileName));
    if (!hasSearchDelivery) {
        throw new Error('MLS public directory is missing its service-area search delivery.');
    }
    let manifest;
    let searchShards;
    let coordinateIndex;
    if (hasSearchDelivery) {
        const missingDeliveryFiles = SEARCH_DELIVERY_FILES.filter(
            (fileName) => !topLevelEntries.includes(fileName),
        );
        if (missingDeliveryFiles.length > 0) {
            throw new Error(`MLS sharded search delivery is incomplete: ${missingDeliveryFiles.join(', ')}.`);
        }
        manifest = JSON.parse(await readFile(path.join(directory, MLS_SEARCH_MANIFEST_FILE), 'utf8'));
        searchShards = {};
        searchShards.preferred = JSON.parse(
            await readFile(path.join(directory, MLS_SEARCH_SHARD_FILES.preferred), 'utf8'),
        );
        coordinateIndex = JSON.parse(
            await readFile(path.join(directory, MLS_COORDINATE_INDEX_FILE), 'utf8'),
        );
    }
    const listingsDir = path.join(directory, 'listings');
    const listingEntries = await readdir(listingsDir, { withFileTypes: true });
    const jsonEntries = listingEntries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
    if (jsonEntries.length !== listingEntries.length) {
        throw new Error('MLS listings directory contains a non-JSON file or nested directory.');
    }

    const detailFiles = [];
    for (const entry of jsonEntries) {
        detailFiles.push({
            name: entry.name,
            value: JSON.parse(await readFile(path.join(listingsDir, entry.name), 'utf8')),
        });
    }

    return validateMlsPublication({
        index,
        detailFiles,
        manifest,
        searchShards,
        coordinateIndex,
        topLevelEntries,
        now: options.now,
        mode: options.mode,
    });
}
