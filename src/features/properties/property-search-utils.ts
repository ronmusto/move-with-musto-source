import type { MlsSearchListing } from '@/lib/mls-public-listings';
import {
    defaultMarketRegionName,
    marketRegions,
    marketRegionNames,
    townMatchesPreferredServiceArea,
    townMatchesMarketRegion,
    townsForMarketRegionSlug,
    serviceTierForTown,
} from '@/lib/market-regions';

export type PropertyViewMode = 'list' | 'gallery' | 'map';
export type PropertySortKey = 'recommended' | 'price' | 'sqft';
export type PropertySortDirection = 'desc' | 'asc';

export type PropertySortState = {
    key: PropertySortKey;
    direction: PropertySortDirection;
};

export type PropertyFilterState = {
    query: string;
    state: string;
    region: string;
    county: string;
    includeTowns: string[];
    excludeTowns: string[];
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
};

export const allLabel = 'All';
export const allRegionsLabel = 'All service-area communities';
export const defaultRegion = defaultMarketRegionName;
export const defaultSort: PropertySortState = {
    key: 'recommended',
    direction: 'desc',
};

export const marketRegionLabels = [
    defaultRegion,
    ...marketRegionNames,
    allRegionsLabel,
];

export const legacyRegionLabels: Record<string, string> = {
    'All reviewed areas': allRegionsLabel,
    'East of Worcester': defaultRegion,
    'Metro North': 'North of Boston',
    'Route 2 & 495': 'MetroWest',
};

export const defaultFilters: PropertyFilterState = {
    query: '',
    state: 'MA',
    region: defaultRegion,
    county: allLabel,
    includeTowns: [],
    excludeTowns: [],
    propertyType: allLabel,
    minPrice: '',
    maxPrice: '',
    minBeds: '',
    maxBeds: '',
    minBaths: '',
    maxBaths: '',
    openHouseOnly: false,
    virtualTourOnly: false,
    savedOnly: false,
};

export function normalizeServiceAreaFilters(filters: PropertyFilterState): PropertyFilterState {
    const includeTowns = uniqueSorted(filters.includeTowns.filter((town) => (
        townMatchesPreferredServiceArea(town, 'MA')
    )));
    const includedTownNames = new Set(includeTowns.map((town) => town.toUpperCase()));
    const excludeTowns = uniqueSorted(filters.excludeTowns.filter((town) => (
        townMatchesPreferredServiceArea(town, 'MA') &&
        !includedTownNames.has(town.toUpperCase())
    )));
    const normalizedRegion = normalizeRegionFilter(filters.region);
    const region = normalizedRegion === defaultRegion ||
        normalizedRegion === allRegionsLabel ||
        marketRegionNames.includes(normalizedRegion)
        ? normalizedRegion
        : defaultRegion;

    return {
        ...filters,
        state: 'MA',
        region,
        county: allLabel,
        includeTowns,
        excludeTowns,
    };
}

export function normalizeRegionFilter(region: string) {
    return legacyRegionLabels[region] ?? region;
}

export function uniqueSorted(values: string[]) {
    return Array.from(new Set(values.filter(Boolean))).sort((first, second) =>
        first.localeCompare(second),
    );
}

export function propertyAreaPresetForSlug(slug: string | null | undefined) {
    const normalizedSlug = slug?.trim().toLowerCase();
    if (!normalizedSlug) {
        return null;
    }

    const area = marketRegions.find((region) => region.slug === normalizedSlug);
    if (!area) {
        return null;
    }

    return {
        slug: area.slug,
        label: area.name,
        towns: [...townsForMarketRegionSlug(area.slug)],
    };
}

export function propertyAreaPresetForTowns(towns: readonly string[]) {
    const normalizedTowns = towns
        .map((town) => town.trim().toUpperCase())
        .filter(Boolean)
        .sort();

    if (normalizedTowns.length === 0) {
        return null;
    }

    return marketRegions
        .map((region) => propertyAreaPresetForSlug(region.slug))
        .find((area) => {
            if (!area || area.towns.length !== normalizedTowns.length) {
                return false;
            }

            const areaTowns = area.towns.map((town) => town.toUpperCase()).sort();
            return areaTowns.every((town, index) => town === normalizedTowns[index]);
        }) ?? null;
}

