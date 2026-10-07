import {
    MLS_PIN_MAX_PUBLIC_AGE_MS,
    MLS_PIN_PUBLIC_DISCLAIMER,
    sanitizeMlsDataOrigin,
} from '@/lib/mls-public-listings';

export const commercialCurrentPointerFile = 'current.json' as const;
export const commercialSearchManifestFile = 'commercial-search-manifest.json' as const;
export const commercialSearchIndexFile = 'commercial-search-index.json' as const;
export const commercialSchemaVersion = 2 as const;

export type CommercialCategory =
    | 'business-opportunity'
    | 'commercial-industrial'
    | 'land';

export type CommercialAvailability =
    | 'for-sale'
    | 'for-lease'
    | 'for-sale-or-lease';

export type CommercialComplianceConfig = {
    participantFirmName: string;
    officeAddress: string;
    phone: string;
    marketArea: string;
};

export type CommercialSearchListing = {
    listingNumber: string;
    category: CommercialCategory;
    availability: CommercialAvailability | null;
    listingTypes: string[];
    status: {
        code: string;
        label: string;
        isActive: true;
    };
    listPrice: number;
    priceLabel: string;
    address: {
        line: string;
        town: string;
        county: string;
        state: 'MA';
        zip: string;
    };
    facts: {
        buildingSqft: number | null;
        lotSizeSqft: number | null;
        acreage: number | null;
        parkingSpaces: number | null;
        totalUnits: number | null;
        stories: number | null;
    };
    realEstateIncluded: boolean | null;
    attribution: {
        listingAgent: string;
        listingOffice: string;
    };
    source: {
        name: string;
    };
    photoCount: number;
};

export type CommercialCurrentPointer = {
    schemaVersion: 2;
    generation: string;
    generatedAt: string;
    manifestFile: 'commercial-search-manifest.json';
};

export type CommercialSearchManifest = {
    schemaVersion: 2;
    generatedAt: string;
    source: string;
    sourceUpdatedAt: string;
    disclaimer: string;
    compliance: CommercialComplianceConfig;
    totalListingCount: number;
    facets: {
        availabilities: CommercialAvailability[];
        categories: CommercialCategory[];
        counties: string[];
        towns: string[];
        listingTypes: string[];
    };
    index: {
        file: 'commercial-search-index.json';
        listingCount: number;
    };
};

export type CommercialSearchIndex = {
    schemaVersion: 2;
    generatedAt: string;
    listings: CommercialSearchListing[];
};

const commercialCategories = new Set<CommercialCategory>([
    'business-opportunity',
    'commercial-industrial',
    'land',
]);
const commercialAvailabilities = new Set<CommercialAvailability>([
    'for-sale',
    'for-lease',
    'for-sale-or-lease',
]);
const activeCommercialStatuses = new Set(['ACT', 'NEW', 'PCG', 'BOM', 'RAC', 'EXT', 'CTG']);
const futureSkewMs = 5 * 60 * 1000;

function exactKeys(value: object, expected: string[]) {
    return Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && Boolean(value.trim());
}

function isNullableNonNegativeNumber(value: unknown) {
    return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}

function isFreshTimestamp(value: unknown, now: number) {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) &&
        timestamp <= now + futureSkewMs &&
        now - timestamp <= MLS_PIN_MAX_PUBLIC_AGE_MS;
}

function isComplianceReady(value: unknown): value is CommercialComplianceConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const config = value as Partial<CommercialComplianceConfig>;
    return exactKeys(value, ['participantFirmName', 'officeAddress', 'phone', 'marketArea']) &&
        isNonEmptyString(config.participantFirmName) &&
        isNonEmptyString(config.officeAddress) &&
        isNonEmptyString(config.phone) &&
        isNonEmptyString(config.marketArea);
}

function isStringArray(value: unknown, { allowEmpty = true } = {}) {
    return Array.isArray(value) &&
        (allowEmpty || value.length > 0) &&
        value.every(isNonEmptyString);
}

function hasProhibitedCommercialPublicField(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => {
        const normalized = key.replace(/[^a-z0-9]/giu, '').toLowerCase();
        return [
            'remarks',
            'adultcommunity',
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
            'mapposition',
            'coordinates',
            'latitude',
            'longitude',
            'lat',
            'lng',
        ].includes(normalized) || hasProhibitedCommercialPublicField(child);
    });
}

