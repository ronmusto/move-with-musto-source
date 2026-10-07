'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    isMlsCoordinateIndexReady,
    type MlsCoordinate, type MlsCoordinateIndex, type MlsSearchListing, type MlsSearchManifest,
} from '@/lib/mls-public-listings';

export type ResolvedListing = Readonly<{
    listing: MlsSearchListing;
    lat: number;
    lng: number;
}>;

const emptyCoordinateLookup: Readonly<Record<string, MlsCoordinate>> = Object.freeze({});
const coordinateIndexRequests = new Map<string, Promise<MlsCoordinateIndex>>();

function coordinateIndexRequestKey(url: string, manifest: MlsSearchManifest) {
    return `${url}|${manifest.generatedAt}|${manifest.coordinateIndex.coordinateCount}`;
}

function loadCoordinateIndex(url: string, manifest: MlsSearchManifest) {
    const requestKey = coordinateIndexRequestKey(url, manifest);
    const existingRequest = coordinateIndexRequests.get(requestKey);
    if (existingRequest) {
        return existingRequest;
    }

    // The service-area partition can change without changing the source MLS
    // timestamp. Always bypass an older immutable sidecar retained by the
    // browser, then keep the validated result in the in-session request map.
    const request = fetch(url, { cache: 'no-store' })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`MLS coordinate index returned ${response.status}.`);
            }

            const value = await response.json() as unknown;
            if (!isMlsCoordinateIndexReady(value, manifest)) {
                throw new Error('MLS coordinate index failed validation.');
            }

            return value;
        })
        .catch((error) => {
            coordinateIndexRequests.delete(requestKey);
            throw error;
        });
    coordinateIndexRequests.set(requestKey, request);
    return request;
}

function freshListingMapPosition(
    listing: MlsSearchListing,
    coordinateLookup: Readonly<Record<string, MlsCoordinate>>,
    coordinateLookupIsAuthoritative: boolean,
) {
    const mapPosition = coordinateLookupIsAuthoritative
        ? coordinateLookup[listing.listingNumber]
        : listing.mapPosition ?? coordinateLookup[listing.listingNumber];
    if (!mapPosition) {
        return null;
    }

    const expiresAt = mapPosition.expiresAt ? Date.parse(mapPosition.expiresAt) : Number.NaN;
    if (
        Number.isFinite(mapPosition.lat) &&
        Number.isFinite(mapPosition.lng) &&
        Number.isFinite(expiresAt) &&
        expiresAt > Date.now()
    ) {
        return { lat: mapPosition.lat, lng: mapPosition.lng };
    }

    return null;
}

/** Loads only the validated coordinate sidecar; never geocodes in the browser. */
export function useListingCoordinates(
    listings: MlsSearchListing[],
    coordinateIndexManifest: MlsSearchManifest | null,
    coordinateIndexUrl?: string,
) {
    const coordinateSourceKey = coordinateIndexManifest && coordinateIndexUrl
        ? coordinateIndexRequestKey(coordinateIndexUrl, coordinateIndexManifest)
        : '';
    const [coordinateDelivery, setCoordinateDelivery] = useState<Readonly<{
        requestKey: string;
        status: 'idle' | 'loading' | 'ready' | 'error';
        coordinates: Readonly<Record<string, MlsCoordinate>>;
    }>>({
        requestKey: '',
        status: 'idle',
        coordinates: emptyCoordinateLookup,
    });
    const [coordinateLoadAttempt, setCoordinateLoadAttempt] = useState(0);
    const coordinateLookup = coordinateDelivery.requestKey === coordinateSourceKey &&
        coordinateDelivery.status === 'ready'
        ? coordinateDelivery.coordinates
        : emptyCoordinateLookup;
    const isCoordinateIndexPending = Boolean(
        coordinateSourceKey &&
        (coordinateDelivery.requestKey !== coordinateSourceKey || coordinateDelivery.status === 'loading'),
    );
    const isCoordinateIndexFailed = Boolean(
        coordinateSourceKey &&
        coordinateDelivery.requestKey === coordinateSourceKey &&
        coordinateDelivery.status === 'error',
    );
    const isCoordinateIndexAuthoritative = Boolean(
        coordinateSourceKey &&
        coordinateDelivery.requestKey === coordinateSourceKey &&
        coordinateDelivery.status === 'ready',
    );
    const resolvedListings = useMemo<ResolvedListing[]>(() => {
        if (isCoordinateIndexPending || isCoordinateIndexFailed) {
            return [];
        }

        return listings.flatMap((listing) => {
            const position = freshListingMapPosition(
                listing,
                coordinateLookup,
                isCoordinateIndexAuthoritative,
            );
            return position ? [{ listing, ...position }] : [];
        });
    }, [
        coordinateLookup,
        isCoordinateIndexAuthoritative,
        isCoordinateIndexFailed,
        isCoordinateIndexPending,
        listings,
    ]);
    useEffect(() => {
        if (!coordinateSourceKey || !coordinateIndexManifest || !coordinateIndexUrl) {
            setCoordinateDelivery({
                requestKey: '',
                status: 'idle',
                coordinates: emptyCoordinateLookup,
            });
            return;
        }

        let cancelled = false;
        setCoordinateDelivery({
            requestKey: coordinateSourceKey,
            status: 'loading',
            coordinates: emptyCoordinateLookup,
        });

        loadCoordinateIndex(coordinateIndexUrl, coordinateIndexManifest)
            .then((coordinateIndex) => {
                if (!cancelled) {
                    setCoordinateDelivery({
                        requestKey: coordinateSourceKey,
                        status: 'ready',
                        coordinates: coordinateIndex.coordinates,
                    });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCoordinateDelivery({
                        requestKey: coordinateSourceKey,
                        status: 'error',
                        coordinates: emptyCoordinateLookup,
                    });
                }
            });

        return () => {
            cancelled = true;
        };
    }, [coordinateIndexManifest, coordinateIndexUrl, coordinateLoadAttempt, coordinateSourceKey]);

    function retryCoordinates() {
        setCoordinateDelivery({
            requestKey: coordinateSourceKey,
            status: 'loading',
            coordinates: emptyCoordinateLookup,
        });
        setCoordinateLoadAttempt((attempt) => attempt + 1);
    }

    return { resolvedListings, isCoordinateIndexPending, isCoordinateIndexFailed, retryCoordinates };
}
