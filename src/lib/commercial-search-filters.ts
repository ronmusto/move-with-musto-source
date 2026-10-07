import type { CommercialAvailability } from './commercial-public-listings';

export const commercialCategoryLabels = {
    'business-opportunity': 'Business opportunity',
    'commercial-industrial': 'Commercial / industrial',
    land: 'Land',
} as const;

export type CommercialCategory = keyof typeof commercialCategoryLabels;

export type CommercialRealEstateFilter = 'all' | 'yes' | 'no' | 'unknown';
export type CommercialAvailabilityFilter = CommercialAvailability | 'all';

export const commercialAvailabilityLabels: Readonly<Record<CommercialAvailability, string>> = {
    'for-sale': 'For sale',
    'for-lease': 'For lease',
    'for-sale-or-lease': 'For sale or lease',
};

export type CommercialSearchFilters = Readonly<{
    query: string;
    category: CommercialCategory | 'all';
    listingType: string;
    availability: CommercialAvailabilityFilter;
    includeTowns: readonly string[];
    excludeTowns: readonly string[];
    minPrice: string;
    maxPrice: string;
    minSquareFeet: string;
    minAcreage: string;
    realEstateIncluded: CommercialRealEstateFilter;
}>;

export type CommercialFilterableListing = Readonly<{
    listingNumber: string;
    category: CommercialCategory;
    availability: CommercialAvailability | null;
    listingTypes: readonly string[];
    listPrice: number;
    address: Readonly<{ line: string; town: string; zip: string }>;
    facts: Readonly<{
        buildingSqft: number | null;
        acreage: number | null;
    }>;
    realEstateIncluded: boolean | null;
}>;

export const defaultCommercialSearchFilters: CommercialSearchFilters = {
    query: '',
    category: 'all',
    listingType: 'all',
    availability: 'all',
    includeTowns: [],
    excludeTowns: [],
    minPrice: '',
    maxPrice: '',
    minSquareFeet: '',
    minAcreage: '',
    realEstateIncluded: 'all',
};

function positiveFilterNumber(value: string) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function hasMinimumSquareFeet(
    listing: CommercialFilterableListing,
    minimum: number | null,
) {
    if (minimum === null) return true;

    return listing.facts.buildingSqft !== null && listing.facts.buildingSqft >= minimum;
}

function matchesQuery(listing: CommercialFilterableListing, query: string) {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    if (!normalized) return true;
    return [
        listing.listingNumber,
        listing.address.line,
        listing.address.town,
        listing.address.zip,
    ].some((value) => value.toLocaleLowerCase('en-US').includes(normalized));
}

function matchesAvailability(
    listing: CommercialFilterableListing,
    availability: CommercialAvailabilityFilter,
) {
    if (availability === 'all') return true;
    if (availability === 'for-sale') {
        return listing.availability === null ||
            listing.availability === 'for-sale' ||
            listing.availability === 'for-sale-or-lease';
    }
    if (availability === 'for-lease') {
        return listing.availability === 'for-lease' ||
            listing.availability === 'for-sale-or-lease';
    }
    return listing.availability === 'for-sale-or-lease';
}

function matchesRealEstateIncluded(
    listing: CommercialFilterableListing,
    filter: CommercialRealEstateFilter,
) {
    if (filter === 'all') return true;
    if (listing.category !== 'business-opportunity') return false;
    if (filter === 'unknown') return listing.realEstateIncluded === null;
    return listing.realEstateIncluded === (filter === 'yes');
}

export function filterCommercialListings<T extends CommercialFilterableListing>(
    listings: readonly T[],
    filters: CommercialSearchFilters,
) {
    const minimumPrice = positiveFilterNumber(filters.minPrice);
    const maximumPrice = positiveFilterNumber(filters.maxPrice);
    const minimumSquareFeet = positiveFilterNumber(filters.minSquareFeet);
    const minimumAcreage = positiveFilterNumber(filters.minAcreage);
    const hasAmountFilter = minimumPrice !== null || maximumPrice !== null;

    return listings.filter((listing) => (
        matchesQuery(listing, filters.query) &&
        (filters.category === 'all' || listing.category === filters.category) &&
        (filters.listingType === 'all' || listing.listingTypes.includes(filters.listingType)) &&
        matchesAvailability(listing, filters.availability) &&
        (filters.includeTowns.length === 0 || filters.includeTowns.includes(listing.address.town)) &&
        !filters.excludeTowns.includes(listing.address.town) &&
        (!hasAmountFilter || listing.availability !== 'for-lease') &&
        (minimumPrice === null || listing.listPrice >= minimumPrice) &&
        (maximumPrice === null || listing.listPrice <= maximumPrice) &&
        hasMinimumSquareFeet(listing, minimumSquareFeet) &&
        (minimumAcreage === null || (
            listing.facts.acreage !== null && listing.facts.acreage >= minimumAcreage
        )) &&
        matchesRealEstateIncluded(listing, filters.realEstateIncluded)
    ));
}

export function commercialListingSizeLabel(listing: CommercialFilterableListing) {
    const formatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
    if (listing.facts.buildingSqft !== null && listing.facts.buildingSqft > 0) {
        return `${formatter.format(listing.facts.buildingSqft)} building sq ft`;
    }
    if (listing.facts.acreage !== null && listing.facts.acreage > 0) {
        return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(listing.facts.acreage)} acres`;
    }
    return 'Size not provided';
}

export function businessRealEstateLabel(
    category: CommercialCategory,
    realEstateIncluded: boolean | null,
) {
    if (category !== 'business-opportunity') return null;
    if (realEstateIncluded === true) return 'Real estate included: Yes';
    if (realEstateIncluded === false) return 'Real estate included: No';
    return 'Real estate included: Unknown';
}