export function listingMatchesRegion(listing: MlsSearchListing, region: string) {
    const town = listing.address.town;

    if (region === defaultRegion) {
        return townMatchesPreferredServiceArea(town, listing.address.state);
    }

    if (region === allRegionsLabel) {
        return true;
    }

    if (marketRegionNames.some((regionName) => regionName === region)) {
        return listing.address.state === 'MA' && townMatchesMarketRegion(town, region);
    }

    return true;
}

export function filterListings(
    listings: readonly MlsSearchListing[],
    filters: PropertyFilterState,
    savedIds: ReadonlySet<string>,
) {
    const normalizedQuery = filters.query.trim().toLowerCase();
    const minPrice = Number(filters.minPrice) || 0;
    const maxPrice = Number(filters.maxPrice) || Number.POSITIVE_INFINITY;
    const minBeds = Number(filters.minBeds) || 0;
    const maxBeds = Number(filters.maxBeds) || Number.POSITIVE_INFINITY;
    const minBaths = Number(filters.minBaths) || 0;
    const maxBaths = Number(filters.maxBaths) || Number.POSITIVE_INFINITY;
    const includeTowns = filters.includeTowns ?? [];
    const excludeTowns = filters.excludeTowns ?? [];

    return listings.filter((listing) => {
        if (filters.savedOnly && !savedIds.has(listing.listingNumber)) {
            return false;
        }

        if (normalizedQuery) {
            const searchable = [
                listing.address.line,
                listing.address.town,
                listing.address.state,
                listing.address.zip,
            ].join(' ').toLowerCase();

            if (!searchable.includes(normalizedQuery)) {
                return false;
            }
        }

        const price = listing.listPrice ?? 0;
        const baths = (listing.facts.fullBaths ?? 0) + ((listing.facts.halfBaths ?? 0) * 0.5);

        return (
            (filters.state === allLabel || listing.address.state === filters.state) &&
            (filters.region === allRegionsLabel || listingMatchesRegion(listing, filters.region)) &&
            (filters.county === allLabel || listing.address.county === filters.county) &&
            (includeTowns.length === 0 || includeTowns.includes(listing.address.town)) &&
            !excludeTowns.includes(listing.address.town) &&
            (filters.propertyType === allLabel || listing.propertyType === filters.propertyType) &&
            price >= minPrice &&
            price <= maxPrice &&
            (listing.facts.beds ?? 0) >= minBeds &&
            (listing.facts.beds ?? 0) <= maxBeds &&
            baths >= minBaths &&
            baths <= maxBaths &&
            (!filters.openHouseOnly || listing.openHouseCount > 0) &&
            (!filters.virtualTourOnly || listing.hasVirtualTour)
        );
    });
}

function sortValueFor(listing: MlsSearchListing, sortKey: PropertySortKey) {
    if (sortKey === 'price') {
        return listing.listPrice;
    }

    if (sortKey === 'sqft') {
        return listing.facts.sqft;
    }

    return null;
}

function recommendedTownRank(listing: MlsSearchListing) {
    if (listing.address.state === 'MA' && listing.address.town.toUpperCase() === 'BURLINGTON') {
        return 0;
    }

    const tier = serviceTierForTown(listing.address.town, listing.address.state);
    return tier === 'core' ? 1 : tier === 'extended' ? 2 : 3;
}

