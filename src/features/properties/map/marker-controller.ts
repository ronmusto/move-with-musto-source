import { MarkerClusterer, SuperClusterAlgorithm, type MarkerClustererOptions } from '@googlemaps/markerclusterer';
import type { MlsSearchListing } from '@/lib/mls-public-listings';
import type { GoogleAdvancedMarker, GoogleMap } from './google-maps';
import { listingAddress } from './listing-presentation';
import type { ResolvedListing } from './use-listing-coordinates';
import {
    markerContent, updateMarkerContent, createBrandedClusterRenderer,
    handleProgressiveClusterClick, scheduleMapWork, type MarkerDisplayMode,
} from './marker-rendering';

const markerBatchSize = 250;
const clusterRadiusPixels = 130;
const clusterMaxZoom = 19;

type ClusterMarker = Parameters<MarkerClusterer['addMarker']>[0];

// Our loader exposes only the SDK capabilities this app uses. These are actual
// Google SDK instances; widen them to the vendor's full declaration here, at
// the clustering boundary, rather than pretending they have the `never` type.
function clusterMarker(marker: GoogleAdvancedMarker): ClusterMarker {
    return marker as unknown as ClusterMarker;
}

function listenForMarkerClick(marker: GoogleAdvancedMarker, onClick: () => void) {
    if (marker.addEventListener && marker.removeEventListener) {
        marker.addEventListener('gmp-click', onClick);
        return () => marker.removeEventListener?.('gmp-click', onClick);
    }
    const listener = marker.addListener('click', onClick);
    return () => listener.remove();
}

/** Owns Google marker and cluster resources across a mounted map's lifetime. */
export class MapMarkerController {
    private clusterer: MarkerClusterer | null = null;
    private cancelPendingBatch: (() => void) | null = null;
    private lastSelectedMarker: GoogleAdvancedMarker | null = null;
    private variant: 'full' | 'preview' | null = null;
    private needsRender = false;
    private readonly markers = new Map<string, {
        marker: GoogleAdvancedMarker;
        content: HTMLElement;
        listing: MlsSearchListing;
        lat: number;
        lng: number;
        removeClickListener: () => void;
    }>();

