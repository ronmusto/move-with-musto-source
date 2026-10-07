import { type MlsListingDetail } from '@/lib/mls-public-listings';
import { useEffect, useState } from 'react';
import { isDisplayableListingDetail, type ListingDetailContent } from './listing-detail-validation';
import { forgetMlsJson, generationVersionedMlsUrl, readMlsJson } from './mls-delivery';

type DetailOptions = Readonly<{
    listingNumber: string | null;
    generatedAt: string;
    detailBaseUrl: string;
    initialDetails: ReadonlyMap<string, MlsListingDetail>;
}>;

/**
 * Observes the selected listing's request. Selection changes cancel the observer,
 * not the shared generation request, so close/reopen can reuse the same promise.
 * Cache keys include delivery origin and generation to prevent stale details.
 */
export function useListingDetail({ listingNumber, generatedAt, detailBaseUrl, initialDetails }: DetailOptions) {
    const [cache, setCache] = useState<ReadonlyMap<string, ListingDetailContent>>(() => new Map());
    const [request, setRequest] = useState<{ key: string; status: 'loading' | 'error' } | null>(null);
    const [attempt, setAttempt] = useState(0);
    const detailUrl = listingNumber
        ? generationVersionedMlsUrl(
            `${detailBaseUrl.replace(/\/+$/u, '')}/${encodeURIComponent(listingNumber)}.json`,
            generatedAt,
        )
        : null;
    const seededDetail = listingNumber ? initialDetails.get(listingNumber) : undefined;
    const detail = (detailUrl ? cache.get(detailUrl) : undefined) ?? (
        listingNumber && isDisplayableListingDetail(seededDetail, listingNumber, generatedAt) ? seededDetail : undefined
    );

    useEffect(() => {
        if (!listingNumber || !detailUrl || detail) {
            return;
        }

        let cancelled = false;
        setRequest({ key: detailUrl, status: 'loading' });
        // Deliberate retries bypass both the shared promise and HTTP cache.
        readMlsJson(detailUrl, attempt > 0 ? 'fresh' : 'generation')
            .then((value) => {
                if (cancelled) return;
                if (!isDisplayableListingDetail(value, listingNumber, generatedAt)) {
                    // A parsed JSON response can still fail domain validation.
                    // Explicit retries must be able to read a repaired asset.
                    forgetMlsJson(detailUrl);
                    throw new Error('MLS detail does not match the active search index.');
                }
                setCache((current) => {
                    const updated = new Map(current);
                    updated.set(detailUrl, value);
                    return updated;
                });
                setRequest(null);
            })
            .catch(() => {
                if (!cancelled) setRequest({ key: detailUrl, status: 'error' });
            });

        return () => { cancelled = true; };
    }, [attempt, detail, detailUrl, generatedAt, listingNumber]);

    return {
        detail,
        detailState: detail ? 'ready' as const : request?.key === detailUrl && request.status === 'error'
            ? 'error' as const : 'loading' as const,
        retryDetail: () => setAttempt((current) => current + 1),
    };
}
