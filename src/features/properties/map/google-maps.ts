import type { MapSearchBounds, MapSearchPoint } from '../property-map-geometry';

export type GoogleMapsListener = {
    remove: () => void;
};

export type GoogleMapsNamespace = {
    maps: {
        Map: new (element: HTMLElement, options: Record<string, unknown>) => GoogleMap;
        LatLngBounds: new () => GoogleBounds;
        OverlayView: new () => GoogleProjectionOverlay;
        Point: new (x: number, y: number) => GooglePoint;
        Polygon: new (options: Record<string, unknown>) => GooglePolygon;
        event: {
            addListenerOnce: (target: unknown, eventName: string, callback: () => void) => void;
            trigger?: (target: unknown, eventName: string) => void;
        };
        marker?: {
            AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleAdvancedMarker;
        };
        __moveWithMustoReady?: () => void;
    };
};

export type GoogleMap = {
    addListener?: (eventName: string, callback: () => void) => GoogleMapsListener;
    fitBounds: (bounds: GoogleBounds | MapSearchBounds) => void;
    getBounds: () => GoogleBounds | undefined;
    getCenter?: () => GoogleLatLng | undefined;
    getZoom?: () => number | undefined;
    setCenter?: (center: MapSearchPoint) => void;
    setZoom?: (zoom: number) => void;
};

export type GoogleLatLng = {
    lat: () => number;
    lng: () => number;
};

export type GooglePoint = Readonly<{
    x: number;
    y: number;
}>;

export type GoogleBounds = {
    extend: (position: MapSearchPoint) => void;
    toJSON: () => MapSearchBounds;
};

export type GoogleProjection = {
    fromContainerPixelToLatLng: (point: GooglePoint) => GoogleLatLng | null;
    fromLatLngToContainerPixel: (point: MapSearchPoint) => GooglePoint | null;
};

export type GoogleProjectionOverlay = {
    draw: () => void;
    getProjection: () => GoogleProjection;
    onAdd: () => void;
    onRemove: () => void;
    setMap: (map: GoogleMap | null) => void;
};

export type GoogleMvcArray = {
    addListener: (eventName: string, callback: () => void) => GoogleMapsListener;
    getArray: () => GoogleLatLng[];
};

export type GooglePolygon = {
    getPath: () => GoogleMvcArray;
    setEditable: (editable: boolean) => void;
    setMap: (map: GoogleMap | null) => void;
    setPath: (path: readonly MapSearchPoint[]) => void;
};

export type GoogleAdvancedMarker = {
    map: GoogleMap | null;
    content?: HTMLElement;
    title?: string;
    focus?: (options?: FocusOptions) => void;
    addEventListener?: (eventName: string, callback: () => void) => void;
    removeEventListener?: (eventName: string, callback: () => void) => void;
    addListener: (eventName: string, callback: () => void) => GoogleMapsListener;
};

declare global {
    interface Window {
        google?: GoogleMapsNamespace;
        __moveWithMustoGoogleMapsLoading?: Promise<GoogleMapsNamespace>;
    }
}

export const mapScriptId = 'move-with-musto-google-maps';

export function mapConfig() {
    return {
        apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? '',
        mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim() ?? '',
    };
}

export function isGoogleMapsReady(googleMaps: GoogleMapsNamespace | undefined): googleMaps is GoogleMapsNamespace {
    const maps = googleMaps?.maps;
    return Boolean(
        maps &&
        typeof maps.Map === 'function' &&
        typeof maps.LatLngBounds === 'function' &&
        typeof maps.OverlayView === 'function' &&
        typeof maps.Point === 'function' &&
        typeof maps.Polygon === 'function' &&
        typeof maps.event?.addListenerOnce === 'function' &&
        typeof maps.marker?.AdvancedMarkerElement === 'function',
    );
}

export function loadGoogleMaps(apiKey: string) {
    if (typeof window === 'undefined') {
        return Promise.reject(new Error('Google Maps requires a browser.'));
    }

    if (isGoogleMapsReady(window.google)) {
        return Promise.resolve(window.google);
    }

    if (window.__moveWithMustoGoogleMapsLoading) {
        return window.__moveWithMustoGoogleMapsLoading;
    }

    window.__moveWithMustoGoogleMapsLoading = new Promise((resolve, reject) => {
        const googleMaps = window.google ?? ({ maps: {} } as GoogleMapsNamespace);
        window.google = googleMaps;
        const finishLoading = () => {
            if (isGoogleMapsReady(window.google)) {
                resolve(window.google);
            }
        };
        googleMaps.maps.__moveWithMustoReady = finishLoading;
        const existingScript = document.getElementById(mapScriptId) as HTMLScriptElement | null;
        if (existingScript) {
            existingScript.addEventListener('error', () => reject(new Error('Google Maps failed to load.')), { once: true });
            finishLoading();
            return;
        }

        const script = document.createElement('script');
        script.id = mapScriptId;
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=marker&loading=async&callback=google.maps.__moveWithMustoReady`;
        script.onerror = () => reject(new Error('Google Maps failed to load.'));
        document.head.appendChild(script);
    });

    return window.__moveWithMustoGoogleMapsLoading;
}
