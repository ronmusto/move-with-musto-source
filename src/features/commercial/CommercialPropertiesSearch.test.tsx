import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MLS_PIN_PUBLIC_DISCLAIMER } from '@/lib/mls-public-listings';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import type {
    CommercialSearchListing,
    CommercialSearchManifest,
} from '@/lib/commercial-public-listings';
import type { CommercialSearchDelivery } from '@/lib/commercial-search-client';
import { CommercialPropertiesSearch } from './CommercialPropertiesSearch';

const generatedAt = new Date().toISOString();

function listing(
    listingNumber: string,
    overrides: Partial<CommercialSearchListing> = {},
): CommercialSearchListing {
    return {
        listingNumber,
        category: 'commercial-industrial',
        availability: 'for-sale',
        listingTypes: ['Office'],
        status: { code: 'ACT', label: 'Active', isActive: true },
        listPrice: 900_000,
        priceLabel: '$900,000',
        address: {
            line: `${listingNumber} Example Way`,
            town: 'Burlington',
            county: 'Middlesex',
            state: 'MA',
            zip: '01803',
        },
        facts: {
            buildingSqft: 8_000,
            lotSizeSqft: 40_000,
            acreage: 0.92,
            parkingSpaces: 20,
            totalUnits: 1,
            stories: 1,
        },
        realEstateIncluded: null,
        attribution: {
            listingAgent: 'Alex Example',
            listingOffice: 'Example Brokerage',
        },
        source: { name: 'MLS Property Information Network, Inc.' },
        photoCount: 1,
        ...overrides,
    };
}

const listings: CommercialSearchListing[] = [
    listing('SYN-CI-1'),
    listing('SYN-LD-1', {
        category: 'land',
        availability: null,
        listingTypes: ['Commercial land'],
        listPrice: 550_000,
        priceLabel: '$550,000',
        address: {
            line: '2 Sample Road',
            town: 'Woburn',
            county: 'Middlesex',
            state: 'MA',
            zip: '01801',
        },
        facts: {
            buildingSqft: null,
            lotSizeSqft: 196_020,
            acreage: 4.5,
            parkingSpaces: null,
            totalUnits: null,
            stories: null,
        },
        photoCount: 0,
    }),
    listing('SYN-BU-U', {
        category: 'business-opportunity',
        availability: null,
        listingTypes: ['Service'],
        listPrice: 175_000,
        priceLabel: '$175,000',
        realEstateIncluded: null,
    }),
    listing('SYN-BU-N', {
        category: 'business-opportunity',
        availability: null,
        listingTypes: ['Retail'],
        listPrice: 225_000,
        priceLabel: '$225,000',
        realEstateIncluded: false,
    }),
    listing('SYN-BU-Y', {
        category: 'business-opportunity',
        availability: null,
        listingTypes: ['Restaurant'],
        listPrice: 450_000,
        priceLabel: '$450,000',
        realEstateIncluded: true,
    }),
];

const manifest: CommercialSearchManifest = {
    schemaVersion: 2,
    generatedAt,
    source: 'MLS Property Information Network, Inc.',
    sourceUpdatedAt: generatedAt,
    disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
    compliance: {
        participantFirmName: 'Synthetic Participant Firm',
        officeAddress: '100 Example Plaza, Sample, MA 01000',
        phone: '555-0100',
        marketArea: 'Burlington, Woburn',
    },
    totalListingCount: listings.length,
    facets: {
        availabilities: ['for-sale'],
        categories: ['business-opportunity', 'commercial-industrial', 'land'],
        counties: ['Middlesex'],
        towns: ['Burlington', 'Woburn'],
        listingTypes: ['Commercial land', 'Office', 'Restaurant', 'Retail', 'Service'],
    },
    index: { file: 'commercial-search-index.json', listingCount: listings.length },
};

const delivery: CommercialSearchDelivery = {
    currentPointerUrl: '/commercial/current.json',
    generationBaseUrl: '/commercial/generations/synthetic-generation',
    manifest,
    index: { schemaVersion: 2, generatedAt, listings },
};

