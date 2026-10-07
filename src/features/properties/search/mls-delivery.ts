import { townMatchesPreferredServiceArea } from '@/lib/market-regions';
import {
    type MlsListingDetail,
    type MlsPublicBundle,
    type MlsPublicListing,
    type MlsSearchIndexBundle,
    type MlsSearchListing,
} from '@/lib/mls-public-listings';
import { sanitizePublicHttpsUrl } from '@/lib/safe-external-url';

function legacyListingToSearchListing(listing: MlsPublicListing): MlsSearchListing {
    return {
        listingNumber: listing.listingNumber,
        propertyType: listing.propertyType,
        status: listing.status,
        listPrice: listing.listPrice,
        priceLabel: listing.priceLabel,
        address: listing.address,
        facts: listing.facts,
        photoCount: listing.photoCount ?? listing.photos.length,
        openHouseCount: listing.openHouses.length,
        openHouseEndTimes: listing.openHouses.map((openHouse) => openHouse.end),
        hasVirtualTour: Boolean(sanitizePublicHttpsUrl(listing.virtualTourUrl)),
        attribution: listing.attribution,
        source: listing.source,
    };
}

function legacyListingToDetail(listing: MlsPublicListing, generatedAt: string): MlsListingDetail {
    return {
        generatedAt,
        listingNumber: listing.listingNumber,
        propertyType: listing.propertyType,
        status: listing.status,
        listPrice: listing.listPrice,
        priceLabel: listing.priceLabel,
        address: listing.address,
        facts: listing.facts,
        features: listing.features,
        remarks: listing.remarks,
        photoCount: listing.photoCount ?? listing.photos.length,
        openHouses: listing.openHouses,
        virtualTourUrl: sanitizePublicHttpsUrl(listing.virtualTourUrl),
        attribution: listing.attribution,
        source: listing.source,
    };
}

export function normalizeLegacyBundle(bundle: MlsPublicBundle) {
    const serviceListings = bundle.listings.filter((listing) => townMatchesPreferredServiceArea(
        listing.address.town,
        listing.address.state,
    ));

    return {
        searchBundle: {
            generatedAt: bundle.generatedAt,
            source: bundle.source,
            disclaimer: bundle.disclaimer,
            compliance: bundle.compliance,
            listings: serviceListings.map(legacyListingToSearchListing),
        } satisfies MlsSearchIndexBundle,
        details: new Map(serviceListings.map((listing) => [
            listing.listingNumber,
            legacyListingToDetail(listing, bundle.generatedAt),
        ])),
    };
}

function isLegacyBundle(bundle: MlsPublicBundle | MlsSearchIndexBundle): bundle is MlsPublicBundle {
    return bundle.listings.some((listing) => 'photos' in listing);
}

export function normalizeLoadedBundle(bundle: MlsPublicBundle | MlsSearchIndexBundle) {
    if (isLegacyBundle(bundle)) {
        return normalizeLegacyBundle(bundle);
    }

    return {
        searchBundle: {
            ...bundle,
            listings: bundle.listings.filter((listing) => townMatchesPreferredServiceArea(
                listing.address.town,
                listing.address.state,
            )),
        },
        details: new Map<string, MlsListingDetail>(),
    };
}

const maxSessionMlsJsonEntries = 64;

const sessionMlsJsonRequestsByFetch = new WeakMap<
    typeof fetch,
    Map<string, Promise<unknown>>
>();

type MlsJsonCachePolicy = 'fresh' | 'generation';

export function generationVersionedMlsUrl(
    url: string,
    generatedAt: string,
    revisions: Readonly<Record<string, string>> = {},
) {
    const hashIndex = url.indexOf('#');
    const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
    const urlWithoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
    const queryIndex = urlWithoutHash.indexOf('?');
    const path = queryIndex >= 0 ? urlWithoutHash.slice(0, queryIndex) : urlWithoutHash;
    const search = new URLSearchParams(queryIndex >= 0 ? urlWithoutHash.slice(queryIndex + 1) : '');
    search.set('generation', generatedAt);
    Object.entries(revisions).forEach(([key, value]) => search.set(key, value));
    return `${path}?${search.toString()}${hash}`;
}

function sessionMlsJsonRequests(fetchImplementation: typeof fetch) {
    const existing = sessionMlsJsonRequestsByFetch.get(fetchImplementation);
    if (existing) {
        return existing;
    }

    const requests = new Map<string, Promise<unknown>>();
    sessionMlsJsonRequestsByFetch.set(fetchImplementation, requests);
    return requests;
}

async function parseMlsJson(fetchImplementation: typeof fetch, url: string, cache: RequestCache) {
    const response = await fetchImplementation(url, { cache });
    if (!response.ok) {
        throw new Error(`MLS asset returned ${response.status}`);
    }

    return response.json() as Promise<unknown>;
}

export function readMlsJson(url: string, cachePolicy: MlsJsonCachePolicy = 'fresh') {
    const fetchImplementation = globalThis.fetch;
    if (cachePolicy === 'fresh') {
        return parseMlsJson(fetchImplementation, url, 'no-store');
    }

    const requests = sessionMlsJsonRequests(fetchImplementation);
    const existing = requests.get(url);
    if (existing) {
        // Refresh insertion order so recently reused entries survive the small session LRU.
        requests.delete(url);
        requests.set(url, existing);
        return existing;
    }

    const request: Promise<unknown> = parseMlsJson(fetchImplementation, url, 'force-cache')
        .catch((error) => {
            if (requests.get(url) === request) {
                requests.delete(url);
            }
            throw error;
        });
    requests.set(url, request);

    while (requests.size > maxSessionMlsJsonEntries) {
        const oldestUrl = requests.keys().next().value as string | undefined;
        if (!oldestUrl) {
            break;
        }
        requests.delete(oldestUrl);
    }

    return request;
}

/** Remove a response that parsed successfully but failed the caller's validation. */
export function forgetMlsJson(url: string) {
    sessionMlsJsonRequestsByFetch.get(globalThis.fetch)?.delete(url);
}
