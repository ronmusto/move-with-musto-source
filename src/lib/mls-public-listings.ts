import { townMatchesPreferredServiceArea } from './market-regions';
import { sanitizePublicHttpsUrl } from './safe-external-url';

export type MlsPhotoSet = {
    index: number;
    card: string;
    detail: string;
    thumbnail: string;
};

export type MlsPhotoSize = 'card' | 'detail' | 'thumbnail';

export type MlsOpenHouse = {
    start: string;
    end: string;
    type: string;
    url: string;
};

export type MlsListingStatus = {
    code: string;
    label: string;
    isActive: boolean;
    isContingent: boolean;
};

export type MlsListingAddress = {
    line: string;
    town: string;
    area?: string;
    neighborhood?: string;
    county: string;
    state: string;
    zip: string;
};

export type MlsListingFacts = {
    beds: number | null;
    fullBaths: number | null;
    halfBaths: number | null;
    bathsLabel: string;
    sqft: number | null;
    lotSize: number | null;
    acreage: number | null;
    yearBuilt: number | null;
    parking: number | null;
    rooms?: number | null;
    garageSpaces?: number | null;
    hasBasement?: boolean | null;
};

export type MlsListingRoom = {
    name: string;
    level: string;
    dimensions: string;
    features: string[];
};

export type MlsListingFeatures = {
    style: string[];
    propertySubtype: string[];
    parking: string[];
    waterfront: string[];
    waterView: string[];
    rooms?: MlsListingRoom[];
    interior?: string[];
    exterior?: string[];
    basement?: string[];
    heating?: string[];
    cooling?: string[];
    appliances?: string[];
    roof?: string[];
    lot?: string[];
    water?: string[];
    sewer?: string[];
    garage?: string[];
};

export type MlsListingAttribution = {
    listingAgent: string;
    listingOffice: string;
    listingOfficePhone: string;
};

export type MlsListingSource = {
    name: string;
    photoDate: string;
    listingAlert: string;
};

/**
 * Legacy in-memory enrichment shape. Public listing artifacts are required to
 * omit this field; the expiring coordinate sidecar is authoritative in the UI.
 */
export type MlsListingMapPosition = {
    lat: number;
    lng: number;
    source: string;
    precision: string;
    geocodedAt: string;
    expiresAt: string;
};

type MlsListingBase = {
    listingNumber: string;
    propertyType: string;
    status: MlsListingStatus;
    listPrice: number | null;
    priceLabel: string;
    address: MlsListingAddress;
    facts: MlsListingFacts;
    mapPosition?: MlsListingMapPosition;
    attribution: MlsListingAttribution;
    source: MlsListingSource;
};

export type MlsSearchListing = {
    listingNumber: string;
    propertyType: string;
    status: Pick<MlsListingStatus, 'code' | 'label' | 'isActive'>;
    listPrice: number | null;
    priceLabel: string;
    address: Pick<MlsListingAddress, 'line' | 'town' | 'county' | 'state' | 'zip'>;
    facts: Pick<MlsListingFacts, 'beds' | 'fullBaths' | 'halfBaths' | 'bathsLabel' | 'sqft'>;
    mapPosition?: MlsListingMapPosition;
    attribution: Pick<MlsListingAttribution, 'listingAgent' | 'listingOffice'>;
    source: Pick<MlsListingSource, 'name'>;
    photoCount: number;
    openHouseCount: number;
    /** End times let the browser age out events after a static MLS publish. */
    openHouseEndTimes?: string[];
    hasVirtualTour: boolean;
};

export type MlsListingDetail = MlsListingBase & {
    generatedAt: string;
    features?: MlsListingFeatures;
    remarks: string;
    photoCount: number;
    openHouses: MlsOpenHouse[];
    virtualTourUrl: string;
};

export type MlsPublicListing = Omit<MlsListingDetail, 'photoCount' | 'generatedAt'> & {
    photoCount?: number;
    photos: MlsPhotoSet[];
};

export type MlsComplianceConfig = {
    participantFirmName: string;
    officeAddress: string;
    phone: string;
    marketArea: string;
};

export type MlsPublicBundleBase = {
    generatedAt: string;
    source: string;
    disclaimer: string;
    compliance: MlsComplianceConfig;
};

export type MlsSearchIndexBundle = MlsPublicBundleBase & {
    listings: MlsSearchListing[];
};

export type MlsSearchShardId = 'preferred';

export type MlsSearchShardDescriptor = {
    id: MlsSearchShardId;
    file: string;
    listingCount: number;
};

export type MlsCoordinateIndexDescriptor = {
    file: string;
    coordinateCount: number;
};

