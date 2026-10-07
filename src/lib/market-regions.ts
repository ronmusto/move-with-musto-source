import marketRegionDefinitionsJson from './market-regions.json';

export type ServiceTier = 'core' | 'extended' | 'search-only';

export type MarketTown = Readonly<{
    name: string;
    state: 'MA';
    regionSlug: string;
    tier: ServiceTier;
    lastReviewed?: string;
}>;

export type MarketRegion = Readonly<{
    slug: string;
    name: string;
    summary: string;
    towns: readonly string[];
    coreTowns: readonly string[];
    extendedTowns: readonly string[];
    searchOnlyTowns: readonly string[];
}>;

type MarketRegionDefinition = Readonly<{
    slug: string;
    name: string;
    summary: string;
    coreTowns: readonly string[];
    extendedTowns?: readonly string[];
    searchOnlyTowns?: readonly string[];
}>;

const lastMarketReview = '2026-07-09';

const marketRegionDefinitions = marketRegionDefinitionsJson as readonly MarketRegionDefinition[];

function sortedTownNames(towns: readonly string[]) {
    return [...towns].sort((left, right) => left.localeCompare(right));
}

export const marketTowns = marketRegionDefinitions
    .flatMap((region) => [
        ...region.coreTowns.map((name) => ({ name, tier: 'core' as const })),
        ...(region.extendedTowns ?? []).map((name) => ({ name, tier: 'extended' as const })),
        ...(region.searchOnlyTowns ?? []).map((name) => ({ name, tier: 'search-only' as const })),
    ].map(({ name, tier }): MarketTown => ({
        name,
        state: 'MA',
        regionSlug: region.slug,
        tier,
        lastReviewed: lastMarketReview,
    })))
    .sort((left, right) => left.name.localeCompare(right.name));

export const marketRegions: readonly MarketRegion[] = marketRegionDefinitions.map((region) => {
    const coreTowns = sortedTownNames(region.coreTowns);
    const extendedTowns = sortedTownNames(region.extendedTowns ?? []);

    return {
        slug: region.slug,
        name: region.name,
        summary: region.summary,
        towns: sortedTownNames([...coreTowns, ...extendedTowns]),
        coreTowns,
        extendedTowns,
        searchOnlyTowns: sortedTownNames(region.searchOnlyTowns ?? []),
    };
});

export const defaultMarketRegionName = 'Burlington-area service area';
export const marketRegionNames = marketRegions.map((region) => region.name);

export const preferredServiceAreaLabel = defaultMarketRegionName;
export const preferredServiceAreaSummary =
    'Massachusetts listings in the Burlington-centered core and established edge markets. Core areas are generally within approximately 45 minutes in normal traffic; travel times vary.';

export const preferredServiceAreaTowns = marketTowns
    .filter((town) => town.tier !== 'search-only')
    .map((town) => town.name);

const preferredServiceAreaTownNames = new Set(
    preferredServiceAreaTowns.map((town) => town.toUpperCase()),
);
const marketTownByName = new Map(
    marketTowns.map((town) => [town.name.toUpperCase(), town]),
);
const marketRegionBySlug = new Map(marketRegions.map((region) => [region.slug, region]));
const marketRegionByName = new Map(marketRegions.map((region) => [region.name.toUpperCase(), region]));
const legacyMarketRegionNames = new Map([
    ['BOSTON', 'GREATER BOSTON'],
    ['NORTH OF BOSTON', 'BURLINGTON & ROUTE 128'],
    ['METROWEST', 'ROUTE 2 & METROWEST'],
    ['SOUTH SHORE', 'SOUTH OF BOSTON & ROUTE 128'],
]);

function normalizeTownName(town: string) {
    return town.trim().toUpperCase();
}

export function marketTownFor(town: string, state = 'MA') {
    if (state.trim().toUpperCase() !== 'MA') {
        return undefined;
    }

    return marketTownByName.get(normalizeTownName(town));
}

export function serviceTierForTown(town: string, state = 'MA'): ServiceTier {
    return marketTownFor(town, state)?.tier ?? 'search-only';
}

export function townMatchesPreferredServiceArea(town: string, state = 'MA') {
    return state.trim().toUpperCase() === 'MA' && preferredServiceAreaTownNames.has(normalizeTownName(town));
}

export function townMatchesMarketRegion(town: string, regionName: string) {
    const normalizedRegionName = regionName.trim().toUpperCase();
    const resolvedRegionName = legacyMarketRegionNames.get(normalizedRegionName) ?? normalizedRegionName;
    const region = marketRegionByName.get(resolvedRegionName);

    return region?.towns.some((regionTown) => normalizeTownName(regionTown) === normalizeTownName(town)) ?? false;
}

export function townsForMarketRegionSlug(slug: string) {
    return marketRegionBySlug.get(slug)?.towns ?? [];
}