export function sortListings(
    listings: readonly MlsSearchListing[],
    sort: PropertySortState,
) {
    if (sort.key === 'recommended') {
        const pricedListings = listings
            .map((listing) => listing.listPrice)
            .filter((price): price is number => Number.isFinite(price))
            .sort((first, second) => first - second);
        const medianPrice = pricedListings.length === 0
            ? null
            : pricedListings.length % 2 === 1
                ? pricedListings[Math.floor(pricedListings.length / 2)]
                : (
                    pricedListings[(pricedListings.length / 2) - 1] +
                    pricedListings[pricedListings.length / 2]
                ) / 2;

        return [...listings].sort((first, second) => {
            const firstTownRank = recommendedTownRank(first);
            const secondTownRank = recommendedTownRank(second);
            if (firstTownRank === 0 || secondTownRank === 0) {
                if (firstTownRank !== secondTownRank) {
                    return firstTownRank === 0 ? -1 : 1;
                }
            }

            const firstDistance = medianPrice === null || !Number.isFinite(first.listPrice)
                ? Number.POSITIVE_INFINITY
                : Math.abs((first.listPrice as number) - medianPrice);
            const secondDistance = medianPrice === null || !Number.isFinite(second.listPrice)
                ? Number.POSITIVE_INFINITY
                : Math.abs((second.listPrice as number) - medianPrice);
            const tierPenalty = (townRank: number) => medianPrice === null
                ? townRank
                : townRank === 1
                    ? 0
                    : townRank === 2
                        ? medianPrice * 0.15
                        : medianPrice * 0.5;
            const scoreDifference = (
                firstDistance + tierPenalty(firstTownRank)
            ) - (
                secondDistance + tierPenalty(secondTownRank)
            );
            if (scoreDifference !== 0) {
                return scoreDifference;
            }

            if (first.openHouseCount !== second.openHouseCount) {
                return second.openHouseCount - first.openHouseCount;
            }

            return first.listingNumber.localeCompare(second.listingNumber);
        });
    }

    const directionMultiplier = sort.direction === 'asc' ? 1 : -1;

    return [...listings].sort((first, second) => {
        const firstValue = sortValueFor(first, sort.key);
        const secondValue = sortValueFor(second, sort.key);
        const firstHasValue = Number.isFinite(firstValue);
        const secondHasValue = Number.isFinite(secondValue);

        if (!firstHasValue && !secondHasValue) {
            return first.listingNumber.localeCompare(second.listingNumber);
        }

        if (!firstHasValue) {
            return 1;
        }

        if (!secondHasValue) {
            return -1;
        }

        const numericDifference = ((firstValue as number) - (secondValue as number)) * directionMultiplier;

        return numericDifference === 0
            ? first.listingNumber.localeCompare(second.listingNumber)
            : numericDifference;
    });
}

export function filterOptionsFor(listings: readonly MlsSearchListing[]) {
    return {
        states: uniqueSorted(listings.map((listing) => listing.address.state)),
        counties: uniqueSorted(listings.map((listing) => listing.address.county)),
        towns: uniqueSorted(listings.map((listing) => listing.address.town)),
        propertyTypes: uniqueSorted(listings.map((listing) => listing.propertyType)),
    };
}

function normalizeTownSearchText(value: string) {
    return value
        .normalize('NFKD')
        .replace(/\p{Mark}+/gu, '')
        .toLocaleLowerCase('en-US')
        .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ');
}

function compactTownSearchText(value: string) {
    return value.replace(/\s+/gu, '');
}

function damerauLevenshteinDistance(first: string, second: string) {
    const rows = first.length + 1;
    const columns = second.length + 1;
    const distances = Array.from({ length: rows }, () => Array<number>(columns).fill(0));

    for (let row = 0; row < rows; row += 1) distances[row][0] = row;
    for (let column = 0; column < columns; column += 1) distances[0][column] = column;

    for (let row = 1; row < rows; row += 1) {
        for (let column = 1; column < columns; column += 1) {
            const substitutionCost = first[row - 1] === second[column - 1] ? 0 : 1;
            distances[row][column] = Math.min(
                distances[row - 1][column] + 1,
                distances[row][column - 1] + 1,
                distances[row - 1][column - 1] + substitutionCost,
            );

            if (
                row > 1 &&
                column > 1 &&
                first[row - 1] === second[column - 2] &&
                first[row - 2] === second[column - 1]
            ) {
                distances[row][column] = Math.min(
                    distances[row][column],
                    distances[row - 2][column - 2] + 1,
                );
            }
        }
    }

    return distances[first.length][second.length];
}

