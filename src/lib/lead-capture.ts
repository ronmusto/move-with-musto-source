export const SEARCH_CONSULT_LEAD_SCHEMA_VERSION = 'move-with-musto.search-consult-lead.v1';
export const SEARCH_CONSULT_LEAD_TYPE = 'search_consult';
export const SEARCH_CONSULT_DELIVERY = 'email_fallback';

export type SearchConsultLeadDelivery = typeof SEARCH_CONSULT_DELIVERY;

export type SearchConsultLeadBounds = Readonly<{
    north: number;
    south: number;
    east: number;
    west: number;
}>;

export type SearchConsultLeadPoint = Readonly<{
    lat: number;
    lng: number;
}>;

export type SearchConsultLeadGeometry = Readonly<{
    kind: 'bounds';
    bounds: SearchConsultLeadBounds;
}> | Readonly<{
    kind: 'polygon';
    bounds: SearchConsultLeadBounds;
    path: readonly SearchConsultLeadPoint[];
}>;

export type SearchConsultLeadFilters = Readonly<{
    query: string;
    state: string;
    region: string;
    county: string;
    includeTowns: readonly string[];
    excludeTowns: readonly string[];
    propertyType: string;
    minPrice: string;
    maxPrice: string;
    minBeds: string;
    maxBeds: string;
    minBaths: string;
    maxBaths: string;
    openHouseOnly: boolean;
    virtualTourOnly: boolean;
    savedOnly: boolean;
    sortBy: string;
    sortDirection: string;
    mode: string;
}>;

export type SearchConsultLeadSearchContext = Readonly<{
    activeRegion: string;
    searchAreaLabel: string;
    searchAreaBounds: SearchConsultLeadBounds | null;
    searchAreaGeometry?: SearchConsultLeadGeometry | null;
    filters: SearchConsultLeadFilters;
    selectedMlsNumbers: readonly string[];
}>;

export type SearchConsultLeadListingSummary = Readonly<{
    listingNumber: string;
    title: string;
    town: string;
    status: string;
    priceLabel: string;
    detailUrl: string;
}>;

export type SearchConsultLeadConsent = Readonly<{
    termsAccepted: boolean;
    privacyAccepted: boolean;
    contactAuthorized: boolean;
    emailUpdatesOptIn: boolean;
    termsVersion: string;
    privacyVersion: string;
}>;

export type SearchConsultLeadPayload = Readonly<{
    schemaVersion: typeof SEARCH_CONSULT_LEAD_SCHEMA_VERSION;
    leadType: typeof SEARCH_CONSULT_LEAD_TYPE;
    delivery: SearchConsultLeadDelivery;
    requestType: string;
    name: string;
    email: string;
    phone: string;
    preferredContact: string;
    message: string;
    freeformMessage: string;
    propertyLink: string;
    sourcePage: string;
    activeRegion: string;
    searchAreaLabel: string;
    searchAreaBounds: SearchConsultLeadBounds | null;
    searchAreaGeometry: SearchConsultLeadGeometry | null;
    filters: SearchConsultLeadFilters;
    selectedMlsNumbers: readonly string[];
    attachedListings: readonly SearchConsultLeadListingSummary[];
    website: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
    contactAuthorized: boolean;
    emailUpdatesOptIn: boolean;
    termsVersion: string;
    privacyVersion: string;
    consent: SearchConsultLeadConsent;
}>;

type BuildSearchConsultLeadPayloadInput = Readonly<{
    requestType: string;
    contact: Readonly<{
        name: string;
        email: string;
        phone: string;
        preferredContact: string;
    }>;
    freeformMessage: string;
    propertyLink: string;
    sourcePage: string;
    searchContext: SearchConsultLeadSearchContext;
    attachedListings: readonly SearchConsultLeadListingSummary[];
    website: string;
    consent: SearchConsultLeadConsent;
}>;

function trim(value: string) {
    return value.trim();
}

function compactUnique(values: readonly string[]) {
    return Array.from(new Set(values.map(trim).filter(Boolean)));
}

