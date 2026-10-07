import { createHash } from 'node:crypto';
import {
    ACTIVE_PUBLIC_STATUSES,
    CANONICAL_SERVICE_AREA_TOWNS,
    MLS_PIN_PUBLIC_DISCLAIMER,
    serializeMlsJson,
    validateComplianceConfig,
} from './mls-pin-cleaner-lib.mjs';

export const COMMERCIAL_SCHEMA_VERSION = 2;
export const COMMERCIAL_CURRENT_POINTER_FILE = 'current.json';
export const COMMERCIAL_MANIFEST_FILE = 'commercial-search-manifest.json';
export const COMMERCIAL_INDEX_FILE = 'commercial-search-index.json';
export const COMMERCIAL_SOURCE_FILES = Object.freeze([
    'idx_bu.txt',
    'idx_ci.txt',
    'idx_ld.txt',
]);
export const COMMERCIAL_REFERENCE_FILES = Object.freeze([
    'agents.txt',
    'counties.txt',
    'field_reference.txt',
    'offices.txt',
    'optout.txt',
    'towns.txt',
]);
export const COMMERCIAL_REQUIRED_FILES = Object.freeze([
    ...COMMERCIAL_SOURCE_FILES,
    ...COMMERCIAL_REFERENCE_FILES,
]);
export const COMMERCIAL_CATEGORIES = Object.freeze([
    'business-opportunity',
    'commercial-industrial',
    'land',
]);
export const COMMERCIAL_SERVICE_AREA_TOWN_COUNT = CANONICAL_SERVICE_AREA_TOWNS.length;

export const COMMERCIAL_CLASSES = Object.freeze({
    BU: Object.freeze({
        category: 'business-opportunity',
        file: 'idx_bu.txt',
        typeField: 'BU_TYPE',
    }),
    CI: Object.freeze({
        category: 'commercial-industrial',
        file: 'idx_ci.txt',
        typeField: 'CI_TYPE',
    }),
    LD: Object.freeze({
        category: 'land',
        file: 'idx_ld.txt',
        typeField: 'LD_TYPE',
    }),
});

const STATUS_LABELS = Object.freeze({
    ACT: 'Active',
    NEW: 'New',
    PCG: 'Price changed',
    BOM: 'Back on market',
    RAC: 'Reactivated',
    EXT: 'Extended',
    CTG: 'Contingent',
});

const SERVICE_AREA_TOWNS = new Set(
    CANONICAL_SERVICE_AREA_TOWNS.map((town) => town.toUpperCase()),
);

// These are the only source fields read into a v2 public artifact. REMARKS,
// ADULT_COMMUNITY, coordinates, and every unlisted source field fail closed.
export const COMMERCIAL_PUBLIC_SOURCE_FIELD_WHITELIST = Object.freeze({
    common: Object.freeze([
        'PROP_TYPE',
        'LIST_NO',
        'LIST_AGENT',
        'LIST_OFFICE',
        'STATUS',
        'LIST_PRICE',
        'STREET_NO',
        'STREET_NAME',
        'UNIT_NO',
        'TOWN_NUM',
        'ZIP_CODE',
        'PHOTO_COUNT',
        'STATE',
    ]),
    BU: Object.freeze(['BU_TYPE', 'LOT_SIZE', 'BLDG_SQ_FEET', 'PARKING_SPCS', 'REAL_ESTATE_INCLD']),
    CI: Object.freeze([
        'CI_TYPE',
        'SPACE_AVAILABLE',
        'NO_STORIES',
        'TOTAL_UNITS',
        'TOTAL_BLDG_SF',
        'LOT_SIZE',
        'ACRE',
        'PARKING_SPACES',
    ]),
    LD: Object.freeze(['LD_TYPE', 'LOT_SIZE', 'ACRE']),
});

const PUBLIC_LISTING_KEYS = Object.freeze([
    'address',
    'attribution',
    'availability',
    'category',
    'facts',
    'listPrice',
    'listingNumber',
    'listingTypes',
    'photoCount',
    'priceLabel',
    'realEstateIncluded',
    'source',
    'status',
]);

