import {
    buildCommercialGenerationBaseUrl,
    defaultCommercialCurrentPointerUrl,
    isCommercialCurrentPointerReady,
    isCommercialSearchIndexReady,
    isCommercialSearchManifestReady,
    readCommercialJson,
    type CommercialCurrentPointer,
    type CommercialSearchIndex,
    type CommercialSearchManifest,
} from './commercial-public-listings';

export type CommercialSearchDelivery = Readonly<{
    currentPointerUrl: string;
    generationBaseUrl: string;
    manifest: CommercialSearchManifest;
    index: CommercialSearchIndex;
}>;

export type LoadCommercialSearchDeliveryOptions = Readonly<{
    currentPointerUrl?: string;
    fetcher?: typeof fetch;
    now?: number;
}>;

export async function loadCommercialSearchDelivery({
    currentPointerUrl = defaultCommercialCurrentPointerUrl,
    fetcher = fetch,
    now = Date.now(),
}: LoadCommercialSearchDeliveryOptions = {}): Promise<CommercialSearchDelivery> {
    const rawPointer = await readCommercialJson<unknown>(currentPointerUrl, fetcher);
    if (!isCommercialCurrentPointerReady(rawPointer, now)) {
        throw new Error('Commercial current pointer failed validation.');
    }
    const pointer = rawPointer as CommercialCurrentPointer;
    const generationBaseUrl = buildCommercialGenerationBaseUrl(currentPointerUrl, pointer, now);
    const manifestUrl = `${generationBaseUrl}/${pointer.manifestFile}`;
    const rawManifest = await readCommercialJson<unknown>(manifestUrl, fetcher);
    if (!isCommercialSearchManifestReady(rawManifest, now)) {
        throw new Error('Commercial search manifest failed validation.');
    }
    const manifest = rawManifest as CommercialSearchManifest;
    const rawIndex = await readCommercialJson<unknown>(
        `${generationBaseUrl}/${manifest.index.file}`,
        fetcher,
    );
    if (!isCommercialSearchIndexReady(rawIndex, manifest)) {
        throw new Error('Commercial search index failed validation.');
    }

    return {
        currentPointerUrl,
        generationBaseUrl,
        manifest,
        index: rawIndex as CommercialSearchIndex,
    };
}
