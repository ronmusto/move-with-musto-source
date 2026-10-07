import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertiesSearch } from './PropertiesSearch';
import styles from './PropertiesSearch.module.css';
import type { MapAreaSelection } from './PropertyMapView';
import type {
    MlsListingDetail,
    MlsPublicBundle,
    MlsPublicListing,
    MlsSearchIndexBundle,
    MlsSearchListing,
    MlsSearchManifest,
    MlsSearchShard,
} from '@/lib/mls-public-listings';
import { MLS_PIN_PUBLIC_DISCLAIMER } from '@/lib/mls-public-listings';
import { townMatchesPreferredServiceArea } from '@/lib/market-regions';

const propertiesCss = readFileSync(resolve(process.cwd(), 'src/features/properties/PropertiesSearch.module.css'), 'utf8');
const defaultIntersectionObserver = window.IntersectionObserver;

function cssRuleFor(selector: string) {
    return propertiesCss.match(new RegExp(`${selector.replace('.', '\\.')}\\s*{[^}]+}`))?.[0] ?? '';
}

function installControllableIntersectionObserver() {
    const registrations = new Map<Element, {
        callback: IntersectionObserverCallback;
        observer: IntersectionObserver;
    }>();

    class ControllableIntersectionObserver implements IntersectionObserver {
        readonly root: Element | Document | null;
        readonly rootMargin: string;
        readonly thresholds: readonly number[];
        private readonly callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
            this.callback = callback;
            this.root = options.root ?? null;
            this.rootMargin = options.rootMargin ?? '0px';
            this.thresholds = Array.isArray(options.threshold)
                ? options.threshold
                : [options.threshold ?? 0];
        }

        observe(target: Element) {
            registrations.set(target, { callback: this.callback, observer: this });
            this.callback(
                [{
                    boundingClientRect: { top: 120 } as DOMRectReadOnly,
                    isIntersecting: true,
                    target,
                } as IntersectionObserverEntry],
                this,
            );
        }

        unobserve(target: Element) {
            registrations.delete(target);
        }

        disconnect() {}

        takeRecords(): IntersectionObserverEntry[] {
            return [];
        }
    }

    window.IntersectionObserver = ControllableIntersectionObserver;

    return {
        notify(target: Element, isIntersecting: boolean) {
            const registration = registrations.get(target);
            if (!registration) {
                throw new Error('The requested IntersectionObserver target was not registered.');
            }

            registration.callback(
                [{
                    boundingClientRect: { top: isIntersecting ? 120 : -1 } as DOMRectReadOnly,
                    isIntersecting,
                    target,
                } as IntersectionObserverEntry],
                registration.observer,
            );
        },
    };
}

function mockDesktopWorkspace() {
    const desktopQuery = '(min-width: 1024px)';
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    let matches = true;
    const desktopMedia = {
        get matches() {
            return matches;
        },
        media: desktopQuery,
        onchange: null,
        addListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
        removeListener: vi.fn((listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
        addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
            if (type === 'change') listeners.add(listener);
        }),
        removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
            if (type === 'change') listeners.delete(listener);
        }),
        dispatchEvent: vi.fn(() => true),
    };

    window.matchMedia = vi.fn().mockImplementation((query: string) => (
        query === desktopQuery
            ? desktopMedia
            : {
                ...desktopMedia,
                matches: false,
                media: query,
            }
    ));

    return {
        setMatches(nextMatches: boolean) {
            matches = nextMatches;
            const event = { matches, media: desktopQuery } as MediaQueryListEvent;
            listeners.forEach((listener) => listener(event));
        },
    };
}

function mockMobileWorkspace() {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 640px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
    }));
}

function getMapPreviewLauncher() {
    return screen.getByRole('button', {
        name: /open interactive map for .* matching homes/i,
    });
}