export type MlsCoordinate = {
    lat: number;
    lng: number;
    expiresAt: string;
};

export type MlsCoordinateIndex = {
    schemaVersion: 1;
    generatedAt: string;
    coordinates: Record<string, MlsCoordinate>;
};

export type MlsSearchManifest = MlsPublicBundleBase & {
    schemaVersion: 1;
    totalListingCount: number;
    facets: {
        states: string[];
        counties: string[];
        towns: string[];
        propertyTypes: string[];
    };
    coordinateIndex: MlsCoordinateIndexDescriptor;
    shards: MlsSearchShardDescriptor[];
};

export type MlsCurrentPointer = {
    schemaVersion: 1;
    generation: string;
    generatedAt: string;
    manifestFile: 'mls-search-manifest.json';
};

export type MlsSearchShardListing = Omit<MlsSearchListing, 'mapPosition'>;

export type MlsSearchShard = {
    schemaVersion: 1;
    id: MlsSearchShardId;
    generatedAt: string;
    listings: MlsSearchShardListing[];
};

export type MlsPublicBundle = MlsPublicBundleBase & {
    listings: MlsPublicListing[];
};

/**
 * Accept only a public HTTPS origin. Paths, credentials, query strings, local
 * hosts, and non-HTTPS values fail closed so a bad deployment setting cannot
 * redirect listing requests to an unexpected endpoint.
 */
export function sanitizeMlsDataOrigin(value: unknown) {
    const sanitizedUrl = sanitizePublicHttpsUrl(value);
    if (!sanitizedUrl) {
        return '';
    }

    const parsed = new URL(sanitizedUrl);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        return '';
    }

    return parsed.origin;
}

/**
 * Resolves a public MLS asset against the optional cloud data origin. An empty
 * or invalid origin intentionally falls back to the site's same-origin /mls
 * path, which keeps local development and static previews self-contained.
 */
export function buildMlsPublicDataUrl(
    mlsPath: string,
    configuredOrigin: unknown = process.env.NEXT_PUBLIC_MLS_DATA_ORIGIN,
) {
    const normalizedPath = mlsPath.startsWith('/mls/')
        ? mlsPath
        : `/mls/${mlsPath.replace(/^\/+/, '')}`;

    return `${sanitizeMlsDataOrigin(configuredOrigin)}${normalizedPath}`;
}

