import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MLS_PIN_PUBLIC_DISCLAIMER,
    type MlsSearchListing,
    type MlsSearchManifest,
} from '@/lib/mls-public-listings';

const markerClustererHarness = vi.hoisted(() => {
    const instances: Array<{
        addMarkers: ReturnType<typeof vi.fn>;
        clearMarkers: ReturnType<typeof vi.fn>;
        options: Record<string, unknown>;
        removeMarkers: ReturnType<typeof vi.fn>;
        render: ReturnType<typeof vi.fn>;
        setMap: ReturnType<typeof vi.fn>;
    }> = [];
    const constructor = vi.fn(function MockMarkerClusterer(options: Record<string, unknown>) {
        const instance = {
            addMarkers: vi.fn(),
            clearMarkers: vi.fn(),
            options,
            removeMarkers: vi.fn(),
            render: vi.fn(),
            setMap: vi.fn(),
        };
        instances.push(instance);
        return instance;
    });
    return { constructor, instances };
});

const superClusterAlgorithmHarness = vi.hoisted(() => {
    const constructor = vi.fn(function MockSuperClusterAlgorithm(options: Record<string, unknown>) {
        return { options };
    });
    return { constructor };
});

vi.mock('@googlemaps/markerclusterer', () => ({
    MarkerClusterer: markerClustererHarness.constructor,
    SuperClusterAlgorithm: superClusterAlgorithmHarness.constructor,
}));

import { PropertyMapView, type MapAreaSelection } from './PropertyMapView';

type Coordinates = Readonly<{ lat: number; lng: number }> | null;

function makeListing(
    index: number,
    coordinates: Coordinates = { lat: 42.45, lng: -71.15 },
    address: Partial<MlsSearchListing['address']> = {},
): MlsSearchListing {
    return {
        listingNumber: `73344${String(index).padStart(3, '0')}`,
        propertyType: 'Single family',
        status: { code: 'ACT', label: 'Active', isActive: true },
        listPrice: 900000 + index,
        priceLabel: `$${(900000 + index).toLocaleString('en-US')}`,
        address: {
            line: `${index} Cache Street`,
            town: 'Boston',
            county: 'Suffolk',
            state: 'MA',
            zip: '02108',
            ...address,
        },
        facts: {
            beds: 3,
            fullBaths: 2,
            halfBaths: 1,
            bathsLabel: '2f;1h',
            sqft: 1800,
        },
        ...(coordinates ? {
            mapPosition: {
                ...coordinates,
                source: 'google_geocoding',
                precision: 'ROOFTOP',
                geocodedAt: '2026-07-01T12:00:00.000Z',
                expiresAt: '2099-07-31T12:00:00.000Z',
            },
        } : {}),
        photoCount: 2,
        openHouseCount: 1,
        hasVirtualTour: false,
        attribution: {
            listingAgent: 'Avery Agent',
            listingOffice: 'Beacon Office',
        },
        source: { name: 'MLS PIN' },
    };
}

function makeCoordinateManifest(generatedAt: string, coordinateCount: number): MlsSearchManifest {
    return {
        schemaVersion: 1,
        generatedAt,
        source: 'MLS PIN',
        disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
        compliance: {
            participantFirmName: 'Test Realty',
            officeAddress: '1 Test Street, Boston, MA',
            phone: '617-555-0100',
            marketArea: 'Massachusetts',
        },
        totalListingCount: Math.max(1, coordinateCount),
        facets: {
            states: ['MA'],
            counties: ['Suffolk'],
            towns: ['Boston'],
            propertyTypes: ['Single family'],
        },
        coordinateIndex: {
            file: 'mls-coordinate-index.json',
            coordinateCount,
        },
        shards: [
            { id: 'preferred', file: 'mls-search-preferred.json', listingCount: Math.max(1, coordinateCount) },
        ],
    };
}

type MockBoundsLiteral = Readonly<{
    north: number;
    east: number;
    south: number;
    west: number;
}>;

