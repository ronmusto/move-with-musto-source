'use client';

import {
    useCallback,
    useEffect,
    useEffectEvent,
    useMemo,
    useRef,
    useState,
    type WheelEvent as ReactWheelEvent,
} from 'react';
import {
    type MlsSearchListing,
    type MlsSearchManifest,
} from '@/lib/mls-public-listings';
import { preferredServiceAreaLabel } from '@/lib/market-regions';
import {
    geometryFromBounds,
    geometryFromPolygon,
    pointInsideMapArea,
    type MapAreaGeometry,
    type MapSearchBounds,
    type MapSearchPoint,
} from './property-map-geometry';
import {
    loadGoogleMaps, mapConfig, mapScriptId,
    type GoogleMap, type GoogleMapsListener,
    type GoogleProjectionOverlay, type GooglePolygon, type GoogleBounds,
} from './map/google-maps';
import {
    markerDisplayModeForZoom,
    type MarkerDisplayMode,
} from './map/marker-rendering';
import { useListingCoordinates, type ResolvedListing } from './map/use-listing-coordinates';
import { MapMarkerController } from './map/marker-controller';
import { SelectedMapListing, type MapCardAnchor } from './map/SelectedMapListing';
import styles from './PropertiesSearch.module.css';

export type { MapAreaGeometry, MapSearchBounds, MapSearchPoint } from './property-map-geometry';

export type MapSearchContext = Readonly<{
    label: string;
    bounds?: MapSearchBounds;
    geometry?: MapAreaGeometry;
    listingNumbers: string[];
}>;

export type MapCameraState = Readonly<{
    center: MapSearchPoint;
    zoom: number;
}>;

export type MapAreaSelection = Readonly<{
    label: string;
    /** Retained for existing links and consumers. Prefer geometry for new work. */
    bounds: MapSearchBounds;
    geometry?: MapAreaGeometry;
    listingNumbers: string[];
    resultCount: number;
    coverage: Readonly<{
        eligibleCount: number;
        attemptedCount: number;
        mappedCount: number;
        isLimited: boolean;
    }>;
}>;

export type PropertyMapViewProps = Readonly<{
    listings: MlsSearchListing[];
    activeListingNumber: string | null;
    coordinateIndexManifest?: MlsSearchManifest | null;
    coordinateIndexUrl?: string;
    selectedArea?: MapAreaSelection | null;
    savedListingNumbers?: readonly string[];
    comparedListingNumbers?: readonly string[];
    camera?: MapCameraState | null;
    /** Keeps the mounted map stable while its containing workspace is hidden. */
    isActive?: boolean;
    variant?: 'full' | 'preview';
    onActiveListingChange: (listingNumber: string | null) => void;
    onMapAreaChange?: (selection: MapAreaSelection | null) => void;
    onCameraChange?: (camera: MapCameraState) => void;
    onAskAboutArea: (listings: MlsSearchListing[], context: MapSearchContext) => void;
    onOpenListing?: (listing: MlsSearchListing) => void;
    onToggleSaved?: (listingNumber: string) => void;
    onToggleCompared?: (listingNumber: string) => void;
    onOpenExpanded?: () => void;
    onMapUnavailable?: () => void;
}>;

type GeometrySnapshot = Readonly<{
    geometry: MapAreaGeometry | null;
    label: string;
}>;

type DraftPointerSample = Readonly<{
    point: MapSearchPoint;
    x: number;
    y: number;
}>;

const maxGeometryHistory = 20;
const singleListingInitialZoom = 15;
const defaultCenter = { lat: 42.3601, lng: -71.0589 };
function selectedAreaGeometry(selection: MapAreaSelection | null | undefined) {
    if (!selection) {
        return null;
    }

    return selection.geometry ?? geometryFromBounds(selection.bounds);
}

function resolvedListingsInsideGeometry(
    listings: readonly ResolvedListing[],
    geometry: MapAreaGeometry | null,
) {
    return geometry
        ? listings.filter((item) => pointInsideMapArea({ lat: item.lat, lng: item.lng }, geometry))
        : listings;
}

function sameStringArray(first: readonly string[], second: readonly string[]) {
    return first.length === second.length && first.every((item, index) => item === second[index]);
}

function geometryKey(geometry: MapAreaGeometry | null) {
    if (!geometry) {
        return 'none';
    }

    if (geometry.kind === 'bounds') {
        return `bounds:${geometry.bounds.north.toFixed(6)},${geometry.bounds.east.toFixed(6)},${geometry.bounds.south.toFixed(6)},${geometry.bounds.west.toFixed(6)}`;
    }

    return `polygon:${geometry.path
        .map((point) => `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`)
        .join(';')}`;
}

function normalizeCameraState(camera: MapCameraState | null | undefined): MapCameraState | null {
    if (
        !camera ||
        !Number.isFinite(camera.center.lat) ||
        !Number.isFinite(camera.center.lng) ||
        !Number.isFinite(camera.zoom)
    ) {
        return null;
    }

    return {
        center: {
            lat: Math.round(Math.max(-90, Math.min(90, camera.center.lat)) * 1_000_000) / 1_000_000,
            lng: Math.round(Math.max(-180, Math.min(180, camera.center.lng)) * 1_000_000) / 1_000_000,
        },
        zoom: Math.round(Math.max(3, Math.min(22, camera.zoom)) * 100) / 100,
    };
}