export function buildSiblingMlsPublicDataUrl(referenceUrl: string, fileName: string) {
    const cleanUrl = referenceUrl.split(/[?#]/u, 1)[0];
    const separatorIndex = cleanUrl.lastIndexOf('/');
    return `${cleanUrl.slice(0, separatorIndex + 1)}${fileName}`;
}

export const hasExternalMlsDataOrigin = Boolean(
    sanitizeMlsDataOrigin(process.env.NEXT_PUBLIC_MLS_DATA_ORIGIN),
);
export const mlsCurrentPointerFile = 'current.json';
export const mlsSearchManifestFile = 'mls-search-manifest.json';
export const defaultMlsSearchIndexUrl = buildMlsPublicDataUrl('mls-search-index.json');
export const defaultMlsBundleUrl = defaultMlsSearchIndexUrl;
export const defaultMlsCurrentPointerUrl = buildMlsPublicDataUrl(mlsCurrentPointerFile);
export const defaultMlsSearchManifestUrl = buildMlsPublicDataUrl(mlsSearchManifestFile);
export const mlsCoordinateIndexFile = 'mls-coordinate-index.json';
export const defaultMlsCoordinateIndexUrl = buildMlsPublicDataUrl(mlsCoordinateIndexFile);
export const mlsSearchShardFiles: Readonly<Record<MlsSearchShardId, string>> = {
    preferred: 'mls-search-preferred.json',
};
export const defaultMlsDetailBaseUrl = buildMlsPublicDataUrl('listings');
export const MLS_PIN_MAX_PUBLIC_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const MLS_PIN_PUBLIC_DISCLAIMER =
    'The property listing data and information, or the Images, set forth herein were provided to MLS Property Information Network, Inc. from third party sources, including sellers, lessors, landlords and public records, and were compiled by MLS Property Information Network, Inc. The property listing data and information, and the Images, are for the personal, non-commercial use of consumers having a good faith interest in purchasing, leasing or renting listed properties of the type displayed to them and may not be used for any purpose other than to identify prospective properties which such consumers may have a good faith interest in purchasing, leasing or renting. MLS Property Information Network, Inc. and its subscribers disclaim any and all representations and warranties as to the accuracy of the property listing data and information, or as to the accuracy of any of the Images, set forth herein.';

const mlsGenerationPattern = /^\d{14}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isMlsCurrentPointerReady(
    value: unknown,
    now = Date.now(),
): value is MlsCurrentPointer {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const pointer = value as Partial<MlsCurrentPointer>;
    return Object.keys(pointer).sort().join(',') ===
            'generatedAt,generation,manifestFile,schemaVersion' &&
        pointer.schemaVersion === 1 &&
        pointer.manifestFile === mlsSearchManifestFile &&
        typeof pointer.generation === 'string' &&
        mlsGenerationPattern.test(pointer.generation) &&
        typeof pointer.generatedAt === 'string' &&
        isMlsBundleFresh(pointer.generatedAt, now);
}

export function buildMlsGenerationBaseUrl(
    currentPointerUrl: string,
    pointer: MlsCurrentPointer,
) {
    const cleanUrl = currentPointerUrl.split(/[?#]/u, 1)[0];
    const pointerSuffix = `/mls/${mlsCurrentPointerFile}`;
    if (!cleanUrl.endsWith(pointerSuffix) || !mlsGenerationPattern.test(pointer.generation)) {
        throw new Error('Cannot resolve an MLS generation from an invalid current pointer URL.');
    }
    return `${cleanUrl.slice(0, -mlsCurrentPointerFile.length)}generations/${pointer.generation}`;
}

export function isMlsBundleFresh(generatedAt: string, now = Date.now()) {
    const generatedTimestamp = Date.parse(generatedAt);
    return Number.isFinite(generatedTimestamp) &&
        generatedTimestamp <= now + (5 * 60 * 1000) &&
        now - generatedTimestamp <= MLS_PIN_MAX_PUBLIC_AGE_MS;
}

function isMlsComplianceReady(compliance: Partial<MlsComplianceConfig> | null | undefined) {
    return Boolean(
        compliance?.participantFirmName?.trim() &&
        compliance.officeAddress?.trim() &&
        compliance.phone?.trim() &&
        compliance.marketArea?.trim()
    );
}

export function isMassachusettsMlsState(state: unknown) {
    return typeof state === 'string' && state.trim().toUpperCase() === 'MA';
}

function isMlsSearchListingReady(listing: MlsSearchListing | null | undefined, _now: number) {
    return Boolean(
        listing?.listingNumber?.trim() &&
        listing.propertyType?.trim() &&
        listing.status?.code?.trim() &&
        listing.status?.label?.trim() &&
        listing.status.isActive === true &&
        Number.isFinite(listing.listPrice) &&
        listing.address?.line?.trim() &&
        listing.address?.town?.trim() &&
        isMassachusettsMlsState(listing.address?.state) &&
        listing.attribution?.listingOffice?.trim() &&
        listing.attribution?.listingAgent?.trim() &&
        !Object.prototype.hasOwnProperty.call(listing, 'mapPosition')
    );
}

export function isMlsSearchIndexBundleReady(
    value: unknown,
    now = Date.now(),
): value is MlsSearchIndexBundle {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const bundle = value as Partial<MlsSearchIndexBundle>;
    const compliance = bundle.compliance;
    if (
        bundle.disclaimer !== MLS_PIN_PUBLIC_DISCLAIMER ||
        typeof bundle.generatedAt !== 'string' ||
        !isMlsBundleFresh(bundle.generatedAt, now) ||
        !isMlsComplianceReady(compliance) ||
        !Array.isArray(bundle.listings) ||
        bundle.listings.length === 0
    ) {
        return false;
    }

    return bundle.listings.every((listing) => isMlsSearchListingReady(listing, now));
}

export function isMlsSearchManifestReady(
    value: unknown,
    now = Date.now(),
): value is MlsSearchManifest {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const manifest = value as Partial<MlsSearchManifest>;
    const facets = manifest.facets;
    const hasStringFacet = (facet: unknown) => Array.isArray(facet) &&
        facet.every((item) => typeof item === 'string' && item.trim());
    if (
        manifest.schemaVersion !== 1 ||
        manifest.disclaimer !== MLS_PIN_PUBLIC_DISCLAIMER ||
        typeof manifest.generatedAt !== 'string' ||
        !isMlsBundleFresh(manifest.generatedAt, now) ||
        !isMlsComplianceReady(manifest.compliance) ||
        !Number.isInteger(manifest.totalListingCount) ||
        Number(manifest.totalListingCount) <= 0 ||
        !facets ||
        !hasStringFacet(facets.states) ||
        facets.states.length !== 1 ||
        facets.states[0] !== 'MA' ||
        !hasStringFacet(facets.counties) ||
        !hasStringFacet(facets.towns) ||
        !hasStringFacet(facets.propertyTypes) ||
        manifest.coordinateIndex?.file !== mlsCoordinateIndexFile ||
        !Number.isInteger(manifest.coordinateIndex.coordinateCount) ||
        Number(manifest.coordinateIndex.coordinateCount) < 0 ||
        Number(manifest.coordinateIndex.coordinateCount) > Number(manifest.totalListingCount) ||
        !Array.isArray(manifest.shards) ||
        manifest.shards.length !== 1
    ) {
        return false;
    }

    const descriptors = new Map(manifest.shards.map((shard) => [shard?.id, shard]));
    return (['preferred'] as const).every((id) => {
        const descriptor = descriptors.get(id);
        return descriptor?.file === mlsSearchShardFiles[id] &&
            Number.isInteger(descriptor.listingCount) &&
            descriptor.listingCount >= 0;
    }) && manifest.shards.reduce((total, shard) => total + shard.listingCount, 0) === manifest.totalListingCount;
}

export function isMlsCoordinateIndexReady(
    value: unknown,
    manifest: MlsSearchManifest,
    _now = Date.now(),
): value is MlsCoordinateIndex {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const coordinateIndex = value as Partial<MlsCoordinateIndex>;
    const coordinates = coordinateIndex.coordinates;
    if (
        coordinateIndex.schemaVersion !== 1 ||
        coordinateIndex.generatedAt !== manifest.generatedAt ||
        !coordinates ||
        typeof coordinates !== 'object' ||
        Array.isArray(coordinates) ||
        Object.keys(coordinates).length !== manifest.coordinateIndex.coordinateCount
    ) {
        return false;
    }

    return Object.entries(coordinates).every(([listingNumber, coordinate]) => (
        Boolean(listingNumber.trim()) &&
        Boolean(coordinate) &&
        Object.keys(coordinate).sort().join(',') === 'expiresAt,lat,lng' &&
        Number.isFinite(coordinate.lat) &&
        Number.isFinite(coordinate.lng) &&
        Number.isFinite(Date.parse(coordinate.expiresAt))
    ));
}

export function isMlsSearchShardReady(
    value: unknown,
    manifest: MlsSearchManifest,
    expectedId: MlsSearchShardId,
    now = Date.now(),
): value is MlsSearchShard {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const shard = value as Partial<MlsSearchShard>;
    const descriptor = manifest.shards.find((item) => item.id === expectedId);
    if (
        shard.schemaVersion !== 1 ||
        shard.id !== expectedId ||
        shard.generatedAt !== manifest.generatedAt ||
        !descriptor ||
        !Array.isArray(shard.listings) ||
        shard.listings.length !== descriptor.listingCount
    ) {
        return false;
    }

    return shard.listings.every((listing) => (
        isMlsSearchListingReady(listing, now) &&
        !Object.prototype.hasOwnProperty.call(listing, 'mapPosition') &&
        (expectedId === 'preferred') === townMatchesPreferredServiceArea(
            listing.address.town,
            listing.address.state,
        )
    ));
}

export function searchBundleFromShard(
    manifest: MlsSearchManifest,
    shard: MlsSearchShard,
): MlsSearchIndexBundle {
    return {
        generatedAt: manifest.generatedAt,
        source: manifest.source,
        disclaimer: manifest.disclaimer,
        compliance: manifest.compliance,
        listings: shard.listings,
    };
}

const photoSizes: Record<MlsPhotoSize, { width: number; height: number }> = {
    card: { width: 600, height: 450 },
    detail: { width: 1024, height: 768 },
    thumbnail: { width: 320, height: 250 },
};

function normalizePhotoCount(photoCount: number | string | null | undefined) {
    const count = Number(photoCount);

    if (!Number.isFinite(count)) {
        return 0;
    }

    return Math.max(0, Math.min(42, Math.trunc(count)));
}

export function getMlsPhotoUrl(listingNumber: string, index: number, size: MlsPhotoSize) {
    const dimensions = photoSizes[size];
    const safeListingNumber = encodeURIComponent(listingNumber.trim());
    const safeIndex = Math.max(0, Math.trunc(index));

    return `https://media.mlspin.com/photo.aspx?mls=${safeListingNumber}&n=${safeIndex}&w=${dimensions.width}&h=${dimensions.height}`;
}

export function buildMlsPhotoSet(
    listingNumber: string,
    photoCount: number | string | null | undefined,
): MlsPhotoSet[] {
    return Array.from({ length: normalizePhotoCount(photoCount) }, (_, index) => ({
        index,
        card: getMlsPhotoUrl(listingNumber, index, 'card'),
        detail: getMlsPhotoUrl(listingNumber, index, 'detail'),
        thumbnail: getMlsPhotoUrl(listingNumber, index, 'thumbnail'),
    }));
}