function setupGoogleMapsMock({ supportsDomEvents = true } = {}) {
    const viewportBounds: MockBoundsLiteral = {
        north: 42.5,
        east: -71.1,
        south: 42.4,
        west: -71.2,
    };
    const createdBounds: Array<{ extend: ReturnType<typeof vi.fn>; toJSON: ReturnType<typeof vi.fn> }> = [];
    const mapListeners = new Map<string, () => void>();
    let cameraCenter = { lat: 42.3601, lng: -71.0589 };
    let cameraZoom = 10;
    const map = {
        addListener: vi.fn((eventName: string, callback: () => void) => {
            mapListeners.set(eventName, callback);
            return { remove: vi.fn() };
        }),
        fitBounds: vi.fn(),
        getBounds: vi.fn(() => ({
            extend: vi.fn(),
            toJSON: vi.fn(() => viewportBounds),
        })),
        getCenter: vi.fn(() => ({
            lat: () => cameraCenter.lat,
            lng: () => cameraCenter.lng,
        })),
        getZoom: vi.fn(() => cameraZoom),
        setCenter: vi.fn((center: { lat: number; lng: number }) => {
            cameraCenter = center;
        }),
        setZoom: vi.fn((zoom: number) => {
            cameraZoom = zoom;
        }),
    };
    const geocoderConstructor = vi.fn();
    const advancedMarkers: Array<{
        addEventListener: ReturnType<typeof vi.fn> | undefined;
        removeEventListener: ReturnType<typeof vi.fn> | undefined;
        addListener: ReturnType<typeof vi.fn>;
        focus: ReturnType<typeof vi.fn>;
        listeners: Map<string, () => void>;
        map: unknown;
        options: Record<string, unknown>;
    }> = [];
    const advancedMarkerConstructor = vi.fn(function MockAdvancedMarker(options: Record<string, unknown>) {
        const listeners = new Map<string, () => void>();
        const marker = {
            addEventListener: supportsDomEvents ? vi.fn((eventName: string, callback: () => void) => {
                listeners.set(eventName, callback);
            }) : undefined,
            removeEventListener: supportsDomEvents ? vi.fn((eventName: string, callback: () => void) => {
                if (listeners.get(eventName) === callback) listeners.delete(eventName);
            }) : undefined,
            addListener: vi.fn((eventName: string, callback: () => void) => {
                listeners.set(eventName, callback);
                return { remove: vi.fn(() => listeners.delete(eventName)) };
            }),
            focus: vi.fn(),
            listeners,
            map: options.map ?? null,
            options,
        };
        advancedMarkers.push(marker);
        return marker;
    });
    const polygonInstances: Array<{
        getPath: () => {
            addListener: (eventName: string, callback: () => void) => { remove: ReturnType<typeof vi.fn> };
            getArray: () => Array<{ lat: () => number; lng: () => number }>;
            setPoints: (points: Array<{ lat: number; lng: number }>) => void;
            trigger: (eventName: string) => void;
        };
        options: Record<string, unknown>;
        setEditable: ReturnType<typeof vi.fn>;
        setMap: ReturnType<typeof vi.fn>;
        setPath: ReturnType<typeof vi.fn>;
    }> = [];
    const polygonConstructor = vi.fn(function MockPolygon(options: Record<string, unknown>) {
        let points = [...((options.path ?? []) as Array<{ lat: number; lng: number }>)] ;
        const listeners = new Map<string, () => void>();
        const path = {
            addListener: (eventName: string, callback: () => void) => {
                listeners.set(eventName, callback);
                return { remove: vi.fn() };
            },
            getArray: () => points.map((point) => ({
                lat: () => point.lat,
                lng: () => point.lng,
            })),
            setPoints: (nextPoints: Array<{ lat: number; lng: number }>) => {
                points = nextPoints;
            },
            trigger: (eventName: string) => listeners.get(eventName)?.(),
        };
        const polygon = {
            getPath: () => path,
            options,
            setEditable: vi.fn(),
            setMap: vi.fn(),
            setPath: vi.fn(),
        };
        polygonInstances.push(polygon);
        return polygon;
    });
    const projectionOverlaySetMap = vi.fn();
    const mapEventTrigger = vi.fn();

    window.google = {
        maps: {
            Map: vi.fn(function MockMap() {
                return map;
            }),
            Geocoder: geocoderConstructor,
            LatLngBounds: vi.fn(function MockLatLngBounds() {
                const bounds = {
                    extend: vi.fn(),
                    toJSON: vi.fn(() => viewportBounds),
                };
                createdBounds.push(bounds);
                return bounds;
            }),
            OverlayView: vi.fn(function MockOverlayView() {
                return {
                    draw: vi.fn(),
                    getProjection: () => ({
                        fromContainerPixelToLatLng: (point: { x: number; y: number }) => ({
                            lat: () => 42.5 - (point.y / 1000),
                            lng: () => -71.2 + (point.x / 1000),
                        }),
                        fromLatLngToContainerPixel: (point: { lat: number; lng: number }) => ({
                            x: (point.lng + 71.2) * 1000,
                            y: (42.5 - point.lat) * 1000,
                        }),
                    }),
                    onAdd: vi.fn(),
                    onRemove: vi.fn(),
                    setMap: projectionOverlaySetMap,
                };
            }),
            Point: vi.fn(function MockPoint(x: number, y: number) {
                return { x, y };
            }),
            Polygon: polygonConstructor,
            event: {
                addListenerOnce: vi.fn(),
                trigger: mapEventTrigger,
            },
            marker: {
                AdvancedMarkerElement: advancedMarkerConstructor,
            },
        },
    } as unknown as NonNullable<typeof window.google>;

    return {
        advancedMarkerConstructor,
        advancedMarkers,
        createdBounds,
        geocoderConstructor,
        map,
        mapEventTrigger,
        mapListeners,
        polygonConstructor,
        polygonInstances,
        projectionOverlaySetMap,
        viewportBounds,
    };
}

function renderMap(listings: MlsSearchListing[], props: Partial<React.ComponentProps<typeof PropertyMapView>> = {}) {
    return render(
        <PropertyMapView
            listings={listings}
            activeListingNumber={null}
            onActiveListingChange={vi.fn()}
            onAskAboutArea={vi.fn()}
            {...props}
        />,
    );
}

function captureIdleWork() {
    let nextHandle = 0;
    const pending = new Map<number, () => void>();
    const cancelled = vi.fn((handle: number) => { pending.delete(handle); });
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
        pending.set(++nextHandle, callback);
        return nextHandle;
    });
    vi.stubGlobal('cancelIdleCallback', cancelled);
    return {
        pending,
        cancelled,
        runNext() {
            const entry = pending.entries().next().value;
            expect(entry).toBeDefined();
            if (!entry) return;
            pending.delete(entry[0]);
            act(() => entry[1]());
        },
    };
}