function maximumTownTypoDistance(length: number) {
    if (length < 5) return 0;
    if (length < 10) return 1;
    return 2;
}

type TownSearchMatch = Readonly<{
    town: string;
    rank: number;
    distance: number;
    matchIndex: number;
    lengthDifference: number;
}>;

function townSearchMatch(town: string, normalizedQuery: string): TownSearchMatch | null {
    const normalizedTown = normalizeTownSearchText(town);
    const compactTown = compactTownSearchText(normalizedTown);
    const compactQuery = compactTownSearchText(normalizedQuery);
    const lengthDifference = Math.abs(compactTown.length - compactQuery.length);

    if (normalizedTown === normalizedQuery || compactTown === compactQuery) {
        return { town, rank: 0, distance: 0, matchIndex: 0, lengthDifference };
    }

    if (normalizedTown.startsWith(normalizedQuery) || compactTown.startsWith(compactQuery)) {
        return { town, rank: 1, distance: 0, matchIndex: 0, lengthDifference };
    }

    const wordPrefixIndex = normalizedTown
        .split(' ')
        .findIndex((word) => word.startsWith(normalizedQuery));
    if (wordPrefixIndex >= 0) {
        return { town, rank: 2, distance: 0, matchIndex: wordPrefixIndex, lengthDifference };
    }

    const substringIndex = normalizedTown.indexOf(normalizedQuery);
    const compactSubstringIndex = compactTown.indexOf(compactQuery);
    if (substringIndex >= 0 || compactSubstringIndex >= 0) {
        return {
            town,
            rank: 3,
            distance: 0,
            matchIndex: substringIndex >= 0 ? substringIndex : compactSubstringIndex,
            lengthDifference,
        };
    }

    const comparisonLength = Math.max(compactTown.length, compactQuery.length);
    const maximumDistance = maximumTownTypoDistance(comparisonLength);
    if (
        maximumDistance === 0 ||
        compactTown[0] !== compactQuery[0] ||
        lengthDifference > maximumDistance
    ) {
        return null;
    }

    const distance = damerauLevenshteinDistance(compactTown, compactQuery);
    if (distance > maximumDistance || distance / comparisonLength > 0.2) {
        return null;
    }

    return { town, rank: 4, distance, matchIndex: 0, lengthDifference };
}

export function townRuleOptionsFor(
    listings: readonly MlsSearchListing[],
    filters: Pick<PropertyFilterState, 'region'>,
    query: string,
    allAvailableTowns?: readonly string[],
) {
    const normalizedQuery = normalizeTownSearchText(query);
    if (!normalizedQuery) {
        return [];
    }

    const availableTowns = allAvailableTowns
        ? new Set(allAvailableTowns)
        : new Set(listings
            .filter((listing) => listingMatchesRegion(listing, filters.region))
            .map((listing) => listing.address.town)
            .filter(Boolean));

    return Array.from(availableTowns)
        .map((town) => town.trim())
        .filter(Boolean)
        .map((town) => townSearchMatch(town, normalizedQuery))
        .filter((match): match is TownSearchMatch => Boolean(match))
        .sort((first, second) => (
            first.rank - second.rank ||
            first.distance - second.distance ||
            first.matchIndex - second.matchIndex ||
            first.lengthDifference - second.lengthDifference ||
            first.town.localeCompare(second.town)
        ))
        .slice(0, 8)
        .map((match) => match.town);
}

export function paginateListings<T>(
    listings: readonly T[],
    currentPage: number,
    pageSize: number,
) {
    const totalPages = Math.max(1, Math.ceil(listings.length / pageSize));
    const effectivePage = Math.min(Math.max(1, currentPage), totalPages);
    const pageStartIndex = listings.length === 0 ? 0 : (effectivePage - 1) * pageSize;
    const pageEndIndex = Math.min(pageStartIndex + pageSize, listings.length);

    return {
        totalPages,
        effectivePage,
        pageStartIndex,
        pageEndIndex,
        pagedListings: listings.slice(pageStartIndex, pageEndIndex),
    };
}