    reconcile(
        map: GoogleMap,
        markerResolvedListings: readonly ResolvedListing[],
        variant: 'full' | 'preview',
        markerDisplayMode: MarkerDisplayMode,
        activeListingNumber: () => string | null,
        onSelect: (listingNumber: string) => void,
    ) {
        // Preview pins are deliberately inert. Recreate them when their mode
        // changes so their clickability and listeners match the new workspace.
        if (this.variant !== null && this.variant !== variant) this.dispose();
        this.variant = variant;
        this.cancelPending();
        const isPreview = variant === 'preview';
        const AdvancedMarker = window.google?.maps.marker?.AdvancedMarkerElement;
        if (!AdvancedMarker) {
            this.dispose();
            return;
        }

        if (!this.clusterer) {
            this.clusterer = new MarkerClusterer({
                algorithm: new SuperClusterAlgorithm({
                    maxZoom: clusterMaxZoom,
                    minPoints: 2,
                    radius: clusterRadiusPixels,
                }),
                map: map as unknown as MarkerClustererOptions['map'],
                markers: [],
                onClusterClick: handleProgressiveClusterClick as unknown as MarkerClustererOptions['onClusterClick'],
                renderer: createBrandedClusterRenderer() as unknown as MarkerClustererOptions['renderer'],
            });
        }
        const clusterer = this.clusterer;
        const desiredListings = new Map(
            markerResolvedListings.map((item) => [item.listing.listingNumber, item]),
        );
        const removedMarkers: GoogleAdvancedMarker[] = [];
        this.markers.forEach((entry, listingNumber) => {
            const desired = desiredListings.get(listingNumber);
            if (!desired || entry.lat !== desired.lat || entry.lng !== desired.lng) {
                entry.removeClickListener();
                entry.marker.map = null;
                if (entry.marker === this.lastSelectedMarker) this.lastSelectedMarker = null;
                removedMarkers.push(entry.marker);
                this.markers.delete(listingNumber);
            }
        });
        if (removedMarkers.length > 0) {
            clusterer.removeMarkers(removedMarkers.map(clusterMarker), true);
            this.needsRender = true;
        }

        const pendingListings: ResolvedListing[] = [];
        markerResolvedListings.forEach((item) => {
            const listingNumber = item.listing.listingNumber;
            const existing = this.markers.get(listingNumber);
            if (existing) {
                existing.listing = item.listing;
                existing.marker.title = `Show ${listingAddress(item.listing)}`;
                updateMarkerContent(
                    existing.content,
                    item.listing,
                    listingNumber === activeListingNumber(),
                    variant,
                    markerDisplayMode,
                );
                return;
            }
            pendingListings.push(item);
        });

        let cancelled = false;
        let cursor = 0;
        const mountNextBatch = () => {
            if (cancelled) {
                return;
            }

            const batch = pendingListings.slice(cursor, cursor + markerBatchSize);
            cursor += batch.length;
            const batchMarkers = batch.map((item) => {
                const listingNumber = item.listing.listingNumber;
                const content = markerContent(
                    item.listing,
                    listingNumber === activeListingNumber(),
                    variant,
                    markerDisplayMode,
                );
                const marker = new AdvancedMarker({
                    gmpClickable: !isPreview,
                    map: null,
                    position: { lat: item.lat, lng: item.lng },
                    title: `Show ${listingAddress(item.listing)}`,
                    content,
                });

                const removeClickListener = isPreview
                    ? () => undefined
                    : listenForMarkerClick(marker, () => {
                        this.lastSelectedMarker = marker;
                        onSelect(listingNumber);
                    });

                this.markers.set(listingNumber, {
                    marker,
                    content,
                    listing: item.listing,
                    lat: item.lat,
                    lng: item.lng,
                    removeClickListener,
                });
                return marker;
            });

            if (batchMarkers.length > 0) {
                clusterer.addMarkers(batchMarkers.map(clusterMarker), true);
                this.needsRender = true;
            }
            if (cursor < pendingListings.length) {
                const cancelScheduledWork = scheduleMapWork(mountNextBatch);
                this.cancelPendingBatch = () => {
                    cancelled = true;
                    cancelScheduledWork();
                };
            } else {
                this.cancelPendingBatch = null;
                // All additions are registered with noDraw=true. Reclustering once
                // at the end avoids dozens of cumulative full-scope passes.
                this.renderChanges(clusterer);
            }
        };

        if (removedMarkers.length > 0 && pendingListings.length > 0) {
            this.renderChanges(clusterer);
        }

        if (pendingListings.length > 0) {
            const cancelScheduledWork = scheduleMapWork(mountNextBatch);
            this.cancelPendingBatch = () => {
                cancelled = true;
                cancelScheduledWork();
            };
        } else {
            // Cancelling a batch can leave retained additions registered with
            // noDraw=true even when this reconciliation adds/removes nothing.
            this.renderChanges(clusterer);
        }

    }

    private renderChanges(clusterer: MarkerClusterer) {
        if (!this.needsRender) return;
        clusterer.render();
        this.needsRender = false;
    }

    updateSelection(activeListingNumber: string | null, variant: 'full' | 'preview', mode: MarkerDisplayMode) {
        this.markers.forEach(({ content, listing }, listingNumber) => {
            updateMarkerContent(content, listing, listingNumber === activeListingNumber, variant, mode);
        });
    }

    selectedMarker() {
        return this.lastSelectedMarker;
    }

    cancelPending() {
        this.cancelPendingBatch?.();
        this.cancelPendingBatch = null;
    }

    dispose() {
        this.cancelPending();
        this.clusterer?.clearMarkers();
        // MarkerClusterer acquires OverlayView methods at runtime; its published
        // TypeScript surface does not declare that inherited cleanup method.
        const overlay = this.clusterer as unknown as { setMap?: (map: null) => void } | null;
        overlay?.setMap?.(null);
        this.clusterer = null;
        this.markers.forEach(({ marker, removeClickListener }) => {
            removeClickListener();
            marker.map = null;
        });
        this.markers.clear();
        this.lastSelectedMarker = null;
        this.variant = null;
        this.needsRender = false;
    }
}