function cameraKey(camera: MapCameraState | null) {
    return camera
        ? `${camera.center.lat.toFixed(6)},${camera.center.lng.toFixed(6)},${camera.zoom.toFixed(2)}`
        : 'none';
}

export function PropertyMapView({
    listings,
    activeListingNumber,
    coordinateIndexManifest = null,
    coordinateIndexUrl,
    selectedArea = null,
    savedListingNumbers = [],
    comparedListingNumbers = [],
    camera = null,
    isActive = true,
    variant = 'full',
    onActiveListingChange,
    onMapAreaChange,
    onCameraChange,
    onAskAboutArea,
    onOpenListing,
    onToggleSaved,
    onToggleCompared,
    onOpenExpanded,
    onMapUnavailable,
}: PropertyMapViewProps) {
    const { apiKey, mapId } = mapConfig();
    const isPreview = variant === 'preview';
    const mapElementRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<GoogleMap | null>(null);
    const initialCameraRef = useRef<MapCameraState | null>(normalizeCameraState(camera));
    const projectionOverlayRef = useRef<GoogleProjectionOverlay | null>(null);
    const polygonRef = useRef<GooglePolygon | null>(null);
    const mapListenersRef = useRef<GoogleMapsListener[]>([]);
    const [markerController] = useState(() => new MapMarkerController());
    const activeListingNumberRef = useRef(activeListingNumber);
    const onActiveListingChangeRef = useRef(onActiveListingChange);
    const onCameraChangeRef = useRef(onCameraChange);
    const hasFitInitialListingsRef = useRef(false);
    const ignoreCameraEventsUntilRef = useRef(0);
    const isApplyingControlledCameraRef = useRef(false);
    const lastEmittedCameraKeyRef = useRef<string | null>(
        initialCameraRef.current ? cameraKey(initialCameraRef.current) : null,
    );
    const drawingPointerIdRef = useRef<number | null>(null);
    const draftPointerSamplesRef = useRef<DraftPointerSample[]>([]);
    const geometryHistoryRef = useRef<GeometrySnapshot[]>([]);
    const editBaselineRef = useRef<GeometrySnapshot | null>(null);
    const editDraftGeometryRef = useRef<MapAreaGeometry | null>(null);
    const lastPublishedGeometryKeyRef = useRef<string | null>(null);
    const lastSeenSelectedGeometryKeyRef = useRef<string | null>(null);
    const selectedCardRef = useRef<HTMLElement | null>(null);
    const [mapState, setMapState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
        apiKey && mapId ? 'idle' : 'error',
    );
    const [mapLoadAttempt, setMapLoadAttempt] = useState(0);
    const [markerDisplayMode, setMarkerDisplayMode] = useState<MarkerDisplayMode>(() => (
        markerDisplayModeForZoom(initialCameraRef.current?.zoom)
    ));
    const [activeGeometry, setActiveGeometry] = useState<MapAreaGeometry | null>(() => (
        selectedAreaGeometry(selectedArea)
    ));
    const [activeMapLabel, setActiveMapLabel] = useState(selectedArea?.label ?? 'Selected map area');
    const [drawMode, setDrawMode] = useState<'idle' | 'draw' | 'edit'>('idle');
    const [draftPointerSamples, setDraftPointerSamples] = useState<DraftPointerSample[]>([]);
    const [drawingNotice, setDrawingNotice] = useState('');
    const [historyVersion, setHistoryVersion] = useState(0);
    const [cameraVersion, setCameraVersion] = useState(0);
    const [selectedCardAnchor, setSelectedCardAnchor] = useState<MapCardAnchor | null>(null);
    const [failedPhotoListingNumbers, setFailedPhotoListingNumbers] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const {
        resolvedListings, isCoordinateIndexPending, isCoordinateIndexFailed, retryCoordinates,
    } = useListingCoordinates(listings, coordinateIndexManifest, coordinateIndexUrl);
    const displayedResolvedListings = useMemo(
        () => resolvedListingsInsideGeometry(resolvedListings, activeGeometry),
        [activeGeometry, resolvedListings],
    );
    const activeMarkerListingsRef = useRef(displayedResolvedListings);
    useEffect(() => {
        if (isActive) {
            activeMarkerListingsRef.current = displayedResolvedListings;
        }
    }, [displayedResolvedListings, isActive]);
    const markerResolvedListings = isActive
        ? displayedResolvedListings
        : activeMarkerListingsRef.current;
    const displayedMarkerSetKey = useMemo(
        () => markerResolvedListings
            .map(({ listing, lat, lng }) => [
                listing.listingNumber,
                lat.toFixed(6),
                lng.toFixed(6),
                listing.listPrice ? 1 : 0,
                listing.priceLabel,
                listing.status.label,
                listing.address.line,
                listing.address.town,
                listing.address.state,
                listing.address.zip,
                listing.photoCount,
                listing.openHouseCount,
                listing.hasVirtualTour ? 1 : 0,
            ].join(':'))
            .sort()
            .join('|'),
        [markerResolvedListings],
    );
    const readMarkerSnapshot = useEffectEvent(() => ({
        listings: markerResolvedListings,
        geometry: activeGeometry,
    }));
    const activeListing = useMemo(
        () => displayedResolvedListings.find((item) => (
            item.listing.listingNumber === activeListingNumber
        ))?.listing ?? null,
        [activeListingNumber, displayedResolvedListings],
    );
    const activeResolvedListing = useMemo(
        () => displayedResolvedListings.find((item) => (
            item.listing.listingNumber === activeListingNumber
        )) ?? null,
        [activeListingNumber, displayedResolvedListings],
    );
    useEffect(() => {
        if (!activeListingNumber || isCoordinateIndexPending) {
            return;
        }

        const selectionStillVisible = displayedResolvedListings.some((item) => (
            item.listing.listingNumber === activeListingNumber
        ));
        if (!selectionStillVisible) {
            onActiveListingChange(null);
        }
    }, [
        activeListingNumber,
        displayedResolvedListings,
        isCoordinateIndexPending,
        onActiveListingChange,
    ]);
    const isCoverageLimited = resolvedListings.length < listings.length;
    const coverageLabel = isCoordinateIndexPending
        ? 'Loading homes on the map.'
        : isCoordinateIndexFailed
            ? 'Home locations could not refresh. The map is available without listing pins.'
            : mapState === 'ready'
                ? `${resolvedListings.length.toLocaleString('en-US')} ${resolvedListings.length === 1 ? 'home' : 'homes'} shown on the map.`
                : 'Preparing the map.';
    const canUndo = geometryHistoryRef.current.length > 0 && historyVersion >= 0;
    activeListingNumberRef.current = activeListingNumber;
    onActiveListingChangeRef.current = onActiveListingChange;
    onCameraChangeRef.current = onCameraChange;

    const areaSelectionFor = useCallback((geometry: MapAreaGeometry, label: string): MapAreaSelection => {
        const insideListings = resolvedListingsInsideGeometry(resolvedListings, geometry);
        return {
            label,
            bounds: geometry.bounds,
            geometry,
            listingNumbers: insideListings.map((item) => item.listing.listingNumber),
            resultCount: insideListings.length,
            coverage: {
                eligibleCount: listings.length,
                attemptedCount: listings.length,
                mappedCount: resolvedListings.length,
                isLimited: isCoverageLimited,
            },
        };
    }, [isCoverageLimited, listings.length, resolvedListings]);

    function pushGeometryHistory(snapshot: GeometrySnapshot) {
        geometryHistoryRef.current = [
            ...geometryHistoryRef.current.slice(-(maxGeometryHistory - 1)),
            snapshot,
        ];
        setHistoryVersion((version) => version + 1);
    }

    function publishGeometry(
        geometry: MapAreaGeometry | null,
        label: string,
        recordHistory = true,
    ) {
        if (recordHistory) {
            pushGeometryHistory({ geometry: activeGeometry, label: activeMapLabel });
        }
        setActiveGeometry(geometry);
        setActiveMapLabel(label);
        lastPublishedGeometryKeyRef.current = geometryKey(geometry);
        onActiveListingChange(null);
        onMapAreaChange?.(geometry ? areaSelectionFor(geometry, label) : null);
    }

    function pointFromPointer(event: React.PointerEvent<HTMLDivElement>): DraftPointerSample | null {
        const mapElement = mapElementRef.current;
        if (!mapElement) {
            return null;
        }

        const rectangle = mapElement.getBoundingClientRect();
        const x = event.clientX - rectangle.left;
        const y = event.clientY - rectangle.top;
        if (rectangle.width <= 0 || rectangle.height <= 0) {
            return null;
        }

        const Point = window.google?.maps.Point;
        const projection = projectionOverlayRef.current?.getProjection?.();
        const projected = Point && projection
            ? projection.fromContainerPixelToLatLng(new Point(x, y))
            : null;
        if (projected) {
            return {
                point: { lat: projected.lat(), lng: projected.lng() },
                x,
                y,
            };
        }

        const bounds = mapRef.current?.getBounds()?.toJSON();
        if (!bounds) {
            return null;
        }

        return {
            point: {
                lat: bounds.north - ((y / rectangle.height) * (bounds.north - bounds.south)),
                lng: bounds.west + ((x / rectangle.width) * (bounds.east - bounds.west)),
            },
            x,
            y,
        };
    }

    function setDraftSamples(samples: DraftPointerSample[]) {
        draftPointerSamplesRef.current = samples;
        setDraftPointerSamples(samples);
    }

    function beginDrawing() {
        onActiveListingChange(null);
        setDrawMode('draw');
        setDrawingNotice('Use your mouse or finger to outline the area you would like to search.');
        setDraftSamples([]);
    }

    function cancelDrawingMode() {
        drawingPointerIdRef.current = null;
        setDraftSamples([]);
        if (drawMode === 'edit' && editBaselineRef.current) {
            editBaselineRef.current = null;
            editDraftGeometryRef.current = null;
        }
        setDrawMode('idle');
        setDrawingNotice('');
    }

    function finishDrawing() {
        const geometry = geometryFromPolygon(
            draftPointerSamplesRef.current.map((sample) => sample.point),
        );
        drawingPointerIdRef.current = null;
        setDraftSamples([]);
        if (!geometry) {
            setDrawingNotice('Draw a larger shape around the area you would like to search.');
            return;
        }

        publishGeometry(geometry, 'Drawn map area');
        setDrawMode('idle');
        setDrawingNotice('Area applied.');
    }

    function beginEditing() {
        if (activeGeometry?.kind !== 'polygon') {
            return;
        }
        const baseline = { geometry: activeGeometry, label: activeMapLabel };
        editBaselineRef.current = baseline;
        editDraftGeometryRef.current = activeGeometry;
        onActiveListingChange(null);
        setDrawMode('edit');
        setDrawingNotice('Move the outline to adjust your area, then choose Done.');
    }

    function finishEditing() {
        const baseline = editBaselineRef.current;
        const editedGeometry = editDraftGeometryRef.current;
        editBaselineRef.current = null;
        editDraftGeometryRef.current = null;
        setDrawMode('idle');
        if (
            baseline &&
            editedGeometry &&
            geometryKey(editedGeometry) !== geometryKey(baseline.geometry)
        ) {
            publishGeometry(editedGeometry, activeMapLabel);
            setDrawingNotice('Area updated.');
            return;
        }
        setDrawingNotice('Area unchanged.');
    }

    function undoGeometry() {
        const previous = geometryHistoryRef.current.pop();
        if (!previous) {
            return;
        }
        setHistoryVersion((version) => version + 1);
        editBaselineRef.current = null;
        editDraftGeometryRef.current = null;
        setDrawMode('idle');
        setDrawingNotice('Previous map area restored.');
        publishGeometry(previous.geometry, previous.label, false);
    }

    function fitMapBounds(bounds: GoogleBounds | MapSearchBounds) {
        ignoreCameraEventsUntilRef.current = Date.now() + 750;
        mapRef.current?.fitBounds(bounds);
    }

    useEffect(() => {
        setActiveGeometry(selectedAreaGeometry(selectedArea));
        setActiveMapLabel(selectedArea?.label ?? 'Selected map area');
    }, [selectedArea]);

    useEffect(() => {
        if (!apiKey || !mapId || !mapElementRef.current || mapRef.current) {
            return;
        }

        let cancelled = false;
        setMapState('loading');
        loadGoogleMaps(apiKey)
            .then((googleMaps) => {
                if (cancelled || !mapElementRef.current) {
                    return;
                }

                const initialCamera = initialCameraRef.current;
                const map = new googleMaps.maps.Map(mapElementRef.current, {
                    center: initialCamera?.center ?? defaultCenter,
                    clickableIcons: !isPreview,
                    disableDefaultUI: isPreview,
                    gestureHandling: isPreview ? 'none' : 'cooperative',
                    keyboardShortcuts: !isPreview,
                    mapId,
                    streetViewControl: false,
                    fullscreenControl: false,
                    mapTypeControl: false,
                    zoom: initialCamera?.zoom ?? 10,
                });
                mapRef.current = map;
                if (initialCamera) {
                    hasFitInitialListingsRef.current = true;
                }

                const projectionOverlay = new googleMaps.maps.OverlayView();
                projectionOverlay.onAdd = () => undefined;
                projectionOverlay.draw = () => setCameraVersion((version) => version + 1);
                projectionOverlay.onRemove = () => undefined;
                projectionOverlay.setMap(map);
                projectionOverlayRef.current = projectionOverlay;

                if (!isPreview && map.addListener) {
                    mapListenersRef.current = [
                        map.addListener('dragend', () => {
                            if (Date.now() < ignoreCameraEventsUntilRef.current) {
                                return;
                            }
                            setCameraVersion((version) => version + 1);
                        }),
                        map.addListener('zoom_changed', () => {
                            setMarkerDisplayMode(markerDisplayModeForZoom(map.getZoom?.()));
                            if (Date.now() < ignoreCameraEventsUntilRef.current) {
                                return;
                            }
                            setCameraVersion((version) => version + 1);
                        }),
                        map.addListener('idle', () => {
                            setCameraVersion((version) => version + 1);
                            if (isApplyingControlledCameraRef.current) {
                                isApplyingControlledCameraRef.current = false;
                                return;
                            }

                            const center = map.getCenter?.();
                            const zoom = map.getZoom?.();
                            if (!center || zoom === undefined) {
                                return;
                            }
                            const nextCamera = normalizeCameraState({
                                center: { lat: center.lat(), lng: center.lng() },
                                zoom,
                            });
                            if (!nextCamera) {
                                return;
                            }
                            const nextCameraKey = cameraKey(nextCamera);
                            if (lastEmittedCameraKeyRef.current === nextCameraKey) {
                                return;
                            }
                            lastEmittedCameraKeyRef.current = nextCameraKey;
                            onCameraChangeRef.current?.(nextCamera);
                        }),
                    ];
                }
                setMapState('ready');
            })
            .catch(() => {
                if (!cancelled) {
                    if (mapLoadAttempt < 2) {
                        document.getElementById(mapScriptId)?.remove();
                        window.__moveWithMustoGoogleMapsLoading = undefined;
                        window.setTimeout(() => {
                            if (!cancelled) {
                                setMapState('idle');
                                setMapLoadAttempt((attempt) => attempt + 1);
                            }
                        }, 500 * (mapLoadAttempt + 1));
                        return;
                    }
                    setMapState('error');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [apiKey, isPreview, mapId, mapLoadAttempt]);

    useEffect(() => {
        if (mapState === 'error' && apiKey && mapId) {
            onMapUnavailable?.();
        }
    }, [apiKey, mapId, mapState, onMapUnavailable]);

    useEffect(() => {
        if (isPreview || mapState !== 'ready' || !mapRef.current) {
            return;
        }

        const nextCamera = normalizeCameraState(camera);
        if (!nextCamera) {
            return;
        }
        const nextCameraKey = cameraKey(nextCamera);
        const currentCenter = mapRef.current.getCenter?.();
        const currentZoom = mapRef.current.getZoom?.();
        const currentCamera = currentCenter && currentZoom !== undefined
            ? normalizeCameraState({
                center: { lat: currentCenter.lat(), lng: currentCenter.lng() },
                zoom: currentZoom,
            })
            : null;
        if (cameraKey(currentCamera) === nextCameraKey) {
            return;
        }
        if (!mapRef.current.setCenter || !mapRef.current.setZoom) {
            return;
        }

        isApplyingControlledCameraRef.current = true;
        ignoreCameraEventsUntilRef.current = Date.now() + 750;
        mapRef.current.setCenter(nextCamera.center);
        mapRef.current.setZoom(nextCamera.zoom);
        hasFitInitialListingsRef.current = true;
    }, [camera, isPreview, mapState]);

    useEffect(() => {
        if (!isActive || mapState !== 'ready' || !window.google?.maps || !mapRef.current) {
            return;
        }

        // The full map stays mounted while the mobile drawer is closed. Google
        // can otherwise retain its hidden-container projection and place a pin
        // underneath the toolbar when the drawer becomes visible.
        const frame = window.requestAnimationFrame(() => {
            const map = mapRef.current;
            if (!map) {
                return;
            }
            const center = map.getCenter?.();
            window.google?.maps.event.trigger?.(map, 'resize');
            if (center && map.setCenter) {
                map.setCenter({ lat: center.lat(), lng: center.lng() });
            }
            setCameraVersion((version) => version + 1);
        });

        return () => window.cancelAnimationFrame(frame);
    }, [isActive, mapState]);

    useEffect(() => {
        if (mapState !== 'ready' || !window.google?.maps || !mapRef.current) {
            return;
        }

        polygonRef.current?.setMap(null);
        polygonRef.current = null;
        if (activeGeometry?.kind !== 'polygon') {
            return;
        }

        const polygon = new window.google.maps.Polygon({
            clickable: drawMode === 'edit',
            editable: drawMode === 'edit',
            fillColor: '#315f5b',
            fillOpacity: 0.08,
            map: mapRef.current,
            path: activeGeometry.path,
            strokeColor: '#315f5b',
            strokeOpacity: 0.98,
            strokeWeight: 3,
            zIndex: 2,
        });
        polygonRef.current = polygon;

        if (drawMode !== 'edit') {
            return () => {
                polygon.setMap(null);
                if (polygonRef.current === polygon) {
                    polygonRef.current = null;
                }
            };
        }

        const path = polygon.getPath();
        const recordEditedPath = () => {
            const geometry = geometryFromPolygon(path.getArray().map((point) => ({
                lat: point.lat(),
                lng: point.lng(),
            })));
            if (!geometry) {
                return;
            }
            editDraftGeometryRef.current = geometry;
            setDrawingNotice('Area adjusted. Choose Done to apply it.');
        };
        const listeners = [
            path.addListener('insert_at', recordEditedPath),
            path.addListener('remove_at', recordEditedPath),
            path.addListener('set_at', recordEditedPath),
        ];

        return () => {
            listeners.forEach((listener) => listener.remove());
            polygon.setMap(null);
            if (polygonRef.current === polygon) {
                polygonRef.current = null;
            }
        };
    }, [activeGeometry, drawMode, mapState]);

    useEffect(() => {
        if (mapState !== 'ready' || !mapRef.current || editBaselineRef.current) {
            return;
        }

        if (!selectedArea) {
            lastSeenSelectedGeometryKeyRef.current = null;
            return;
        }

        const selectedGeometryKey = geometryKey(selectedAreaGeometry(selectedArea));
        if (lastSeenSelectedGeometryKeyRef.current === selectedGeometryKey) {
            return;
        }
        lastSeenSelectedGeometryKeyRef.current = selectedGeometryKey;
        if (lastPublishedGeometryKeyRef.current === selectedGeometryKey) {
            lastPublishedGeometryKeyRef.current = null;
            hasFitInitialListingsRef.current = true;
            return;
        }

        fitMapBounds(selectedArea.bounds);
        hasFitInitialListingsRef.current = true;
    }, [mapState, selectedArea]);

    useEffect(() => {
        if (mapState !== 'ready' || !window.google?.maps || !mapRef.current) {
            return;
        }

        // A fresh parent array must not cancel an incomplete marker batch.
        const { listings: markerResolvedListings, geometry: activeGeometry } = readMarkerSnapshot();
        markerController.reconcile(
            mapRef.current, markerResolvedListings, variant, markerDisplayMode,
            () => activeListingNumberRef.current,
            (listingNumber) => onActiveListingChangeRef.current(listingNumber),
        );
        const bounds = new window.google.maps.LatLngBounds();
        markerResolvedListings.forEach((item) => bounds.extend({ lat: item.lat, lng: item.lng }));

        if (
            markerResolvedListings.length > 0 &&
            !activeListingNumberRef.current &&
            !activeGeometry &&
            !hasFitInitialListingsRef.current
        ) {
            const onlyListing = markerResolvedListings.length === 1
                ? markerResolvedListings[0]
                : null;
            if (onlyListing && mapRef.current.setCenter && mapRef.current.setZoom) {
                ignoreCameraEventsUntilRef.current = Date.now() + 750;
                mapRef.current.setCenter({ lat: onlyListing.lat, lng: onlyListing.lng });
                mapRef.current.setZoom(singleListingInitialZoom);
            } else {
                fitMapBounds(bounds);
            }
            hasFitInitialListingsRef.current = true;
        }

        return () => markerController.cancelPending();
    }, [
        displayedMarkerSetKey,
        markerController,
        isPreview,
        markerDisplayMode,
        mapState,
        variant,
    ]);

    useEffect(() => {
        markerController.updateSelection(activeListingNumber, variant, markerDisplayMode);
    }, [activeListingNumber, markerController, markerDisplayMode, variant]);

    useEffect(() => {
        if (!activeListing || drawMode !== 'idle') {
            return;
        }

        const focusHandle = window.setTimeout(() => {
            selectedCardRef.current?.focus({ preventScroll: true });
        }, 0);
        return () => window.clearTimeout(focusHandle);
    }, [activeListing, drawMode]);

    useEffect(() => {
        const mapElement = mapElementRef.current;
        const projection = projectionOverlayRef.current?.getProjection?.();
        if (!activeResolvedListing || !mapElement || !projection) {
            setSelectedCardAnchor(null);
            return;
        }

        const pixel = projection.fromLatLngToContainerPixel({
            lat: activeResolvedListing.lat,
            lng: activeResolvedListing.lng,
        });
        const rectangle = mapElement.getBoundingClientRect();
        if (!pixel || rectangle.width <= 0 || rectangle.height <= 0) {
            setSelectedCardAnchor(null);
            return;
        }

        const cardWidth = Math.min(360, Math.max(240, rectangle.width - 32));
        const cardHeight = Math.min(300, Math.max(180, rectangle.height - 32));
        const gap = 18;
        const canAnchorRight = pixel.x + gap + cardWidth <= rectangle.width - 16;
        const side = canAnchorRight ? 'right' : 'left';
        const preferredLeft = canAnchorRight
            ? pixel.x + gap
            : pixel.x - gap - cardWidth;
        setSelectedCardAnchor({
            left: Math.max(16, Math.min(rectangle.width - cardWidth - 16, preferredLeft)),
            side,
            top: Math.max(16, Math.min(rectangle.height - cardHeight - 16, pixel.y - (cardHeight / 2))),
        });
    }, [activeResolvedListing, cameraVersion, mapState]);

    useEffect(() => {
        if (
            isPreview ||
            !selectedArea ||
            !onMapAreaChange ||
            isCoordinateIndexPending ||
            isCoordinateIndexFailed ||
            mapState !== 'ready'
        ) {
            return;
        }

        const geometry = selectedAreaGeometry(selectedArea);
        if (!geometry) {
            return;
        }
        const selection = areaSelectionFor(geometry, selectedArea.label);
        const coverageMatches =
            selection.coverage.eligibleCount === selectedArea.coverage.eligibleCount &&
            selection.coverage.attemptedCount === selectedArea.coverage.attemptedCount &&
            selection.coverage.mappedCount === selectedArea.coverage.mappedCount &&
            selection.coverage.isLimited === selectedArea.coverage.isLimited;
        if (
            selection.resultCount !== selectedArea.resultCount ||
            !sameStringArray(selection.listingNumbers, selectedArea.listingNumbers) ||
            !coverageMatches
        ) {
            onMapAreaChange(selection);
        }
    }, [
        areaSelectionFor,
        isCoordinateIndexFailed,
        isCoordinateIndexPending,
        isPreview,
        mapState,
        onMapAreaChange,
        resolvedListings,
        selectedArea,
    ]);

    useEffect(() => {
        if (drawMode === 'idle') {
            return;
        }

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            cancelDrawingMode();
        };
        document.addEventListener('keydown', handleEscape, true);
        return () => document.removeEventListener('keydown', handleEscape, true);
    });

    useEffect(() => () => {
        mapListenersRef.current.forEach((listener) => listener.remove());
        mapListenersRef.current = [];
        markerController.dispose();
        polygonRef.current?.setMap(null);
        polygonRef.current = null;
        projectionOverlayRef.current?.setMap(null);
        projectionOverlayRef.current = null;
        mapRef.current = null;
    }, [markerController]);

    function retryMap() {
        document.getElementById(mapScriptId)?.remove();
        window.__moveWithMustoGoogleMapsLoading = undefined;
        mapListenersRef.current.forEach((listener) => listener.remove());
        mapListenersRef.current = [];
        markerController.dispose();
        projectionOverlayRef.current?.setMap(null);
        projectionOverlayRef.current = null;
        mapRef.current = null;
        hasFitInitialListingsRef.current = false;
        lastSeenSelectedGeometryKeyRef.current = null;
        setMapState('idle');
        setMapLoadAttempt((attempt) => attempt + 1);
    }

    function dismissSelectedListing() {
        const markerToRestore = markerController.selectedMarker();
        onActiveListingChange(null);
        window.setTimeout(() => {
            markerToRestore?.focus?.({ preventScroll: true });
        }, 0);
    }

    function passUnconsumedMapWheelToPage(event: ReactWheelEvent<HTMLDivElement>) {
        if (event.ctrlKey || event.metaKey || event.deltaY === 0) {
            return;
        }

        const scrollStart = window.scrollY;
        const unit = event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
                ? window.innerHeight
                : 1;
        const scrollDistance = event.deltaY * unit;

        window.requestAnimationFrame(() => {
            if (Math.abs(window.scrollY - scrollStart) < 1) {
                window.scrollBy({ top: scrollDistance, behavior: 'auto' });
            }
        });
    }

    if (!apiKey || !mapId) {
        if (isPreview) {
            return (
                <div className={styles.mapPreviewFallback} role="status">
                    <strong>Map temporarily unavailable</strong>
                    <span>The listing results are ready while the map reconnects.</span>
                    <button type="button" onClick={onOpenExpanded}>Open map</button>
                </div>
            );
        }

        return (
            <div className={styles.mapFallback} role="status">
                <h3>Map temporarily unavailable</h3>
                <p>The property list is ready to use. Keep browsing or get help with this search.</p>
                <button type="button" onClick={() => onAskAboutArea(listings.slice(0, 5), {
                    label: `${preferredServiceAreaLabel} map temporarily unavailable`,
                    listingNumbers: listings.slice(0, 5).map((listing) => listing.listingNumber),
                })}>
                    Get search help
                </button>
            </div>
        );
    }

    if (mapState === 'error') {
        if (isPreview) {
            return (
                <div className={styles.mapPreviewFallback} role="status">
                    <strong>Map unavailable</strong>
                    <span>The property list is still available while the map reconnects.</span>
                    <button type="button" onClick={retryMap}>Try map again</button>
                </div>
            );
        }

        return (
            <div className={styles.mapFallback} role="status">
                <h3>Map unavailable</h3>
                <p>The property list is still available. Try the map again or get help with this search.</p>
                <button type="button" onClick={retryMap}>Try map again</button>
                <button type="button" onClick={() => onAskAboutArea(listings.slice(0, 5), {
                    label: `${preferredServiceAreaLabel} map unavailable`,
                    listingNumbers: listings.slice(0, 5).map((listing) => listing.listingNumber),
                })}>
                    Get search help
                </button>
            </div>
        );
    }

    if (isPreview) {
        return (
            <div className={[styles.mapPanel, styles.mapPanelPreview].join(' ')}>
                <div className={styles.mapPreviewCanvasFrame}>
                    <div className={styles.mapCanvas} ref={mapElementRef} aria-label="Property map preview" />
                    {mapState === 'loading' || isCoordinateIndexPending ? (
                        <span className={styles.mapPreviewStatus}>Loading map</span>
                    ) : null}
                    <span className={styles.mapPreviewCoverage}>{coverageLabel}</span>
                    <button className={styles.mapPreviewOpenButton} onClick={onOpenExpanded} type="button">
                        Open the full map
                    </button>
                </div>
            </div>
        );
    }

    const shouldShowCoverageStatus = isCoordinateIndexPending || (
        !isCoordinateIndexFailed && mapState !== 'ready'
    );

    return (
        <div className={styles.mapPanel}>
            <div aria-label="Map search tools" className={styles.mapToolbar} role="toolbar">
                <p className={styles.mapExploreGuidance}>
                    Pan to explore. Draw an area to narrow the homes shown.
                </p>
                <div className={styles.mapToolbarAreaActions}>
                    {activeGeometry?.kind === 'polygon' ? (
                        <button
                            aria-label={drawMode === 'edit' ? 'Done editing' : 'Edit area'}
                            disabled={
                                mapState !== 'ready' ||
                                isCoordinateIndexPending ||
                                isCoordinateIndexFailed ||
                                drawMode === 'draw'
                            }
                            onClick={drawMode === 'edit' ? finishEditing : beginEditing}
                            type="button"
                        >
                            {drawMode === 'edit' ? 'Done' : 'Edit area'}
                        </button>
                    ) : null}
                    <button
                        aria-label={activeGeometry?.kind === 'polygon' ? 'Redraw area' : 'Draw area'}
                        disabled={
                            mapState !== 'ready' ||
                            isCoordinateIndexPending ||
                            isCoordinateIndexFailed ||
                            drawMode !== 'idle'
                        }
                        onClick={beginDrawing}
                        type="button"
                    >
                        {activeGeometry?.kind === 'polygon' ? 'Redraw' : 'Draw area'}
                    </button>
                    {activeGeometry ? (
                        <button
                            aria-label="Clear area"
                            disabled={drawMode !== 'idle'}
                            onClick={() => publishGeometry(null, 'Selected map area')}
                            type="button"
                        >
                            Clear
                        </button>
                    ) : null}
                    {canUndo ? (
                        <button disabled={drawMode !== 'idle'} onClick={undoGeometry} type="button">
                            Undo
                        </button>
                    ) : null}
                    {drawMode !== 'idle' ? (
                        <button aria-label="Cancel drawing" onClick={cancelDrawingMode} type="button">Cancel</button>
                    ) : null}
                </div>
                <span className={styles.mapDrawingStatus} id="map-drawing-instructions" role="status">
                    {drawingNotice}
                </span>
            </div>

            <p
                className={shouldShowCoverageStatus ? styles.mapCoverage : styles.visuallyHidden}
                role="status"
            >
                {coverageLabel}
            </p>
            {isCoordinateIndexFailed ? (
                <div className={styles.mapCoordinateNotice} role="status">
                    <span>Home locations could not refresh. The map and full property list are still available.</span>
                    <button
                        onClick={retryCoordinates}
                        type="button"
                    >
                        Refresh locations
                    </button>
                </div>
            ) : null}

            <div className={styles.mapShell}>
                <div className={styles.mapCanvasFrame} onWheelCapture={passUnconsumedMapWheelToPage}>
                    <div className={styles.mapCanvas} ref={mapElementRef} aria-label="Map of matching homes" />
                    {drawMode === 'draw' ? (
                        <div
                            aria-describedby="map-drawing-instructions"
                            aria-label="Draw a map search area"
                            className={styles.mapDrawingSurface}
                            onPointerCancel={() => {
                                drawingPointerIdRef.current = null;
                                setDraftSamples([]);
                            }}
                            onPointerDown={(event) => {
                                if (event.isPrimary === false || event.button > 0) {
                                    return;
                                }
                                const sample = pointFromPointer(event);
                                if (!sample) {
                                    return;
                                }
                                drawingPointerIdRef.current = event.pointerId;
                                event.currentTarget.setPointerCapture?.(event.pointerId);
                                setDraftSamples([sample]);
                                setDrawingNotice('Keep drawing, then release to apply the area.');
                            }}
                            onPointerMove={(event) => {
                                if (drawingPointerIdRef.current !== event.pointerId) {
                                    return;
                                }
                                const sample = pointFromPointer(event);
                                const previous = draftPointerSamplesRef.current.at(-1);
                                if (!sample || (previous && Math.hypot(sample.x - previous.x, sample.y - previous.y) < 3)) {
                                    return;
                                }
                                setDraftSamples([...draftPointerSamplesRef.current, sample]);
                            }}
                            onPointerUp={(event) => {
                                if (drawingPointerIdRef.current !== event.pointerId) {
                                    return;
                                }
                                const sample = pointFromPointer(event);
                                if (sample) {
                                    draftPointerSamplesRef.current = [...draftPointerSamplesRef.current, sample];
                                }
                                event.currentTarget.releasePointerCapture?.(event.pointerId);
                                finishDrawing();
                            }}
                            role="region"
                            style={{ cursor: 'crosshair', inset: 0, position: 'absolute', touchAction: 'none', zIndex: 4 }}
                            tabIndex={0}
                        >
                            <svg aria-hidden="true" className={styles.mapDrawingPreview} focusable="false">
                                <polyline
                                    fill="rgba(49, 95, 91, 0.08)"
                                    points={draftPointerSamples.map((sample) => `${sample.x},${sample.y}`).join(' ')}
                                    stroke="#315f5b"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="3"
                                />
                            </svg>
                        </div>
                    ) : null}
                    {activeListing && drawMode === 'idle' ? (
                        <SelectedMapListing
                            activeListing={activeListing}
                            selectedCardRef={selectedCardRef}
                            selectedCardAnchor={selectedCardAnchor}
                            isPhotoFailed={failedPhotoListingNumbers.has(activeListing.listingNumber)}
                            isActiveListingSaved={savedListingNumbers.includes(activeListing.listingNumber)}
                            isActiveListingCompared={comparedListingNumbers.includes(activeListing.listingNumber)}
                            onPhotoError={() => setFailedPhotoListingNumbers((current) => (
                                new Set(current).add(activeListing.listingNumber)
                            ))}
                            dismissSelectedListing={dismissSelectedListing}
                            onToggleSaved={onToggleSaved}
                            onToggleCompared={onToggleCompared}
                            onOpenListing={onOpenListing}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}