const bundle: MlsPublicBundle = {
    generatedAt: new Date().toISOString(),
    source: 'MLS Property Information Network, Inc.',
    disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
    compliance: {
        participantFirmName: 'Test Participant Realty',
        officeAddress: '123 Main Street, Salem, MA 01970',
        phone: '(781) 315-3845',
        marketArea: 'Boston, Brookline, Salem, Hingham, Nantucket, Worcester',
    },
    listings: [
        {
            listingNumber: '73333444',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 8990000,
            priceLabel: '$8,990,000',
            address: {
                line: '86 Mount Vernon Street',
                town: 'Boston',
                county: 'Suffolk',
                state: 'MA',
                zip: '02108',
            },
            facts: {
                beds: 5,
                fullBaths: 4,
                halfBaths: 2,
                bathsLabel: '4f;2h',
                sqft: 4492,
                lotSize: 0,
                acreage: 0.03,
                yearBuilt: 1875,
                parking: 1,
                rooms: 11,
                garageSpaces: 1,
                hasBasement: true,
            },
            features: {
                style: ['Victorian'],
                propertySubtype: ['Attached'],
                parking: ['On Street'],
                waterfront: ['No'],
                waterView: ['No'],
                rooms: [{
                    name: 'Primary bedroom',
                    level: 'Second',
                    dimensions: '23 x 11',
                    features: ['Closet - Walk-in'],
                }],
                interior: ['Cable Available'],
                heating: ['Hot Water Baseboard'],
                water: ['City/Town Water'],
                sewer: ['City/Town Sewer'],
            },
            remarks: 'Source-faithful MLS remarks stay intact. '.repeat(8).trim(),
            photos: Array.from({ length: 7 }, (_, index) => ({
                index,
                card: `https://media.mlspin.com/photo.aspx?mls=73333444&n=${index}&w=600&h=450`,
                detail: `https://media.mlspin.com/photo.aspx?mls=73333444&n=${index}&w=1024&h=768`,
                thumbnail: `https://media.mlspin.com/photo.aspx?mls=73333444&n=${index}&w=320&h=250`,
            })),
            openHouses: [{
                start: '2099-06-27T10:00:00',
                end: '2099-06-27T13:00:00',
                type: 'In-Person',
                url: '',
            }],
            virtualTourUrl: 'https://example.com/tour',
            attribution: {
                listingAgent: 'Avery Agent',
                listingOffice: 'Beacon Office',
                listingOfficePhone: '617-555-0100',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '2026-06-01T10:00:00',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333445',
            propertyType: 'Condo/co-op',
            status: { code: 'CTG', label: 'Contingent', isActive: true, isContingent: true },
            listPrice: 750000,
            priceLabel: '$750,000',
            address: {
                line: '12 Beacon Street #2',
                town: 'Brookline',
                county: 'Norfolk',
                state: 'MA',
                zip: '02445',
            },
            facts: {
                beds: 2,
                fullBaths: 2,
                halfBaths: 0,
                bathsLabel: '2f;0h',
                sqft: 1210,
                lotSize: null,
                acreage: null,
                yearBuilt: 1920,
                parking: 1,
            },
            remarks: 'Contingent record can still support backup-offer context.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'Blake Broker',
                listingOffice: 'Beacon Office',
                listingOfficePhone: '617-555-0100',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333446',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 925000,
            priceLabel: '$925,000',
            address: {
                line: '9 Chestnut Street',
                town: 'Salem',
                county: 'Essex',
                state: 'MA',
                zip: '01970',
            },
            facts: {
                beds: 3,
                fullBaths: 2,
                halfBaths: 1,
                bathsLabel: '2f;1h',
                sqft: 1850,
                lotSize: null,
                acreage: null,
                yearBuilt: 1901,
                parking: 2,
            },
            remarks: 'North Shore listing remarks.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'North Agent',
                listingOffice: 'Harbor Office',
                listingOfficePhone: '978-555-0100',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333447',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 1150000,
            priceLabel: '$1,150,000',
            address: {
                line: '44 South Shore Road',
                town: 'Hingham',
                county: 'Plymouth',
                state: 'MA',
                zip: '02043',
            },
            facts: {
                beds: 4,
                fullBaths: 3,
                halfBaths: 0,
                bathsLabel: '3f;0h',
                sqft: 2400,
                lotSize: null,
                acreage: null,
                yearBuilt: 1956,
                parking: 2,
            },
            remarks: 'South Shore listing remarks.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'South Agent',
                listingOffice: 'Harbor Office',
                listingOfficePhone: '781-555-0100',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333448',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 2650000,
            priceLabel: '$2,650,000',
            address: {
                line: '3 Harbor View Lane',
                town: 'Nantucket',
                county: 'Nantucket',
                state: 'MA',
                zip: '02554',
            },
            facts: {
                beds: 4,
                fullBaths: 3,
                halfBaths: 1,
                bathsLabel: '3f;1h',
                sqft: 3100,
                lotSize: null,
                acreage: null,
                yearBuilt: 1988,
                parking: 2,
            },
            remarks: 'Nantucket listing remarks.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'Island Agent',
                listingOffice: 'Island Office',
                listingOfficePhone: '508-555-0100',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333449',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 650000,
            priceLabel: '$650,000',
            address: {
                line: '1 Worcester Road',
                town: 'Worcester',
                county: 'Worcester',
                state: 'MA',
                zip: '01608',
            },
            facts: {
                beds: 3,
                fullBaths: 2,
                halfBaths: 0,
                bathsLabel: '2f;0h',
                sqft: 1550,
                lotSize: null,
                acreage: null,
                yearBuilt: 1978,
                parking: 1,
            },
            remarks: 'Central Massachusetts listing remarks.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'Central Agent',
                listingOffice: 'Central Office',
                listingOfficePhone: '508-555-0101',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
        {
            listingNumber: '73333450',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice: 875000,
            priceLabel: '$875,000',
            address: {
                line: '8 Granite Road',
                town: 'Pittsfield',
                county: 'Berkshire',
                state: 'MA',
                zip: '01201',
            },
            facts: {
                beds: 3,
                fullBaths: 2,
                halfBaths: 0,
                bathsLabel: '2f;0h',
                sqft: 1750,
                lotSize: null,
                acreage: null,
                yearBuilt: 1984,
                parking: 2,
            },
            remarks: 'Massachusetts listing outside the public service area.',
            photos: [],
            openHouses: [],
            virtualTourUrl: '',
            attribution: {
                listingAgent: 'Border Agent',
                listingOffice: 'Border Office',
                listingOfficePhone: '413-555-0101',
            },
            source: {
                name: 'MLS PIN',
                photoDate: '',
                listingAlert: 'N',
            },
        },
    ],
};

function generationUrl(path: string, generatedAt = bundle.generatedAt) {
    return `${path}?generation=${encodeURIComponent(generatedAt)}`;
}

const profileProps = {
    contact: {
        email: 'maily@movewithmusto.com',
        phone: '(781) 315-3845',
        phoneHref: 'tel:+17813153845',
    },
    inquiry: {
        action: 'https://data.movewithmusto.com/inquiries',
        method: 'post' as const,
    },
    termsVersion: '2026-06-16',
    privacyVersion: '2026-06-16',
};

function makeListing(index: number): MlsPublicListing {
    return {
        ...bundle.listings[0],
        listingNumber: `73333${String(index).padStart(3, '0')}`,
        listPrice: 800000 + (index * 1000),
        priceLabel: `$${(800000 + (index * 1000)).toLocaleString('en-US')}`,
        address: {
            ...bundle.listings[0].address,
            line: `${index} Test Street`,
            town: 'Boston',
            county: 'Suffolk',
            state: 'MA',
        },
        photos: [],
        remarks: `Paged listing ${index}`,
    };
}

function toSearchBundle(input: MlsPublicBundle = bundle): MlsSearchIndexBundle {
    return {
        generatedAt: input.generatedAt,
        source: input.source,
        disclaimer: input.disclaimer,
        compliance: input.compliance,
        listings: input.listings.map((listing) => ({
            listingNumber: listing.listingNumber,
            propertyType: listing.propertyType,
            status: listing.status,
            listPrice: listing.listPrice,
            priceLabel: listing.priceLabel,
            address: listing.address,
            facts: listing.facts,
            photoCount: listing.photos.length,
            openHouseCount: listing.openHouses.length,
            openHouseEndTimes: listing.openHouses.map((openHouse) => openHouse.end),
            hasVirtualTour: Boolean(listing.virtualTourUrl),
            attribution: listing.attribution,
            source: listing.source,
        })),
    };
}

function toListingDetail(listing: MlsPublicListing = bundle.listings[0]): MlsListingDetail {
    return {
        generatedAt: bundle.generatedAt,
        listingNumber: listing.listingNumber,
        propertyType: listing.propertyType,
        status: listing.status,
        listPrice: listing.listPrice,
        priceLabel: listing.priceLabel,
        address: listing.address,
        facts: listing.facts,
        features: listing.features,
        remarks: listing.remarks,
        photoCount: listing.photos.length,
        openHouses: listing.openHouses,
        virtualTourUrl: listing.virtualTourUrl,
        attribution: listing.attribution,
        source: listing.source,
    };
}

function listingCardFor(address: string) {
    const heading = screen.getAllByRole('heading', { name: address }).find((candidate) => (
        candidate.closest(`.${styles.listingCard}`)
    ));
    const card = heading?.closest('article');
    if (!card) {
        throw new Error(`Could not find listing card for ${address}`);
    }
    return card;
}

function toShardedSearchDelivery(input: MlsPublicBundle = bundle) {
    const searchBundle = toSearchBundle(input);
    const preferredListings = searchBundle.listings.filter((listing) => (
        townMatchesPreferredServiceArea(listing.address.town, listing.address.state)
    ));
    const otherListings = searchBundle.listings.filter((listing) => (
        !townMatchesPreferredServiceArea(listing.address.town, listing.address.state)
    ));
    const facetValues = (readValue: (listing: MlsSearchListing) => string) => Array.from(new Set(
        preferredListings.map(readValue).filter(Boolean),
    )).sort((first, second) => first.localeCompare(second));
    const manifest = {
        schemaVersion: 1,
        generatedAt: searchBundle.generatedAt,
        source: searchBundle.source,
        disclaimer: searchBundle.disclaimer,
        compliance: searchBundle.compliance,
        totalListingCount: preferredListings.length,
        facets: {
            states: facetValues((listing) => listing.address.state),
            counties: facetValues((listing) => listing.address.county),
            towns: facetValues((listing) => listing.address.town),
            propertyTypes: facetValues((listing) => listing.propertyType),
        },
        coordinateIndex: {
            file: 'mls-coordinate-index.json',
            coordinateCount: 0,
        },
        shards: [
            { id: 'preferred', file: 'mls-search-preferred.json', listingCount: preferredListings.length },
        ],
    } satisfies MlsSearchManifest;

    return {
        manifest,
        preferred: {
            schemaVersion: 1,
            id: 'preferred',
            generatedAt: searchBundle.generatedAt,
            listings: preferredListings,
        } satisfies MlsSearchShard,
        other: {
            schemaVersion: 1,
            id: 'other',
            generatedAt: searchBundle.generatedAt,
            listings: otherListings,
        },
        searchBundle,
    };
}

describe('PropertiesSearch', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/properties/');
        localStorage.clear();
        vi.restoreAllMocks();
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        window.IntersectionObserver = defaultIntersectionObserver;
        document.body.style.overflow = '';
        delete window.google;
        window.__moveWithMustoGoogleMapsLoading = undefined;
        document.getElementById('move-with-musto-google-maps')?.remove();
    });

    it('shows a branded loading state while the search index is loading', () => {
        vi.spyOn(global, 'fetch').mockReturnValue(new Promise(() => undefined) as Promise<Response>);

        render(<PropertiesSearch {...profileProps} />);

        const status = screen.getByRole('status', { name: /loading homes/i });
        expect(status).toHaveTextContent(/loading homes/i);
    });

    it('loads only the preferred service-area shard for the default search', async () => {
        const delivery = toShardedSearchDelivery();
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        expect(screen.getByText(/across the burlington-centered service area/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all reviewed mls listings/i })).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/mls/mls-search-manifest.json', { cache: 'no-store' });
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt),
            { cache: 'force-cache' },
        );
        expect(fetchMock).not.toHaveBeenCalledWith(
            generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt),
            expect.anything(),
        );
        expect(fetchMock).not.toHaveBeenCalledWith('/mls/mls-search-index.json', expect.anything());
    });

    it('resolves every cloud asset through one validated current generation pointer', async () => {
        const user = userEvent.setup();
        const delivery = toShardedSearchDelivery();
        const generation = '20260713040000-11111111-1111-4111-8111-111111111111';
        const pointerUrl = 'https://data.movewithmusto.com/mls/current.json';
        const generationBase = `https://data.movewithmusto.com/mls/generations/${generation}`;
        const manifestUrl = `${generationBase}/mls-search-manifest.json`;
        const preferredUrl = generationUrl(
            `${generationBase}/mls-search-preferred.json`,
            delivery.manifest.generatedAt,
        );
        const detailUrl = generationUrl(
            `${generationBase}/listings/73333444.json`,
            delivery.manifest.generatedAt,
        );
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === pointerUrl) {
                return {
                    ok: true,
                    json: async () => ({
                        schemaVersion: 1,
                        generation,
                        generatedAt: delivery.manifest.generatedAt,
                        manifestFile: 'mls-search-manifest.json',
                    }),
                } as Response;
            }
            if (url === manifestUrl) {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === preferredUrl) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === detailUrl) {
                return { ok: true, json: async () => toListingDetail() } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch currentPointerUrl={pointerUrl} {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        expect(await screen.findByText(/source-faithful mls remarks stay intact/i)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith(pointerUrl, { cache: 'no-store' });
        expect(fetchMock).toHaveBeenCalledWith(manifestUrl, { cache: 'no-store' });
        expect(fetchMock).toHaveBeenCalledWith(preferredUrl, { cache: 'force-cache' });
        expect(fetchMock).toHaveBeenCalledWith(detailUrl, { cache: 'force-cache' });
        expect(fetchMock).not.toHaveBeenCalledWith('/mls/mls-search-manifest.json', expect.anything());
        expect(fetchMock).not.toHaveBeenCalledWith('/mls/mls-search-index.json', expect.anything());
    });

    it('fails closed when a cloud current pointer is invalid instead of mixing generations', async () => {
        const pointerUrl = 'https://data.movewithmusto.com/mls/current.json';
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                schemaVersion: 1,
                generation: '../previous',
                generatedAt: new Date().toISOString(),
                manifestFile: 'mls-search-manifest.json',
            }),
        } as Response);

        render(<PropertiesSearch currentPointerUrl={pointerUrl} {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /home search is temporarily unavailable/i }))
            .toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith(pointerUrl, { cache: 'no-store' });
    });

    it('loads the coordinate sidecar from the selected cloud generation', async () => {
        const user = userEvent.setup();
        const delivery = toShardedSearchDelivery();
        const generation = '20260713040000-11111111-1111-4111-8111-111111111111';
        const pointerUrl = 'https://data.movewithmusto.com/mls/current.json';
        const generationBase = `https://data.movewithmusto.com/mls/generations/${generation}`;
        const coordinateUrl = `${generationUrl(
            `${generationBase}/mls-coordinate-index.json`,
            delivery.manifest.generatedAt,
        )}&coordinates=0`;
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === pointerUrl) {
                return {
                    ok: true,
                    json: async () => ({
                        schemaVersion: 1,
                        generation,
                        generatedAt: delivery.manifest.generatedAt,
                        manifestFile: 'mls-search-manifest.json',
                    }),
                } as Response;
            }
            if (url === `${generationBase}/mls-search-manifest.json`) {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl(
                `${generationBase}/mls-search-preferred.json`,
                delivery.manifest.generatedAt,
            )) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === coordinateUrl) {
                return {
                    ok: true,
                    json: async () => ({
                        schemaVersion: 1,
                        generatedAt: delivery.manifest.generatedAt,
                        coordinates: {},
                    }),
                } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch currentPointerUrl={pointerUrl} {...profileProps} />);
        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        await user.click(getMapPreviewLauncher());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(coordinateUrl, { cache: 'no-store' }));
    });

    it('versions the coordinate sidecar by service-area count and bypasses immutable browser cache', async () => {
        const user = userEvent.setup();
        const delivery = toShardedSearchDelivery();
        const coordinateUrl = `${generationUrl(
            '/mls/mls-coordinate-index.json',
            delivery.manifest.generatedAt,
        )}&coordinates=${delivery.manifest.coordinateIndex.coordinateCount}`;
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === coordinateUrl) {
                return {
                    ok: true,
                    json: async () => ({
                        schemaVersion: 1,
                        generatedAt: delivery.manifest.generatedAt,
                        coordinates: {},
                    }),
                } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);
        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        await user.click(getMapPreviewLauncher());

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(coordinateUrl, { cache: 'no-store' }));
    });

    it('keeps an out-of-area address inside the service search without loading the deferred shard', async () => {
        const delivery = toShardedSearchDelivery();
        let resolveOtherShard: (response: Response) => void = () => undefined;
        const otherShardResponse = new Promise<Response>((resolve) => {
            resolveOtherShard = resolve;
        });
        const otherUrl = generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt);
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === otherUrl) {
                return otherShardResponse;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);
        const addressSearch = await screen.findByRole('searchbox', { name: /address search/i });
        fireEvent.change(addressSearch, { target: { value: '3 Harbor View Lane' } });
        expect(screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);
        fireEvent.submit(addressSearch.closest('form')!);

        expect(await screen.findByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
        expect(screen.getByText(/this search covers burlington and nearby service-area communities/i))
            .toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /3 Harbor View Lane/i })).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);
        expect(new URLSearchParams(window.location.search).has('scope')).toBe(false);
        resolveOtherShard({ ok: true, json: async () => delivery.other } as Response);
    });

    it('does not load the deferred shard for a miss inside an explicit preferred-only area', async () => {
        const delivery = toShardedSearchDelivery();
        const otherUrl = generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt);
        window.history.pushState(
            {},
            '',
            '/properties/?query=999+Impossible+Address&includeTown=Boston',
        );
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('999 Impossible Address');
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);
    });

    it('never loads the deferred shard for repeated address misses', async () => {
        const delivery = toShardedSearchDelivery();
        const otherUrl = generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt);
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === otherUrl) {
                return { ok: true, json: async () => delivery.other } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);
        const addressSearch = await screen.findByRole('searchbox', { name: /address search/i });
        fireEvent.change(addressSearch, { target: { value: '999 Impossible Address' } });
        fireEvent.submit(addressSearch.closest('form')!);

        expect(await screen.findByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);

        fireEvent.change(addressSearch, { target: { value: '998 Still Impossible' } });
        fireEvent.submit(addressSearch.closest('form')!);
        await waitFor(() => {
            expect(screen.getByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
            expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);
        });
    });

    it('keeps the latest address query authoritative without expanding inventory', async () => {
        const delivery = toShardedSearchDelivery();
        let resolveOtherShard: (response: Response) => void = () => undefined;
        const otherShardResponse = new Promise<Response>((resolve) => {
            resolveOtherShard = resolve;
        });
        const otherUrl = generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt);
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === otherUrl) {
                return otherShardResponse;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);
        const addressSearch = await screen.findByRole('searchbox', { name: /address search/i });
        fireEvent.change(addressSearch, { target: { value: '999 Impossible Address' } });
        fireEvent.submit(addressSearch.closest('form')!);
        expect(await screen.findByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();

        fireEvent.change(addressSearch, { target: { value: '86 Mount Vernon Street' } });
        fireEvent.submit(addressSearch.closest('form')!);

        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all reviewed mls listings/i })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: /property search results/i })).toHaveAttribute('aria-busy', 'false');

        resolveOtherShard({ ok: true, json: async () => delivery.other } as Response);

        expect(await screen.findByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /no matching homes/i })).not.toBeInTheDocument();
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === otherUrl)).toHaveLength(0);
    });

    it('revalidates the manifest but reuses a parsed generation shard across SPA remounts', async () => {
        const delivery = toShardedSearchDelivery();
        const preferredUrl = generationUrl(
            '/mls/mls-search-preferred.json',
            delivery.manifest.generatedAt,
        );
        let manifestParses = 0;
        let preferredParses = 0;
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return {
                    ok: true,
                    json: async () => {
                        manifestParses += 1;
                        return delivery.manifest;
                    },
                } as Response;
            }
            if (url === preferredUrl) {
                return {
                    ok: true,
                    json: async () => {
                        preferredParses += 1;
                        return delivery.preferred;
                    },
                } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        const firstRender = render(<PropertiesSearch {...profileProps} />);
        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        firstRender.unmount();

        render(<PropertiesSearch {...profileProps} />);
        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();

        expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/mls/mls-search-manifest.json'))
            .toHaveLength(2);
        expect(fetchMock.mock.calls.filter(([input]) => String(input) === preferredUrl)).toHaveLength(1);
        expect(manifestParses).toBe(2);
        expect(preferredParses).toBe(1);
    });

    it('falls back to the monolithic search index when the shard manifest is unavailable', async () => {
        const searchBundle = toSearchBundle();
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-index.json') {
                return { ok: true, json: async () => searchBundle } as Response;
            }
            return { ok: false, status: 404 } as Response;
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/mls/mls-search-manifest.json', { cache: 'no-store' });
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/mls/mls-search-index.json', { cache: 'no-store' });
    });

    it('does not load or open a shared listing outside the service area', async () => {
        const delivery = toShardedSearchDelivery();
        const otherListing = bundle.listings.find((listing) => listing.address.town === 'Nantucket');
        expect(otherListing).toBeDefined();
        window.history.pushState({}, '', `/properties/?listing=${otherListing?.listingNumber}`);
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.other } as Response;
            }
            if (url === generationUrl(
                `/mls/listings/${otherListing?.listingNumber}.json`,
                delivery.manifest.generatedAt,
            )) {
                return { ok: true, json: async () => toListingDetail(otherListing) } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByText(/that home is not available in the current search/i)).toBeInTheDocument();
        expect(screen.queryByRole('dialog', {
            name: new RegExp(`photos for ${otherListing?.address.line}`, 'i'),
        })).not.toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(
            generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt),
            expect.anything(),
        );
    });

    it('normalizes a legacy all-scope URL to the service-area shard', async () => {
        const delivery = toShardedSearchDelivery();
        window.history.pushState({}, '', '/properties/?scope=all');
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.other } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/3 Harbor View Lane/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/8 Granite Road/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all reviewed mls listings/i })).not.toBeInTheDocument();
        const results = screen.getByRole('region', { name: /property search results/i });
        expect(within(results).getAllByRole('button', { name: /^view details$/i })).toHaveLength(
            delivery.preferred.listings.length,
        );
        expect(fetchMock).not.toHaveBeenCalledWith(
            generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt),
            expect.anything(),
        );
        await waitFor(() => expect(new URLSearchParams(window.location.search).has('scope')).toBe(false));
    });

    it('filters a full initial bundle to the Burlington-area service area', async () => {
        window.history.pushState({}, '', '/properties/?scope=all');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/3 Harbor View Lane/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /all reviewed mls listings/i })).not.toBeInTheDocument();
        await waitFor(() => expect(new URLSearchParams(window.location.search).has('scope')).toBe(false));
    });

    it('uses only preferred-shard geography in the filter sheet', async () => {
        const user = userEvent.setup();
        const delivery = toShardedSearchDelivery();
        let resolveOtherShard: (response: Response) => void = () => undefined;
        const otherShardResponse = new Promise<Response>((resolve) => {
            resolveOtherShard = resolve;
        });
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt)) {
                return otherShardResponse;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        await user.click(await screen.findByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        expect(within(filterDialog).queryByRole('combobox', { name: /state/i })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('option', { name: 'NH' })).not.toBeInTheDocument();
        await user.type(within(filterDialog).getByRole('combobox', { name: /search communities to include/i }), 'Nantucket');
        expect(within(filterDialog).getByText(/no close community matches found/i)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(
            generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt),
            expect.anything(),
        );
        resolveOtherShard({ ok: true, json: async () => delivery.other } as Response);
        expect(screen.queryByText(/8 Granite Road/i)).not.toBeInTheDocument();
    });

    it('never requests the optional shard when it is unavailable', async () => {
        const delivery = toShardedSearchDelivery();
        let otherShardAttempts = 0;
        vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt)) {
                otherShardAttempts += 1;
                return otherShardAttempts === 1
                    ? { ok: false, status: 503 } as Response
                    : { ok: true, json: async () => delivery.other } as Response;
            }
            if (url === generationUrl('/mls/mls-search-index.json', delivery.manifest.generatedAt)) {
                return { ok: false, status: 503 } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/some reviewed listings could not be loaded/i)).not.toBeInTheDocument();
        expect(otherShardAttempts).toBe(0);
    });

    it('prunes saved homes outside the service area without loading the other shard', async () => {
        const delivery = toShardedSearchDelivery();
        const otherListing = delivery.other.listings.find((listing) => listing.address.town === 'Nantucket');
        expect(otherListing).toBeDefined();
        localStorage.setItem('move-with-musto.properties.saved', JSON.stringify([otherListing?.listingNumber]));
        const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            if (url === generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.other } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(
            generationUrl('/mls/mls-search-other.json', delivery.manifest.generatedAt),
            expect.anything(),
        );
        await waitFor(() => expect(screen.queryByRole('button', { name: /show saved homes/i })).not.toBeInTheDocument());
        expect(screen.queryByText(/3 Harbor View Lane/i)).not.toBeInTheDocument();
        await waitFor(() => expect(localStorage.getItem('move-with-musto.properties.saved')).toBe('[]'));
    });

    it('loads listing details on demand from the compact search index', async () => {
        const user = userEvent.setup();
        let resolveDetail: (detail: MlsListingDetail) => void = () => undefined;
        const detailPromise = new Promise<MlsListingDetail>((resolve) => {
            resolveDetail = resolve;
        });
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => detailPromise,
        } as Response);

        render(
            <PropertiesSearch
                detailBaseUrl="/mls/listings"
                initialSearchBundle={toSearchBundle()}
                {...profileProps}
            />,
        );

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));

        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(within(dialog).getByRole('status', { name: /loading listing details/i })).toBeInTheDocument();

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                generationUrl('/mls/listings/73333444.json', toSearchBundle().generatedAt),
                { cache: 'force-cache' },
            );
        });
        resolveDetail(toListingDetail());
        expect(await within(dialog).findByText(/source-faithful mls remarks stay intact/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('img', { name: /photo 1 of 7/i })).toHaveAttribute(
            'src',
            expect.stringContaining('w=1024&h=768'),
        );
    });

    it('rejects an out-of-state listing detail even when its search result is Massachusetts', async () => {
        const user = userEvent.setup();
        vi.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                ...toListingDetail(),
                address: {
                    ...toListingDetail().address,
                    state: 'NH',
                },
            }),
        } as Response);

        render(
            <PropertiesSearch
                detailBaseUrl="/mls/listings"
                initialSearchBundle={toSearchBundle()}
                {...profileProps}
            />,
        );

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(await within(dialog).findByText(/some details are not showing right now/i)).toBeInTheDocument();
        expect(within(dialog).queryByText(/source-faithful mls remarks stay intact/i)).not.toBeInTheDocument();
    });

    it('renders sanitized MLS listings with required compliance surfaces', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.getByRole('heading', { name: /homes for sale/i })).toBeInTheDocument();
        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.getByText(/MLS #73333444/i)).toBeInTheDocument();
        expect(screen.getAllByText(/Beacon Office/i)).toHaveLength(2);
        expect(screen.getByText(/Avery Agent/i)).toBeInTheDocument();
        expect(screen.getByText(/personal, non-commercial use/i)).toBeInTheDocument();
        expect(screen.getByText(/123 Main Street/i)).toBeInTheDocument();
        expect(screen.getByText(/^Contingent$/i)).toBeInTheDocument();
        expect(screen.getAllByText('4f | 2h').length).toBeGreaterThan(0);
        expect(screen.queryByText('4f;2h')).not.toBeInTheDocument();
        expect(screen.getAllByText(/MLS #73333444 · Single family/i).length).toBeGreaterThan(0);
        expect(screen.queryByText(/Active flag/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/No open house listed/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Tour link unavailable/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/representative search example/i)).not.toBeInTheDocument();
    });

    it('does not show an ended open house on the listing card or in details', async () => {
        const user = userEvent.setup();
        const endedBundle: MlsPublicBundle = {
            ...bundle,
            listings: [{
                ...bundle.listings[0],
                openHouses: [{
                    start: '2020-01-05T10:00:00',
                    end: '2020-01-05T13:00:00',
                    type: 'Ended event',
                    url: '',
                }],
                virtualTourUrl: '',
            }],
        };

        render(<PropertiesSearch initialBundle={endedBundle} {...profileProps} />);

        const card = listingCardFor('86 Mount Vernon Street');
        expect(card).not.toHaveTextContent(/open house/i);
        await user.click(within(card).getByRole('button', { name: /view details/i }));
        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(within(dialog).queryByText(/ended event/i)).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/^open houses$/i)).not.toBeInTheDocument();
    });

    it('keeps source status details below the search workspace without compliance marketing copy', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const searchSection = screen.getByLabelText(/homes for sale/i);
        const sourceStatus = screen.getByLabelText(/listing source details/i);
        const workspace = screen.getByRole('region', { name: /property search results/i });
        const compliancePanel = screen.getByLabelText(/mls listing compliance information/i);
        const disclosureRegion = screen.getByRole('region', {
            name: /mls listing disclosure and participant information/i,
        });
        const disclosureRule = cssRuleFor('.compliancePanel .screenDisclosure');

        expect(searchSection.compareDocumentPosition(sourceStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(workspace.compareDocumentPosition(sourceStatus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(workspace.compareDocumentPosition(compliancePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(disclosureRegion).toHaveAttribute('tabindex', '0');
        expect(disclosureRule).toContain('max-height: min(12rem, 30svh);');
        expect(disclosureRule).toContain('overflow-y: auto;');
        expect(sourceStatus).toHaveTextContent(/MLS Property Information Network/i);
        expect(sourceStatus).toHaveTextContent(/Updated:/i);
        expect(sourceStatus).not.toHaveTextContent(/public listings/i);
        expect(sourceStatus).not.toHaveTextContent(/compliant/i);
    });

    it('keeps inactive toolbar actions out of the compact search header', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.queryByRole('button', { name: /help me find homes/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /send selected homes/i })).not.toBeInTheDocument();
    });

    it('does not style the remaining toolbar action as primary by position', () => {
        expect(propertiesCss).not.toContain('.toolbarActions button:first-child');
    });

    it('morphs the full filter surface into a concise search capsule after scrolling', () => {
        const observer = installControllableIntersectionObserver();
        mockDesktopWorkspace();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const sentinel = screen.getByTestId('property-filter-capsule-sentinel');
        const capsule = sentinel.nextElementSibling as HTMLElement;

        expect(capsule).toHaveAttribute('data-compact', 'false');
        expect(screen.getByRole('search', { name: /property search filters/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /edit search filters/i })).not.toBeInTheDocument();

        act(() => observer.notify(sentinel, false));

        expect(capsule).toHaveAttribute('data-compact', 'true');
        expect(screen.queryByRole('search', { name: /property search filters/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', {
            name: /edit search filters: any location · any price/i,
        })).toHaveAttribute('aria-expanded', 'false');
        expect(within(capsule).getByText(/^4$/)).toBeInTheDocument();
        expect(within(capsule).getByText(/^homes$/i)).toBeInTheDocument();

        act(() => observer.notify(sentinel, true));

        expect(capsule).toHaveAttribute('data-compact', 'false');
        expect(screen.getByRole('search', { name: /property search filters/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /edit search filters/i })).not.toBeInTheDocument();
    });

    it('expands the desktop filter capsule on click and dismisses it with Escape', async () => {
        const user = userEvent.setup();
        const observer = installControllableIntersectionObserver();
        mockDesktopWorkspace();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const sentinel = screen.getByTestId('property-filter-capsule-sentinel');
        const capsule = sentinel.nextElementSibling as HTMLElement;
        act(() => observer.notify(sentinel, false));

        const editSearch = screen.getByRole('button', { name: /edit search filters/i });
        await user.click(editSearch);

        expect(capsule).toHaveAttribute('data-expanded', 'true');
        expect(editSearch).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('search', { name: /property search filters/i })).toBeInTheDocument();
        expect(document.body.style.overflow).toBe('');

        await user.keyboard('{Escape}');

        expect(capsule).toHaveAttribute('data-expanded', 'false');
        expect(editSearch).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('search', { name: /property search filters/i })).not.toBeInTheDocument();
        expect(editSearch).toHaveFocus();
        expect(document.body.style.overflow).toBe('');
    });

    it('collapses the inline capsule before switching to the mobile filter sheet', async () => {
        const user = userEvent.setup();
        const observer = installControllableIntersectionObserver();
        const desktop = mockDesktopWorkspace();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const sentinel = screen.getByTestId('property-filter-capsule-sentinel');
        const capsule = sentinel.nextElementSibling as HTMLElement;
        act(() => observer.notify(sentinel, false));

        const editSearch = screen.getByRole('button', { name: /edit search filters/i });
        await user.click(editSearch);
        expect(capsule).toHaveAttribute('data-expanded', 'true');

        act(() => desktop.setMatches(false));

        expect(capsule).toHaveAttribute('data-expanded', 'false');
        expect(editSearch).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('search', { name: /property search filters/i })).not.toBeInTheDocument();

        await user.click(editSearch);
        expect(screen.getByRole('dialog', { name: /more filters/i })).toBeInTheDocument();
        expect(screen.queryByRole('search', { name: /property search filters/i })).not.toBeInTheDocument();
    });

    it('uses simple bedroom and bathroom minimums with exact maximums in More filters', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const quickFilters = screen.getByRole('search', { name: /property search filters/i });
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /minimum beds/i }), '3');
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /minimum baths/i }), '2');

        await user.click(within(quickFilters).getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        await user.type(within(filterDialog).getByRole('spinbutton', { name: /home basics maximum beds/i }), '3');
        await user.type(within(filterDialog).getByRole('spinbutton', { name: /home basics maximum baths/i }), '3');

        expect(screen.getByText(/9 Chestnut Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/1 Worcester Road/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/44 South Shore Road/i)).not.toBeInTheDocument();
    });

    it('summarizes every active quick filter and resets the full search in one action', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const quickFilters = screen.getByRole('search', { name: /property search filters/i });
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /property type/i }), 'Single family');
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /price range shortcut/i }), '$750K-$1.5M');
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /minimum beds/i }), '3');
        await user.selectOptions(within(quickFilters).getByRole('combobox', { name: /minimum baths/i }), '2');

        expect(within(quickFilters).getByRole('button', { name: /remove single family/i })).toBeInTheDocument();
        expect(within(quickFilters).getByRole('button', { name: /remove price: \$750k-\$1\.5m/i })).toBeInTheDocument();
        expect(within(quickFilters).getByRole('button', { name: /remove beds: 3\+/i })).toBeInTheDocument();
        expect(within(quickFilters).getByRole('button', { name: /remove baths: 2\+/i })).toBeInTheDocument();
        expect(within(quickFilters).getByRole('button', { name: /more filters.*4/i })).toBeInTheDocument();

        await user.click(within(quickFilters).getByRole('button', { name: /reset all/i }));

        expect(within(quickFilters).getByRole('combobox', { name: /property type/i })).toHaveValue('All');
        expect(within(quickFilters).getByRole('combobox', { name: /price range shortcut/i })).toHaveValue('Any');
        expect(within(quickFilters).getByRole('combobox', { name: /minimum beds/i })).toHaveValue('');
        expect(within(quickFilters).getByRole('combobox', { name: /minimum baths/i })).toHaveValue('');
        expect(within(quickFilters).queryByRole('group', { name: /active advanced filters/i })).not.toBeInTheDocument();
        expect(within(quickFilters).queryByRole('button', { name: /reset all/i })).not.toBeInTheDocument();
    });

    it('normalizes inverted bedroom and bathroom ranges instead of silently returning no homes', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const dialog = screen.getByRole('dialog', { name: /more filters/i });
        const minBeds = within(dialog).getByRole('spinbutton', { name: /home basics minimum beds/i });
        const maxBeds = within(dialog).getByRole('spinbutton', { name: /home basics maximum beds/i });
        const minBaths = within(dialog).getByRole('spinbutton', { name: /home basics minimum baths/i });
        const maxBaths = within(dialog).getByRole('spinbutton', { name: /home basics maximum baths/i });

        await user.type(maxBeds, '3');
        await user.type(minBeds, '4');
        expect(minBeds).toHaveValue(4);
        expect(maxBeds).toHaveValue(4);

        await user.type(maxBaths, '2');
        await user.type(minBaths, '3');
        expect(minBaths).toHaveValue(3);
        expect(maxBaths).toHaveValue(3);
    });

    it('keeps property type, beds, and baths available in the More filters Home basics section', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /^more filters$/i }));
        const dialog = screen.getByRole('dialog', { name: /more filters/i });
        const basics = within(dialog).getByRole('heading', { name: /home basics/i }).closest('section');
        expect(basics).not.toBeNull();
        const basicsView = within(basics as HTMLElement);
        await user.selectOptions(basicsView.getByRole('combobox', { name: /home basics property type/i }), 'Single family');
        await user.type(basicsView.getByRole('spinbutton', { name: /home basics minimum beds/i }), '3');
        await user.type(basicsView.getByRole('spinbutton', { name: /home basics maximum beds/i }), '4');
        await user.type(basicsView.getByRole('spinbutton', { name: /home basics minimum baths/i }), '2');
        await user.type(basicsView.getByRole('spinbutton', { name: /home basics maximum baths/i }), '3');

        expect(within(dialog).getByRole('button', { name: /view 2 homes/i })).toBeInTheDocument();
        expect(within(dialog).queryByText(/homes match/i, { selector: 'p' })).not.toBeInTheDocument();
        expect(screen.queryByText(/12 Beacon Street/i)).not.toBeInTheDocument();
    });

    it('uses removable active chips for advanced filters', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const quickFilters = screen.getByRole('search', { name: /property search filters/i });
        const addressSearch = within(quickFilters).getByRole('searchbox', { name: /address search/i });
        await user.type(addressSearch, 'Salem');
        await user.click(within(quickFilters).getByRole('button', { name: /search location/i }));

        const searchChip = screen.getByRole('button', { name: /remove search: salem/i });
        const chipRule = cssRuleFor('.activeFilterChips button');

        expect(searchChip).toHaveTextContent(/Search: Salem/i);
        expect(chipRule).toContain('border-radius: 999px;');
        expect(chipRule).toContain('background: rgba(49, 95, 91, 0.07);');
        await user.click(searchChip);
        expect(screen.queryByRole('button', { name: /remove search: salem/i })).not.toBeInTheDocument();
    });

    it('does not count address, map-area, or Saved Homes state in the More filters badge', async () => {
        const user = userEvent.setup();
        localStorage.setItem('move-with-musto.properties.saved', JSON.stringify(['73333444']));
        const mapArea: MapAreaSelection = {
            label: 'Selected map area',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71.1 },
            listingNumbers: ['73333444'],
            resultCount: 1,
            coverage: { eligibleCount: 4, attemptedCount: 4, mappedCount: 4, isLimited: false },
        };
        window.history.pushState({}, '', '/properties/?query=Mount%20Vernon');
        render(<PropertiesSearch initialBundle={bundle} initialMapArea={mapArea} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /show saved homes, 1 saved/i }));

        expect(screen.getByRole('button', { name: /^more filters$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /remove search: mount vernon/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /remove map area/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
    });

    it('keeps the complete MLS market-area city and town list visible', () => {
        render(
            <PropertiesSearch
                initialBundle={{
                    ...bundle,
                    compliance: {
                        ...bundle.compliance,
                        marketArea:
                            'Acton, Amesbury, Andover, Arlington, Bedford, Belmont, Beverly, Boxford, Burlington, Cambridge, Carlisle, Chelmsford, Concord, Danvers, Essex, Georgetown, Gloucester, Groton, Hamilton, Ipswich, Lexington, Lynn, Lynnfield, Malden, Manchester-by-the-Sea, Marblehead, Medford, Melrose, Middleton, Nahant, Newbury, Newburyport, Newton, North Andover, North Reading, Peabody, Reading, Revere, Rockport, Rowley, Salem, Saugus, Somerville, Stoneham, Swampscott, Tewksbury, Topsfield, Wakefield, Waltham, Watertown, Wenham, West Newbury, Westford, Wilmington, Winchester, Woburn',
                    },
                }}
                {...profileProps}
            />,
        );

        const disclosure = screen.getByLabelText(/mls listing disclosure and participant information/i);
        expect(disclosure).toHaveTextContent(/Acton, Amesbury, Andover, Arlington/i);
        expect(disclosure).toHaveTextContent(/Wilmington, Winchester, Woburn/i);
        expect(screen.queryByRole('button', { name: /show full market area/i })).not.toBeInTheDocument();
    });

    it('shows maintenance instead of search controls when reviewed MLS data exceeds the three-day refresh limit', () => {
        render(
            <PropertiesSearch
                initialBundle={{
                    ...bundle,
                    generatedAt: new Date(Date.now() - (4 * 24 * 60 * 60 * 1000)).toISOString(),
                }}
                {...profileProps}
            />,
        );

        expect(screen.getByRole('heading', { name: /home search is temporarily unavailable/i })).toBeInTheDocument();
        expect(screen.getByText(/^home search$/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^try again$/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /send an email/i })).toHaveAttribute(
            'href',
            `mailto:${profileProps.contact.email}`,
        );
        expect(screen.getByRole('link', { name: /call/i })).toHaveAttribute(
            'href',
            profileProps.contact.phoneHref,
        );
        expect(screen.queryByRole('heading', { name: /mls import pending/i })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/property search filters/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();
    });

    it('shows maintenance when the search index is missing', async () => {
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);

        render(<PropertiesSearch {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /home search is temporarily unavailable/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /mls import pending/i })).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/property search filters/i)).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock).toHaveBeenNthCalledWith(1, '/mls/mls-search-manifest.json', { cache: 'no-store' });
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/mls/mls-search-index.json', { cache: 'no-store' });
    });

    it('retries a missing search index and restores the workspace when delivery recovers', async () => {
        const user = userEvent.setup();
        const observer = installControllableIntersectionObserver();
        const delivery = toShardedSearchDelivery();
        let deliveryAvailable = false;
        vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (!deliveryAvailable) {
                return { ok: false, status: 503 } as Response;
            }
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                return { ok: true, json: async () => delivery.preferred } as Response;
            }
            throw new Error(`Unexpected MLS request: ${url}`);
        });

        render(<PropertiesSearch {...profileProps} />);

        const retryButton = await screen.findByRole('button', { name: /^try again$/i });
        deliveryAvailable = true;
        await user.click(retryButton);

        expect(await screen.findByLabelText(/property search filters/i)).toBeInTheDocument();
        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /home search is temporarily unavailable/i })).not.toBeInTheDocument();
        const sentinel = document.querySelector(`.${styles.filterCapsuleSentinel}`)!;
        act(() => observer.notify(sentinel, false));
        expect(document.querySelector(`.${styles.filterCapsuleCompact}`)).toBeInTheDocument();
    });

    it('bypasses a cached invalid preferred shard on explicit retry', async () => {
        const user = userEvent.setup();
        const delivery = toShardedSearchDelivery();
        let repaired = false;
        const shardCacheModes: RequestCache[] = [];
        vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url === '/mls/mls-search-manifest.json') {
                return { ok: true, json: async () => delivery.manifest } as Response;
            }
            if (url === generationUrl('/mls/mls-search-preferred.json', delivery.manifest.generatedAt)) {
                shardCacheModes.push(init?.cache ?? 'default');
                // Model a browser retaining the invalid first response unless cache is bypassed.
                const value = repaired && init?.cache === 'no-store' ? delivery.preferred : { ...delivery.preferred, listings: [] };
                return { ok: true, json: async () => value } as Response;
            }
            return { ok: false, status: 503 } as Response;
        });
        render(<PropertiesSearch {...profileProps} />);
        const retry = await screen.findByRole('button', { name: /^try again$/i });
        repaired = true;
        await user.click(retry);
        expect(await screen.findByLabelText(/property search filters/i)).toBeInTheDocument();
        expect(shardCacheModes).toEqual(['force-cache', 'no-store']);
    });

    it('restores saved and compared homes from localStorage without PII', () => {
        localStorage.setItem('move-with-musto.properties.saved', JSON.stringify(['73333444']));
        localStorage.setItem('move-with-musto.properties.selected', JSON.stringify(['73333444']));
        localStorage.setItem('move-with-musto.properties.filters', JSON.stringify({
            status: 'ACT',
            town: 'Boston',
            state: 'NH',
            includeTowns: ['Nantucket'],
            excludeTowns: ['Worcester'],
        }));

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.getByRole('button', { name: /^saved$/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText(/^1 comparing$/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /compare homes, 1 selected/i })).toHaveTextContent('1');
        expect(screen.queryByRole('button', { name: /remove town: boston/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove include nantucket/i })).not.toBeInTheDocument();
        expect(screen.getByText(/44 South Shore Road/i)).toBeInTheDocument();
        expect(localStorage.getItem('move-with-musto.properties.saved')).not.toContain('@');
    });

    it('shows saved homes moving into the saved-homes destination', async () => {
        const user = userEvent.setup();
        const { container } = render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.queryByRole('button', { name: /show saved homes/i })).not.toBeInTheDocument();
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));

        const savedHomesButton = screen.getByRole('button', { name: /show saved homes, 1 saved/i });
        expect(container.querySelector(`.${styles.savedCheers}`)).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^saved$/i })[0]).toHaveAttribute('aria-pressed', 'true');

        await user.click(savedHomesButton);
        expect(screen.getByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).get('saved')).toBe('1');
        expect(window.location.search).not.toContain('73333444');
    });

    it('builds the saved-home email in save order with complete property details', async () => {
        const user = userEvent.setup();
        render(
            <PropertiesSearch
                initialBundle={bundle}
                {...profileProps}
                inquiry={{ action: undefined, method: 'post' }}
            />,
        );

        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /show saved homes, 2 saved/i }));

        await user.click(screen.getByRole('button', { name: /send 2 saved homes to mai ly/i }));
        const drawer = screen.getByRole('dialog', { name: /send these homes to mai ly/i });
        expect(within(drawer).getByText(/2 homes included/i)).toBeInTheDocument();
        expect(within(drawer).getByText(/all 2 homes.*address, price, mls number, and detail link/i))
            .toBeInTheDocument();

        const emailLink = within(drawer).getByRole('link', { name: /open email with 2 homes/i });
        const decodedEmailHref = decodeURIComponent(emailLink.getAttribute('href') ?? '');
        const hinghamUrl = new URL('/properties/', window.location.origin);
        hinghamUrl.searchParams.set('listing', '73333447');
        const bostonUrl = new URL('/properties/', window.location.origin);
        bostonUrl.searchParams.set('listing', '73333444');
        const hinghamBlock = [
            '- 44 South Shore Road, Hingham',
            '  $1,150,000 \u00b7 MLS #73333447',
            `  ${hinghamUrl.href}`,
        ].join('\n');
        const bostonBlock = [
            '- 86 Mount Vernon Street, Boston',
            '  $8,990,000 \u00b7 MLS #73333444',
            `  ${bostonUrl.href}`,
        ].join('\n');

        expect(decodedEmailHref).toContain('subject=2 homes to review');
        expect(decodedEmailHref).toContain(hinghamBlock);
        expect(decodedEmailHref).toContain(bostonBlock);
        expect(decodedEmailHref.indexOf(hinghamBlock)).toBeLessThan(decodedEmailHref.indexOf(bostonBlock));
    });

    it('submits saved homes through the in-page contact form instead of opening an email client', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /show saved homes, 2 saved/i }));
        await user.click(screen.getByRole('button', { name: /send 2 saved homes to mai ly/i }));

        const drawer = screen.getByRole('dialog', { name: /send these homes to mai ly/i });
        expect(within(drawer).queryByRole('link', { name: /open email/i })).not.toBeInTheDocument();
        expect(within(drawer).getByText(/2 homes included/i)).toBeInTheDocument();
        expect(within(drawer).getByText('Message (optional)')).toBeInTheDocument();
        expect(within(drawer).getByLabelText(/^message$/i)).not.toBeRequired();

        await user.click(within(drawer).getByRole('button', {
            name: /remove 44 south shore road, hingham from this request/i,
        }));
        expect(within(drawer).getByText(/^home included$/i)).toBeInTheDocument();
        expect(within(drawer).queryByText(/44 south shore road/i)).not.toBeInTheDocument();
        expect(within(drawer).getByRole('button', { name: /back to saved homes/i })).toBeInTheDocument();
        expect(localStorage.getItem('move-with-musto.properties.saved')).toContain('73333447');

        await user.type(within(drawer).getByLabelText(/^name$/i), 'Saved Homes Buyer');
        await user.type(within(drawer).getByLabelText(/^email$/i), 'buyer@example.com');
        await user.click(within(drawer).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        await user.click(within(drawer).getByRole('button', { name: /send request/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 3_000 });
        expect(fetchMock.mock.calls[0][0]).toBe('https://data.movewithmusto.com/inquiries');
        const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(payload.requestType).toBe('send_selected_homes');
        expect(payload.selectedMlsNumbers).toEqual(['73333444']);
        expect(payload.attachedListings).toHaveLength(1);
        expect(payload.attachedListings[0].listingNumber).toBe('73333444');
        expect(payload.freeformMessage).toBe('');
    });

    it('requires saved lists over twenty homes to be narrowed before sending', async () => {
        const savedBundle: MlsPublicBundle = {
            ...bundle,
            listings: Array.from({ length: 21 }, (_, index) => makeListing(index + 1)),
        };
        localStorage.setItem(
            'move-with-musto.properties.saved',
            JSON.stringify(savedBundle.listings.map((listing) => listing.listingNumber)),
        );
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={savedBundle} {...profileProps} />);

        await user.click(await screen.findByRole('button', { name: /show saved homes, 21 saved/i }));

        expect(screen.getByText(/remove 1 home to send the full list/i)).toBeInTheDocument();
        expect(screen.getByText(/compare up to four homes instead/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /send .*saved homes to mai ly/i })).not.toBeInTheDocument();
    });

    it('moves focus to the next saved card, then offers a return to search when the final saved card is removed', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /show saved homes, 2 saved/i }));

        const firstSavedButton = within(listingCardFor('86 Mount Vernon Street')).getByRole('button', {
            name: /^saved$/i,
        });
        const secondSavedButton = within(listingCardFor('44 South Shore Road')).getByRole('button', {
            name: /^saved$/i,
        });
        await user.click(firstSavedButton);
        await waitFor(() => expect(secondSavedButton).toHaveFocus());

        await user.click(secondSavedButton);
        expect(screen.getByRole('heading', { name: /ready to look again/i })).toBeInTheDocument();
        expect(screen.getByText(/your saved list is clear/i)).toBeInTheDocument();
        const returnToSearch = screen.getByRole('button', { name: /return to home search/i });
        await waitFor(() => expect(returnToSearch).toHaveFocus());

        await user.click(returnToSearch);
        await waitFor(() => expect(screen.queryByRole('heading', { name: /ready to look again/i })).not.toBeInTheDocument());
        expect(screen.getByText(/across the burlington-centered service area/i)).toBeInTheDocument();
    });

    it('restores the Saved Homes URL view through reload, Back, and Forward without sharing saved IDs', async () => {
        const user = userEvent.setup();
        window.history.replaceState({}, '', '/properties/?query=Boston');
        const firstRender = render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await waitFor(() => expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('Boston'));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /show saved homes, 1 saved/i }));
        expect(await screen.findByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).get('saved')).toBe('1');
        expect(window.location.search).not.toContain('73333444');
        await waitFor(() => expect(localStorage.getItem('move-with-musto.properties.saved')).toContain('73333444'));

        firstRender.unmount();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);
        expect(await screen.findByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();

        act(() => window.history.back());
        await waitFor(() => expect(screen.queryByRole('button', { name: /remove saved only/i })).not.toBeInTheDocument());
        expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('Boston');
        expect(screen.getByText(/across the burlington-centered service area/i)).toBeInTheDocument();

        act(() => window.history.forward());
        expect(await screen.findByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).get('saved')).toBe('1');
        expect(screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();
    });

    it('keeps property contact contextual to details with an action selector in the drawer', async () => {
        const user = userEvent.setup();
        render(
            <PropertiesSearch
                appointmentCta={{
                    label: 'Book an appointment now',
                    href: 'https://calendly.example/maily',
                }}
                initialBundle={bundle}
                {...profileProps}
            />,
        );

        expect(screen.queryByRole('button', { name: /^ask about a home$/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^plan a showing$/i })).not.toBeInTheDocument();
        const listingCard = listingCardFor('86 Mount Vernon Street');
        expect(within(listingCard).queryByRole('button', { name: /ask about this home/i })).not.toBeInTheDocument();

        await user.click(within(listingCard).getByRole('button', { name: /view details/i }));
        const details = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(details).getByRole('button', { name: /ask about this home/i }));

        const dialog = screen.getByRole('dialog', { name: /ask about this home/i });
        const appointmentLink = within(dialog).getByRole('link', { name: /book an appointment now/i });

        expect(document.body.style.overflow).toBe('hidden');
        expect(within(dialog).getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(appointmentLink).toHaveClass(styles.drawerBookingCta);
        expect(appointmentLink).toHaveAttribute('href', 'https://calendly.example/maily');
        expect(appointmentLink).toHaveAttribute('target', '_blank');
        expect(within(dialog).queryByText(/property lead delivery is being connected/i)).not.toBeInTheDocument();
        expect(within(dialog).getByLabelText(/mls listing disclosure and participant information/i)).toHaveTextContent(
            /personal, non-commercial use/i,
        );
        const requestTypeSelect = within(dialog).getByRole('combobox', {
            name: /what would you like help with/i,
        });
        expect(within(requestTypeSelect).getByRole('option', { name: /ask about a home/i })).toBeInTheDocument();
        expect(within(requestTypeSelect).getByRole('option', { name: /plan a showing/i })).toBeInTheDocument();
        expect(within(requestTypeSelect).getByRole('option', { name: /ask a question/i })).toBeInTheDocument();

        const phoneField = within(dialog).getByRole('textbox', { name: /phone.*optional/i });
        expect(phoneField).not.toBeRequired();
        await user.selectOptions(requestTypeSelect, 'request_showing');
        expect(within(dialog).getByRole('textbox', { name: /phone.*required/i })).toBe(phoneField);
        expect(phoneField).toBeRequired();
        expect(within(dialog).getByLabelText(/property address or move with musto listing link/i)).toBeInTheDocument();
        expect(within(dialog).getByRole('checkbox', {
            name: /terms.*privacy policy.*email or phone follow-up/i,
        })).toBeRequired();
        expect(within(dialog).queryByRole('checkbox', { name: /authorize move with musto/i })).not.toBeInTheDocument();
        expect(within(dialog).queryByText(/text|sms/i)).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /^close$/i }));
        expect(document.body.style.overflow).toBe('');
    });

    it('submits a search consult payload with context without storing PII locally', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const details = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(details).getByRole('button', { name: /ask about this home/i }));

        const dialog = screen.getByRole('dialog', { name: /ask about this home/i });
        await user.type(within(dialog).getByLabelText(/^name$/i), 'Buyer One');
        await user.type(within(dialog).getByLabelText(/^email$/i), 'buyer@example.com');
        await user.type(within(dialog).getByLabelText(/phone.*optional/i), '781-555-0101');
        await user.type(
            within(dialog).getByLabelText(/property address or move with musto listing link/i),
            'https://movewithmusto.com/buy/properties/?listing=73333444',
        );
        await user.type(within(dialog).getByLabelText(/^message$/i), 'Can you help me compare this one?');
        await user.click(within(dialog).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        await user.click(within(dialog).getByRole('checkbox', { name: /send me property matches/i }));
        await user.click(within(dialog).getByRole('button', { name: /send request/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(fetchMock.mock.calls[0][0]).toBe('https://data.movewithmusto.com/inquiries');
        const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

        expect(payload).toMatchObject({
            schemaVersion: 'move-with-musto.search-consult-lead.v1',
            leadType: 'search_consult',
            delivery: 'email_fallback',
            requestType: 'request_details',
            activeRegion: 'Burlington-area service area',
            searchAreaLabel: 'Burlington-area service area',
            searchAreaBounds: null,
            freeformMessage: 'Can you help me compare this one?',
            message: 'Can you help me compare this one?',
            selectedMlsNumbers: ['73333444'],
            filters: {
                region: 'Burlington-area service area',
                state: 'MA',
                mode: 'list',
            },
            termsAccepted: true,
            privacyAccepted: true,
            contactAuthorized: true,
            emailUpdatesOptIn: true,
            termsVersion: '2026-06-16',
            privacyVersion: '2026-06-16',
            consent: {
                termsVersion: '2026-06-16',
                privacyVersion: '2026-06-16',
            },
        });
        expect(payload.attachedListings[0]).toMatchObject({
            listingNumber: '73333444',
            town: 'Boston',
        });
        expect(new URL(payload.attachedListings[0].detailUrl).searchParams.get('listing')).toBe('73333444');

        const storedValues = [
            localStorage.getItem('move-with-musto.properties.saved'),
            localStorage.getItem('move-with-musto.properties.selected'),
            localStorage.getItem('move-with-musto.properties.filters'),
        ].join(' ');
        expect(storedValues).not.toContain('Buyer One');
        expect(storedValues).not.toContain('buyer@example.com');
        expect(storedValues).not.toContain('781-555-0101');
        expect(storedValues).not.toContain('Can you help me compare this one?');
    });

    it('keeps a showing request classified correctly and resets a completed drawer for another request', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const details = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(details).getByRole('button', { name: /request a showing/i }));

        const drawer = await screen.findByRole('dialog', { name: /plan a showing/i });
        expect(within(drawer).getByText(/please complete the required fields/i)).toBeInTheDocument();
        expect(within(drawer).getByText('Name (required)')).toBeInTheDocument();
        expect(within(drawer).getByText('Email (required)')).toBeInTheDocument();
        expect(within(drawer).getByText('Property address or Move With Musto listing link (optional)')).toBeInTheDocument();
        expect(within(drawer).getByText('Message (optional)')).toBeInTheDocument();
        expect(within(drawer).getByLabelText(/^message$/i)).not.toBeRequired();
        expect(within(drawer).getByRole('combobox', { name: /what would you like help with/i })).toHaveValue(
            'request_showing',
        );
        expect(within(drawer).getByRole('textbox', { name: /phone.*required/i })).toBeRequired();
        expect(within(drawer).getByRole('link', { name: /^terms$/i })).toHaveAttribute('target', '_blank');
        const consentPrivacyLink = within(drawer).getAllByRole('link', { name: /privacy policy/i })
            .find((link) => link.getAttribute('href') === '/privacy/');
        expect(consentPrivacyLink).toHaveAttribute('target', '_blank');

        await user.type(within(drawer).getByLabelText(/^name$/i), 'Showing Buyer');
        await user.type(within(drawer).getByLabelText(/^email$/i), 'showing@example.com');
        await user.type(within(drawer).getByLabelText(/phone.*required/i), '781-555-0102');
        await user.type(within(drawer).getByLabelText(/^message$/i), 'Tuesday afternoon works.');
        await user.click(within(drawer).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        await user.click(within(drawer).getByRole('button', { name: /send request/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
            requestType: 'request_showing',
        });
        const successMessage = await within(drawer).findByText(/thanks.*your request was sent/i);
        await waitFor(() => expect(successMessage.parentElement).toHaveFocus());

        await user.click(within(drawer).getByRole('button', { name: /ask about something else/i }));
        const freshDrawer = await screen.findByRole('dialog', { name: /help me find homes/i });
        await waitFor(() => expect(freshDrawer).toContainElement(document.activeElement as HTMLElement));
        expect(within(freshDrawer).getByRole('button', { name: /^close$/i })).toHaveFocus();
        expect(within(freshDrawer).queryByText(/thanks.*your request was sent/i)).not.toBeInTheDocument();
        expect(within(freshDrawer).getByLabelText(/^name$/i)).toHaveValue('');
        expect(within(freshDrawer).getByRole('combobox', { name: /preferred contact/i })).toHaveValue('email');
    });

    it('requires a phone number whenever phone is the preferred contact method', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const details = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(details).getByRole('button', { name: /ask about this home/i }));
        const drawer = screen.getByRole('dialog', { name: /ask about this home/i });
        await user.selectOptions(within(drawer).getByRole('combobox', { name: /preferred contact/i }), 'phone');
        const phone = within(drawer).getByRole('textbox', { name: /phone.*required/i });
        expect(phone).toBeRequired();

        await user.type(within(drawer).getByLabelText(/^name$/i), 'Phone Buyer');
        await user.type(within(drawer).getByLabelText(/^email$/i), 'phone@example.com');
        await user.type(within(drawer).getByLabelText(/^message$/i), 'Please call me.');
        await user.click(within(drawer).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        fireEvent.submit(phone.closest('form')!);

        expect(await within(drawer).findByText(/please add a phone number for a phone reply/i)).toBeInTheDocument();
        expect(phone).toHaveFocus();
    });

    it('does not treat Enter on a live quick filter as a new location search', async () => {
        const user = userEvent.setup();
        const onMapAreaChange = vi.fn();
        const mapArea: MapAreaSelection = {
            label: 'Selected map area',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71.1 },
            listingNumbers: ['73333444'],
            resultCount: 1,
            coverage: { eligibleCount: 4, attemptedCount: 4, mappedCount: 4, isLimited: false },
        };
        render(
            <PropertiesSearch
                initialBundle={bundle}
                initialMapArea={mapArea}
                onMapAreaChange={onMapAreaChange}
                {...profileProps}
            />,
        );

        const minimumBeds = screen.getByRole('combobox', { name: /minimum beds/i });
        await user.selectOptions(minimumBeds, '4');
        await user.click(minimumBeds);
        await user.keyboard('{Enter}');

        expect(screen.getByRole('button', { name: /remove map area: 1 home/i })).toBeInTheDocument();
        expect(onMapAreaChange).not.toHaveBeenCalled();
    });

    it('keeps Enter activation working for Search, More filters, and Reset all', async () => {
        const user = userEvent.setup();
        const onMapAreaChange = vi.fn();
        const mapArea: MapAreaSelection = {
            label: 'Selected map area',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71.1 },
            listingNumbers: ['73333444'],
            resultCount: 1,
            coverage: { eligibleCount: 4, attemptedCount: 4, mappedCount: 4, isLimited: false },
        };
        render(
            <PropertiesSearch
                initialBundle={bundle}
                initialMapArea={mapArea}
                onMapAreaChange={onMapAreaChange}
                {...profileProps}
            />,
        );

        const moreFilters = screen.getByRole('button', { name: /more filters/i });
        moreFilters.focus();
        await user.keyboard('{Enter}');
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        expect(filterDialog).toBeInTheDocument();
        await user.click(within(filterDialog).getByRole('button', { name: /close more filters/i }));
        await waitFor(() => expect(moreFilters).toHaveFocus());

        await user.type(screen.getByRole('searchbox', { name: /^address search$/i }), 'Boston');
        const findHomes = screen.getByRole('button', { name: /search location/i });
        findHomes.focus();
        await user.keyboard('{Enter}');
        expect(screen.getByRole('button', { name: /remove search: boston/i })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove map area/i })).not.toBeInTheDocument();
        expect(onMapAreaChange).toHaveBeenCalledWith(null);
        await waitFor(() => expect(
            screen.getByRole('region', { name: /property search results/i }),
        ).toHaveFocus());

        const clear = screen.getByRole('button', { name: /reset all/i });
        clear.focus();
        await user.keyboard('{Enter}');
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /remove search: boston/i })).not.toBeInTheDocument();
        });
    });

    it('applies live filters to Saved Homes and restores the prior search on return', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        await user.type(within(filterDialog).getByRole('spinbutton', { name: /home basics minimum beds/i }), '6');
        await user.click(within(filterDialog).getByRole('button', { name: /close more filters/i }));
        const minimumBeds = screen.getByRole('combobox', { name: /minimum beds/i });
        await user.click(screen.getByRole('button', { name: /show saved homes, 1 saved/i }));

        expect(screen.getByRole('heading', { name: /no matching saved homes/i })).toBeInTheDocument();
        await user.selectOptions(minimumBeds, '5');
        expect(screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /back to search/i }));
        expect(screen.getByRole('combobox', { name: /minimum beds/i })).toHaveValue('6');
        expect(screen.queryByRole('button', { name: /all reviewed mls listings/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove saved only/i })).not.toBeInTheDocument();
    });

    it('preserves an incompatible location query while keeping service-only inventory', async () => {
        window.history.pushState({}, '', '/properties/?query=Nantucket&scope=all');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(await screen.findByRole('heading', { name: /^no matching homes/i })).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('Nantucket');
        expect(screen.queryByRole('heading', { name: /3 Harbor View Lane/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /search all reviewed listings/i })).not.toBeInTheDocument();
        await waitFor(() => expect(new URLSearchParams(window.location.search).has('scope')).toBe(false));
    });

    it('keeps lead-drawer and disclosure scrolling visible and stable', () => {
        const drawerFormRule = propertiesCss.match(
            /\.drawerForm,\s*\.successPanel,\s*\.drawerFallback\s*{[^}]+}/,
        )?.[0] ?? '';
        const disclosureRule = cssRuleFor('.drawerDisclosurePanel .screenDisclosure');

        expect(drawerFormRule).toContain('overflow-y: auto;');
        expect(drawerFormRule).toContain('scrollbar-width: thin;');
        expect(drawerFormRule).toContain('scrollbar-gutter: stable;');
        expect(propertiesCss).toContain('.drawerForm::-webkit-scrollbar');
        expect(propertiesCss).toContain('.drawerFallback::-webkit-scrollbar');
        expect(propertiesCss).toContain('display: block;');
        expect(disclosureRule).toContain('overflow-y: auto;');
        expect(disclosureRule).toContain('scrollbar-width: thin;');
        expect(disclosureRule).toContain('scrollbar-gutter: stable;');
        expect(propertiesCss).toMatch(/\.mapDrawerBackdrop\[hidden\]\s*{[^}]*display:\s*none\s*!important;/);
    });

    it('keeps desktop map chrome compact and visually emphasizes the map launcher', () => {
        const previewCardRule = cssRuleFor('.mapPreviewCard');
        const mapDockRule = cssRuleFor('.mapDrawerDock');
        const mapSavedHomesRule = cssRuleFor('.savedHomesDockOnMap');

        expect(previewCardRule).toContain('border-color: rgba(49, 95, 91, 0.38);');
        expect(previewCardRule).toContain('linear-gradient');
        expect(mapDockRule).toContain('justify-content: flex-end;');
        expect(mapDockRule).toContain('border-top: 1px solid rgba(23, 24, 24, 0.12);');
        expect(mapSavedHomesRule).toContain('position: static;');
        expect(propertiesCss).toMatch(
            /\.mapPreviewAction\s*{[^}]*background:\s*rgba\(36,\s*51,\s*50,\s*0\.94\);/,
        );
        expect(propertiesCss).toMatch(
            /@media \(min-width: 1024px\)[\s\S]*?\.mapDrawerHeader button\s*{[^}]*min-height:\s*1\.9rem;/,
        );
        expect(propertiesCss).toMatch(
            /@media \(min-width: 1024px\)[\s\S]*?\.mapToolbar button\s*{[^}]*min-height:\s*1\.9rem;/,
        );
    });

    it('keeps the desktop contact and collection actions inside the sticky map rail', async () => {
        const user = userEvent.setup();
        const searchRailRule = cssRuleFor('.searchRail');
        const contactStackRule = cssRuleFor('.savedHomesDockStack');
        const contactButtonRule = cssRuleFor('.searchHelpDockButton');

        expect(searchRailRule).toContain('position: sticky;');
        expect(searchRailRule).toContain('overflow: visible;');
        expect(searchRailRule).not.toContain('overflow-y: auto;');
        expect(contactStackRule).toContain('position: fixed;');
        expect(contactStackRule).toContain('display: grid;');
        expect(contactButtonRule).toContain('width: 100%;');
        expect(contactButtonRule).toContain('background: #315f5b;');
        expect(propertiesCss).toMatch(
            /@media \(min-width: 901px\)[\s\S]*?\.savedHomesDockStack\s*{[^}]*position:\s*static;[^}]*width:\s*100%;/,
        );
        expect(propertiesCss).toMatch(
            /\.savedHomesDockStack \.savedHomesDockWithComparison\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
        );

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const searchRail = screen.getByRole('complementary', { name: /map and listing status/i });
        const actionGroup = within(searchRail).getByRole('group', {
            name: /search contact and home collections/i,
        });
        const contactButton = within(actionGroup).getByRole('button', { name: /contact mai ly/i });
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));

        expect(within(actionGroup).getByLabelText(/saved and compared homes/i)).toBeInTheDocument();
        await user.click(contactButton);

        const contactDialog = await screen.findByRole('dialog', { name: /help me find homes/i });
        expect(within(contactDialog).getByText(/^home included$/i)).toBeInTheDocument();
        expect(within(contactDialog).getByText(/86 mount vernon street/i)).toBeInTheDocument();
        expect(within(contactDialog).getByRole('button', {
            name: /remove 86 mount vernon street, boston from this request/i,
        })).toBeInTheDocument();

        await user.click(within(contactDialog).getByRole('button', { name: /back to saved homes/i }));
        expect(await screen.findByRole('heading', { name: /^saved homes$/i })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /help me find homes/i })).not.toBeInTheDocument();
    });

    it('gives the saved-homes send action its own prominent visual hierarchy', () => {
        const savedActionsRule = cssRuleFor('.savedViewActions');
        const savedSendRule = propertiesCss.match(
            /\.savedViewActions \.savedSendButton\s*{[^}]+}/,
        )?.[0] ?? '';

        expect(savedActionsRule).toContain('flex-wrap: nowrap;');
        expect(savedActionsRule).toContain('width: min(100%, 32rem);');
        expect(savedSendRule).toContain('min-height: 3.4rem;');
        expect(savedSendRule).toContain('background: #315f5b;');
        expect(savedSendRule).toContain('box-shadow:');
        expect(propertiesCss).toMatch(
            /\.savedSendButton small\s*{[^}]*text-transform:\s*none;/,
        );
    });

    it('aligns the price rail endpoints and thumbs on one centerline', () => {
        const sliderStackRule = cssRuleFor('.sliderStack');
        const sliderTrackRule = cssRuleFor('.sliderTrack');

        expect(sliderStackRule).toContain(
            '--price-slider-thumb-radius: calc(var(--price-slider-thumb-size) / 2);',
        );
        expect(sliderStackRule).toContain('--price-slider-thumb-offset: calc(');
        expect(sliderStackRule).toContain(
            '(var(--price-slider-track-size) - var(--price-slider-thumb-size)) / 2',
        );
        expect(sliderTrackRule).toContain('right: var(--price-slider-thumb-radius);');
        expect(sliderTrackRule).toContain('left: var(--price-slider-thumb-radius);');
        expect(sliderTrackRule).toContain('height: var(--price-slider-track-size);');
        expect(propertiesCss).toMatch(
            /::-webkit-slider-thumb\s*{[^}]*margin-top:\s*var\(--price-slider-thumb-offset\);/,
        );
    });

    it('uses range sliders and numeric fields for price filtering', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        expect(within(filterDialog).queryByRole('button', { name: /price range/i })).not.toBeInTheDocument();
        const priceGroup = within(filterDialog).getByRole('group', { name: /price range/i });
        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('max', '3000000');
        expect(within(priceGroup).getByRole('slider', { name: /maximum price/i })).toHaveAttribute('max', '3000000');
        expect(within(priceGroup).getByRole('button', { name: /\$750k-\$1\.5m/i })).toBeInTheDocument();

        fireEvent.click(within(priceGroup).getByRole('button', { name: /\$750k-\$1\.5m/i }));

        expect(within(priceGroup).getByRole('spinbutton', { name: /minimum price/i })).toHaveValue(750000);
        expect(within(priceGroup).getByRole('spinbutton', { name: /maximum price/i })).toHaveValue(1500000);
        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('min', '750000');
        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('max', '1500000');
        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveValue('750000');
        expect(within(priceGroup).getByRole('slider', { name: /maximum price/i })).toHaveValue('1500000');
        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();
        expect(screen.getByText(/12 Beacon Street/i)).toBeInTheDocument();

        const maximumPriceInput = within(priceGroup).getByRole('spinbutton', { name: /maximum price/i });
        fireEvent.change(maximumPriceInput, {
            target: { value: '1000000' },
        });
        fireEvent.blur(maximumPriceInput);

        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('min', '750000');
        expect(within(priceGroup).getByRole('slider', { name: /maximum price/i })).toHaveAttribute('max', '1000000');
        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();
        expect(screen.getByText(/12 Beacon Street/i)).toBeInTheDocument();

        fireEvent.click(within(priceGroup).getByRole('button', { name: /\$3m\+/i }));

        expect(within(priceGroup).getByRole('spinbutton', { name: /minimum price/i })).toHaveValue(3000000);
        expect(within(priceGroup).getByRole('spinbutton', { name: /maximum price/i })).toHaveValue(null);
        expect(within(priceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('min', '3000000');
        expect(within(priceGroup).getByRole('slider', { name: /maximum price/i })).toHaveAttribute('max', '20000000');
        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
    });

    it('restores the price slider domain on history navigation without shrinking it during a drag', async () => {
        const user = userEvent.setup();
        window.history.replaceState({}, '', '/properties/?minPrice=750000&maxPrice=1500000');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const initialPriceGroup = screen.getByRole('group', { name: /price range/i });
        expect(within(initialPriceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('min', '750000');
        fireEvent.click(within(initialPriceGroup).getByRole('button', { name: /\$3m\+/i }));
        expect(within(initialPriceGroup).getByRole('slider', { name: /minimum price/i })).toHaveAttribute('min', '3000000');

        // Reproduce the URL and popstate delivered by Back/Forward. Restoration
        // must update the slider's domain as well as its numeric filter values.
        act(() => {
            window.history.replaceState({}, '', '/properties/?minPrice=750000&maxPrice=1500000');
            window.dispatchEvent(new PopStateEvent('popstate'));
        });
        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const restoredPriceGroup = screen.getByRole('group', { name: /price range/i });
        const minimumSlider = within(restoredPriceGroup).getByRole('slider', { name: /minimum price/i });
        const maximumSlider = within(restoredPriceGroup).getByRole('slider', { name: /maximum price/i });
        expect(within(restoredPriceGroup).getByRole('spinbutton', { name: /minimum price/i })).toHaveValue(750000);
        expect(within(restoredPriceGroup).getByRole('spinbutton', { name: /maximum price/i })).toHaveValue(1500000);
        expect(minimumSlider).toHaveAttribute('min', '750000');
        expect(maximumSlider).toHaveAttribute('max', '1500000');
        expect(minimumSlider).toHaveValue('750000');
        expect(maximumSlider).toHaveValue('1500000');

        fireEvent.change(minimumSlider, { target: { value: '800000' } });
        fireEvent.change(maximumSlider, { target: { value: '1400000' } });
        expect(minimumSlider).toHaveAttribute('min', '750000');
        expect(maximumSlider).toHaveAttribute('max', '1500000');
        expect(within(restoredPriceGroup).getByRole('spinbutton', { name: /minimum price/i })).toHaveValue(800000);
        expect(within(restoredPriceGroup).getByRole('spinbutton', { name: /maximum price/i })).toHaveValue(1400000);
    });

    it('keeps the results workspace in view when filters return no matching homes', async () => {
        const user = userEvent.setup();
        const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;
        const scrollIntoView = vi.fn();
        window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

        try {
            render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

            const quickFilters = screen.getByRole('search', { name: /property search filters/i });
            await user.type(
                within(quickFilters).getByRole('searchbox', { name: /address search/i }),
                'No such address',
            );
            await user.click(within(quickFilters).getByRole('button', { name: /search location/i }));

            expect(screen.getByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
            expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
            expect(screen.getByRole('button', { name: /reset all/i })).toBeInTheDocument();
        } finally {
            window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
        }
    });

    it('labels the Burlington service scope while hiding legacy region and county controls', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.queryByRole('combobox', { name: /for sale or rent/i })).not.toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: /address search/i })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: /property type/i })).toBeInTheDocument();
        const mapRail = screen.getByRole('complementary', { name: /map and listing status/i });
        expect(within(mapRail).queryByRole('button', { name: /map view/i })).not.toBeInTheDocument();
        expect(within(mapRail).queryByRole('button', { name: /list view/i })).not.toBeInTheDocument();
        expect(within(mapRail).getByText(/map search/i)).toBeInTheDocument();
        expect(within(mapRail).queryByText(/want a second set of eyes/i)).not.toBeInTheDocument();
        expect(within(mapRail).queryByText(/get help narrowing/i)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /contact mai ly/i })).toBeInTheDocument();
        expect(screen.getByText(/across the burlington-centered service area/i)).toBeInTheDocument();
        expect(screen.getByText(/44 South Shore Road/i)).toBeInTheDocument();
        expect(screen.queryByText(/1 Worcester Road/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/3 Harbor View Lane/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        expect(within(filterDialog).queryByRole('combobox', { name: /state/i })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('searchbox', { name: /address search/i })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('combobox', { name: /region/i })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('combobox', { name: /county/i })).not.toBeInTheDocument();
    });

    it('keeps the interactive map provider deferred until the user opens the map', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'test-map-key');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', 'test-map-id');
        const { container } = render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const launchButton = await screen.findByRole('button', {
            name: /open interactive map for .* matching homes/i,
        });
        const overviewImage = container.querySelector('img[src*="massachusetts-search-overview.webp"]');

        expect(overviewImage).toBeInTheDocument();
        expect(overviewImage).toHaveAttribute('loading', 'lazy');
        expect(document.getElementById('move-with-musto-google-maps')).not.toBeInTheDocument();

        await user.click(launchButton);

        const mapDialog = await screen.findByRole('dialog', { name: /explore homes on the map/i });
        expect(screen.queryByRole('complementary', { name: /map and listing status/i })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: /property search results/i })).toBeInTheDocument();
        await waitFor(() => expect(
            document.getElementById('move-with-musto-google-maps'),
        ).toBeInTheDocument());

        await user.click(within(mapDialog).getByRole('button', { name: /^close$/i }));
        expect(screen.getByRole('complementary', { name: /map and listing status/i })).toBeInTheDocument();
    });

    it('uses a stable mobile command bar whose active treatment follows list, map, saved, and compare', async () => {
        const user = userEvent.setup();
        mockMobileWorkspace();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const commandBar = await screen.findByRole('navigation', {
            name: /mobile property search actions/i,
        });
        const listButton = within(commandBar).getByRole('button', { name: /show property list/i });
        const mapButton = within(commandBar).getByRole('button', { name: /show property map/i });
        const savedButton = within(commandBar).getByRole('button', { name: /show saved homes, 0 saved/i });
        const compareButton = within(commandBar).getByRole('button', { name: /compare homes, 0 selected/i });

        expect(screen.queryByRole('search', { name: /property search filters/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /edit search filters/i })).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: /view mode/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', { name: /results per page/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('complementary', { name: /map and listing status/i })).not.toBeInTheDocument();
        expect(compareButton).toBeDisabled();
        expect(within(commandBar).getByRole('button', { name: /contact mai ly/i })).toBeInTheDocument();
        expect(listButton).toHaveAttribute('aria-pressed', 'true');
        expect(mapButton).toHaveAttribute('aria-pressed', 'false');

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', {
            name: /^compare home$/i,
        }));
        expect(savedButton).toHaveAccessibleName(/show saved homes, 1 saved/i);
        expect(compareButton).toHaveAccessibleName(/compare homes, 1 selected/i);
        expect(compareButton).toBeEnabled();

        await user.click(savedButton);
        expect(savedButton).toHaveAttribute('aria-pressed', 'true');

        await user.click(mapButton);
        const mapDialog = await screen.findByRole('dialog', { name: /explore homes on the map/i });
        const mapCommandBar = within(mapDialog).getByRole('navigation', {
            name: /mobile property search actions/i,
        });
        const mapListButton = within(mapCommandBar).getByRole('button', { name: /show property list/i });
        const activeMapButton = within(mapCommandBar).getByRole('button', { name: /show property map/i });

        expect(within(mapCommandBar).getByRole('button', { name: /show saved homes, 1 saved/i })).toBeInTheDocument();
        expect(within(mapCommandBar).getByRole('button', { name: /compare homes, 1 selected/i })).toBeInTheDocument();
        expect(within(mapCommandBar).getByRole('button', { name: /contact mai ly/i })).toBeInTheDocument();
        expect(activeMapButton).toHaveAttribute('aria-pressed', 'true');

        await user.click(mapListButton);

        await waitFor(() => expect(screen.queryByRole('dialog', {
            name: /explore homes on the map/i,
        })).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: /show property list/i }))
            .toHaveAttribute('aria-pressed', 'true');

        await user.click(screen.getByRole('button', { name: /compare homes, 1 selected/i }));
        const tray = screen.getByRole('complementary', { name: /home comparison drawer/i });
        const comparisonBar = screen.getByRole('navigation', { name: /mobile property search actions/i });
        expect(within(comparisonBar).getByRole('button', { name: /compare homes, 1 selected/i }))
            .toHaveAttribute('aria-pressed', 'true');
        expect(within(tray).getByRole('button', { name: /minimize comparison/i })).toBeInTheDocument();

        await user.click(within(comparisonBar).getByRole('button', { name: /show saved homes, 1 saved/i }));
        expect(screen.queryByRole('complementary', { name: /home comparison drawer/i }))
            .not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /show saved homes, 1 saved/i }))
            .toHaveAttribute('aria-pressed', 'true');
    });

    it('ignores legacy region and county filters from the URL and saved search state', async () => {
        const user = userEvent.setup();
        localStorage.setItem('move-with-musto.properties.filters', JSON.stringify({
            county: 'Essex',
            region: 'North of Boston',
        }));
        window.history.pushState({}, '', '/properties/?region=North%20Shore&county=Essex');

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        expect(within(filterDialog).queryByRole('combobox', { name: /region/i })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('combobox', { name: /county/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove region: north shore/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove county: essex/i })).not.toBeInTheDocument();
        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.getByText(/9 Chestnut Street/i)).toBeInTheDocument();
    });

    it('keeps the filter capsule sticky while property results use document scrolling', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const results = screen.getByRole('region', { name: /property search results/i });
        const workspaceRule = cssRuleFor('.workspace');
        const filterCapsuleRule = cssRuleFor('.filterCapsuleShell');
        const filtersRule = cssRuleFor('.filters');
        const resultsAreaRule = cssRuleFor('.resultsArea');
        const resultsScrollerRule = cssRuleFor('.resultsScroller');

        expect(results).toHaveTextContent(/4 homes/i);
        expect(within(results).getByRole('group', { name: /view mode/i })).toBeInTheDocument();
        expect(workspaceRule).toContain('align-items: start;');
        expect(workspaceRule).not.toMatch(/(?:^|[;{]\s*)height\s*:/);
        expect(workspaceRule).not.toContain('max-height:');
        expect(filterCapsuleRule).toContain('position: sticky;');
        expect(filterCapsuleRule).toContain('top: var(--buyer-sticky-top);');
        expect(filterCapsuleRule).not.toContain('max-height:');
        expect(filterCapsuleRule).not.toContain('overflow-y: auto;');
        expect(filterCapsuleRule).not.toContain('scrollbar-gutter');
        expect(filtersRule).toContain('position: relative;');
        expect(filtersRule).not.toContain('position: sticky;');
        expect(filtersRule).not.toContain('max-height:');
        expect(resultsAreaRule).not.toContain('overflow: hidden;');
        expect(resultsScrollerRule).not.toContain('overflow-y: auto;');
        expect(resultsScrollerRule).not.toContain('scrollbar-gutter');
        expect(propertiesCss).toMatch(
            /property-search-results-pane\)\s*{[^}]*overflow:\s*visible;[^}]*overscroll-behavior:\s*auto;/,
        );
        expect(propertiesCss).not.toMatch(
            /property-search-results-pane\)\s*{[^}]*(?:max-height|overflow-y:\s*auto)/,
        );
        expect(propertiesCss).toMatch(
            /property-search-map-surface\) \.mapDrawerBody\s*{[^}]*overflow-y:\s*auto;[^}]*-webkit-overflow-scrolling:\s*touch;/,
        );
    });

    it('defaults property results to list view', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const viewMode = screen.getByRole('group', { name: /view mode/i });

        expect(within(viewMode).getByRole('button', { name: /list/i })).toHaveClass(styles.activeMode);
        expect(within(viewMode).getByRole('button', { name: /grid/i })).not.toHaveClass(styles.activeMode);
    });

    it('migrates the former persisted high-to-low default to Recommended once', async () => {
        localStorage.setItem('move-with-musto.properties.sort', JSON.stringify({
            key: 'price',
            direction: 'desc',
        }));
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        expect(screen.getByRole('combobox', { name: /sort results/i })).toHaveDisplayValue('Recommended');
        await waitFor(() => expect(
            localStorage.getItem('move-with-musto.properties.sort-version'),
        ).toBe('recommended-v1'));
    });

    it('applies a stable area slug as visible town rules and actual results', async () => {
        localStorage.setItem('move-with-musto.properties.filters', JSON.stringify({
            query: 'Burlington',
            includeTowns: ['Burlington'],
            excludeTowns: ['Salem'],
        }));
        window.history.pushState({}, '', '/buy/properties/?area=north-shore#properties-search-title');

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await waitFor(() => {
            expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('');
        });
        expect(screen.getByRole('button', { name: /remove area: north shore/i })).toBeInTheDocument();
        expect(screen.getByText(/9 Chestnut Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/44 South Shore Road/i)).not.toBeInTheDocument();
    });

    it.each([
        { town: 'Nantucket', address: '3 Harbor View Lane' },
        { town: 'Portsmouth', address: '8 Granite Road' },
    ])('does not offer out-of-area town $town for inclusion', async ({ town, address }) => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        await user.type(
            within(filterDialog).getByRole('combobox', { name: /search communities to include/i }),
            town,
        );
        expect(within(filterDialog).getByText(/no close community matches found/i)).toBeInTheDocument();
        expect(within(filterDialog).queryByRole('option', { name: new RegExp(`include ${town}`, 'i') })).not.toBeInTheDocument();
        expect(within(filterDialog).queryByRole('combobox', { name: /state/i })).not.toBeInTheDocument();
        await user.click(within(filterDialog).getByRole('button', { name: /close more filters/i }));

        expect(screen.queryByText(new RegExp(address, 'i'))).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: new RegExp(`remove include ${town}`, 'i') })).not.toBeInTheDocument();
    });

    it('uses one removable map-area state for cards and result counts', async () => {
        const user = userEvent.setup();
        const onMapAreaChange = vi.fn();
        const mapArea: MapAreaSelection = {
            label: 'Selected map area',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71.1 },
            listingNumbers: ['73333446'],
            resultCount: 1,
            coverage: {
                eligibleCount: 5,
                attemptedCount: 5,
                mappedCount: 5,
                isLimited: false,
            },
        };

        render(
            <PropertiesSearch
                initialBundle={bundle}
                initialMapArea={mapArea}
                onMapAreaChange={onMapAreaChange}
                {...profileProps}
            />,
        );

        const results = screen.getByRole('region', { name: /property search results/i });
        expect(within(results).getByText(/^1$/i)).toBeInTheDocument();
        expect(within(results).getByText(/9 Chestnut Street/i)).toBeInTheDocument();
        expect(within(results).queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();

        fireEvent.change(screen.getByRole('combobox', { name: /minimum beds/i }), {
            target: { value: '4' },
        });
        expect(screen.getByRole('button', { name: /remove map area: 1 home/i })).toBeInTheDocument();
        expect(within(results).getByRole('heading', { name: /no matching homes/i })).toBeInTheDocument();
        expect(onMapAreaChange).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: /remove map area: 1 home/i }));

        expect(screen.queryByRole('button', { name: /remove map area/i })).not.toBeInTheDocument();
        expect(within(results).getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(onMapAreaChange).toHaveBeenLastCalledWith(null);
    });

    it('only uses Burlington when the URL requests it and Clear truly clears it', async () => {
        const user = userEvent.setup();
        const burlingtonBundle: MlsPublicBundle = {
            ...bundle,
            listings: [
                ...bundle.listings,
                {
                    ...bundle.listings[0],
                    listingNumber: '73333999',
                    listPrice: 850000,
                    priceLabel: '$850,000',
                    address: {
                        line: '24 Cambridge Street',
                        town: 'Burlington',
                        county: 'Middlesex',
                        state: 'MA',
                        zip: '01803',
                    },
                    photos: [],
                    openHouses: [],
                    virtualTourUrl: '',
                },
            ],
        };
        window.history.pushState({}, '', '/properties/?query=Burlington');

        render(<PropertiesSearch initialBundle={burlingtonBundle} {...profileProps} />);

        await waitFor(() => expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('Burlington'));
        expect(screen.getByText(/24 Cambridge Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /reset all/i }));

        expect(screen.getByRole('searchbox', { name: /address search/i })).toHaveValue('');
        expect(screen.getByText(/24 Cambridge Street/i)).toBeInTheDocument();
        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(window.location.search).toBe('');
    });

    it('does not restore an old saved gallery mode over the list default', () => {
        localStorage.setItem('move-with-musto.properties.filters', JSON.stringify({
            mode: 'gallery',
            town: 'Boston',
        }));

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const viewMode = screen.getByRole('group', { name: /view mode/i });

        expect(screen.queryByRole('button', { name: /remove town: boston/i })).not.toBeInTheDocument();
        expect(within(viewMode).getByRole('button', { name: /list/i })).toHaveClass(styles.activeMode);
        expect(within(viewMode).getByRole('button', { name: /grid/i })).not.toHaveClass(styles.activeMode);
    });

    it('treats a shared URL as deterministic instead of merging local saved filters into it', async () => {
        localStorage.setItem('move-with-musto.properties.filters', JSON.stringify({
            minPrice: '3000000',
            includeTowns: ['Salem'],
        }));
        localStorage.setItem('move-with-musto.properties.sort', JSON.stringify({
            key: 'sqft',
            direction: 'desc',
        }));
        window.history.pushState({}, '', '/properties/?query=Beacon&direction=asc&view=gallery');

        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        await waitFor(() => expect(screen.getByLabelText('Address search')).toHaveValue('Beacon'));
        expect(screen.getByText('12 Beacon Street #2')).toBeInTheDocument();
        expect(screen.queryByText('9 Chestnut Street')).not.toBeInTheDocument();
        expect(screen.getByLabelText('Sort results')).toHaveValue('price:asc');
        expect(screen.getByRole('button', { name: /grid/i })).toHaveClass(styles.activeMode);
        await waitFor(() => {
            const params = new URLSearchParams(window.location.search);
            expect(params.get('query')).toBe('Beacon');
            expect(params.get('direction')).toBe('asc');
            expect(params.get('view')).toBe('gallery');
            expect(params.has('minPrice')).toBe(false);
            expect(params.has('includeTown')).toBe(false);
        });
    });

    it('restores pagination from the URL after the result set is known', async () => {
        const paginationBundle: MlsPublicBundle = {
            ...bundle,
            listings: Array.from({ length: 25 }, (_, index) => makeListing(index + 1)),
        };
        window.history.pushState({}, '', '/properties/?page=2&pageSize=10');

        render(<PropertiesSearch {...profileProps} initialBundle={paginationBundle} />);

        await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());
        expect(screen.getByText('18 Test Street')).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).get('page')).toBe('2');
    });

    it('uses listing history so Back closes details and Forward reopens them', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        const listingCard = screen.getByText('86 Mount Vernon Street').closest('article');
        expect(listingCard).not.toBeNull();
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /view details/i }));

        const dialog = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(new URLSearchParams(window.location.search).get('listing')).toBe('73333444');
        await user.click(within(dialog).getByRole('button', { name: /^close details$/i }));

        await waitFor(() => expect(screen.queryByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).not.toBeInTheDocument());
        expect(new URLSearchParams(window.location.search).has('listing')).toBe(false);

        act(() => window.history.forward());
        expect(await screen.findByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).toBeInTheDocument();
    });

    it('preserves device-local saved-only state when listing history returns to search', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getByRole('button', { name: /show saved homes, 1 saved/i }));
        const savedChip = await screen.findByRole('button', { name: /remove saved only/i });
        expect(savedChip).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /view details/i }));
        const dialog = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(dialog).getByRole('button', { name: /^close details$/i }));

        expect(await screen.findByRole('button', { name: /remove saved only/i })).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /property search results/i })).toHaveTextContent(/1 home/i);
    });

    it('clears stale listing markers before opening a new history entry', async () => {
        const user = userEvent.setup();
        window.history.replaceState({
            moveWithMustoPropertyListing: {
                entryId: 99,
                listingNumber: '73333444',
                pushed: true,
            },
        }, '', '/properties/');
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        await waitFor(() => expect(window.history.state.moveWithMustoPropertyListing).toBeUndefined());
        const listingCard = screen.getByText('86 Mount Vernon Street').closest('article');
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /view details/i }));
        expect(window.history.state.moveWithMustoPropertyListing).toMatchObject({
            listingNumber: '73333444',
            pushed: true,
        });

        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^close details$/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(window.location.pathname).toBe('/properties/');
    });

    it('does not resurrect a cleared initial map area after listing Back navigation', async () => {
        const user = userEvent.setup();
        const mapArea: MapAreaSelection = {
            label: 'Selected map area',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71.1 },
            listingNumbers: ['73333444'],
            resultCount: 1,
            coverage: { eligibleCount: 5, attemptedCount: 5, mappedCount: 5, isLimited: false },
        };
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} initialMapArea={mapArea} />);

        await user.click(screen.getByRole('button', { name: /remove map area: 1 home/i }));
        const listingCard = screen.getByText('86 Mount Vernon Street').closest('article');
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /view details/i }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^close details$/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /remove map area/i })).not.toBeInTheDocument();
    });

    it('collapses a pushed listing entry before transitioning to the lead dialog', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        const listingCard = screen.getByText('86 Mount Vernon Street').closest('article');
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /view details/i }));
        await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /request a showing/i }));

        expect(await screen.findByRole('dialog', { name: /plan a showing/i })).toBeInTheDocument();
        expect(new URLSearchParams(window.location.search).has('listing')).toBe(false);
        expect(window.history.state.moveWithMustoPropertyListing).toBeUndefined();

        act(() => window.history.forward());
        expect(await screen.findByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /plan a showing/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('closes a directly shared listing without navigating away from search', async () => {
        const user = userEvent.setup();
        window.history.pushState({}, '', '/properties/?query=Mount&listing=73333444');
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        const dialog = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(dialog).getByRole('button', { name: /^close details$/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(window.location.pathname).toBe('/properties/');
        expect(new URLSearchParams(window.location.search).get('query')).toBe('Mount');
        expect(new URLSearchParams(window.location.search).has('listing')).toBe(false);
    });

    it('does not trust shared map IDs when the bounds cannot be validated', async () => {
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        window.history.pushState({}, '', [
            '/properties/?mapBounds=42.5,-70.8,42.1,-71.3',
            'mapListing=73333444',
            'mapListing=79999999',
        ].join('&'));
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        const restoreNotice = await screen.findByText(
            /that shared map area is not available right now/i,
        );
        expect(restoreNotice).toHaveAttribute('role', 'status');
        expect(screen.getByText('86 Mount Vernon Street')).toBeInTheDocument();
        expect(screen.getByText('12 Beacon Street #2')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /remove map area/i })).not.toBeInTheDocument();
        await waitFor(() => expect(new URLSearchParams(window.location.search).has('mapBounds')).toBe(false));
        expect(new URLSearchParams(window.location.search).has('mapBounds')).toBe(false);
        expect(new URLSearchParams(window.location.search).has('mapListing')).toBe(false);
        expect(new URLSearchParams(window.location.search).has('map')).toBe(false);
        expect(screen.queryByRole('dialog', { name: /explore homes on the map/i })).not.toBeInTheDocument();
    });

    it('applies focus containment, Escape dismissal, and focus restoration to the filter dialog', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch {...profileProps} initialBundle={bundle} />);

        const trigger = screen.getByRole('button', { name: /more filters/i });
        await user.click(trigger);
        const dialog = screen.getByRole('dialog', { name: /more filters/i });
        const closeButton = within(dialog).getByRole('button', { name: /close more filters/i });

        await waitFor(() => expect(closeButton).toHaveFocus());
        expect(document.body.style.overflow).toBe('hidden');
        await user.keyboard('{Escape}');

        expect(screen.queryByRole('dialog', { name: /more filters/i })).not.toBeInTheDocument();
        await waitFor(() => expect(trigger).toHaveFocus());
        expect(document.body.style.overflow).toBe('');
    });

    it('switches list, gallery, and the map drawer without losing filters or saved comparison state', async () => {
        const user = userEvent.setup();
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^save$/i }));
        await user.click(screen.getAllByRole('button', { name: /^compare home$/i })[0]);
        const quickFilters = screen.getByRole('search', { name: /property search filters/i });
        await user.type(
            within(quickFilters).getByRole('searchbox', { name: /address search/i }),
            'Boston',
        );
        await user.click(within(quickFilters).getByRole('button', { name: /search location/i }));
        await user.click(within(quickFilters).getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        await user.click(within(filterDialog).getByRole('button', { name: /view 1 home/i }));

        const viewMode = screen.getByRole('group', { name: /view mode/i });
        expect(within(viewMode).getByRole('button', { name: /list/i })).toHaveClass(styles.activeMode);
        expect(screen.getByRole('button', { name: /remove search: boston/i })).toBeInTheDocument();

        await user.click(within(viewMode).getByRole('button', { name: /grid/i }));
        expect(within(viewMode).getByRole('button', { name: /grid/i })).toHaveClass(styles.activeMode);

        await user.click(getMapPreviewLauncher());
        const mapDrawer = await screen.findByRole('dialog', { name: /explore homes on the map/i });
        expect(await within(mapDrawer).findByText(/map temporarily unavailable/i)).toBeInTheDocument();
        expect(screen.getByText(/^1–1 shown$/i)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /show saved homes, 1 saved/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /compare homes, 1 selected/i })).not.toBeInTheDocument();

        await user.click(within(mapDrawer).getByRole('button', { name: /close/i }));
        expect(within(viewMode).getByRole('button', { name: /grid/i })).toHaveClass(styles.activeMode);
        expect(screen.getByRole('button', { name: /remove search: boston/i })).toBeInTheDocument();
        expect(screen.getAllByText(/86 Mount Vernon Street/i).length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /compare homes, 1 selected/i })).toBeInTheDocument();
    });

    it('shows listing details inline beside the persistent map in the desktop workspace', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const listingCard = screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i }).closest('article');
        const detailsButton = within(listingCard as HTMLElement).getByRole('button', { name: /view details/i });
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /^save$/i }));
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /^compare home$/i }));
        await user.click(getMapPreviewLauncher());
        const mapWorkspace = await screen.findByRole('region', { name: /explore homes on the map/i });
        const mapActions = within(mapWorkspace).getByRole('group', {
            name: /search contact and home collections/i,
        });
        const mapCollections = within(mapActions).getByLabelText(/saved and compared homes/i);

        expect(within(mapActions).getByRole('button', { name: /contact mai ly/i })).toBeInTheDocument();
        expect(within(mapCollections).getByRole('button', { name: /show saved homes, 1 saved/i })).toBeInTheDocument();
        expect(within(mapCollections).getByRole('button', { name: /compare homes, 1 selected/i })).toBeInTheDocument();
        expect(within(mapWorkspace).queryByText(/your homes/i)).not.toBeInTheDocument();
        expect(within(mapWorkspace).queryByRole('button', { name: /ask about this area/i })).not.toBeInTheDocument();
        await user.click(detailsButton);

        const details = await screen.findByRole('region', {
            name: /listing details for 86 mount vernon street/i,
        });
        await waitFor(() => expect(details).toHaveFocus());
        expect(details).not.toHaveAttribute('aria-modal');
        expect(screen.queryByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).not.toBeInTheDocument();
        expect(mapWorkspace).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /explore homes on the map/i })).toBeVisible();

        await user.click(within(mapWorkspace).getByRole('button', { name: /^close$/i }));

        expect(screen.queryByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', {
            name: /listing details for 86 mount vernon street/i,
        })).not.toBeInTheDocument();
        await waitFor(() => expect(detailsButton).toHaveFocus());
        await waitFor(() => {
            const params = new URLSearchParams(window.location.search);
            expect(params.has('listing')).toBe(false);
            expect(params.has('map')).toBe(false);
        });
    });

    it('returns focus to the desktop map preview after Close or idle Escape', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(getMapPreviewLauncher());
        let mapWorkspace = await screen.findByRole('region', { name: /explore homes on the map/i });
        await user.click(within(mapWorkspace).getByRole('button', { name: /^close$/i }));
        await waitFor(() => expect(getMapPreviewLauncher()).toHaveFocus());

        await user.click(getMapPreviewLauncher());
        mapWorkspace = await screen.findByRole('region', { name: /explore homes on the map/i });
        expect(mapWorkspace).toBeVisible();
        await user.keyboard('{Escape}');
        await waitFor(() => expect(getMapPreviewLauncher()).toHaveFocus());
    });

    it('falls back to the map preview when a detail return control becomes hidden', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(getMapPreviewLauncher());
        const mapWorkspace = await screen.findByRole('region', { name: /explore homes on the map/i });
        const listingCard = screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i }).closest('article');
        const detailsButton = within(listingCard as HTMLElement).getByRole('button', { name: /view details/i });
        await user.click(detailsButton);
        await screen.findByRole('region', { name: /listing details for 86 mount vernon street/i });

        (detailsButton.closest('article') as HTMLElement).hidden = true;
        await user.click(within(mapWorkspace).getByRole('button', { name: /^close$/i }));

        await waitFor(() => expect(getMapPreviewLauncher()).toHaveFocus());
    });

    it('keeps listing details modal on mobile and returns to the mounted map', async () => {
        const user = userEvent.setup();
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(getMapPreviewLauncher());
        const mapDialog = await screen.findByRole('dialog', { name: /explore homes on the map/i });

        const listingCard = screen.getByRole('heading', { name: /^86 Mount Vernon Street$/i }).closest('article');
        await user.click(within(listingCard as HTMLElement).getByRole('button', { name: /view details/i }));

        const details = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(details).toHaveAttribute('aria-modal', 'true');
        await user.click(within(details).getByRole('button', { name: /^back to map$/i }));

        expect(screen.queryByRole('dialog', {
            name: /photos for 86 mount vernon street/i,
        })).not.toBeInTheDocument();
        expect(mapDialog).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: /explore homes on the map/i })).toBeVisible();
    });

    it('uses the map fallback as a provider-neutral search consult capture path', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(getMapPreviewLauncher());
        const mapDrawer = await screen.findByRole('dialog', { name: /explore homes on the map/i });
        expect(await within(mapDrawer).findByText(/map temporarily unavailable/i)).toBeInTheDocument();

        await user.click(within(mapDrawer).getByRole('button', { name: /get search help/i }));

        const dialog = await screen.findByRole('dialog', { name: /help me find homes/i });
        expect(within(dialog).queryByText(/home you are asking about/i)).not.toBeInTheDocument();

        await user.type(within(dialog).getByLabelText(/^name$/i), 'Buyer One');
        await user.type(within(dialog).getByLabelText(/^email$/i), 'buyer@example.com');
        await user.type(within(dialog).getByLabelText(/^message$/i), 'Can you help me search this area?');
        await user.click(within(dialog).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        await user.click(within(dialog).getByRole('button', { name: /send request/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));

        expect(payload).toMatchObject({
            leadType: 'search_consult',
            delivery: 'email_fallback',
            requestType: 'get_matching_homes',
            searchAreaLabel: 'Burlington-area service area map temporarily unavailable',
            searchAreaBounds: null,
            filters: {
                mode: 'map',
                region: 'Burlington-area service area',
            },
            freeformMessage: 'Can you help me search this area?',
        });
        expect(payload.selectedMlsNumbers).toHaveLength(4);
        expect(payload.selectedMlsNumbers).toContain('73333444');
        expect(payload.attachedListings).toHaveLength(0);
    });

    it('loads desktop split-view results continuously without page controls', async () => {
        const user = userEvent.setup();
        let observerCallback: IntersectionObserverCallback | undefined;
        let observedTarget: Element | null = null;

        class CapturingIntersectionObserver implements IntersectionObserver {
            readonly root = null;
            readonly rootMargin = '800px 0px';
            readonly thresholds = [0];

            constructor(callback: IntersectionObserverCallback) {
                observerCallback = callback;
            }

            observe(target: Element) {
                observedTarget = target;
            }

            unobserve() {}
            disconnect() {}
            takeRecords(): IntersectionObserverEntry[] {
                return [];
            }
        }

        window.IntersectionObserver = CapturingIntersectionObserver;
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: query === '(min-width: 1024px)',
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', '');
        vi.stubEnv('NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID', '');

        const continuousBundle: MlsPublicBundle = {
            ...bundle,
            listings: Array.from({ length: 101 }, (_, index) => makeListing(index + 1)),
        };
        render(<PropertiesSearch initialBundle={continuousBundle} {...profileProps} />);

        await user.click(getMapPreviewLauncher());
        const mapWorkspace = await screen.findByRole('region', { name: /explore homes on the map/i });
        const results = screen.getByRole('region', { name: /property search results/i });

        await waitFor(() => expect(within(results).getAllByRole('article')).toHaveLength(50));
        expect(within(results).getByText(/^50 loaded$/i)).toBeInTheDocument();
        expect(within(results).queryByRole('combobox', { name: /results per page/i })).not.toBeInTheDocument();
        expect(within(results).queryByRole('button', { name: /^previous$/i })).not.toBeInTheDocument();
        expect(within(results).queryByRole('button', { name: /^next$/i })).not.toBeInTheDocument();

        expect(observedTarget).not.toBeNull();
        await act(async () => {
            observerCallback?.(
                [{ isIntersecting: true, target: observedTarget } as unknown as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
        });

        await waitFor(() => expect(within(results).getAllByRole('article')).toHaveLength(100));
        expect(within(results).getByText(/^100 loaded$/i)).toBeInTheDocument();

        const quickFilters = screen.getByRole('search', { name: /property search filters/i });
        await user.type(
            within(quickFilters).getByRole('searchbox', { name: /address search/i }),
            '101 Test Street',
        );
        await user.click(within(quickFilters).getByRole('button', { name: /search location/i }));
        await waitFor(() => expect(within(results).getAllByRole('article')).toHaveLength(1));
        await user.click(screen.getByRole('button', { name: /remove search: 101 test street/i }));

        await waitFor(() => expect(within(results).getAllByRole('article')).toHaveLength(50));
        expect(mapWorkspace).toBeInTheDocument();
        expect(screen.getByRole('region', { name: /explore homes on the map/i })).toBeVisible();

        await user.click(within(mapWorkspace).getByRole('button', { name: /^close$/i }));
        await waitFor(() => expect(within(results).getAllByRole('article')).toHaveLength(10));
        expect(within(results).getByRole('combobox', { name: /results per page/i })).toBeInTheDocument();
    });

    it('limits rendered property results to 10 by default with a 50-result option', async () => {
        const user = userEvent.setup();
        const pagedBundle: MlsPublicBundle = {
            ...bundle,
            listings: Array.from({ length: 12 }, (_, index) => makeListing(index + 1)),
        };

        render(<PropertiesSearch initialBundle={pagedBundle} {...profileProps} />);

        const results = screen.getByRole('region', { name: /property search results/i });
        expect(within(results).getByText(/1–10 shown/i)).toBeInTheDocument();
        expect(within(results).getByRole('heading', { name: /^6 Test Street$/i })).toBeInTheDocument();
        expect(within(results).getByRole('heading', { name: /^10 Test Street$/i })).toBeInTheDocument();
        expect(within(results).queryByRole('heading', { name: /^1 Test Street$/i })).not.toBeInTheDocument();
        expect(within(results).getAllByRole('article')).toHaveLength(10);

        await user.selectOptions(within(results).getByRole('combobox', { name: /results per page/i }), '50');

        expect(within(results).getByText(/1–12 shown/i)).toBeInTheDocument();
        expect(within(results).getByRole('heading', { name: /^1 Test Street$/i })).toBeInTheDocument();
        expect(within(results).getAllByRole('article')).toHaveLength(12);
    });

    it('sorts visible property results by price or square feet in either direction', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        const results = screen.getByRole('region', { name: /property search results/i });
        const sortControl = within(results).getByRole('combobox', { name: /sort results/i });

        expect(sortControl).toHaveDisplayValue('Recommended');
        expect(within(sortControl).queryByRole('option', { name: /mls order/i })).not.toBeInTheDocument();
        expect(within(results).getAllByRole('article')[0]).toHaveTextContent(/9 Chestnut Street|44 South Shore Road/i);
        expect(within(results).getAllByRole('article')[0]).not.toHaveTextContent(/86 Mount Vernon Street/i);

        await user.selectOptions(sortControl, 'price:asc');

        let cards = within(results).getAllByRole('article');
        expect(cards[0]).toHaveTextContent(/12 Beacon Street/i);
        expect(cards[1]).toHaveTextContent(/9 Chestnut Street/i);

        await user.selectOptions(sortControl, 'price:desc');

        cards = within(results).getAllByRole('article');
        expect(cards[0]).toHaveTextContent(/86 Mount Vernon Street/i);
        expect(cards[1]).toHaveTextContent(/44 South Shore Road/i);

        await user.selectOptions(sortControl, 'sqft:asc');

        cards = within(results).getAllByRole('article');
        expect(cards[0]).toHaveTextContent(/12 Beacon Street/i);
        expect(cards[1]).toHaveTextContent(/9 Chestnut Street/i);
    });

    it('filters by included and excluded towns or cities', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /more filters/i }));
        const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
        const townRules = within(filterDialog).getByRole('group', { name: /^communities$/i });
        const includeTownSearch = within(townRules).getByRole('combobox', { name: /search communities to include/i });
        const excludeTownSearch = within(townRules).getByRole('combobox', { name: /search communities to exclude/i });

        expect(within(filterDialog).queryByRole('combobox', { name: /status/i })).not.toBeInTheDocument();
        expect(within(townRules).queryByRole('combobox', { name: /include town or city/i })).not.toBeInTheDocument();
        expect(within(townRules).queryByRole('option', { name: /include visible/i })).not.toBeInTheDocument();
        expect(within(townRules).queryByRole('option', { name: /include boston/i })).not.toBeInTheDocument();
        expect(within(townRules).getByText(/search for a community to include/i)).toBeInTheDocument();
        expect(within(townRules).getByText(/search for a community to exclude/i)).toBeInTheDocument();

        await user.type(includeTownSearch, 'Bo');
        expect(within(townRules).getByRole('option', { name: /include boston/i })).toBeInTheDocument();

        await user.click(within(townRules).getByRole('option', { name: /include boston/i }));
        expect(includeTownSearch).toHaveValue('');
        expect(within(townRules).getByRole('button', { name: /remove included town boston/i })).toHaveTextContent(/include boston/i);

        await user.type(includeTownSearch, 'Salem');
        await user.click(within(townRules).getByRole('option', { name: /include salem/i }));

        expect(screen.getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(screen.getByText(/9 Chestnut Street/i)).toBeInTheDocument();
        expect(screen.queryByText(/12 Beacon Street/i)).not.toBeInTheDocument();
        expect(within(townRules).getByRole('button', { name: /remove included town boston/i })).toBeInTheDocument();
        expect(within(townRules).getByRole('button', { name: /remove included town salem/i })).toBeInTheDocument();

        await user.type(excludeTownSearch, 'Boston');
        await user.click(within(townRules).getByRole('option', { name: /exclude boston/i }));

        expect(screen.queryByText(/86 Mount Vernon Street/i)).not.toBeInTheDocument();
        expect(screen.getByText(/9 Chestnut Street/i)).toBeInTheDocument();
        expect(within(townRules).queryByRole('button', { name: /remove included town boston/i })).not.toBeInTheDocument();
        expect(within(townRules).getByRole('button', { name: /remove excluded town boston/i })).toBeInTheDocument();
    });

    describe('town rule combobox', () => {
        const townRuleListingTowns = [
            'Burlington',
            'North Andover',
            'North Reading',
            'Wakefield',
            'Waltham',
            'Watertown',
            'Wayland',
            'Wellesley',
            'Wenham',
            'West Newbury',
            'Westford',
            'Weston',
            'Westwood',
            'Weymouth',
            'Wilmington',
            'Winchester',
            'Winthrop',
            'Woburn',
        ] as const;
        const townRuleBundle: MlsPublicBundle = {
            ...bundle,
            listings: townRuleListingTowns.map((town, index) => {
                const listPrice = 700_000 + (index * 1_000);

                return {
                    ...bundle.listings[0],
                    listingNumber: `74444${String(index).padStart(3, '0')}`,
                    listPrice,
                    priceLabel: `$${listPrice.toLocaleString('en-US')}`,
                    address: {
                        ...bundle.listings[0].address,
                        line: `${index + 1} Community Test Road`,
                        town,
                        county: 'Middlesex',
                        state: 'MA',
                    },
                    photos: [],
                    openHouses: [],
                    virtualTourUrl: '',
                };
            }),
        };

        async function openTownRuleDialog(path = '/properties/?utm_source=town-test') {
            window.history.replaceState({}, '', path);
            const user = userEvent.setup();
            render(<PropertiesSearch initialBundle={townRuleBundle} {...profileProps} />);

            await user.click(screen.getByRole('button', { name: /more filters/i }));
            const filterDialog = screen.getByRole('dialog', { name: /more filters/i });
            const townRules = within(filterDialog).getByRole('group', { name: /^communities$/i });

            return {
                user,
                filterDialog,
                townRules,
                includeTownSearch: within(townRules).getByRole('combobox', {
                    name: /search communities to include/i,
                }),
                excludeTownSearch: within(townRules).getByRole('combobox', {
                    name: /search communities to exclude/i,
                }),
            };
        }

        it.each([
            { action: 'include' as const, query: 'burlignton', town: 'Burlington' },
            { action: 'exclude' as const, query: 'wobrn', town: 'Woburn' },
            { action: 'include' as const, query: 'northandover', town: 'North Andover' },
        ])('offers canonical $town for the $action typo "$query" only after explicit selection', async ({
            action,
            query,
            town,
        }) => {
            const {
                user,
                townRules,
                includeTownSearch,
                excludeTownSearch,
            } = await openTownRuleDialog();
            const input = action === 'include' ? includeTownSearch : excludeTownSearch;
            const actionLabel = action === 'include' ? 'Include' : 'Exclude';
            const selectedState = action === 'include' ? 'included' : 'excluded';
            const urlParameter = action === 'include' ? 'includeTown' : 'excludeTown';
            const urlBeforeTyping = `${window.location.pathname}${window.location.search}`;

            await user.type(input, query);

            const listbox = within(townRules).getByRole('listbox', {
                name: new RegExp(`towns to ${action}`, 'i'),
            });
            const canonicalOption = within(listbox).getByRole('option', {
                name: `${actionLabel} ${town}`,
            });
            expect(canonicalOption).toHaveTextContent(town);
            expect(input).toHaveValue(query);
            expect(within(townRules).queryByRole('button', {
                name: `Remove ${selectedState} town ${town}`,
            })).not.toBeInTheDocument();
            expect(`${window.location.pathname}${window.location.search}`).toBe(urlBeforeTyping);
            expect(new URLSearchParams(window.location.search).has(urlParameter)).toBe(false);

            await user.click(canonicalOption);

            expect(input).toHaveValue('');
            expect(within(townRules).getByRole('button', {
                name: `Remove ${selectedState} town ${town}`,
            })).toBeInTheDocument();
            await waitFor(() => expect(
                new URLSearchParams(window.location.search).getAll(urlParameter),
            ).toEqual([town]));
        });

        it('supports ArrowDown, ArrowUp, and Enter without changing the typed text', async () => {
            const { user, townRules, includeTownSearch } = await openTownRuleDialog();

            await user.type(includeTownSearch, 'north');

            const listbox = within(townRules).getByRole('listbox', { name: /towns to include/i });
            const northAndover = within(listbox).getByRole('option', { name: 'Include North Andover' });
            const northReading = within(listbox).getByRole('option', { name: 'Include North Reading' });
            expect(northAndover).toHaveAttribute('aria-selected', 'true');
            expect(includeTownSearch).toHaveAttribute('aria-activedescendant', northAndover.id);

            await user.keyboard('{ArrowDown}');
            expect(northReading).toHaveAttribute('aria-selected', 'true');
            expect(includeTownSearch).toHaveValue('north');

            await user.keyboard('{ArrowUp}');
            expect(northAndover).toHaveAttribute('aria-selected', 'true');
            expect(includeTownSearch).toHaveValue('north');

            await user.keyboard('{Enter}');

            expect(includeTownSearch).toHaveValue('');
            expect(within(townRules).getByRole('button', {
                name: 'Remove included town North Andover',
            })).toBeInTheDocument();
            await waitFor(() => expect(
                new URLSearchParams(window.location.search).getAll('includeTown'),
            ).toEqual(['North Andover']));
        });

        it('clears a pending typo with Escape without closing filters or selecting a town', async () => {
            const {
                user,
                filterDialog,
                townRules,
                includeTownSearch,
            } = await openTownRuleDialog();
            const urlBeforeTyping = `${window.location.pathname}${window.location.search}`;

            await user.type(includeTownSearch, 'burlignton');
            expect(within(townRules).getByRole('listbox', { name: /towns to include/i })).toBeInTheDocument();

            await user.keyboard('{Escape}');

            expect(filterDialog).toBeInTheDocument();
            expect(includeTownSearch).toHaveValue('');
            expect(includeTownSearch).toHaveAttribute('aria-expanded', 'false');
            expect(within(townRules).queryByRole('listbox', { name: /towns to include/i })).not.toBeInTheDocument();
            expect(within(townRules).queryByRole('button', {
                name: /remove included town burlington/i,
            })).not.toBeInTheDocument();
            expect(`${window.location.pathname}${window.location.search}`).toBe(urlBeforeTyping);
        });

        it('caps broad town suggestions at eight accessible options', async () => {
            const { user, townRules, includeTownSearch } = await openTownRuleDialog();

            await user.type(includeTownSearch, 'w');

            const listbox = within(townRules).getByRole('listbox', { name: /towns to include/i });
            expect(within(listbox).getAllByRole('option')).toHaveLength(8);
            expect(includeTownSearch).toHaveAttribute('aria-expanded', 'true');
        });

        it('keeps restored canonical URL rules unchanged while a typo remains unselected', async () => {
            const {
                user,
                townRules,
                includeTownSearch,
            } = await openTownRuleDialog(
                '/properties/?includeTown=Woburn&excludeTown=North%20Andover&utm_source=town-test',
            );

            await waitFor(() => {
                expect(within(townRules).getByRole('button', {
                    name: 'Remove included town Woburn',
                })).toBeInTheDocument();
                expect(within(townRules).getByRole('button', {
                    name: 'Remove excluded town North Andover',
                })).toBeInTheDocument();
            });
            expect(includeTownSearch).toHaveValue('');

            await user.type(includeTownSearch, 'burlignton');

            expect(within(townRules).getByRole('option', {
                name: 'Include Burlington',
            })).toBeInTheDocument();
            expect(includeTownSearch).toHaveValue('burlignton');
            expect(within(townRules).queryByRole('button', {
                name: 'Remove included town Burlington',
            })).not.toBeInTheDocument();
            const params = new URLSearchParams(window.location.search);
            expect(params.getAll('includeTown')).toEqual(['Woburn']);
            expect(params.getAll('excludeTown')).toEqual(['North Andover']);
            expect(params.get('utm_source')).toBe('town-test');
        });
    });

    it('opens listing photos in an expandable gallery overlay', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(screen.getByRole('button', { name: /open photos for 86 mount vernon street/i }));

        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(within(dialog).getByRole('img', { name: /photo 1 of 7/i })).toHaveAttribute(
            'src',
            expect.stringContaining('w=1024&h=768'),
        );
        await user.click(within(dialog).getByRole('button', { name: /next photo/i }));
        expect(within(dialog).getByRole('img', { name: /photo 2 of 7/i })).toBeInTheDocument();
    });

    it('opens details with the compact card hierarchy, readable remarks, and slideshow controls', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));

        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(within(dialog).getByRole('heading', { name: /86 Mount Vernon Street/i })).toBeInTheDocument();
        const freshness = within(dialog).getByRole('region', { name: /listing data freshness/i });
        expect(freshness).toHaveTextContent(/Last updated:/i);
        expect(freshness).not.toHaveTextContent(/Last checked:/i);
        expect(freshness).not.toHaveTextContent(/view/i);
        expect(freshness).not.toHaveTextContent(/save/i);
        const remarks = within(dialog).getByText(/source-faithful mls remarks stay intact/i);
        expect(remarks).toHaveClass(styles.galleryRemarks);
        expect(remarks).toHaveClass(styles.galleryRemarksPreview);
        expect(cssRuleFor('.galleryRemarksPanel')).not.toContain('overflow-y: auto;');
        expect(cssRuleFor('.galleryRemarksPanel')).not.toContain('max-height:');
        expect(within(dialog).queryByLabelText(/mls listing disclosure and participant information/i)).not.toBeInTheDocument();
        expect(screen.getAllByLabelText(/mls listing disclosure and participant information/i)).toHaveLength(1);
        expect(within(dialog).getByText(/4f \| 2h/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/Avery Agent/i)).toBeInTheDocument();
        const remarksToggle = within(dialog).getByRole('button', { name: /show more/i });
        expect(remarksToggle).toHaveAttribute('aria-expanded', 'false');
        await user.click(remarksToggle);
        expect(remarks).not.toHaveClass(styles.galleryRemarksPreview);
        expect(within(dialog).getByRole('button', { name: /show less/i })).toHaveAttribute('aria-expanded', 'true');

        expect(within(dialog).getByRole('button', { name: /save home/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /compare home/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /ask about this home/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('heading', { name: /at a glance/i })).toBeInTheDocument();
        expect(within(dialog).getByText('Area', { selector: 'dt' })).toBeInTheDocument();
        expect(within(dialog).getByText('Boston', { selector: 'dd' })).toBeInTheDocument();
        expect(within(dialog).getByText('Key rooms', { selector: 'dt' })).toBeInTheDocument();
        expect(within(dialog).getByText('Primary bedroom', { selector: 'dd' })).toBeInTheDocument();
        const factsSummary = within(dialog).getByText('More facts & features').closest('summary');
        const factsDetails = factsSummary?.closest('details');
        expect(factsDetails).toHaveProperty('open', false);
        await user.click(factsSummary!);
        expect(factsDetails).toHaveProperty('open', true);
        expect(within(factsDetails!).getByText('Primary bedroom')).toBeInTheDocument();
        expect(within(factsDetails!).getByText('23 x 11')).toBeInTheDocument();
        expect(within(factsDetails!).getByText('Hot Water Baseboard')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /request a showing/i })).toBeInTheDocument();
        expect(within(dialog).getByText(/In-Person:.*Jun 27.*10:00 AM.*1:00 PM/i)).toBeInTheDocument();
        expect(within(dialog).queryByRole('region', { name: /scheduling preview/i })).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: /save home/i }));
        expect(within(dialog).getByRole('button', { name: /saved home/i })).toHaveAttribute('aria-pressed', 'true');
        expect(localStorage.getItem('move-with-musto.properties.analytics')).toBeNull();
        expect(within(dialog).getByRole('img', { name: /photo 1 of 7/i })).toHaveAttribute(
            'src',
            expect.stringContaining('w=1024&h=768'),
        );
        expect(within(dialog).getByRole('img', { name: /photo 1 of 7/i })).toHaveClass(styles.galleryStageImage);

        const nearbyPhotos = within(dialog).getByLabelText(/nearby listing photos/i);
        expect(within(nearbyPhotos).getAllByRole('button', { name: /open photo/i })).toHaveLength(5);
        expect(within(nearbyPhotos).queryByRole('button', { name: /open photo 7$/i })).not.toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /open photo 2/i }));
        expect(within(dialog).getByRole('img', { name: /photo 2 of 7/i })).toBeInTheDocument();

        const viewAllPhotosButton = within(dialog).getByRole('button', { name: /view all photos/i });
        await user.click(viewAllPhotosButton);
        const allPhotos = within(dialog).getByRole('dialog', { name: /all listing photos/i });
        expect(allPhotos).toHaveAttribute('aria-modal', 'true');
        const drawerPhotos = within(allPhotos).getAllByRole('button', { name: /open photo .*from all photos/i });
        expect(drawerPhotos).toHaveLength(7);
        expect(drawerPhotos[0]).toHaveClass(styles.photoDrawerTile);
        const closePhotoDrawerButton = within(allPhotos).getByRole('button', { name: /close photo drawer/i });
        expect(closePhotoDrawerButton).toHaveClass(
            styles.photoDrawerCloseButton,
        );
        await waitFor(() => expect(closePhotoDrawerButton).toHaveFocus());
        Array.from(allPhotos.querySelectorAll('img')).forEach((image) => {
            expect(image).toHaveAttribute('loading', 'lazy');
            expect(image).toHaveAttribute('decoding', 'async');
            expect(image).toHaveAttribute('src', expect.stringContaining('w=320&h=250'));
        });
        await user.click(within(allPhotos).getByRole('button', { name: /open photo 7 from all photos/i }));
        expect(within(dialog).getByRole('img', { name: /photo 7 of 7/i })).toBeInTheDocument();
        await waitFor(() => expect(viewAllPhotosButton).toHaveFocus());

        await user.click(viewAllPhotosButton);
        expect(within(dialog).getByRole('dialog', { name: /all listing photos/i })).toBeInTheDocument();
        await user.keyboard('{Escape}');
        expect(within(dialog).queryByRole('dialog', { name: /all listing photos/i })).not.toBeInTheDocument();
        expect(dialog).toBeInTheDocument();
        await waitFor(() => expect(viewAllPhotosButton).toHaveFocus());

        await user.click(within(dialog).getByRole('button', { name: /start autoplay/i }));
        expect(within(dialog).getByRole('img', { name: /photo 1 of 7/i })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: /pause autoplay/i })).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: /ask about this home/i }));
        expect(screen.queryByRole('dialog', { name: /photos for 86 mount vernon street/i })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: /ask about this home/i })).toBeInTheDocument();
    });

    it('resets photo, autoplay, and remarks state when details switch to another listing', async () => {
        const user = userEvent.setup();
        const secondListing = {
            ...bundle.listings[3],
            remarks: 'Second listing remarks are long enough to require progressive disclosure. '.repeat(5),
            photos: bundle.listings[0].photos.slice(0, 3).map((photo) => ({
                ...photo,
                card: photo.card.replace('73333444', '73333447'),
                detail: photo.detail.replace('73333444', '73333447'),
                thumbnail: photo.thumbnail.replace('73333444', '73333447'),
            })),
        };
        render(
            <PropertiesSearch
                initialBundle={{ ...bundle, listings: [bundle.listings[0], secondListing] }}
                {...profileProps}
            />,
        );

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const firstDialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(firstDialog).getByRole('button', { name: /next photo/i }));
        await user.click(within(firstDialog).getByRole('button', { name: /show more/i }));
        await user.click(within(firstDialog).getByRole('button', { name: /start autoplay/i }));

        const comparisonDrawer = screen.getByRole('complementary', {
            name: /home comparison drawer/i,
            hidden: true,
        });
        const secondComparisonCard = within(comparisonDrawer).getByText('44 South Shore Road').closest('article');
        fireEvent.click(within(secondComparisonCard as HTMLElement).getByRole('button', { name: /view details/i }));

        const secondDialog = await screen.findByRole('dialog', { name: /photos for 44 south shore road/i });
        expect(within(secondDialog).getByRole('img', { name: /photo 1 of 3/i })).toBeInTheDocument();
        expect(within(secondDialog).getByRole('button', { name: /show more/i })).toHaveAttribute(
            'aria-expanded',
            'false',
        );
        expect(within(secondDialog).getByRole('button', { name: /start autoplay/i })).toBeInTheDocument();
    });

    it('replaces a broken listing-card photo with a readable fallback', () => {
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);
        const listingPhoto = screen.getByRole('img', {
            name: /86 Mount Vernon Street, Boston property photo/i,
        });

        fireEvent.error(listingPhoto);

        expect(screen.queryByRole('img', {
            name: /86 Mount Vernon Street, Boston property photo/i,
        })).not.toBeInTheDocument();
        expect(screen.getAllByText(/photo unavailable/i).length).toBeGreaterThan(0);
    });

    it('keeps zero-photo listing details usable without invalid slideshow controls', async () => {
        const user = userEvent.setup();
        const noPhotoListing = {
            ...bundle.listings[0],
            listingNumber: '73333999',
            photos: [],
        };

        render(
            <PropertiesSearch
                initialBundle={{ ...bundle, listings: [noPhotoListing] }}
                {...profileProps}
            />,
        );

        await user.click(screen.getByRole('button', { name: /view details/i }));
        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });

        expect(within(dialog).getByText(/no photos available.*mls #73333999/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/photo unavailable/i)).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /previous photo/i })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /next photo/i })).not.toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /view all photos/i })).not.toBeInTheDocument();
    });

    it('routes showing requests to direct contact when online lead delivery is unavailable', async () => {
        const user = userEvent.setup();
        render(
            <PropertiesSearch
                initialBundle={bundle}
                {...profileProps}
                inquiry={{ action: undefined, method: 'post' }}
            />,
        );

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const galleryDialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });
        await user.click(within(galleryDialog).getByRole('button', { name: /request a showing/i }));

        expect(screen.queryByRole('dialog', { name: /photos for 86 mount vernon street/i })).not.toBeInTheDocument();
        const requestDrawer = screen.getByRole('dialog', { name: /plan a showing/i });
        expect(within(requestDrawer).getByRole('heading', { name: /email this home directly/i })).toBeInTheDocument();
        const emailLink = within(requestDrawer).getByRole('link', { name: /open email with 1 home/i });
        const decodedEmailHref = decodeURIComponent(emailLink.getAttribute('href') ?? '');

        expect(decodedEmailHref).toContain('mailto:maily@movewithmusto.com');
        expect(decodedEmailHref).toContain('MLS #73333444');
        expect(within(requestDrawer).getByRole('link', { name: /call instead \(781\) 315-3845/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(within(requestDrawer).queryByRole('button', { name: /send request/i })).not.toBeInTheDocument();
    });

    it('uses a comparison tray that can minimize and expand into a full comparison', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));

        const drawer = screen.getByRole('complementary', { name: /home comparison drawer/i });
        expect(within(drawer).getByRole('heading', { name: /2 homes selected/i })).toBeInTheDocument();
        expect(within(drawer).getByText(/86 Mount Vernon Street/i)).toBeInTheDocument();
        expect(within(drawer).getByText(/44 South Shore Road/i)).toBeInTheDocument();
        expect(within(drawer).queryByLabelText(/mls listing disclosure and participant information/i)).not.toBeInTheDocument();
        const comparisonPhoto = drawer.querySelector('img');
        expect(comparisonPhoto).not.toBeNull();
        fireEvent.error(comparisonPhoto!);
        expect(within(drawer).getAllByText(/photo unavailable/i)).toHaveLength(2);

        await user.click(within(drawer).getByRole('button', { name: /compare details/i }));
        const fullComparison = screen.getByRole('dialog', { name: /compare your homes/i });
        expect(within(fullComparison).getByRole('heading', { name: /compare your homes/i })).toBeInTheDocument();
        expect(within(fullComparison).getByText(/price \/ sqft/i)).toBeInTheDocument();
        expect(within(fullComparison).getByText(/want a second opinion/i)).toBeInTheDocument();
        expect(within(fullComparison).getByRole('button', { name: /send 2 compared homes to mai ly/i })).toBeInTheDocument();
        expect(within(fullComparison).getByRole('table', { name: /selected home comparison/i })).toBeInTheDocument();
        expect(within(fullComparison).getByRole('rowheader', { name: /price.*sqft/i })).toBeInTheDocument();
        expect(document.body.style.overflow).toBe('hidden');

        await user.keyboard('{Escape}');
        const restoredTray = screen.getByRole('complementary', { name: /home comparison drawer/i });
        const restoredFullButton = within(restoredTray).getByRole('button', { name: /compare details/i });
        expect(restoredFullButton).toHaveFocus();
        expect(document.body.style.overflow).toBe('');

        await user.click(restoredFullButton);
        const reopenedComparison = screen.getByRole('dialog', { name: /compare your homes/i });

        await user.click(within(reopenedComparison).getByRole('button', { name: /minimize/i }));
        const minimized = screen.getByRole('button', { name: /compare homes, 2 selected/i });
        await waitFor(() => expect(minimized).toHaveFocus());
        expect(minimized).toHaveAttribute('aria-expanded', 'false');
        expect(minimized).toHaveTextContent('2');
        await user.click(minimized);
        expect(screen.getByRole('heading', { name: /2 homes selected/i })).toBeInTheDocument();
    });

    it('submits compared homes in selection order as send_selected_homes', async () => {
        const user = userEvent.setup();
        const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));
        const comparison = screen.getByRole('complementary', { name: /home comparison drawer/i });
        await user.click(within(comparison).getByRole('button', { name: /send 2 selected homes to mai ly/i }));

        const drawer = screen.getByRole('dialog', { name: /send these homes to mai ly/i });
        expect(within(drawer).getByText(/2 homes included/i)).toBeInTheDocument();
        expect(within(drawer).queryByRole('combobox', { name: /what would you like help with/i }))
            .not.toBeInTheDocument();
        await user.type(within(drawer).getByLabelText(/^name$/i), 'Comparison Buyer');
        await user.type(within(drawer).getByLabelText(/^email$/i), 'buyer@example.com');
        await user.type(within(drawer).getByLabelText(/^message$/i), 'Please review these in this order.');
        await user.click(within(drawer).getByRole('checkbox', { name: /terms.*privacy policy/i }));
        await user.click(within(drawer).getByRole('button', { name: /send request/i }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(payload.requestType).toBe('send_selected_homes');
        expect(payload.selectedMlsNumbers).toEqual(['73333447', '73333444']);
        expect(payload.attachedListings.map((listing: { listingNumber: string }) => listing.listingNumber))
            .toEqual(['73333447', '73333444']);
    });

    it('minimizes tray and full comparison before opening View Details', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));

        let tray = screen.getByRole('complementary', { name: /home comparison drawer/i });
        await user.click(within(tray).getAllByRole('button', { name: /view details/i })[0]);
        let details = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(screen.queryByRole('complementary', { name: /home comparison drawer/i })).not.toBeInTheDocument();
        let compareDock = screen.getByRole('button', { name: /compare homes, 2 selected/i });
        expect(compareDock).toHaveAttribute('aria-expanded', 'false');
        await user.click(within(details).getByRole('button', { name: /^close details$/i }));
        await waitFor(() => expect(compareDock).toHaveFocus());

        await user.click(compareDock);
        tray = screen.getByRole('complementary', { name: /home comparison drawer/i });
        await user.click(within(tray).getByRole('button', { name: /compare details/i }));
        const fullComparison = screen.getByRole('dialog', { name: /compare your homes/i });
        await user.click(within(fullComparison).getAllByRole('button', { name: /view details/i })[0]);

        details = await screen.findByRole('dialog', { name: /photos for 86 mount vernon street/i });
        expect(screen.queryByRole('dialog', { name: /compare your homes/i })).not.toBeInTheDocument();
        compareDock = screen.getByRole('button', { name: /compare homes, 2 selected/i });
        expect(compareDock).toHaveAttribute('aria-expanded', 'false');
        await user.click(within(details).getByRole('button', { name: /^close details$/i }));
        await waitFor(() => expect(compareDock).toHaveFocus());
    });

    it('caps comparison selection at four homes', async () => {
        const user = userEvent.setup();
        const comparisonBundle = {
            ...bundle,
            listings: Array.from({ length: 5 }, (_, index) => makeListing(index + 1)),
        };
        render(<PropertiesSearch initialBundle={comparisonBundle} {...profileProps} />);

        for (let index = 0; index < 5; index += 1) {
            await user.click(screen.getAllByRole('button', { name: /^compare home$/i })[0]);
        }

        expect(screen.getByText(/selected four homes\. remove one to compare another/i)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /compare homes, 4 selected/i }));
        expect(screen.getByRole('heading', { name: /4 homes selected/i })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /^in comparison$/i })).toHaveLength(4);
        await user.click(screen.getByRole('button', { name: /dismiss/i }));
        expect(screen.queryByText(/selected four homes\. remove one to compare another/i)).not.toBeInTheDocument();
    });

    it('returns focus to the Compare dock when the ordinary comparison tray is minimized', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', {
            name: /^compare home$/i,
        }));
        await user.click(screen.getByRole('button', { name: /compare homes, 1 selected/i }));
        const tray = screen.getByRole('complementary', { name: /home comparison drawer/i });
        await user.click(within(tray).getByRole('button', { name: /minimize/i }));

        await waitFor(() => expect(screen.getByRole('button', {
            name: /compare homes, 1 selected/i,
        })).toHaveFocus());
    });

    it('moves focus to the next comparison removal control and back to results after the last removal', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));
        const firstRemove = screen.getByRole('button', { name: /remove 86 mount vernon street from comparison/i });
        await user.click(firstRemove);

        const lastRemove = screen.getByRole('button', { name: /remove 44 south shore road from comparison/i });
        await waitFor(() => expect(lastRemove).toHaveFocus());
        await user.click(lastRemove);
        await waitFor(() => expect(screen.getByRole('region', { name: /property search results/i })).toHaveFocus());
    });

    it('returns focus to the remaining Remove control when full comparison drops to one home', async () => {
        const user = userEvent.setup();
        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /^compare home$/i }));
        await user.click(within(listingCardFor('44 South Shore Road')).getByRole('button', { name: /^compare home$/i }));
        await user.click(screen.getByRole('button', { name: /compare homes, 2 selected/i }));
        await user.click(screen.getByRole('button', { name: /compare details/i }));
        const fullComparison = screen.getByRole('dialog', { name: /compare your homes/i });
        await user.click(within(fullComparison).getByRole('button', {
            name: /remove 86 mount vernon street from comparison/i,
        }));

        const remainingRemove = await screen.findByRole('button', {
            name: /remove 44 south shore road from comparison/i,
        });
        await waitFor(() => expect(remainingRemove).toHaveFocus());
        expect(screen.getByRole('button', { name: /compare details/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /compare details/i })).not.toHaveFocus();
    });

    it('keeps an explicitly opened comparison tray available until the buyer minimizes it', () => {
        vi.useFakeTimers();

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        fireEvent.click(screen.getAllByRole('button', { name: /^compare home$/i })[0]);
        fireEvent.click(screen.getByRole('button', { name: /compare homes, 1 selected/i }));

        expect(screen.getByRole('complementary', { name: /home comparison drawer/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /1 home selected/i })).toBeInTheDocument();

        act(() => {
            vi.advanceTimersByTime(10_000);
        });
        expect(screen.getByRole('complementary', { name: /home comparison drawer/i })).toBeInTheDocument();
    });

    it('keeps the explicitly opened comparison tray visible when a buyer interacts with it', () => {
        vi.useFakeTimers();

        render(<PropertiesSearch initialBundle={bundle} {...profileProps} />);

        fireEvent.click(screen.getAllByRole('button', { name: /^compare home$/i })[0]);
        fireEvent.click(screen.getByRole('button', { name: /compare homes, 1 selected/i }));
        const drawer = screen.getByRole('complementary', { name: /home comparison drawer/i });

        fireEvent.pointerDown(drawer);
        act(() => {
            vi.advanceTimersByTime(2500);
        });

        expect(screen.getByRole('complementary', { name: /home comparison drawer/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /1 home selected/i })).toBeInTheDocument();
    });

    it('shows square-foot lot size when acreage is unavailable', async () => {
        const user = userEvent.setup();
        const lotOnlyBundle: MlsPublicBundle = {
            ...bundle,
            listings: bundle.listings.map((listing) => listing.listingNumber === '73333445'
                ? {
                    ...listing,
                    facts: { ...listing.facts, acreage: null, lotSize: 4_200 },
                }
                : listing),
        };
        render(<PropertiesSearch initialBundle={lotOnlyBundle} {...profileProps} />);

        await user.click(within(listingCardFor('12 Beacon Street #2')).getByRole('button', { name: /view details/i }));
        const details = await screen.findByRole('dialog', { name: /photos for 12 beacon street #2/i });
        expect(within(details).getByText('Lot', { selector: 'dt' })).toBeInTheDocument();
        expect(within(details).getByText('4,200 sqft', { selector: 'dd' })).toBeInTheDocument();
    });

    it('describes missing listing detail data as unavailable and offers retry', async () => {
        const user = userEvent.setup();
        let detailAttempts = 0;
        vi.spyOn(global, 'fetch').mockImplementation(async () => {
            detailAttempts += 1;
            return detailAttempts === 1
                ? { ok: false, status: 404 } as Response
                : { ok: true, json: async () => toListingDetail() } as Response;
        });

        render(
            <PropertiesSearch
                detailBaseUrl="/mls/listings"
                initialSearchBundle={toSearchBundle()}
                {...profileProps}
            />,
        );

        await user.click(within(listingCardFor('86 Mount Vernon Street')).getByRole('button', { name: /view details/i }));
        const dialog = screen.getByRole('dialog', { name: /photos for 86 mount vernon street/i });

        expect(await within(dialog).findByText(/some details are not showing right now/i)).toBeInTheDocument();
        expect(within(dialog).queryByText(/could not load/i)).not.toBeInTheDocument();
        await user.click(within(dialog).getByRole('button', { name: /^try again$/i }));
        expect(await within(dialog).findByText(/source-faithful mls remarks stay intact/i)).toBeInTheDocument();
        expect(detailAttempts).toBe(2);
    });
});