function roundedCoordinate(value: number) {
    return Number(value.toFixed(5));
}

function normalizedBounds(bounds: SearchConsultLeadBounds | null | undefined) {
    if (!bounds) return null;
    const { north, east, south, west } = bounds;
    if (
        ![north, east, south, west].every(Number.isFinite) ||
        north > 90 || south < -90 || north <= south ||
        east > 180 || east < -180 || west > 180 || west < -180
    ) {
        return null;
    }

    return {
        north: roundedCoordinate(north),
        east: roundedCoordinate(east),
        south: roundedCoordinate(south),
        west: roundedCoordinate(west),
    };
}

function normalizedGeometry(
    geometry: SearchConsultLeadGeometry | null | undefined,
    fallbackBounds: SearchConsultLeadBounds | null,
): SearchConsultLeadGeometry | null {
    const bounds = normalizedBounds(geometry?.bounds ?? fallbackBounds);
    if (!bounds) return null;
    if (!geometry || geometry.kind === 'bounds') return { kind: 'bounds', bounds };

    const path = geometry.path.slice(0, 64).map((point) => ({
        lat: roundedCoordinate(point.lat),
        lng: roundedCoordinate(point.lng),
    }));
    if (
        path.length < 3 ||
        path.some((point) => (
            !Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 ||
            !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180
        )) ||
        new Set(path.map((point) => `${point.lat},${point.lng}`)).size < 3
    ) {
        return { kind: 'bounds', bounds };
    }

    return { kind: 'polygon', bounds, path };
}

export function buildSearchConsultLeadPayload(
    input: BuildSearchConsultLeadPayloadInput,
): SearchConsultLeadPayload {
    const freeformMessage = trim(input.freeformMessage);
    const selectedMlsNumbers = compactUnique([
        ...input.searchContext.selectedMlsNumbers,
        ...input.attachedListings.map((listing) => listing.listingNumber),
    ]);
    const consent = input.consent;
    const searchAreaBounds = normalizedBounds(input.searchContext.searchAreaBounds);
    const searchAreaGeometry = normalizedGeometry(
        input.searchContext.searchAreaGeometry,
        searchAreaBounds,
    );

    return {
        schemaVersion: SEARCH_CONSULT_LEAD_SCHEMA_VERSION,
        leadType: SEARCH_CONSULT_LEAD_TYPE,
        delivery: SEARCH_CONSULT_DELIVERY,
        requestType: trim(input.requestType),
        name: trim(input.contact.name),
        email: trim(input.contact.email),
        phone: trim(input.contact.phone),
        preferredContact: trim(input.contact.preferredContact),
        message: freeformMessage,
        freeformMessage,
        propertyLink: trim(input.propertyLink),
        sourcePage: trim(input.sourcePage),
        activeRegion: trim(input.searchContext.activeRegion),
        searchAreaLabel: trim(input.searchContext.searchAreaLabel),
        searchAreaBounds,
        searchAreaGeometry,
        filters: {
            ...input.searchContext.filters,
            includeTowns: compactUnique(input.searchContext.filters.includeTowns),
            excludeTowns: compactUnique(input.searchContext.filters.excludeTowns),
        },
        selectedMlsNumbers,
        attachedListings: input.attachedListings.map((listing) => ({
            listingNumber: trim(listing.listingNumber),
            title: trim(listing.title),
            town: trim(listing.town),
            status: trim(listing.status),
            priceLabel: trim(listing.priceLabel),
            detailUrl: trim(listing.detailUrl),
        })),
        website: trim(input.website),
        termsAccepted: consent.termsAccepted,
        privacyAccepted: consent.privacyAccepted,
        contactAuthorized: consent.contactAuthorized,
        emailUpdatesOptIn: consent.emailUpdatesOptIn,
        termsVersion: trim(consent.termsVersion),
        privacyVersion: trim(consent.privacyVersion),
        consent: {
            ...consent,
            termsVersion: trim(consent.termsVersion),
            privacyVersion: trim(consent.privacyVersion),
        },
    };
}
