import {
    buildMlsGenerationBaseUrl,
    buildSiblingMlsPublicDataUrl,
    defaultMlsCurrentPointerUrl,
    hasExternalMlsDataOrigin,
    isMlsCurrentPointerReady,
    isMlsSearchIndexBundleReady,
    isMlsSearchManifestReady,
    isMlsSearchShardReady,
    mlsSearchShardFiles,
    searchBundleFromShard,
    type MlsListingDetail,
    type MlsPublicBundle,
    type MlsSearchIndexBundle,
    type MlsSearchManifest,
} from '@/lib/mls-public-listings';
import { useEffect, useMemo, useState } from 'react';
import {
    forgetMlsJson,
    generationVersionedMlsUrl,
    normalizeLegacyBundle,
    normalizeLoadedBundle,
    readMlsJson,
} from './mls-delivery';

type DeliveryOptions = Readonly<{
    bundleUrl: string;
    currentPointerUrl: string | null | undefined;
    manifestUrl: string;
    detailBaseUrl: string;
    initialBundle: MlsPublicBundle | null;
    initialSearchBundle: MlsSearchIndexBundle | null;
}>;

/** Owns one validated MLS generation and its delivery/retry lifecycle. */
export function usePropertySearchDelivery({
    bundleUrl,
    currentPointerUrl,
    manifestUrl,
    detailBaseUrl,
    initialBundle,
    initialSearchBundle,
}: DeliveryOptions) {
    const normalizedInitialBundle = useMemo(() => {
        let normalized: {
            searchBundle: MlsSearchIndexBundle | null;
            details: Map<string, MlsListingDetail>;
        };
        if (initialSearchBundle) {
            normalized = normalizeLoadedBundle(initialSearchBundle);
        } else if (initialBundle) {
            normalized = normalizeLegacyBundle(initialBundle);
        } else {
            normalized = {
                searchBundle: null,
                details: new Map<string, MlsListingDetail>(),
            };
        }

        if (normalized.searchBundle && !isMlsSearchIndexBundleReady(normalized.searchBundle)) {
            return {
                searchBundle: null,
                details: new Map<string, MlsListingDetail>(),
            };
        }

        return normalized;
    }, [initialBundle, initialSearchBundle]);

    const [bundle, setBundle] = useState<MlsSearchIndexBundle | null>(normalizedInitialBundle.searchBundle);
    const [searchManifest, setSearchManifest] = useState<MlsSearchManifest | null>(null);
    const [activeManifestUrl, setActiveManifestUrl] = useState(manifestUrl);
    const [activeDetailBaseUrl, setActiveDetailBaseUrl] = useState(detailBaseUrl);
    const [detailCache, setDetailCache] = useState<ReadonlyMap<string, MlsListingDetail>>(
        normalizedInitialBundle.details,
    );
    const [bundleState, setBundleState] = useState<'ready' | 'loading' | 'missing'>(
        normalizedInitialBundle.searchBundle
            ? 'ready'
            : initialBundle || initialSearchBundle
                ? 'missing'
                : 'loading',
    );
    const [bundleLoadAttempt, setBundleLoadAttempt] = useState(0);
    useEffect(() => {
        if ((initialBundle || initialSearchBundle) && bundleLoadAttempt === 0) {
            return;
        }

        let cancelled = false;
        const resolvedCurrentPointerUrl = currentPointerUrl ?? defaultMlsCurrentPointerUrl;
        const shouldResolveCurrentPointer = currentPointerUrl !== null && (
            currentPointerUrl !== undefined || hasExternalMlsDataOrigin
        );

        async function readInitialSearchDelivery() {
            try {
                let nextManifestUrl = manifestUrl;
                let nextDetailBaseUrl = detailBaseUrl;
                let pointerGeneratedAt: string | null = null;
                if (shouldResolveCurrentPointer) {
                    const currentPointer = await readMlsJson(resolvedCurrentPointerUrl);
                    if (!isMlsCurrentPointerReady(currentPointer)) {
                        throw new Error('MLS current pointer failed validation.');
                    }
                    const generationBaseUrl = buildMlsGenerationBaseUrl(
                        resolvedCurrentPointerUrl,
                        currentPointer,
                    );
                    nextManifestUrl = `${generationBaseUrl}/${currentPointer.manifestFile}`;
                    nextDetailBaseUrl = `${generationBaseUrl}/listings`;
                    pointerGeneratedAt = currentPointer.generatedAt;
                }

                // The active generation path is stable, but daily coordinate
                // retention may reconcile its manifest count. Always re-read
                // the manifest after resolving the uncached pointer.
                const nextManifest = await readMlsJson(nextManifestUrl);
                if (!isMlsSearchManifestReady(nextManifest)) {
                    throw new Error('MLS search manifest failed compliance or freshness validation.');
                }
                if (pointerGeneratedAt && nextManifest.generatedAt !== pointerGeneratedAt) {
                    throw new Error('MLS current pointer does not match its generation manifest.');
                }
                const preferredShardUrl = generationVersionedMlsUrl(
                    buildSiblingMlsPublicDataUrl(nextManifestUrl, mlsSearchShardFiles.preferred),
                    nextManifest.generatedAt,
                );
                const preferredShard = await readMlsJson(preferredShardUrl, bundleLoadAttempt > 0 ? 'fresh' : 'generation');
                if (!isMlsSearchShardReady(preferredShard, nextManifest, 'preferred')) {
                    forgetMlsJson(preferredShardUrl);
                    throw new Error('MLS preferred search shard failed validation.');
                }
                const preferredBundle = searchBundleFromShard(nextManifest, preferredShard);
                if (!isMlsSearchIndexBundleReady(preferredBundle)) {
                    throw new Error('MLS preferred search bundle failed validation.');
                }

                return {
                    kind: 'sharded' as const,
                    bundle: preferredBundle,
                    manifest: nextManifest,
                    manifestUrl: nextManifestUrl,
                    detailBaseUrl: nextDetailBaseUrl,
                };
            } catch {
                if (shouldResolveCurrentPointer) {
                    throw new Error('The active cloud MLS generation could not be loaded safely.');
                }
                const nextBundle = await readMlsJson(bundleUrl);
                if (!isMlsSearchIndexBundleReady(nextBundle)) {
                    throw new Error('MLS search index failed compliance or freshness validation.');
                }

                return {
                    kind: 'monolith' as const,
                    bundle: nextBundle,
                };
            }
        }

        readInitialSearchDelivery()
            .then((delivery) => {
                if (!cancelled) {
                    if (delivery.kind === 'sharded') {
                        setBundle(delivery.bundle);
                        setSearchManifest(delivery.manifest);
                        setActiveManifestUrl(delivery.manifestUrl);
                        setActiveDetailBaseUrl(delivery.detailBaseUrl);
                    } else {
                        const normalized = normalizeLoadedBundle(delivery.bundle);
                        setBundle(normalized.searchBundle);
                        setDetailCache((current) => new Map([...current, ...normalized.details]));
                        setSearchManifest(null);
                        setActiveManifestUrl(manifestUrl);
                        setActiveDetailBaseUrl(detailBaseUrl);
                    }
                    setBundleState('ready');
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setBundleState('missing');
                }
            });

        return () => {
            cancelled = true;
        };
    }, [
        bundleLoadAttempt,
        bundleUrl,
        currentPointerUrl,
        detailBaseUrl,
        initialBundle,
        initialSearchBundle,
        manifestUrl,
    ]);

    const coordinateIndexUrl = searchManifest
        ? generationVersionedMlsUrl(
            buildSiblingMlsPublicDataUrl(activeManifestUrl, searchManifest.coordinateIndex.file),
            searchManifest.generatedAt,
            { coordinates: String(searchManifest.coordinateIndex.coordinateCount) },
        )
        : undefined;
    function retryBundle() {
        setBundleState('loading');
        setBundleLoadAttempt((attempt) => attempt + 1);
    }
    return { bundle, bundleState, searchManifest, activeDetailBaseUrl, initialDetails: detailCache, coordinateIndexUrl, retryBundle };
}
