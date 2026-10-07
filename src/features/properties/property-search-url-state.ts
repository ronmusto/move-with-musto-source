import {
    defaultFilters,
    defaultSort,
    normalizeServiceAreaFilters,
    propertyAreaPresetForSlug,
    propertyAreaPresetForTowns,
    uniqueSorted,
    type PropertyFilterState,
    type PropertySortDirection,
    type PropertySortKey,
    type PropertySortState,
} from './property-search-utils';
import { townMatchesPreferredServiceArea } from '@/lib/market-regions';

export type PropertySearchUrlView = 'list' | 'gallery';
export type PropertySearchScope = 'service';
export type PropertySearchMapBounds = Readonly<{
    north: number;
    east: number;
    south: number;
    west: number;
}>;
export type PropertySearchMapPoint = Readonly<{
    lat: number;
    lng: number;
}>;
export type PropertySearchMapCamera = Readonly<{
    center: PropertySearchMapPoint;
    zoom: number;
}>;
export type PropertySearchMapGeometry = Readonly<{
    kind: 'bounds';
    bounds: PropertySearchMapBounds;
}> | Readonly<{
    kind: 'polygon';
    path: readonly PropertySearchMapPoint[];
    bounds: PropertySearchMapBounds;
}>;

export type PropertySearchUrlState = Readonly<{
    filters: PropertyFilterState;
    sort: PropertySortState;
    view: PropertySearchUrlView;
    page: number;
    pageSize: 10 | 50;
    scope: PropertySearchScope;
    isMapOpen: boolean;
    listingNumber: string | null;
    mapListingNumber?: string | null;
    mapCamera?: PropertySearchMapCamera | null;
    mapBounds?: PropertySearchMapBounds | null;
    mapGeometry?: PropertySearchMapGeometry | null;
}>;

export type PropertySearchUrlOverrides = Readonly<{
    hasSearchState: boolean;
    filters: Partial<PropertyFilterState>;
    sort?: PropertySortState;
    view?: PropertySearchUrlView;
    page?: number;
    pageSize?: 10 | 50;
    scope?: PropertySearchScope;
    isMapOpen?: boolean;
    listingNumber?: string | null;
    mapListingNumber?: string | null;
    mapCamera?: PropertySearchMapCamera | null;
    mapBounds?: PropertySearchMapBounds | null;
    mapGeometry?: PropertySearchMapGeometry | null;
}>;

const managedKeys = [
    'area',
    'query',
    'state',
    'includeTown',
    'excludeTown',
    'type',
    'minPrice',
    'maxPrice',
    'minBeds',
    'maxBeds',
    'minBaths',
    'maxBaths',
    'openHouse',
    'virtualTour',
    'sort',
    'direction',
    'view',
    'page',
    'pageSize',
    'scope',
    'map',
    'mapBounds',
    'mapPolygon',
    'mapCenter',
    'mapZoom',
    'listing',
    'mapListing',
    'saved',
] as const;

const legacyKeys = ['region', 'county', 'town', 'mode'] as const;
const scalarFilterParams = {
    query: 'query',
    propertyType: 'type',
    minPrice: 'minPrice',
    maxPrice: 'maxPrice',
    minBeds: 'minBeds',
    maxBeds: 'maxBeds',
    minBaths: 'minBaths',
    maxBaths: 'maxBaths',
} as const satisfies Partial<Record<keyof PropertyFilterState, string>>;

function trimmedParam(params: URLSearchParams, key: string) {
    return params.get(key)?.trim() ?? '';
}

