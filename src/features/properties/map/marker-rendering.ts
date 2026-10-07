import type { MlsSearchListing } from '@/lib/mls-public-listings';
import styles from '../PropertiesSearch.module.css';

const priceMarkerMinZoom = 13;
const clusterMaxZoom = 19;
const clusterZoomStep = 2;

export function markerLabel(listing: MlsSearchListing) {
    return listing.listPrice ? listing.priceLabel : 'Home';
}

export type MarkerDisplayMode = 'overview' | 'price';

export function markerDisplayModeForZoom(zoom: number | undefined): MarkerDisplayMode {
    return (zoom ?? 10) >= priceMarkerMinZoom ? 'price' : 'overview';
}

export function updateMarkerContent(
    element: HTMLElement,
    listing: MlsSearchListing,
    isActive: boolean,
    variant: 'full' | 'preview',
    displayMode: MarkerDisplayMode,
) {
    const isOverviewMarker = variant === 'full' && displayMode === 'overview' && !isActive;
    element.className = [
        isActive ? styles.mapMarkerActive : styles.mapMarker,
        variant === 'preview' ? styles.mapMarkerPreview : '',
        isOverviewMarker ? styles.mapMarkerOverview : '',
    ].filter(Boolean).join(' ');
    element.textContent = isOverviewMarker ? '' : markerLabel(listing);
    element.setAttribute('aria-hidden', 'true');
}

export function markerContent(
    listing: MlsSearchListing,
    isActive: boolean,
    variant: 'full' | 'preview',
    displayMode: MarkerDisplayMode,
) {
    const element = document.createElement('span');
    updateMarkerContent(element, listing, isActive, variant, displayMode);
    return element;
}

type IdleWindow = Window & typeof globalThis & {
    cancelIdleCallback?: (handle: number) => void;
    requestIdleCallback?: (
        callback: () => void,
        options?: Readonly<{ timeout: number }>,
    ) => number;
};

export function scheduleMapWork(callback: () => void) {
    const browserWindow = window as IdleWindow;
    if (browserWindow.requestIdleCallback && browserWindow.cancelIdleCallback) {
        const handle = browserWindow.requestIdleCallback(callback, { timeout: 120 });
        return () => browserWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(callback, 0);
    return () => window.clearTimeout(handle);
}

export function createBrandedClusterRenderer() {
    return {
        render: (cluster: Readonly<{ count: number; position: unknown }>) => {
            const AdvancedMarker = window.google?.maps.marker?.AdvancedMarkerElement;
            if (!AdvancedMarker) {
                throw new Error('Advanced map markers are unavailable.');
            }

            const content = document.createElement('span');
            content.className = styles.mapClusterMarker;
            const visualLabel = document.createElement('span');
            visualLabel.className = styles.mapClusterMarkerLabel;
            visualLabel.setAttribute('aria-hidden', 'true');
            visualLabel.textContent = cluster.count >= 1000
                ? `${(cluster.count / 1000).toFixed(cluster.count >= 10_000 ? 0 : 1)}K`
                : cluster.count.toLocaleString('en-US');
            content.appendChild(visualLabel);
            content.setAttribute(
                'aria-label',
                `${cluster.count.toLocaleString('en-US')} homes in this area. Zoom in to see individual homes.`,
            );

            return new AdvancedMarker({
                content,
                gmpClickable: true,
                position: cluster.position,
                title: `${cluster.count.toLocaleString('en-US')} homes`,
                zIndex: 1000 + cluster.count,
            });
        },
    };
}

export function handleProgressiveClusterClick(
    _event: unknown,
    cluster: Readonly<{ bounds?: unknown; position: unknown }>,
    map: Readonly<{
        fitBounds?: (bounds: unknown) => void;
        getZoom?: () => number | undefined;
        setCenter?: (center: unknown) => void;
        setZoom?: (zoom: number) => void;
    }>,
) {
    const currentZoom = map.getZoom?.();
    if (typeof currentZoom === 'number' && map.setCenter && map.setZoom) {
        map.setCenter(cluster.position);
        map.setZoom(Math.min(clusterMaxZoom + 1, Math.round(currentZoom) + clusterZoomStep));
        return;
    }

    if (cluster.bounds) {
        map.fitBounds?.(cluster.bounds);
    }
}