describe('CommercialPropertiesSearch', () => {
    it('shows mandatory listing fields, participant information, and the MLS notice', async () => {
        const user = userEvent.setup();
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockResolvedValue(delivery)}
            />,
        );

        const address = await screen.findByRole('heading', { name: /syn-ci-1 example way/i });
        const card = address.closest('article');
        expect(card).not.toBeNull();
        expect(within(card as HTMLElement).getByText('List price')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText('$900,000')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText('1 total unit')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText('1 story')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText('Active')).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText(/mls #syn-ci-1/i)).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText(/listed by alex example/i)).toBeInTheDocument();
        expect(within(card as HTMLElement).getByText(/listing office: example brokerage/i))
            .toBeInTheDocument();

        const searchSummary = screen.getByRole('complementary', {
            name: 'Commercial search summary',
        });
        expect(within(searchSummary).getByText('5 matching listings')).toBeInTheDocument();
        expect(within(searchSummary).getByText('2 communities')).toBeInTheDocument();
        expect(within(searchSummary).getByRole('link', { name: 'Contact Mai Ly' }))
            .toHaveAttribute('href', expect.stringContaining('mailto:'));

        expect(screen.getByText('Synthetic Participant Firm')).toBeInTheDocument();
        expect(screen.getByText('100 Example Plaza, Sample, MA 01000')).toBeInTheDocument();
        expect(screen.getByText('555-0100')).toBeInTheDocument();
        const compliancePanel = screen.getByRole('complementary', {
            name: 'MLS listing information',
        });
        expect(compliancePanel.firstElementChild).not.toHaveAttribute('tabindex');
        const serviceAreaSummary = screen.getByText('2 service-area communities');
        const serviceAreaDisclosure = serviceAreaSummary.closest('details');
        expect(serviceAreaDisclosure).not.toBeNull();
        expect(serviceAreaDisclosure).not.toHaveAttribute('open');
        await user.click(serviceAreaSummary);
        expect(serviceAreaDisclosure).toHaveAttribute('open');
        expect(within(serviceAreaDisclosure as HTMLElement).getByRole('list')).toBeInTheDocument();
        expect(within(serviceAreaDisclosure as HTMLElement).getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText(MLS_PIN_PUBLIC_DISCLAIMER)).toBeInTheDocument();
        expect(screen.getAllByText(/source: MLS Property Information Network, Inc/i).length)
            .toBeGreaterThan(0);
        expect(screen.queryByText(/public remarks|adult community/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /map/i })).not.toBeInTheDocument();
    });

    it('displays yes, no, and unknown business real-estate values explicitly', async () => {
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockResolvedValue(delivery)}
            />,
        );

        expect(await screen.findByText('Real estate included: Unknown')).toBeInTheDocument();
        expect(screen.getByText('Real estate included: No')).toBeInTheDocument();
        expect(screen.getByText('Real estate included: Yes')).toBeInTheDocument();
    });

    it('filters business opportunities by explicit unknown status and switches views', async () => {
        const user = userEvent.setup();
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockResolvedValue(delivery)}
            />,
        );
        await screen.findByRole('heading', { name: /syn-ci-1 example way/i });

        await user.click(screen.getByRole('button', { name: /more commercial filters/i }));
        await user.selectOptions(screen.getByLabelText('Real estate included'), 'unknown');
        expect(screen.getByText('Real estate included: Unknown')).toBeInTheDocument();
        expect(screen.queryByText('Real estate included: No')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /syn-ci-1 example way/i })).not.toBeInTheDocument();

        const gridButton = screen.getByRole('button', { name: 'Grid' });
        await user.click(gridButton);
        expect(gridButton).toHaveAttribute('aria-pressed', 'true');
    });

    it('adds accessible include and exclude community rules without rendering a long town list', async () => {
        const user = userEvent.setup();
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockResolvedValue(delivery)}
            />,
        );
        await screen.findByRole('heading', { name: /syn-ci-1 example way/i });

        await user.click(screen.getByRole('button', { name: /more commercial filters/i }));
        const includeSearch = screen.getByRole('combobox', {
            name: 'Search communities to include',
        });
        expect(includeSearch).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('option', { name: /include burlington/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /include woburn/i })).not.toBeInTheDocument();

        await user.type(includeSearch, 'wob');
        expect(screen.getByRole('option', { name: 'Include Woburn' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /include burlington/i })).not.toBeInTheDocument();

        await user.keyboard('{Enter}');
        expect(includeSearch).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Remove included town Woburn' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /2 sample road/i })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /syn-ci-1 example way/i })).not.toBeInTheDocument();

        const excludeSearch = screen.getByRole('combobox', {
            name: 'Search communities to exclude',
        });
        await user.type(excludeSearch, 'burl');
        await user.click(screen.getByRole('option', { name: 'Exclude Burlington' }));
        expect(screen.getByRole('button', { name: 'Remove excluded town Burlington' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Remove included town Woburn' }));
        expect(screen.queryByRole('heading', { name: /syn-ci-1 example way/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /2 sample road/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Clear community choices' }));
        expect(screen.getByRole('heading', { name: /syn-ci-1 example way/i })).toBeInTheDocument();
    });

    it('collapses the sticky quick filters to the compact search capsule after scrolling', async () => {
        const originalObserver = window.IntersectionObserver;
        let observerCallback: IntersectionObserverCallback | undefined;
        let observedTarget: Element | undefined;

        class CapturingIntersectionObserver implements IntersectionObserver {
            readonly root = null;
            readonly rootMargin = '-96px 0px 0px';
            readonly thresholds = [0];

            constructor(callback: IntersectionObserverCallback) {
                observerCallback = callback;
            }

            disconnect() {}
            observe(target: Element) { observedTarget = target; }
            takeRecords(): IntersectionObserverEntry[] { return []; }
            unobserve() {}
        }

        window.IntersectionObserver = CapturingIntersectionObserver;
        try {
            const user = userEvent.setup();
            render(
                <CommercialPropertiesSearch
                    contact={defaultRealEstateProfile.contact}
                    loadDelivery={vi.fn().mockResolvedValue(delivery)}
                />,
            );
            await screen.findByRole('heading', { name: /syn-ci-1 example way/i });

            const quickFilters = screen.getByRole('search', { name: 'Commercial property search filters' });
            const capsuleButton = screen.getByRole('button', {
                hidden: true,
                name: /edit commercial search filters/i,
            });
            expect(quickFilters).not.toHaveAttribute('hidden');
            expect(capsuleButton.closest('[hidden]')).not.toBeNull();
            await waitFor(() => expect(observerCallback).toBeTypeOf('function'));
            expect(observedTarget).toBe(screen.getByTestId('commercial-filter-capsule-sentinel'));

            act(() => {
                observerCallback?.([{
                    boundingClientRect: { top: 0 },
                    isIntersecting: false,
                    target: observedTarget,
                } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
            });

            expect(quickFilters).toHaveAttribute('hidden');
            expect(capsuleButton.closest('[hidden]')).toBeNull();
            await user.click(capsuleButton);
            expect(quickFilters).not.toHaveAttribute('hidden');
            await user.keyboard('{Escape}');
            expect(quickFilters).toHaveAttribute('hidden');
        } finally {
            window.IntersectionObserver = originalObserver;
        }
    });

    it('contains keyboard focus in the filters dialog and restores the opener on Escape', async () => {
        const user = userEvent.setup();
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockResolvedValue(delivery)}
            />,
        );
        await screen.findByRole('heading', { name: /syn-ci-1 example way/i });
        const opener = screen.getByRole('button', { name: /more commercial filters/i });
        await user.click(opener);
        const dialog = screen.getByRole('dialog', { name: 'More filters' });
        const close = within(dialog).getByRole('button', { name: /close more commercial filters/i });
        const showResults = within(dialog).getByRole('button', { name: /show 5 listings/i });
        expect(dialog).toHaveFocus();
        await user.tab({ shift: true });
        expect(showResults).toHaveFocus();
        await user.tab();
        expect(close).toHaveFocus();

        const community = within(dialog).getByRole('combobox', { name: /search communities to include/i });
        await user.type(community, 'wob');
        expect(community).toHaveAttribute('aria-expanded', 'true');
        await user.keyboard('{Escape}');
        expect(dialog).toBeInTheDocument();
        expect(community).toHaveAttribute('aria-expanded', 'false');
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        await waitFor(() => expect(opener).toHaveFocus());
    });

    it('fails closed without rendering listing data when delivery validation fails', async () => {
        render(
            <CommercialPropertiesSearch
                contact={defaultRealEstateProfile.contact}
                loadDelivery={vi.fn().mockRejectedValue(new Error('stale'))}
            />,
        );

        expect(await screen.findByRole('heading', {
            name: /commercial listings are temporarily unavailable/i,
        })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /syn-ci-1 example way/i })).not.toBeInTheDocument();
    });
});