const COMMERCIAL_AVAILABILITY_BY_CODE = Object.freeze({
    A: 'for-sale',
    B: 'for-lease',
    C: 'for-sale-or-lease',
});

function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value) {
    const normalized = readString(value).replace(/[$,]/gu, '');
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function toCount(value, maximum = Number.MAX_SAFE_INTEGER) {
    const number = toNumber(value);
    return number === null ? 0 : Math.min(maximum, Math.max(0, Math.trunc(number)));
}

function toTriState(value) {
    const normalized = readString(value).toUpperCase();
    if (normalized === 'Y') {
        return true;
    }
    if (normalized === 'N') {
        return false;
    }
    return null;
}

function formatPrice(value) {
    if (!Number.isFinite(value)) {
        return '';
    }

    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
    }).format(value);
}

function formatAddress(row) {
    const street = [readString(row.STREET_NO), readString(row.STREET_NAME)]
        .filter(Boolean)
        .join(' ');
    const unit = readString(row.UNIT_NO);
    return unit ? `${street} #${unit}` : street;
}

function increment(target, key) {
    target[key] = (target[key] ?? 0) + 1;
}

function sortedUnique(values) {
    return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function publicReferenceLabel(row) {
    return (readString(row.Long) || readString(row.Medium) || readString(row.Short))
        .replace(/\s*\(?see\s+remarks\)?\s*/giu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function assertExactKeys(value, expectedKeys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    if (actual.join(',') !== expected.join(',')) {
        throw new Error(`${label} has unexpected public keys: ${actual.join(', ')}`);
    }
}

export function assertCommercialFilesAllOrNone(fileNames) {
    const present = new Set(fileNames.map((fileName) => fileName.toLowerCase()));
    const included = COMMERCIAL_SOURCE_FILES.filter((fileName) => present.has(fileName));
    if (included.length !== 0 && included.length !== COMMERCIAL_SOURCE_FILES.length) {
        const missing = COMMERCIAL_SOURCE_FILES.filter((fileName) => !present.has(fileName));
        throw new Error(
            `Commercial MLS input is all-three-or-none; missing: ${missing.join(', ')}`,
        );
    }
    return included.length === COMMERCIAL_SOURCE_FILES.length;
}

export function assertSafeCommercialGeneration(generation) {
    const value = readString(generation);
    if (!/^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
        throw new Error('Commercial generation must be a safe single path segment.');
    }
    return value;
}

export function buildCommercialReferenceMaps({ agents, offices, towns, counties, fieldReference }) {
    return {
        agents: new Map(agents.map((row) => [
            readString(row.ID),
            [readString(row.FIRST_NAME), readString(row.LAST_NAME)].filter(Boolean).join(' '),
        ])),
        offices: new Map(offices.map((row) => [
            readString(row.ID),
            { name: readString(row.NAME) },
        ])),
        towns: new Map(towns.map((row) => [
            readString(row.TOWN_NUM),
            {
                town: readString(row.LONG),
                countyCode: readString(row.COUNTY),
                state: readString(row.STATE).toUpperCase(),
            },
        ])),
        counties: new Map(counties.map((row) => [
            readString(row.SHORT),
            readString(row.LONG) || readString(row.SHORT),
        ])),
        fieldReference: new Map(fieldReference.flatMap((row) => {
            const field = readString(row.Field);
            const short = readString(row.Short);
            if (!field || !short) return [];
            return Object.keys(COMMERCIAL_CLASSES)
                .filter((propertyClass) => readString(row[propertyClass.toLowerCase()]) === '1')
                .map((propertyClass) => [
                    `${propertyClass}:${field}:${short}`,
                    publicReferenceLabel(row),
                ]);
        })),
    };
}

export function parseOptOutOfficeIds(text) {
    return new Set((String(text).match(/[A-Z0-9]+/gu) ?? []).filter(Boolean));
}

function decodeListingTypes(row, propertyClass, classConfig, fieldReference) {
    const codes = readString(row[classConfig.typeField])
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean);
    if (codes.length === 0) {
        return { listingTypes: [], missingCodes: [] };
    }

    const listingTypes = [];
    const missingCodes = [];
    for (const code of codes) {
        const label = fieldReference.get(`${propertyClass}:${classConfig.typeField}:${code}`);
        if (!label) {
            missingCodes.push(code);
        } else {
            listingTypes.push(label);
        }
    }
    return { listingTypes: sortedUnique(listingTypes), missingCodes };
}

function decodeAvailability(row, propertyClass, fieldReference) {
    if (propertyClass !== 'CI') {
        return { availability: null, invalid: false };
    }
    const code = readString(row.SPACE_AVAILABLE).toUpperCase();
    const availability = COMMERCIAL_AVAILABILITY_BY_CODE[code];
    const referenceLabel = fieldReference.get(`CI:SPACE_AVAILABLE:${code}`);
    return {
        availability: availability && referenceLabel ? availability : null,
        invalid: !availability || !referenceLabel,
    };
}

function commercialFacts(row, propertyClass) {
    if (propertyClass === 'BU') {
        return {
            buildingSqft: toNumber(row.BLDG_SQ_FEET),
            lotSizeSqft: toNumber(row.LOT_SIZE),
            acreage: null,
            parkingSpaces: toNumber(row.PARKING_SPCS),
            totalUnits: null,
            stories: null,
        };
    }
    if (propertyClass === 'CI') {
        return {
            buildingSqft: toNumber(row.TOTAL_BLDG_SF),
            lotSizeSqft: toNumber(row.LOT_SIZE),
            acreage: toNumber(row.ACRE),
            parkingSpaces: toNumber(row.PARKING_SPACES),
            totalUnits: toNumber(row.TOTAL_UNITS),
            stories: toNumber(row.NO_STORIES),
        };
    }
    return {
        buildingSqft: null,
        lotSizeSqft: toNumber(row.LOT_SIZE),
        acreage: toNumber(row.ACRE),
        parkingSpaces: null,
        totalUnits: null,
        stories: null,
    };
}

export function cleanCommercialRows({
    rows,
    propertyClass,
    references,
    optOutOfficeIds,
}) {
    const classConfig = COMMERCIAL_CLASSES[propertyClass];
    if (!classConfig) {
        throw new Error(`Unsupported commercial MLS class: ${propertyClass}`);
    }

    const listings = [];
    const quarantined = [];
    const report = {
        sourceRows: rows.length,
        published: 0,
        excludedInactive: 0,
        excludedOptOut: 0,
        excludedOutsideMassachusetts: 0,
        excludedOutsideServiceArea: 0,
        quarantined: 0,
        quarantineReasons: {},
    };

    for (const row of rows) {
        const listingNumber = readString(row.LIST_NO);
        const statusCode = readString(row.STATUS).toUpperCase();
        const listingOfficeId = readString(row.LIST_OFFICE);
        const listingAgentId = readString(row.LIST_AGENT);

        if (!ACTIVE_PUBLIC_STATUSES.includes(statusCode)) {
            report.excludedInactive += 1;
            continue;
        }
        if (optOutOfficeIds.has(listingOfficeId)) {
            report.excludedOptOut += 1;
            continue;
        }

        const townRef = references.towns.get(readString(row.TOWN_NUM));
        const rowState = readString(row.STATE).toUpperCase();
        if (rowState !== 'MA' || (townRef && townRef.state !== 'MA')) {
            report.excludedOutsideMassachusetts += 1;
            continue;
        }
        if (townRef && !SERVICE_AREA_TOWNS.has(townRef.town.toUpperCase())) {
            report.excludedOutsideServiceArea += 1;
            continue;
        }

        const officeRef = references.offices.get(listingOfficeId);
        const agentName = references.agents.get(listingAgentId);
        const county = townRef ? references.counties.get(townRef.countyCode) : '';
        const listPrice = toNumber(row.LIST_PRICE);
        const addressLine = formatAddress(row);
        const { listingTypes, missingCodes } = decodeListingTypes(
            row,
            propertyClass,
            classConfig,
            references.fieldReference,
        );
        const { availability, invalid: invalidAvailability } = decodeAvailability(
            row,
            propertyClass,
            references.fieldReference,
        );
        const reasons = [];
        if (readString(row.PROP_TYPE).toUpperCase() !== propertyClass) reasons.push('invalid_property_class');
        if (!listingNumber) reasons.push('missing_listing_number');
        if (!STATUS_LABELS[statusCode]) reasons.push('unsupported_active_status');
        if (listPrice === null) reasons.push('missing_or_invalid_list_price');
        if (!addressLine) reasons.push('missing_address');
        if (!townRef?.town) reasons.push('missing_town_reference');
        if (!county) reasons.push('missing_county_reference');
        if (!officeRef?.name) reasons.push('missing_office_reference');
        if (!agentName) reasons.push('missing_agent_reference');
        if (listingTypes.length === 0) reasons.push('missing_listing_type_reference');
        if (missingCodes.length > 0) reasons.push('unknown_or_cross_class_listing_type_code');
        if (invalidAvailability) reasons.push('missing_or_unknown_commercial_availability');

        if (reasons.length > 0) {
            report.quarantined += 1;
            for (const reason of reasons) increment(report.quarantineReasons, reason);
            quarantined.push({ listingNumber, reasons });
            continue;
        }

        const listing = {
            listingNumber,
            category: classConfig.category,
            availability,
            listingTypes,
            status: {
                code: statusCode,
                label: STATUS_LABELS[statusCode],
                isActive: true,
            },
            listPrice,
            priceLabel: formatPrice(listPrice),
            address: {
                line: addressLine,
                town: townRef.town,
                county,
                state: 'MA',
                zip: readString(row.ZIP_CODE),
            },
            facts: commercialFacts(row, propertyClass),
            realEstateIncluded: propertyClass === 'BU'
                ? toTriState(row.REAL_ESTATE_INCLD)
                : null,
            attribution: {
                listingAgent: agentName,
                listingOffice: officeRef.name,
            },
            source: { name: 'MLS Property Information Network, Inc.' },
            photoCount: toCount(row.PHOTO_COUNT, 42),
        };
        listings.push(listing);
    }

    report.published = listings.length;
    return { listings, quarantined, report };
}

function toSearchListing(listing) {
    assertExactKeys(listing, PUBLIC_LISTING_KEYS, 'Commercial search listing');
    return listing;
}

export function assertNoProhibitedCommercialPublicKeys(value, path = '$') {
    if (!value || typeof value !== 'object') {
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
        if (
            normalized === 'remarks' ||
            normalized === 'adultcommunity' ||
            normalized === 'entryonly' ||
            normalized === 'expirationdate' ||
            normalized === 'firmremarks' ||
            normalized === 'listdatereceived' ||
            normalized === 'publicrecord' ||
            normalized === 'showingbuyeragent' ||
            normalized === 'showingfacilitator' ||
            normalized === 'showingsubagent' ||
            normalized === 'specialshowinginstructions' ||
            normalized === 'typeoflistingagreement' ||
            normalized === 'mapposition' ||
            normalized === 'coordinates' ||
            normalized === 'latitude' ||
            normalized === 'longitude' ||
            normalized === 'lat' ||
            normalized === 'lng'
        ) {
            throw new Error(`Prohibited commercial public field at ${path}.${key}`);
        }
        assertNoProhibitedCommercialPublicKeys(child, `${path}.${key}`);
    }
}

export function buildCommercialPublicOutputs({
    generation,
    generatedAt,
    sourceUpdatedAt,
    compliance,
    listings,
}) {
    const safeGeneration = assertSafeCommercialGeneration(generation);
    const validatedCompliance = validateComplianceConfig(compliance);
    const uniqueListingNumbers = new Set(listings.map((listing) => listing.listingNumber));
    if (uniqueListingNumbers.size !== listings.length) {
        throw new Error('Commercial public output contains duplicate listing numbers.');
    }

    const sortedListings = [...listings].sort((left, right) => (
        left.listingNumber.localeCompare(right.listingNumber)
    ));
    const searchListings = sortedListings.map(toSearchListing);
    const base = {
        generatedAt,
        source: 'MLS Property Information Network, Inc.',
        sourceUpdatedAt,
        disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
        compliance: validatedCompliance,
    };
    const index = {
        schemaVersion: COMMERCIAL_SCHEMA_VERSION,
        generatedAt,
        listings: searchListings,
    };
    const manifest = {
        schemaVersion: COMMERCIAL_SCHEMA_VERSION,
        ...base,
        totalListingCount: searchListings.length,
        facets: {
            availabilities: sortedUnique(
                searchListings.map((listing) => listing.availability).filter(Boolean),
            ),
            categories: sortedUnique(searchListings.map((listing) => listing.category)),
            counties: sortedUnique(searchListings.map((listing) => listing.address.county)),
            towns: sortedUnique(searchListings.map((listing) => listing.address.town)),
            listingTypes: sortedUnique(searchListings.flatMap((listing) => listing.listingTypes)),
        },
        index: {
            file: COMMERCIAL_INDEX_FILE,
            listingCount: searchListings.length,
        },
    };
    const current = {
        schemaVersion: COMMERCIAL_SCHEMA_VERSION,
        generation: safeGeneration,
        generatedAt,
        manifestFile: COMMERCIAL_MANIFEST_FILE,
    };

    assertNoProhibitedCommercialPublicKeys({ current, manifest, index });
    return { current, manifest, index };
}

export function assertCommercialPublicBundle({ current, manifest, index }) {
    if (!current || !manifest || !index) {
        throw new Error('Commercial public bundle is incomplete.');
    }
    assertExactKeys(
        current,
        ['schemaVersion', 'generation', 'generatedAt', 'manifestFile'],
        'Commercial current pointer',
    );
    assertExactKeys(
        manifest,
        [
            'schemaVersion',
            'generatedAt',
            'source',
            'sourceUpdatedAt',
            'disclaimer',
            'compliance',
            'totalListingCount',
            'facets',
            'index',
        ],
        'Commercial manifest',
    );
    assertExactKeys(index, ['schemaVersion', 'generatedAt', 'listings'], 'Commercial index');
    assertSafeCommercialGeneration(current.generation);
    if (
        current.schemaVersion !== COMMERCIAL_SCHEMA_VERSION ||
        current.manifestFile !== COMMERCIAL_MANIFEST_FILE ||
        manifest.schemaVersion !== COMMERCIAL_SCHEMA_VERSION ||
        index.schemaVersion !== COMMERCIAL_SCHEMA_VERSION ||
        current.generatedAt !== manifest.generatedAt ||
        manifest.generatedAt !== index.generatedAt
    ) {
        throw new Error('Commercial public bundle metadata does not match.');
    }
    if (
        manifest.index?.file !== COMMERCIAL_INDEX_FILE ||
        !Array.isArray(index.listings) ||
        manifest.totalListingCount !== index.listings.length ||
        manifest.index?.listingCount !== index.listings.length
    ) {
        throw new Error('Commercial public bundle counts do not match.');
    }
    const searchIds = new Set();
    for (const listing of index.listings) {
        assertExactKeys(listing, PUBLIC_LISTING_KEYS, 'Commercial search listing');
        if (!readString(listing.listingNumber) || searchIds.has(listing.listingNumber)) {
            throw new Error('Commercial search index has a missing or duplicate listing number.');
        }
        searchIds.add(listing.listingNumber);
    }
    assertNoProhibitedCommercialPublicKeys({ current, manifest, index });
    return true;
}

export function serializeCommercialJson(value, options) {
    return serializeMlsJson(value, options);
}

export function sha256CommercialBuffer(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

export { MLS_PIN_PUBLIC_DISCLAIMER };