function isCommercialSearchListingReady(value: unknown): value is CommercialSearchListing {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const listing = value as Partial<CommercialSearchListing>;
    const status = listing.status;
    const address = listing.address;
    const facts = listing.facts;
    const attribution = listing.attribution;
    const source = listing.source;
    if (
        !exactKeys(value, [
            'listingNumber',
            'category',
            'availability',
            'listingTypes',
            'status',
            'listPrice',
            'priceLabel',
            'address',
            'facts',
            'realEstateIncluded',
            'attribution',
            'source',
            'photoCount',
        ]) ||
        !isNonEmptyString(listing.listingNumber) ||
        !commercialCategories.has(listing.category as CommercialCategory) ||
        !(listing.availability === null || commercialAvailabilities.has(
            listing.availability as CommercialAvailability,
        )) ||
        (listing.category === 'commercial-industrial' && listing.availability === null) ||
        (listing.category !== 'commercial-industrial' && listing.availability !== null) ||
        !isStringArray(listing.listingTypes, { allowEmpty: false }) ||
        !status || !exactKeys(status, ['code', 'label', 'isActive']) ||
        !isNonEmptyString(status.code) || !activeCommercialStatuses.has(status.code) ||
        !isNonEmptyString(status.label) || status.isActive !== true ||
        typeof listing.listPrice !== 'number' || !Number.isFinite(listing.listPrice) || listing.listPrice < 0 ||
        !isNonEmptyString(listing.priceLabel) ||
        !address || !exactKeys(address, ['line', 'town', 'county', 'state', 'zip']) ||
        !isNonEmptyString(address.line) || !isNonEmptyString(address.town) ||
        !isNonEmptyString(address.county) || address.state !== 'MA' || typeof address.zip !== 'string' ||
        !facts || !exactKeys(facts, [
            'buildingSqft',
            'lotSizeSqft',
            'acreage',
            'parkingSpaces',
            'totalUnits',
            'stories',
        ]) ||
        !Object.values(facts).every(isNullableNonNegativeNumber) ||
        !(listing.realEstateIncluded === null || typeof listing.realEstateIncluded === 'boolean') ||
        (listing.category !== 'business-opportunity' && listing.realEstateIncluded !== null) ||
        !attribution || !exactKeys(attribution, ['listingAgent', 'listingOffice']) ||
        !isNonEmptyString(attribution.listingAgent) || !isNonEmptyString(attribution.listingOffice) ||
        !source || !exactKeys(source, ['name']) || !isNonEmptyString(source.name) ||
        !Number.isInteger(listing.photoCount) || Number(listing.photoCount) < 0 || Number(listing.photoCount) > 42 ||
        hasProhibitedCommercialPublicField(value)
    ) {
        return false;
    }
    return true;
}

/** Commercial has its own delivery namespace, separate from residential /mls. */
export function buildCommercialPublicDataUrl(
    commercialPath: string,
    configuredOrigin: unknown = process.env.NEXT_PUBLIC_MLS_DATA_ORIGIN,
) {
    const origin = sanitizeMlsDataOrigin(configuredOrigin);
    const normalized = commercialPath.replace(/^\/+/, '');
    return `${origin}/commercial/${normalized}`;
}

export const defaultCommercialCurrentPointerUrl = buildCommercialPublicDataUrl(
    commercialCurrentPointerFile,
);

export async function readCommercialJson<T>(
    url: string,
    fetcher: typeof fetch = fetch,
): Promise<T> {
    const response = await fetcher(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
        throw new Error(`Commercial data request failed with HTTP ${response.status}.`);
    }
    return response.json() as Promise<T>;
}