describe('PropertyMapView', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        markerClustererHarness.instances.length = 0;
        delete window.google;
        window.__moveWithMustoGoogleMapsLoading = undefined;
        document.getElementById('move-with-musto-google-maps')?.remove();
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it('keeps missing map configuration customer-facing and leaves the list usable', () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        renderMap([makeListing(1)]);

        expect(screen.getByRole('heading', { name: /map temporarily unavailable/i })).toBeVisible();
        expect(screen.getByText(/property list is ready to use/i)).toBeVisible();
        expect(screen.queryByText(/NEXT_PUBLIC_GOOGLE_MAPS/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /get search help/i })).toBeEnabled();
    });

    it('uses reviewed coordinates only and never constructs a browser geocoder', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, geocoderConstructor } = setupGoogleMapsMock();

        renderMap([makeListing(1), makeListing(2, null)]);

        expect(await screen.findByText(/1 home shown on the map/i)).toBeInTheDocument();
        expect(screen.queryByText(/current scope|reviewed coordinates|saved coordinates/i)).not.toBeInTheDocument();
        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(1));
        expect(geocoderConstructor).not.toHaveBeenCalled();
        expect(screen.queryByRole('searchbox', { name: /search map area/i })).not.toBeInTheDocument();
    });

    it('opens a single result at a useful neighborhood zoom', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { map } = setupGoogleMapsMock();
        const listing = makeListing(3, { lat: 42.392916, lng: -71.487601 });

        renderMap([listing]);

        await screen.findByText(/1 home shown on the map/i);
        await waitFor(() => expect(map.setCenter).toHaveBeenCalledWith({
            lat: 42.392916,
            lng: -71.487601,
        }));
        expect(map.setZoom).toHaveBeenCalledWith(15);
        expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it('treats the reviewed coordinate sidecar as authoritative', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, geocoderConstructor } = setupGoogleMapsMock();
        const generatedAt = '2026-07-09T18:00:00.000Z';
        const listing = makeListing(10, { lat: 40, lng: -73 });
        const expiredListing = makeListing(12, { lat: 41, lng: -72 });
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                schemaVersion: 1,
                generatedAt,
                coordinates: {
                    [listing.listingNumber]: {
                        lat: 42.5048,
                        lng: -71.1956,
                        expiresAt: '2099-07-31T12:00:00.000Z',
                    },
                    [expiredListing.listingNumber]: {
                        lat: 42.6,
                        lng: -71.3,
                        expiresAt: '2000-07-31T12:00:00.000Z',
                    },
                },
            }),
        } as Response);

        renderMap([listing, expiredListing], {
            coordinateIndexManifest: makeCoordinateManifest(generatedAt, 2),
            coordinateIndexUrl: '/mls/mls-coordinate-index.json?generation=map-engine-authority',
        });

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            '/mls/mls-coordinate-index.json?generation=map-engine-authority',
            { cache: 'no-store' },
        ));
        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledWith(expect.objectContaining({
            position: { lat: 42.5048, lng: -71.1956 },
        })));
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/1 home shown on the map/i)).toBeInTheDocument();
        expect(geocoderConstructor).not.toHaveBeenCalled();
    });

    it('keeps the Google map usable when refreshed home locations need retrying', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor } = setupGoogleMapsMock();
        const generatedAt = '2026-07-09T18:05:00.000Z';
        const listing = makeListing(11, { lat: 40, lng: -73 });
        const coordinateResponse = {
            ok: true,
            json: async () => ({
                schemaVersion: 1,
                generatedAt,
                coordinates: {
                    [listing.listingNumber]: {
                        lat: 42.5048,
                        lng: -71.1956,
                        expiresAt: '2099-07-31T12:00:00.000Z',
                    },
                },
            }),
        } as Response;
        const fetchMock = vi.spyOn(global, 'fetch')
            .mockRejectedValueOnce(new Error('stale coordinate response'))
            .mockResolvedValueOnce(coordinateResponse);

        renderMap([listing], {
            coordinateIndexManifest: makeCoordinateManifest(generatedAt, 1),
            coordinateIndexUrl: '/mls/mls-coordinate-index.json?generation=retry-locations&coordinates=1',
        });

        const refreshLocations = await screen.findByRole('button', { name: /refresh locations/i });
        expect(refreshLocations.parentElement).toHaveTextContent(/home locations could not refresh/i);
        expect(screen.getByLabelText(/map of matching homes/i)).toBeInTheDocument();
        expect(screen.queryByText(/map could not load/i)).not.toBeInTheDocument();
        await user.click(refreshLocations);

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock).toHaveBeenLastCalledWith(
            '/mls/mls-coordinate-index.json?generation=retry-locations&coordinates=1',
            { cache: 'no-store' },
        );
        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledWith(expect.objectContaining({
            position: { lat: 42.5048, lng: -71.1956 },
        })));
        expect(screen.queryAllByText(/home locations could not refresh/i)).toHaveLength(0);
    });

    it('clusters every resolved marker instead of truncating after 200', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, advancedMarkers } = setupGoogleMapsMock();
        const listings = Array.from({ length: 205 }, (_, index) => makeListing(index + 100, {
            lat: 42.4 + (index * 0.0001),
            lng: -71.2 + (index * 0.0001),
        }));

        const view = renderMap(listings);

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(205));
        await waitFor(() => expect(markerClustererHarness.constructor).toHaveBeenCalledTimes(1));
        const clusterer = markerClustererHarness.instances[0];
        expect(clusterer.addMarkers).toHaveBeenLastCalledWith(
            expect.arrayContaining([expect.any(Object)]),
            true,
        );
        expect(clusterer.addMarkers.mock.calls.at(-1)?.[0]).toHaveLength(205);
        expect(clusterer.render).toHaveBeenCalled();
        expect(screen.getByText(/205 homes shown on the map/i)).toBeInTheDocument();

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                listings={listings.slice(0, 2)}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );
        await screen.findByText(/2 homes shown on the map/i);
        expect(clusterer.clearMarkers).not.toHaveBeenCalled();
        expect(clusterer.removeMarkers).toHaveBeenLastCalledWith(
            expect.arrayContaining([expect.any(Object)]),
            true,
        );
        expect(clusterer.removeMarkers.mock.calls.at(-1)?.[0]).toHaveLength(203);
        expect(clusterer.addMarkers).toHaveBeenCalledTimes(1);
        expect(advancedMarkers.slice(2).every((marker) => marker.map === null)).toBe(true);

        view.unmount();
        expect(clusterer.clearMarkers).toHaveBeenCalled();
        expect(clusterer.setMap).toHaveBeenCalledWith(null);
    });

    it('preserves marker instances across reorders and applies only membership deltas', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, advancedMarkers } = setupGoogleMapsMock();
        const first = makeListing(701, { lat: 42.41, lng: -71.21 });
        const second = makeListing(702, { lat: 42.42, lng: -71.22 });
        const third = makeListing(703, { lat: 42.43, lng: -71.23 });
        const replacement = makeListing(704, { lat: 42.44, lng: -71.24 });
        const view = renderMap([first, second, third]);

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(3));
        const clusterer = markerClustererHarness.instances[0];
        const initialAddCount = clusterer.addMarkers.mock.calls.length;
        const initialRenderCount = clusterer.render.mock.calls.length;

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                listings={[third, second, first]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );

        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(3);
        expect(clusterer.addMarkers).toHaveBeenCalledTimes(initialAddCount);
        expect(clusterer.removeMarkers).not.toHaveBeenCalled();
        expect(clusterer.clearMarkers).not.toHaveBeenCalled();
        expect(clusterer.render).toHaveBeenCalledTimes(initialRenderCount);

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                listings={[second, third, replacement]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(4));
        expect(clusterer.removeMarkers).toHaveBeenCalledTimes(1);
        expect(clusterer.removeMarkers).toHaveBeenLastCalledWith([advancedMarkers[0]], true);
        expect(clusterer.addMarkers.mock.calls.at(-1)?.[0]).toHaveLength(1);
        expect(clusterer.clearMarkers).not.toHaveBeenCalled();
    });

    it('freezes hidden marker work while immediately recomputing polygon membership', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor } = setupGoogleMapsMock();
        const first = makeListing(711, { lat: 42.41, lng: -71.21 });
        const second = makeListing(712, { lat: 42.42, lng: -71.22 });
        const third = makeListing(713, { lat: 42.43, lng: -71.23 });
        const geometry = {
            kind: 'polygon' as const,
            path: [
                { lat: 42.5, lng: -71.3 },
                { lat: 42.5, lng: -71.1 },
                { lat: 42.3, lng: -71.1 },
                { lat: 42.3, lng: -71.3 },
            ],
            bounds: { north: 42.5, east: -71.1, south: 42.3, west: -71.3 },
        };
        const selectedArea: MapAreaSelection = {
            label: 'Persistent polygon',
            bounds: geometry.bounds,
            geometry,
            listingNumbers: [first.listingNumber, second.listingNumber],
            resultCount: 2,
            coverage: { eligibleCount: 2, attemptedCount: 2, mappedCount: 2, isLimited: false },
        };
        const onMapAreaChange = vi.fn();
        const view = renderMap([first, second], { isActive: true, onMapAreaChange, selectedArea });

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(2));
        const clusterer = markerClustererHarness.instances[0];
        const initialAddCount = clusterer.addMarkers.mock.calls.length;
        const initialRenderCount = clusterer.render.mock.calls.length;

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                isActive={false}
                listings={[first, second, third]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
                onMapAreaChange={onMapAreaChange}
                selectedArea={selectedArea}
            />,
        );

        expect(screen.getByText(/3 homes shown on the map/i)).toBeInTheDocument();
        await waitFor(() => expect(onMapAreaChange).toHaveBeenLastCalledWith(expect.objectContaining({
            geometry,
            listingNumbers: [first.listingNumber, second.listingNumber, third.listingNumber],
            resultCount: 3,
        })));
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(2);
        expect(clusterer.addMarkers).toHaveBeenCalledTimes(initialAddCount);
        expect(clusterer.removeMarkers).not.toHaveBeenCalled();
        expect(clusterer.render).toHaveBeenCalledTimes(initialRenderCount);

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                isActive
                listings={[first, second, third]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
                onMapAreaChange={onMapAreaChange}
                selectedArea={selectedArea}
            />,
        );

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(3));
        expect(clusterer.removeMarkers).not.toHaveBeenCalled();
        expect(clusterer.addMarkers.mock.calls.at(-1)?.[0]).toHaveLength(1);
        expect(clusterer.clearMarkers).not.toHaveBeenCalled();
    });

    it('resizes and recenters the persistent map when a hidden mobile workspace opens', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { map, mapEventTrigger } = setupGoogleMapsMock();
        const listing = makeListing(714, { lat: 42.49762, lng: -71.2303 });
        const view = renderMap([listing], { isActive: false });

        await screen.findByText(/1 home shown on the map/i);
        expect(mapEventTrigger).not.toHaveBeenCalled();
        const setCenterCount = map.setCenter.mock.calls.length;

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                isActive
                listings={[listing]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );

        await waitFor(() => expect(mapEventTrigger).toHaveBeenCalledWith(map, 'resize'));
        expect(map.setCenter.mock.calls.length).toBeGreaterThan(setCenterCount);
    });

    it('mounts large marker sets in responsive batches without reducing discoverability', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, map } = setupGoogleMapsMock();
        const listings = Array.from({ length: 515 }, (_, index) => makeListing(index + 1000, {
            lat: 42.35 + (index * 0.0001),
            lng: -71.25 + (index * 0.0001),
        }));

        renderMap(listings);

        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(515));
        const clusterer = markerClustererHarness.instances[0];
        const addedBatchSizes = clusterer.addMarkers.mock.calls.map((call) => call[0].length as number);
        expect(addedBatchSizes.every((size) => size <= 250)).toBe(true);
        expect(addedBatchSizes.reduce((sum, size) => sum + size, 0)).toBe(515);
        expect(clusterer.render).toHaveBeenCalledTimes(1);
        expect(clusterer.options).toEqual(expect.objectContaining({
            algorithm: expect.any(Object),
            onClusterClick: expect.any(Function),
            renderer: expect.objectContaining({ render: expect.any(Function) }),
        }));
        expect(superClusterAlgorithmHarness.constructor).toHaveBeenCalledWith({
            maxZoom: 19,
            minPoints: 2,
            radius: 130,
        });

        const clusterRenderer = clusterer.options.renderer as {
            render: (cluster: { count: number; position: unknown }) => unknown;
        };
        clusterRenderer.render({ count: 1842, position: { lat: 42.45, lng: -71.15 } });
        const renderedCluster = advancedMarkerConstructor.mock.calls.at(-1)?.[0] as Record<string, unknown>;
        const renderedClusterContent = renderedCluster.content as HTMLElement;
        expect(renderedClusterContent).toHaveTextContent('1.8K');
        expect(renderedClusterContent).toHaveAttribute(
            'aria-label',
            '1,842 homes in this area. Zoom in to see individual homes.',
        );
        expect(renderedCluster.title).toBe('1,842 homes');

        const onClusterClick = clusterer.options.onClusterClick as (
            event: unknown,
            cluster: { position: unknown },
            targetMap: typeof map,
        ) => void;
        const clusterPosition = { lat: 42.45, lng: -71.15 };
        onClusterClick({}, { position: clusterPosition }, map);
        expect(map.setCenter).toHaveBeenLastCalledWith(clusterPosition);
        expect(map.setZoom).toHaveBeenLastCalledWith(12);
    });

    it('finishes an in-flight marker batch when the parent refreshes equivalent listing objects', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor } = setupGoogleMapsMock();
        const idle = captureIdleWork();
        const listings = Array.from({ length: 515 }, (_, index) => makeListing(index + 2000));
        const view = renderMap(listings);

        await waitFor(() => expect(idle.pending.size).toBe(1));
        idle.runNext();
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(250);
        const continuation = [...idle.pending.values()][0];
        view.rerender(
            <PropertyMapView
                listings={structuredClone(listings)}
                activeListingNumber={null}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );

        expect(idle.cancelled).not.toHaveBeenCalled();
        expect([...idle.pending.values()][0]).toBe(continuation);
        idle.runNext();
        idle.runNext();
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(515);
        expect(markerClustererHarness.instances[0].render).toHaveBeenCalledTimes(1);
    });

    it('renders retained additions when a smaller result set cancels their unfinished batch', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor } = setupGoogleMapsMock();
        const idle = captureIdleWork();
        const listings = Array.from({ length: 500 }, (_, index) => makeListing(index + 2500));
        const view = renderMap(listings);
        await waitFor(() => expect(idle.pending.size).toBe(1));
        idle.runNext();
        const clusterer = markerClustererHarness.instances[0];
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(250);
        expect(clusterer.render).not.toHaveBeenCalled();

        view.rerender(
            <PropertyMapView
                listings={listings.slice(0, 250)}
                activeListingNumber={null}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );
        expect(idle.pending.size).toBe(0);
        expect(clusterer.removeMarkers).not.toHaveBeenCalled();
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(250);
        expect(clusterer.render).toHaveBeenCalledOnce();
    });

    it('cancels superseded marker batches and does not mount stale inventory after unmount', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, advancedMarkers } = setupGoogleMapsMock();
        const idle = captureIdleWork();
        const listings = Array.from({ length: 515 }, (_, index) => makeListing(index + 3000));
        const view = renderMap(listings);

        await waitFor(() => expect(idle.pending.size).toBe(1));
        idle.runNext();
        const staleContinuation = [...idle.pending.values()][0];
        const replacement = makeListing(9999, { lat: 42.4, lng: -71.3 });
        view.rerender(
            <PropertyMapView
                listings={[replacement]}
                activeListingNumber={null}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );

        expect(idle.cancelled).toHaveBeenCalledTimes(1);
        act(() => staleContinuation());
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(250);
        expect(advancedMarkers.every((marker) => marker.map === null)).toBe(true);
        expect(advancedMarkers.every((marker) => marker.listeners.size === 0)).toBe(true);
        const replacementBatch = [...idle.pending.values()][0];
        view.unmount();
        act(() => replacementBatch());
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(250);
        expect(idle.pending.size).toBe(0);
        expect(markerClustererHarness.instances[0].setMap).toHaveBeenCalledWith(null);
    });

    it('updates marker display content without replacing its map resource', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkerConstructor, advancedMarkers } = setupGoogleMapsMock();
        const listing = makeListing(8000);
        const view = renderMap([listing], { camera: { center: { lat: 42.45, lng: -71.15 }, zoom: 14 } });
        await waitFor(() => expect(advancedMarkerConstructor).toHaveBeenCalledTimes(1));
        const content = advancedMarkers[0].options.content as HTMLElement;
        expect(content).toHaveTextContent(listing.priceLabel);

        view.rerender(
            <PropertyMapView
                listings={[{ ...listing, priceLabel: '$875,000' }]}
                activeListingNumber={null}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );
        expect(content).toHaveTextContent('$875,000');
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(1);

        view.rerender(
            <PropertyMapView
                listings={[{ ...listing, listPrice: null, priceLabel: '$875,000' }]}
                activeListingNumber={null}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
            />,
        );
        expect(content).toHaveTextContent('Home');
        expect(advancedMarkerConstructor).toHaveBeenCalledTimes(1);
    });

    it('creates interactive pins when an existing map switches out of preview mode', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkers } = setupGoogleMapsMock();
        const listing = makeListing(9000);
        const select = vi.fn();
        const view = renderMap([listing], { variant: 'preview' });
        await waitFor(() => expect(advancedMarkers).toHaveLength(1));
        expect(advancedMarkers[0].options.gmpClickable).toBe(false);

        view.rerender(
            <PropertyMapView
                listings={[listing]}
                variant="full"
                activeListingNumber={null}
                onActiveListingChange={select}
                onAskAboutArea={vi.fn()}
            />,
        );
        await waitFor(() => expect(advancedMarkers).toHaveLength(2));
        expect(advancedMarkers[1].options.gmpClickable).toBe(true);
        act(() => advancedMarkers[1].listeners.get('gmp-click')?.());
        expect(select).toHaveBeenCalledWith(listing.listingNumber);
        expect(markerClustererHarness.instances[0].setMap).toHaveBeenCalledWith(null);
        view.unmount();
        expect(advancedMarkers[1].listeners.size).toBe(0);
        expect(advancedMarkers[1].removeEventListener).toHaveBeenCalledWith('gmp-click', expect.any(Function));
    });

    it('removes legacy Google listener handles when the map unmounts', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkers } = setupGoogleMapsMock({ supportsDomEvents: false });
        const onSelect = vi.fn();
        const listing = makeListing(9200);
        const view = renderMap([listing], { onActiveListingChange: onSelect });
        await waitFor(() => expect(advancedMarkers).toHaveLength(1));
        const marker = advancedMarkers[0];
        act(() => marker.listeners.get('click')?.());
        expect(onSelect).toHaveBeenCalledWith(listing.listingNumber);
        const listener = marker.addListener.mock.results[0].value as { remove: ReturnType<typeof vi.fn> };
        view.unmount();
        expect(listener.remove).toHaveBeenCalledOnce();
        expect(marker.listeners.size).toBe(0);
    });

    it('uses quiet overview dots until neighborhood zoom while keeping marker activation intact', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkers, map, mapListeners } = setupGoogleMapsMock();
        const listing = makeListing(1600);

        renderMap([listing]);

        await waitFor(() => expect(advancedMarkers).toHaveLength(1));
        const content = advancedMarkers[0].options.content as HTMLElement;
        expect(content).toHaveTextContent('');
        expect(advancedMarkers[0].options.title).toBe(`Show ${listing.address.line}, ${listing.address.town}, ${listing.address.state}, ${listing.address.zip}`);

        act(() => {
            map.setZoom(13);
            mapListeners.get('zoom_changed')?.();
        });
        await waitFor(() => expect(content).toHaveTextContent(listing.priceLabel));

        act(() => {
            map.setZoom(12);
            mapListeners.get('zoom_changed')?.();
        });
        await waitFor(() => expect(content).toHaveTextContent(''));
    });

    it('keeps panning exploratory and directs buyers to draw an area to narrow results', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { mapListeners } = setupGoogleMapsMock();
        const onMapAreaChange = vi.fn();
        const inside = makeListing(20, { lat: 42.45, lng: -71.15 });
        const outside = makeListing(21, { lat: 42.2, lng: -71 });
        renderMap([inside, outside], { onMapAreaChange });
        await screen.findByText(/2 homes shown on the map/i);

        act(() => mapListeners.get('dragend')?.());

        expect(onMapAreaChange).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: /search this view/i })).not.toBeInTheDocument();
        expect(screen.getByText(/pan to explore\. draw an area to narrow the homes shown/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^draw area$/i })).toBeEnabled();
    });

    it('keeps drawing instructions accessible and prevents a second draw while drawing', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        setupGoogleMapsMock();
        renderMap([]);
        await screen.findByText(/0 homes shown on the map/i);

        const drawArea = screen.getByRole('button', { name: /^draw area$/i });
        await user.click(drawArea);
        expect(drawArea).toBeDisabled();
        expect(screen.getByRole('region', { name: /draw a map search area/i })).toHaveAttribute(
            'aria-describedby',
            'map-drawing-instructions',
        );
        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(drawArea).toBeEnabled();
    });

    it('restores a controlled camera and emits normalized user camera state on idle', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { map, mapListeners } = setupGoogleMapsMock();
        const onCameraChange = vi.fn();
        const camera = {
            center: { lat: 42.50481234, lng: -71.19561234 },
            zoom: 12.345,
        };
        const view = renderMap([makeListing(25)], { camera, onCameraChange });
        await screen.findByText(/1 home shown on the map/i);
        expect(window.google?.maps.Map).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
            center: { lat: 42.504812, lng: -71.195612 },
            gestureHandling: 'cooperative',
            zoom: 12.35,
        }));
        expect(map.fitBounds).not.toHaveBeenCalled();

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                camera={{ center: { lat: 91, lng: -181 }, zoom: 30 }}
                listings={[makeListing(25)]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
                onCameraChange={onCameraChange}
            />,
        );
        expect(map.setCenter).toHaveBeenCalledWith({ lat: 90, lng: -180 });
        expect(map.setZoom).toHaveBeenCalledWith(22);
        act(() => mapListeners.get('idle')?.());
        expect(onCameraChange).not.toHaveBeenCalled();

        map.setCenter({ lat: 42.12345678, lng: -71.87654321 });
        map.setZoom(11.234);
        act(() => mapListeners.get('idle')?.());
        expect(onCameraChange).toHaveBeenLastCalledWith({
            center: { lat: 42.123457, lng: -71.876543 },
            zoom: 11.23,
        });
    });

    it('does not refit a panned camera when only polygon membership changes', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
        const { map, mapListeners } = setupGoogleMapsMock();
        const first = makeListing(26, { lat: 42.45, lng: -71.15 });
        const second = makeListing(27, { lat: 42.46, lng: -71.16 });
        const geometry = {
            kind: 'polygon' as const,
            path: [
                { lat: 42.49, lng: -71.19 },
                { lat: 42.49, lng: -71.11 },
                { lat: 42.41, lng: -71.11 },
                { lat: 42.41, lng: -71.19 },
            ],
            bounds: { north: 42.49, east: -71.11, south: 42.41, west: -71.19 },
        };
        const selectedArea = (listingNumbers: string[]): MapAreaSelection => ({
            label: 'Stable polygon',
            bounds: geometry.bounds,
            geometry,
            listingNumbers,
            resultCount: listingNumbers.length,
            coverage: {
                eligibleCount: listingNumbers.length,
                attemptedCount: listingNumbers.length,
                mappedCount: listingNumbers.length,
                isLimited: false,
            },
        });
        const view = renderMap([first], { selectedArea: selectedArea([first.listingNumber]) });

        await screen.findByText(/1 home shown on the map/i);
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
        const fittedCameraCount = map.fitBounds.mock.calls.length;
        now.mockReturnValue(2_000);
        act(() => mapListeners.get('dragend')?.());
        expect(screen.getByText(/pan to explore\. draw an area to narrow the homes shown/i)).toBeInTheDocument();

        view.rerender(
            <PropertyMapView
                activeListingNumber={null}
                listings={[first, second]}
                onActiveListingChange={vi.fn()}
                onAskAboutArea={vi.fn()}
                selectedArea={selectedArea([first.listingNumber, second.listingNumber])}
            />,
        );

        await screen.findByText(/2 homes shown on the map/i);
        expect(map.fitBounds).toHaveBeenCalledTimes(fittedCameraCount);
        expect(screen.queryByRole('button', { name: /search this view/i })).not.toBeInTheDocument();
    });

    it('draws, applies, preserves, clears, and restores freehand polygon areas', async () => {
        const user = userEvent.setup();
        vi.stubGlobal('PointerEvent', MouseEvent);
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { polygonConstructor } = setupGoogleMapsMock();
        const onMapAreaChange = vi.fn();
        const inside = makeListing(30, { lat: 42.45, lng: -71.15 });
        const outside = makeListing(31, { lat: 42.3, lng: -71 });
        renderMap([inside, outside], { onMapAreaChange });
        await screen.findByText(/2 homes shown on the map/i);

        await user.click(screen.getByRole('button', { name: /^draw area$/i }));
        const mapCanvas = screen.getByLabelText(/map of matching homes/i);
        vi.spyOn(mapCanvas, 'getBoundingClientRect').mockReturnValue({
            bottom: 100,
            height: 100,
            left: 0,
            right: 100,
            top: 0,
            width: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });
        const drawingSurface = screen.getByRole('region', { name: /draw a map search area/i });
        fireEvent.pointerDown(drawingSurface, { button: 0, clientX: 10, clientY: 10, isPrimary: true, pointerId: 7 });
        fireEvent.pointerMove(drawingSurface, { clientX: 90, clientY: 10, isPrimary: true, pointerId: 7 });
        fireEvent.pointerMove(drawingSurface, { clientX: 90, clientY: 90, isPrimary: true, pointerId: 7 });
        fireEvent.pointerMove(drawingSurface, { clientX: 10, clientY: 90, isPrimary: true, pointerId: 7 });
        fireEvent.pointerUp(drawingSurface, { button: 0, clientX: 10, clientY: 10, isPrimary: true, pointerId: 7 });

        await waitFor(() => expect(onMapAreaChange).toHaveBeenLastCalledWith(expect.objectContaining({
            label: 'Drawn map area',
            geometry: expect.objectContaining({ kind: 'polygon' }),
            listingNumbers: [inside.listingNumber],
            resultCount: 1,
        })));
        const selection = onMapAreaChange.mock.calls.at(-1)?.[0] as MapAreaSelection;
        expect(selection.geometry?.kind === 'polygon' ? selection.geometry.path.length : 0).toBeLessThanOrEqual(64);
        expect(polygonConstructor).toHaveBeenCalledWith(expect.objectContaining({
            fillColor: '#315f5b',
            fillOpacity: 0.08,
            strokeColor: '#315f5b',
        }));
        expect(screen.queryByRole('button', { name: /ask about this area/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/home in this area/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /redraw area/i }));
        expect(screen.getByRole('region', { name: /draw a map search area/i })).toBeInTheDocument();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('region', { name: /draw a map search area/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /clear area/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /clear area/i }));
        expect(onMapAreaChange).toHaveBeenLastCalledWith(null);
        await user.click(screen.getByRole('button', { name: /^undo$/i }));
        expect(onMapAreaChange).toHaveBeenLastCalledWith(expect.objectContaining({
            geometry: expect.objectContaining({ kind: 'polygon' }),
            listingNumbers: [inside.listingNumber],
        }));
    });

    it('keeps polygon handle edits local until Done and cancels without refitting the camera', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { map, polygonInstances } = setupGoogleMapsMock();
        const onMapAreaChange = vi.fn();
        const listing = makeListing(40, { lat: 42.45, lng: -71.15 });
        const geometry = {
            kind: 'polygon' as const,
            path: [
                { lat: 42.49, lng: -71.19 },
                { lat: 42.49, lng: -71.11 },
                { lat: 42.41, lng: -71.11 },
                { lat: 42.41, lng: -71.19 },
            ],
            bounds: { north: 42.49, east: -71.11, south: 42.41, west: -71.19 },
        };
        renderMap([listing], {
            selectedArea: {
                label: 'Shared drawn area',
                bounds: geometry.bounds,
                geometry,
                listingNumbers: [listing.listingNumber],
                resultCount: 1,
                coverage: { eligibleCount: 1, attemptedCount: 1, mappedCount: 1, isLimited: false },
            },
            onMapAreaChange,
        });
        await screen.findByText(/1 home shown on the map/i);

        await user.click(screen.getByRole('button', { name: /edit area/i }));
        await waitFor(() => expect(polygonInstances.at(-1)?.options).toEqual(expect.objectContaining({ editable: true })));
        const fitCountBeforeEdit = map.fitBounds.mock.calls.length;
        const editablePolygon = polygonInstances.at(-1);
        editablePolygon?.getPath().setPoints([
            { lat: 42.48, lng: -71.18 },
            { lat: 42.48, lng: -71.12 },
            { lat: 42.42, lng: -71.12 },
            { lat: 42.42, lng: -71.18 },
        ]);
        act(() => editablePolygon?.getPath().trigger('set_at'));
        expect(onMapAreaChange).not.toHaveBeenCalled();
        expect(map.fitBounds).toHaveBeenCalledTimes(fitCountBeforeEdit);
        expect(screen.getByRole('button', { name: /redraw area/i })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /done editing/i }));
        expect(onMapAreaChange).toHaveBeenLastCalledWith(expect.objectContaining({
            geometry: expect.objectContaining({
                kind: 'polygon',
                bounds: { north: 42.48, east: -71.12, south: 42.42, west: -71.18 },
            }),
        }));
        expect(map.fitBounds).toHaveBeenCalledTimes(fitCountBeforeEdit);

        await user.click(screen.getByRole('button', { name: /edit area/i }));
        const secondEditablePolygon = polygonInstances.at(-1);
        secondEditablePolygon?.getPath().setPoints([
            { lat: 42.47, lng: -71.17 },
            { lat: 42.47, lng: -71.13 },
            { lat: 42.43, lng: -71.13 },
            { lat: 42.43, lng: -71.17 },
        ]);
        act(() => secondEditablePolygon?.getPath().trigger('set_at'));
        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onMapAreaChange).toHaveBeenCalledTimes(1);
        expect(map.fitBounds).toHaveBeenCalledTimes(fitCountBeforeEdit);
    });

    it('uses one React selected-home card and never opens an InfoWindow', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { advancedMarkers } = setupGoogleMapsMock();
        const onActiveListingChange = vi.fn();
        const onOpenListing = vi.fn();
        const onToggleSaved = vi.fn();
        const onToggleCompared = vi.fn();
        const listing = makeListing(50);
        const view = renderMap([listing], {
            comparedListingNumbers: [listing.listingNumber],
            onActiveListingChange,
            onOpenListing,
            onToggleCompared,
            onToggleSaved,
            savedListingNumbers: [listing.listingNumber],
        });
        await waitFor(() => expect(advancedMarkers).toHaveLength(1));
        vi.spyOn(screen.getByLabelText(/map of matching homes/i), 'getBoundingClientRect').mockReturnValue({
            bottom: 600,
            height: 600,
            left: 0,
            right: 900,
            top: 0,
            width: 900,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        const markerContent = advancedMarkers[0].options.content as HTMLElement;
        expect(markerContent.tagName).toBe('SPAN');
        expect(markerContent).toHaveAttribute('aria-hidden', 'true');
        expect(advancedMarkers[0].options.title).toBe(`Show ${listing.address.line}, ${listing.address.town}, ${listing.address.state}, ${listing.address.zip}`);

        act(() => advancedMarkers[0].listeners.get('gmp-click')?.());
        expect(onActiveListingChange).toHaveBeenCalledWith(listing.listingNumber);
        view.rerender(
            <PropertyMapView
                activeListingNumber={listing.listingNumber}
                comparedListingNumbers={[listing.listingNumber]}
                listings={[listing]}
                onActiveListingChange={onActiveListingChange}
                onAskAboutArea={vi.fn()}
                onOpenListing={onOpenListing}
                onToggleCompared={onToggleCompared}
                onToggleSaved={onToggleSaved}
                savedListingNumbers={[listing.listingNumber]}
            />,
        );

        const card = await screen.findByRole('article', { name: /selected home:/i });
        await waitFor(() => expect(card).toHaveFocus());
        expect(card).toHaveTextContent(listing.priceLabel);
        expect(card).toHaveTextContent('Active');
        expect(card).toHaveTextContent('3 beds');
        expect(card).toHaveTextContent('2f;1h baths');
        expect(card).toHaveTextContent('1,800 sq ft');
        expect(card).toHaveTextContent(/Avery Agent.*Beacon Office.*MLS PIN/);
        expect(card).toHaveTextContent(/2 photos.*1 open house/);
        expect(screen.getByRole('img', { name: new RegExp(listing.address.line, 'i') })).toBeInTheDocument();
        expect(window.google?.maps).not.toHaveProperty('InfoWindow');
        await waitFor(() => expect(card).toHaveAttribute('data-anchor-side', 'right'));
        expect(card.getAttribute('style')).toContain('--map-card-left');

        await user.click(screen.getByRole('button', { name: /^saved$/i }));
        expect(onToggleSaved).toHaveBeenCalledWith(listing.listingNumber);
        expect(screen.getByRole('button', { name: /^saved$/i })).toHaveAttribute('aria-pressed', 'true');
        await user.click(screen.getByRole('button', { name: /^in comparison$/i }));
        expect(onToggleCompared).toHaveBeenCalledWith(listing.listingNumber);
        expect(screen.getByRole('button', { name: /^in comparison$/i })).toHaveAttribute('aria-pressed', 'true');

        await user.click(screen.getByRole('button', { name: /^details$/i }));
        expect(onOpenListing).toHaveBeenCalledWith(listing);
        await user.click(screen.getByRole('button', { name: /dismiss selected home/i }));
        expect(onActiveListingChange).toHaveBeenLastCalledWith(null);
        await waitFor(() => expect(advancedMarkers[0].focus).toHaveBeenCalledWith({ preventScroll: true }));
    });

    it('clears a settled selected map home when filters remove it from displayed results', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        setupGoogleMapsMock();
        const listing = makeListing(55);
        const onActiveListingChange = vi.fn();
        const view = renderMap([listing], {
            activeListingNumber: listing.listingNumber,
            onActiveListingChange,
        });

        await screen.findByText(/1 home shown on the map/i);
        expect(onActiveListingChange).not.toHaveBeenCalledWith(null);
        view.rerender(
            <PropertyMapView
                activeListingNumber={listing.listingNumber}
                listings={[]}
                onActiveListingChange={onActiveListingChange}
                onAskAboutArea={vi.fn()}
            />,
        );

        await waitFor(() => expect(onActiveListingChange).toHaveBeenCalledWith(null));
    });

    it('keeps preview mode compact with clustering and an expand action', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        setupGoogleMapsMock();
        const onOpenExpanded = vi.fn();
        renderMap([makeListing(60)], { variant: 'preview', onOpenExpanded });

        expect(await screen.findByLabelText(/property map preview/i)).toBeInTheDocument();
        expect(screen.queryByRole('toolbar', { name: /map search tools/i })).not.toBeInTheDocument();
        await waitFor(() => expect(markerClustererHarness.constructor).toHaveBeenCalledTimes(1));
        await user.click(screen.getByRole('button', { name: /open the full map/i }));
        expect(onOpenExpanded).toHaveBeenCalledTimes(1);
    });
});
