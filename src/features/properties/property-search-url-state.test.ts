import { describe, expect, it } from 'vitest';
import { defaultFilters, defaultSort } from './property-search-utils';
import { buildPropertySearchUrl, readPropertySearchUrl } from './property-search-url-state';

describe('property search URL state', () => {
    it('reads a complete shareable search and ignores invalid values', () => {
        const result = readPropertySearchUrl(new URL(
            'https://example.com/buy/properties/?query=Beacon&type=Condo%2Fco-op&minPrice=750000&maxPrice=1500000' +
            '&minBeds=2&maxBaths=3&includeTown=Boston&includeTown=Brookline&excludeTown=Salem' +
            '&openHouse=1&virtualTour=1&sort=sqft&direction=asc&view=gallery&page=3&pageSize=50' +
            '&scope=all&map=1&mapBounds=42.5,-70.8,42.1,-71.3&listing=73333444' +
            '&mapListing=73333445&mapCenter=42.48291,-71.19372&mapZoom=12.25&saved=1',
        ));

        expect(result).toMatchObject({
            hasSearchState: true,
            filters: {
                query: 'Beacon',
                propertyType: 'Condo/co-op',
                minPrice: '750000',
                maxPrice: '1500000',
                minBeds: '2',
                maxBaths: '3',
                includeTowns: ['Boston', 'Brookline'],
                excludeTowns: ['Salem'],
                openHouseOnly: true,
                virtualTourOnly: true,
                savedOnly: true,
            },
            sort: { key: 'sqft', direction: 'asc' },
            view: 'gallery',
            page: 3,
            pageSize: 50,
            scope: 'service',
            isMapOpen: true,
            listingNumber: '73333444',
            mapListingNumber: '73333445',
            mapCamera: { center: { lat: 42.48291, lng: -71.19372 }, zoom: 12.25 },
            mapBounds: { north: 42.5, east: -70.8, south: 42.1, west: -71.3 },
        });
    });

    it('normalizes legacy all-scope and out-of-area geography to the service area', () => {
        const result = readPropertySearchUrl(new URL(
            'https://example.com/buy/properties/?scope=all&state=NH' +
            '&includeTown=Cambridge&includeTown=Nantucket&includeTown=Portsmouth' +
            '&excludeTown=Salem&excludeTown=Worcester',
        ));

        expect(result.scope).toBe('service');
        expect(result.filters.state).toBeUndefined();
        expect(result.filters.includeTowns).toEqual(['Cambridge']);
        expect(result.filters.excludeTowns).toEqual(['Salem']);

        const normalizedUrl = buildPropertySearchUrl(new URL(
            'https://example.com/buy/properties/?scope=all&state=NH',
        ), {
            filters: defaultFilters,
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });
        expect(new URL(normalizedUrl, 'https://example.com').searchParams.has('scope')).toBe(false);
        expect(new URL(normalizedUrl, 'https://example.com').searchParams.has('state')).toBe(false);
    });

    it('keeps stable area links compatible with the buyer neighborhood entry points', () => {
        const result = readPropertySearchUrl(new URL(
            'https://example.com/buy/properties/?area=north-shore#properties-search-title',
        ));

        expect(result.hasSearchState).toBe(true);
        expect(result.filters.state).toBe('MA');
        expect(result.filters.region).toBe('North Shore');
        expect(result.filters.includeTowns).toEqual(expect.arrayContaining(['Beverly', 'Marblehead']));
        expect(result.filters.excludeTowns).toEqual([]);
    });

    it('writes deterministic state while retaining unrelated campaign parameters and the hash', () => {
        const url = buildPropertySearchUrl(
            new URL('https://example.com/buy/properties/?utm_source=newsletter&region=old#properties-search-title'),
            {
                filters: {
                    ...defaultFilters,
                    query: 'Beacon Hill',
                    includeTowns: ['Boston', 'Brookline'],
                    propertyType: 'Condo/co-op',
                    minBeds: '2',
                    openHouseOnly: true,
                    savedOnly: true,
                },
                sort: { key: 'sqft', direction: 'asc' },
                view: 'gallery',
                page: 2,
                pageSize: 50,
                scope: 'service',
                isMapOpen: true,
                listingNumber: '73333444',
                mapListingNumber: '73333445',
                mapCamera: { center: { lat: 42.482906, lng: -71.193724 }, zoom: 12.254 },
                mapBounds: { north: 42.5, east: -70.8, south: 42.1, west: -71.3 },
            },
        );
        const written = new URL(url, 'https://example.com');

        expect(written.searchParams.get('utm_source')).toBe('newsletter');
        expect(written.searchParams.has('region')).toBe(false);
        expect(written.searchParams.getAll('includeTown')).toEqual(['Boston', 'Brookline']);
        expect(written.searchParams.get('query')).toBe('Beacon Hill');
        expect(written.searchParams.get('type')).toBe('Condo/co-op');
        expect(written.searchParams.get('minBeds')).toBe('2');
        expect(written.searchParams.get('openHouse')).toBe('1');
        expect(written.searchParams.get('saved')).toBe('1');
        expect(written.searchParams.get('sort')).toBe('sqft');
        expect(written.searchParams.get('direction')).toBe('asc');
        expect(written.searchParams.get('view')).toBe('gallery');
        expect(written.searchParams.get('page')).toBe('2');
        expect(written.searchParams.get('pageSize')).toBe('50');
        expect(written.searchParams.has('scope')).toBe(false);
        expect(written.searchParams.get('map')).toBe('1');
        expect(written.searchParams.get('listing')).toBe('73333444');
        expect(written.searchParams.get('mapListing')).toBe('73333445');
        expect(written.searchParams.get('mapCenter')).toBe('42.48291,-71.19372');
        expect(written.searchParams.get('mapZoom')).toBe('12.25');
        expect(written.searchParams.get('mapBounds')).toBe('42.5,-70.8,42.1,-71.3');
        expect(written.hash).toBe('#properties-search-title');
    });

    it('omits defaults and serializes known regional town sets back to their stable area slug', () => {
        const area = readPropertySearchUrl(new URL('https://example.com/?area=north-shore')).filters;
        const url = buildPropertySearchUrl(new URL('https://example.com/buy/properties/'), {
            filters: { ...defaultFilters, ...area },
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });

        expect(url).toBe('/buy/properties/?area=north-shore');
    });

    it('round-trips a canonical regional guide area', () => {
        const area = readPropertySearchUrl(new URL('https://example.com/?area=route-2-495')).filters;
        const url = buildPropertySearchUrl(new URL('https://example.com/buy/properties/'), {
            filters: { ...defaultFilters, ...area },
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });

        expect(area.region).toBe('Route 2 & MetroWest');
        expect(url).toBe('/buy/properties/?area=route-2-495');
    });

    it('does not restore malformed pagination, listing, or map bounds values', () => {
        const result = readPropertySearchUrl(new URL(
            'https://example.com/properties/?page=0&pageSize=25&listing=%3Cscript%3E&mapBounds=1,2,3,4',
        ));

        expect(result.hasSearchState).toBe(true);
        expect(result.page).toBeUndefined();
        expect(result.pageSize).toBeUndefined();
        expect(result.listingNumber).toBeUndefined();
        expect(result.mapBounds).toBeUndefined();
    });

    it('rejects incomplete or out-of-range map cameras and selected map listings', () => {
        const incomplete = readPropertySearchUrl(new URL(
            'https://example.com/properties/?mapCenter=42.4,-71.2&mapListing=%3Cscript%3E',
        ));
        const invalid = readPropertySearchUrl(new URL(
            'https://example.com/properties/?mapCenter=95,-71.2&mapZoom=25',
        ));

        expect(incomplete.mapCamera).toBeUndefined();
        expect(incomplete.mapListingNumber).toBeUndefined();
        expect(invalid.mapCamera).toBeUndefined();
    });

    it('round-trips a non-default direction for the default sort key', () => {
        const url = buildPropertySearchUrl(new URL('https://example.com/properties/'), {
            filters: defaultFilters,
            sort: { key: 'price', direction: 'asc' },
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });

        expect(readPropertySearchUrl(new URL(url, 'https://example.com')).sort).toEqual({
            key: 'price',
            direction: 'asc',
        });
    });

    it('normalizes a non-Massachusetts state back to its service-area preset', () => {
        const areaFilters = readPropertySearchUrl(new URL('https://example.com/?area=north-shore')).filters;
        const url = buildPropertySearchUrl(new URL('https://example.com/properties/'), {
            filters: { ...defaultFilters, ...areaFilters, state: 'NH' },
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });
        const written = new URL(url, 'https://example.com');

        expect(written.searchParams.get('area')).toBe('north-shore');
        expect(written.searchParams.has('state')).toBe(false);
        expect(written.searchParams.getAll('includeTown')).toEqual([]);
        expect(readPropertySearchUrl(written).filters).toMatchObject({
            state: 'MA',
            region: 'North Shore',
        });
    });

    it('normalizes towns and shares only the Saved Homes view, never device-local saved IDs', () => {
        const url = buildPropertySearchUrl(new URL('https://example.com/properties/?saved=1'), {
            filters: {
                ...defaultFilters,
                query: '  Beacon Hill  ',
                includeTowns: [' Salem ', 'Beverly', 'Salem'],
                savedOnly: true,
            },
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: false,
            listingNumber: null,
        });
        const written = new URL(url, 'https://example.com');

        expect(written.searchParams.get('query')).toBe('Beacon Hill');
        expect(written.searchParams.getAll('includeTown')).toEqual(['Beverly', 'Salem']);
        expect(written.searchParams.get('saved')).toBe('1');
        expect(written.toString()).not.toContain('73333444');
        expect(readPropertySearchUrl(written).filters.savedOnly).toBe(true);
    });

    it('round-trips the complete workspace state in one deterministic URL', () => {
        const url = buildPropertySearchUrl(new URL('https://example.com/buy/properties/?utm_source=client'), {
            filters: {
                ...defaultFilters,
                query: 'Burlington',
                minBeds: '3',
                includeTowns: ['Burlington', 'Woburn'],
                savedOnly: true,
            },
            sort: { key: 'sqft', direction: 'asc' },
            view: 'gallery',
            page: 4,
            pageSize: 50,
            scope: 'service',
            isMapOpen: true,
            listingNumber: '73333444',
            mapListingNumber: '73333445',
            mapCamera: { center: { lat: 42.50482, lng: -71.19561 }, zoom: 11.75 },
            mapGeometry: {
                kind: 'polygon',
                path: [
                    { lat: 42.55, lng: -71.3 },
                    { lat: 42.56, lng: -71.08 },
                    { lat: 42.41, lng: -71.12 },
                ],
                bounds: { north: 42.56, east: -71.08, south: 42.41, west: -71.3 },
            },
        });
        const written = new URL(url, 'https://example.com');
        const restored = readPropertySearchUrl(written);

        expect(written.searchParams.get('utm_source')).toBe('client');
        expect(restored).toMatchObject({
            hasSearchState: true,
            filters: {
                query: 'Burlington',
                minBeds: '3',
                includeTowns: ['Burlington', 'Woburn'],
                savedOnly: true,
            },
            sort: { key: 'sqft', direction: 'asc' },
            view: 'gallery',
            page: 4,
            pageSize: 50,
            isMapOpen: true,
            listingNumber: '73333444',
            mapListingNumber: '73333445',
            mapCamera: { center: { lat: 42.50482, lng: -71.19561 }, zoom: 11.75 },
            mapGeometry: {
                kind: 'polygon',
                path: [
                    { lat: 42.55, lng: -71.3 },
                    { lat: 42.56, lng: -71.08 },
                    { lat: 42.41, lng: -71.12 },
                ],
                bounds: { north: 42.56, east: -71.08, south: 42.41, west: -71.3 },
            },
        });
    });

    it('round-trips a precision-limited polygon alongside its derived bounds', () => {
        const url = buildPropertySearchUrl(new URL('https://example.com/properties/'), {
            filters: defaultFilters,
            sort: defaultSort,
            view: 'list',
            page: 1,
            pageSize: 10,
            scope: 'service',
            isMapOpen: true,
            listingNumber: null,
            mapGeometry: {
                kind: 'polygon',
                path: [
                    { lat: 42.500001, lng: -71.300009 },
                    { lat: 42.400004, lng: -70.800003 },
                    { lat: 42.100002, lng: -71.200006 },
                ],
                bounds: { north: 90, east: 180, south: -90, west: -180 },
            },
        });
        const written = new URL(url, 'https://example.com');

        expect(written.searchParams.get('mapPolygon')).toBe(
            '42.5,-71.30001;42.4,-70.8;42.1,-71.20001',
        );
        expect(written.searchParams.get('mapBounds')).toBe('42.5,-70.8,42.1,-71.30001');
        expect(readPropertySearchUrl(written).mapGeometry).toEqual({
            kind: 'polygon',
            path: [
                { lat: 42.5, lng: -71.30001 },
                { lat: 42.4, lng: -70.8 },
                { lat: 42.1, lng: -71.20001 },
            ],
            bounds: { north: 42.5, east: -70.8, south: 42.1, west: -71.30001 },
        });
    });

    it('rejects malformed polygons and paths above the 64-point sharing limit', () => {
        const tooManyPoints = Array.from({ length: 65 }, (_, index) => (
            `${42 + (index / 1000)},${-71 + (index / 1000)}`
        )).join(';');
        const malformed = readPropertySearchUrl(new URL(
            'https://example.com/properties/?map=1&mapBounds=42.5,-70.8,42.1,-71.3&mapPolygon=42,-71;bad',
        ));
        const tooMany = readPropertySearchUrl(new URL(
            `https://example.com/properties/?mapPolygon=${encodeURIComponent(tooManyPoints)}`,
        ));

        expect(malformed.mapGeometry).toBeUndefined();
        expect(tooMany.mapGeometry).toBeUndefined();
    });
});