function positiveInteger(value: string, maximum = 100_000) {
    if (!/^\d+$/.test(value)) {
        return null;
    }

    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

function finiteCoordinate(value: string, minimum: number, maximum: number) {
    if (!value || !/^-?\d+(?:\.\d+)?$/.test(value)) {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function readBounds(value: string): PropertySearchMapBounds | null {
    const [northValue, eastValue, southValue, westValue, ...extra] = value.split(',');
    if (extra.length > 0) {
        return null;
    }

    const north = finiteCoordinate(northValue, -90, 90);
    const east = finiteCoordinate(eastValue, -180, 180);
    const south = finiteCoordinate(southValue, -90, 90);
    const west = finiteCoordinate(westValue, -180, 180);

    if (north === null || east === null || south === null || west === null || north <= south) {
        return null;
    }

    return { north, east, south, west };
}

function writeBounds(bounds: PropertySearchMapBounds) {
    const values = [bounds.north, bounds.east, bounds.south, bounds.west];
    if (
        values.some((value) => !Number.isFinite(value)) ||
        bounds.north > 90 || bounds.north <= bounds.south || bounds.south < -90 ||
        bounds.east > 180 || bounds.east < -180 || bounds.west > 180 || bounds.west < -180
    ) {
        return null;
    }

    return values.map((value) => Number(value.toFixed(5))).join(',');
}

function readMapCamera(centerValue: string, zoomValue: string): PropertySearchMapCamera | null {
    const [latitudeValue, longitudeValue, ...extra] = centerValue.split(',');
    if (extra.length > 0) {
        return null;
    }

    const lat = finiteCoordinate(latitudeValue, -90, 90);
    const lng = finiteCoordinate(longitudeValue, -180, 180);
    const zoom = finiteCoordinate(zoomValue, 3, 22);
    return lat === null || lng === null || zoom === null
        ? null
        : { center: { lat, lng }, zoom };
}

function writeMapCamera(camera: PropertySearchMapCamera) {
    const lat = camera.center.lat;
    const lng = camera.center.lng;
    const zoom = camera.zoom;
    if (
        !Number.isFinite(lat) || lat < -90 || lat > 90 ||
        !Number.isFinite(lng) || lng < -180 || lng > 180 ||
        !Number.isFinite(zoom) || zoom < 3 || zoom > 22
    ) {
        return null;
    }

    return {
        center: `${Number(lat.toFixed(5))},${Number(lng.toFixed(5))}`,
        zoom: String(Number(zoom.toFixed(2))),
    };
}

function boundsForPath(path: readonly PropertySearchMapPoint[]): PropertySearchMapBounds | null {
    if (path.length < 3 || path.length > 64) {
        return null;
    }

    const latitudes = path.map((point) => point.lat);
    const longitudes = path.map((point) => point.lng);
    if (
        latitudes.some((value) => !Number.isFinite(value) || value < -90 || value > 90) ||
        longitudes.some((value) => !Number.isFinite(value) || value < -180 || value > 180)
    ) {
        return null;
    }

    const uniquePoints = new Set(path.map((point) => `${point.lat},${point.lng}`));
    const north = Math.max(...latitudes);
    const east = Math.max(...longitudes);
    const south = Math.min(...latitudes);
    const west = Math.min(...longitudes);
    if (uniquePoints.size < 3 || north <= south || east <= west) {
        return null;
    }

    return { north, east, south, west };
}

function readPolygon(value: string) {
    const pointValues = value.split(';');
    if (pointValues.length < 3 || pointValues.length > 64) {
        return null;
    }

    const path: PropertySearchMapPoint[] = [];
    for (const pointValue of pointValues) {
        const [latitudeValue, longitudeValue, ...extra] = pointValue.split(',');
        if (extra.length > 0) {
            return null;
        }

        const lat = finiteCoordinate(latitudeValue, -90, 90);
        const lng = finiteCoordinate(longitudeValue, -180, 180);
        if (lat === null || lng === null) {
            return null;
        }
        path.push({ lat, lng });
    }

    const bounds = boundsForPath(path);
    return bounds ? { path, bounds } : null;
}

function writePolygon(path: readonly PropertySearchMapPoint[]) {
    const bounds = boundsForPath(path);
    if (!bounds) {
        return null;
    }

    return {
        bounds,
        value: path
            .map((point) => `${Number(point.lat.toFixed(5))},${Number(point.lng.toFixed(5))}`)
            .join(';'),
    };
}

function isSortKey(value: string): value is PropertySortKey {
    return value === 'recommended' || value === 'price' || value === 'sqft';
}

function isSortDirection(value: string): value is PropertySortDirection {
    return value === 'asc' || value === 'desc';
}

export function readPropertySearchUrl(url: URL): PropertySearchUrlOverrides {
    const params = url.searchParams;
    const filters: Partial<PropertyFilterState> = {};

    Object.entries(scalarFilterParams).forEach(([field, key]) => {
        const value = trimmedParam(params, key);
        if (value) {
            filters[field as keyof typeof scalarFilterParams] = value;
        }
    });

    const area = propertyAreaPresetForSlug(params.get('area'));
    const includedTowns = uniqueSorted(params.getAll('includeTown')
        .map((town) => town.trim())
        .filter((town) => townMatchesPreferredServiceArea(town, 'MA')));
    const excludedTowns = uniqueSorted(params.getAll('excludeTown')
        .map((town) => town.trim())
        .filter((town) => townMatchesPreferredServiceArea(town, 'MA')));

    if (includedTowns.length > 0) {
        filters.includeTowns = includedTowns;
    } else if (area) {
        filters.state = 'MA';
        filters.region = area.label;
        filters.includeTowns = area.towns;
    }
    if (excludedTowns.length > 0) {
        filters.excludeTowns = excludedTowns;
    } else if (area) {
        filters.excludeTowns = [];
    }

    if (params.get('openHouse') === '1') filters.openHouseOnly = true;
    if (params.get('virtualTour') === '1') filters.virtualTourOnly = true;
    if (params.get('saved') === '1') filters.savedOnly = true;
    const sortKey = trimmedParam(params, 'sort');
    const sortDirection = trimmedParam(params, 'direction');
    const hasSortState = params.has('sort') || params.has('direction');
    const sort = hasSortState
        ? {
            key: isSortKey(sortKey)
                ? sortKey
                : params.has('direction')
                    ? 'price'
                    : defaultSort.key,
            direction: isSortDirection(sortDirection) ? sortDirection : defaultSort.direction,
        }
        : undefined;
    const viewValue = trimmedParam(params, 'view');
    const view = viewValue === 'gallery' || viewValue === 'list' ? viewValue : undefined;
    const page = positiveInteger(trimmedParam(params, 'page')) ?? undefined;
    const pageSizeValue = positiveInteger(trimmedParam(params, 'pageSize'), 50);
    const pageSize = pageSizeValue === 10 || pageSizeValue === 50 ? pageSizeValue : undefined;
    const listingValue = trimmedParam(params, 'listing');
    const listingNumber = /^[a-z0-9-]{1,64}$/i.test(listingValue) ? listingValue : undefined;
    const mapListingValue = trimmedParam(params, 'mapListing');
    const mapListingNumber = /^[a-z0-9-]{1,64}$/i.test(mapListingValue)
        ? mapListingValue
        : undefined;
    // Scope is intentionally fixed to Mai Ly's service area. Treat old shared
    // links as service-area searches and let the next URL write remove the
    // obsolete parameter.
    const scope = params.has('scope') ? 'service' as const : undefined;
    const mapBoundsValue = trimmedParam(params, 'mapBounds');
    const mapBounds = mapBoundsValue ? readBounds(mapBoundsValue) : undefined;
    const mapPolygonValue = trimmedParam(params, 'mapPolygon');
    const mapPolygon = mapPolygonValue ? readPolygon(mapPolygonValue) : null;
    const restoredBounds = mapPolygon?.bounds ?? mapBounds;
    const mapGeometry: PropertySearchMapGeometry | undefined = mapPolygonValue
        ? mapPolygon
            ? { kind: 'polygon', path: mapPolygon.path, bounds: mapPolygon.bounds }
            : undefined
        : mapBounds
            ? { kind: 'bounds', bounds: mapBounds }
            : undefined;
    const mapCamera = readMapCamera(
        trimmedParam(params, 'mapCenter'),
        trimmedParam(params, 'mapZoom'),
    );

    return {
        hasSearchState: managedKeys.some((key) => params.has(key)),
        filters,
        ...(sort ? { sort } : {}),
        ...(view ? { view } : {}),
        ...(page ? { page } : {}),
        ...(pageSize ? { pageSize } : {}),
        ...(scope ? { scope } : {}),
        ...(params.has('map') ? { isMapOpen: params.get('map') === '1' } : {}),
        ...(listingNumber ? { listingNumber } : {}),
        ...(mapListingNumber ? { mapListingNumber } : {}),
        ...(mapCamera ? { mapCamera } : {}),
        ...(restoredBounds ? { mapBounds: restoredBounds } : {}),
        ...(mapGeometry ? { mapGeometry } : {}),
    };
}

function setWhenDifferent(
    params: URLSearchParams,
    key: string,
    value: string,
    defaultValue: string,
) {
    if (value && value !== defaultValue) {
        params.set(key, value);
    }
}

export function buildPropertySearchUrl(currentUrl: URL, state: PropertySearchUrlState) {
    const url = new URL(currentUrl.toString());
    [...managedKeys, ...legacyKeys].forEach((key) => url.searchParams.delete(key));
    const filters = normalizeServiceAreaFilters(state.filters);

    const includeTowns = uniqueSorted(filters.includeTowns.map((town) => town.trim()));
    const excludeTowns = uniqueSorted(filters.excludeTowns.map((town) => town.trim()));
    const areaPreset = propertyAreaPresetForTowns(includeTowns);
    const area = filters.state.trim() === defaultFilters.state &&
        areaPreset &&
        (filters.region === defaultFilters.region || filters.region === areaPreset.label) &&
        filters.county === defaultFilters.county &&
        excludeTowns.length === 0
        ? areaPreset
        : null;
    if (area) {
        url.searchParams.set('area', area.slug);
    } else {
        includeTowns.forEach((town) => url.searchParams.append('includeTown', town));
        excludeTowns.forEach((town) => url.searchParams.append('excludeTown', town));
    }

    Object.entries(scalarFilterParams).forEach(([field, key]) => {
        const filterKey = field as keyof typeof scalarFilterParams;
        setWhenDifferent(
            url.searchParams,
            key,
            filters[filterKey].trim(),
            defaultFilters[filterKey],
        );
    });

    if (filters.openHouseOnly) url.searchParams.set('openHouse', '1');
    if (filters.virtualTourOnly) url.searchParams.set('virtualTour', '1');
    if (filters.savedOnly) url.searchParams.set('saved', '1');
    if (state.sort.key !== defaultSort.key) url.searchParams.set('sort', state.sort.key);
    if (state.sort.direction !== defaultSort.direction) url.searchParams.set('direction', state.sort.direction);
    if (state.view !== 'list') url.searchParams.set('view', state.view);
    if (state.pageSize !== 10) url.searchParams.set('pageSize', String(state.pageSize));
    if (state.page > 1) url.searchParams.set('page', String(state.page));
    if (state.isMapOpen) url.searchParams.set('map', '1');
    if (state.listingNumber) url.searchParams.set('listing', state.listingNumber);
    if (state.mapListingNumber) url.searchParams.set('mapListing', state.mapListingNumber);
    if (state.mapCamera) {
        const camera = writeMapCamera(state.mapCamera);
        if (camera) {
            url.searchParams.set('mapCenter', camera.center);
            url.searchParams.set('mapZoom', camera.zoom);
        }
    }

    const geometry = state.mapGeometry ?? (state.mapBounds
        ? { kind: 'bounds' as const, bounds: state.mapBounds }
        : null);
    if (geometry?.kind === 'polygon') {
        const polygon = writePolygon(geometry.path);
        const boundsValue = polygon ? writeBounds(polygon.bounds) : null;
        if (polygon && boundsValue) {
            url.searchParams.set('mapPolygon', polygon.value);
            url.searchParams.set('mapBounds', boundsValue);
        }
    } else if (geometry) {
        const boundsValue = writeBounds(geometry.bounds);
        if (boundsValue) url.searchParams.set('mapBounds', boundsValue);
    }

    return `${url.pathname}${url.search}${url.hash}`;
}