export function isCommercialCurrentPointerReady(
    value: unknown,
    now = Date.now(),
): value is CommercialCurrentPointer {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const pointer = value as Partial<CommercialCurrentPointer>;
    return exactKeys(value, ['schemaVersion', 'generation', 'generatedAt', 'manifestFile']) &&
        pointer.schemaVersion === commercialSchemaVersion &&
        isNonEmptyString(pointer.generation) &&
        /^(?!\.{1,2}$)[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(pointer.generation) &&
        isFreshTimestamp(pointer.generatedAt, now) &&
        pointer.manifestFile === commercialSearchManifestFile;
}

export function buildCommercialGenerationBaseUrl(
    currentPointerUrl: string,
    pointer: CommercialCurrentPointer,
    now = Date.now(),
) {
    if (!isCommercialCurrentPointerReady(pointer, now)) {
        throw new Error('Cannot resolve an invalid commercial current pointer.');
    }
    const cleanUrl = currentPointerUrl.split(/[?#]/u, 1)[0];
    const pointerPathname = new URL(cleanUrl, 'https://local.invalid').pathname;
    if (pointerPathname !== '/commercial/current.json') {
        throw new Error('Commercial current pointer URL has an unexpected namespace.');
    }
    return `${cleanUrl.slice(0, -commercialCurrentPointerFile.length)}` +
        `generations/${encodeURIComponent(pointer.generation)}`;
}

export function isCommercialSearchManifestReady(
    value: unknown,
    now = Date.now(),
): value is CommercialSearchManifest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const manifest = value as Partial<CommercialSearchManifest>;
    const facets = manifest.facets;
    const index = manifest.index;
    const generatedAt = Date.parse(String(manifest.generatedAt));
    const sourceUpdatedAt = Date.parse(String(manifest.sourceUpdatedAt));
    return exactKeys(value, [
        'schemaVersion',
        'generatedAt',
        'source',
        'sourceUpdatedAt',
        'disclaimer',
        'compliance',
        'totalListingCount',
        'facets',
        'index',
    ]) &&
        manifest.schemaVersion === commercialSchemaVersion &&
        isFreshTimestamp(manifest.generatedAt, now) &&
        isFreshTimestamp(manifest.sourceUpdatedAt, now) &&
        sourceUpdatedAt <= generatedAt + futureSkewMs &&
        isNonEmptyString(manifest.source) &&
        manifest.disclaimer === MLS_PIN_PUBLIC_DISCLAIMER &&
        isComplianceReady(manifest.compliance) &&
        Number.isInteger(manifest.totalListingCount) && Number(manifest.totalListingCount) > 0 &&
        Boolean(facets) && exactKeys(
            facets as object,
            ['availabilities', 'categories', 'counties', 'towns', 'listingTypes'],
        ) &&
        isStringArray(facets?.availabilities, { allowEmpty: false }) &&
        facets!.availabilities.every((availability) => commercialAvailabilities.has(availability)) &&
        isStringArray(facets?.categories, { allowEmpty: false }) &&
        facets!.categories.every((category) => commercialCategories.has(category)) &&
        isStringArray(facets?.counties, { allowEmpty: false }) &&
        isStringArray(facets?.towns, { allowEmpty: false }) &&
        isStringArray(facets?.listingTypes, { allowEmpty: false }) &&
        Boolean(index) && exactKeys(index as object, ['file', 'listingCount']) &&
        index?.file === commercialSearchIndexFile &&
        index?.listingCount === manifest.totalListingCount &&
        !hasProhibitedCommercialPublicField(value);
}

export function commercialSearchIndexMatchesManifest(
    index: CommercialSearchIndex,
    manifest: CommercialSearchManifest,
) {
    return index.generatedAt === manifest.generatedAt &&
        index.listings.length === manifest.totalListingCount &&
        index.listings.length === manifest.index.listingCount &&
        new Set(index.listings.map((listing) => listing.listingNumber)).size === index.listings.length;
}

export function isCommercialSearchIndexReady(
    value: unknown,
    manifest: CommercialSearchManifest,
): value is CommercialSearchIndex {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const index = value as Partial<CommercialSearchIndex>;
    return exactKeys(value, ['schemaVersion', 'generatedAt', 'listings']) &&
        index.schemaVersion === commercialSchemaVersion &&
        typeof index.generatedAt === 'string' &&
        Array.isArray(index.listings) &&
        index.listings.every(isCommercialSearchListingReady) &&
        commercialSearchIndexMatchesManifest(index as CommercialSearchIndex, manifest) &&
        !hasProhibitedCommercialPublicField(value);
}
