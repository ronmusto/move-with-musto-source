import { describe, expect, it } from 'vitest';
import type { MlsSearchListing } from '@/lib/mls-public-listings';
import { withCurrentOpenHouseCount } from '@/lib/mls-open-house-time';
import {
    allLabel,
    allRegionsLabel,
    defaultSort,
    defaultRegion,
    defaultFilters,
    filterListings,
    filterOptionsFor,
    listingMatchesRegion,
    normalizeServiceAreaFilters,
    paginateListings,
    propertyAreaPresetForSlug,
    propertyAreaPresetForTowns,
    sortListings,
    townRuleOptionsFor,
} from './property-search-utils';

function listing(overrides: Partial<MlsSearchListing>): MlsSearchListing {
    return {
        listingNumber: '70000000',
        propertyType: 'Single family',
        status: { code: 'ACT', label: 'Active', isActive: true },
        listPrice: 900000,
        priceLabel: '$900,000',
        address: {
            line: '1 Test Street',
            town: 'Boston',
            county: 'Suffolk',
            state: 'MA',
            zip: '02108',
        },
        facts: {
            beds: 3,
            fullBaths: 2,
            halfBaths: 1,
            bathsLabel: '2f;1h',
            sqft: 1800,
        },
        photoCount: 3,
        openHouseCount: 0,
        hasVirtualTour: false,
        attribution: {
            listingAgent: 'Avery Agent',
            listingOffice: 'Beacon Office',
        },
        source: { name: 'MLS PIN' },
        ...overrides,
    };
}

describe('property search utilities', () => {
    const listings = [
        listing({ listingNumber: '1', address: { line: '1 Beacon Street', town: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108' } }),
        listing({ listingNumber: '2', listPrice: 925000, address: { line: '9 Chestnut Street', town: 'Salem', county: 'Essex', state: 'MA', zip: '01970' } }),
        listing({ listingNumber: '3', listPrice: 750000, propertyType: 'Condo/co-op', address: { line: '12 Ocean Avenue', town: 'Nantucket', county: 'Nantucket', state: 'MA', zip: '02554' } }),
    ];

    it('matches configured regions and all-region search', () => {
        expect(listingMatchesRegion(listings[1], 'North Shore')).toBe(true);
        expect(listingMatchesRegion(listings[2], 'North Shore')).toBe(false);
        expect(listingMatchesRegion(listings[2], allRegionsLabel)).toBe(true);
    });

    it('maps stable area slugs to the existing market-region towns', () => {
        const northShore = propertyAreaPresetForSlug('north-shore');

        expect(northShore).toMatchObject({
            slug: 'north-shore',
            label: 'North Shore',
        });
        expect(northShore?.towns).toContain('Salem');
        expect(northShore?.towns).not.toContain('Burlington');
        expect(propertyAreaPresetForTowns(northShore?.towns ?? [])).toMatchObject({
            slug: 'north-shore',
            label: 'North Shore',
        });
        expect(propertyAreaPresetForSlug('not-a-real-area')).toBeNull();
    });

    it('uses a Burlington-area service fence as the default region', () => {
        const serviceAreaListings = [
            listing({ listingNumber: '1', address: { line: '1 Cambridge Street', town: 'Cambridge', county: 'Middlesex', state: 'MA', zip: '02139' } }),
            listing({ listingNumber: '2', address: { line: '1 Main Street', town: 'Worcester', county: 'Worcester', state: 'MA', zip: '01608' } }),
            listing({ listingNumber: '3', address: { line: '1 Harbor Road', town: 'Nantucket', county: 'Nantucket', state: 'MA', zip: '02554' } }),
            listing({ listingNumber: '4', address: { line: '1 Ocean Road', town: 'Plymouth', county: 'Plymouth', state: 'MA', zip: '02360' } }),
            listing({ listingNumber: '5', address: { line: '1 Border Road', town: 'Portsmouth', county: 'Rockingham', state: 'NH', zip: '03801' } }),
        ];

        expect(listingMatchesRegion(serviceAreaListings[0], defaultRegion)).toBe(true);
        expect(listingMatchesRegion(serviceAreaListings[1], defaultRegion)).toBe(false);
        expect(listingMatchesRegion(serviceAreaListings[2], defaultRegion)).toBe(false);
        expect(listingMatchesRegion(serviceAreaListings[3], defaultRegion)).toBe(false);
        expect(listingMatchesRegion(serviceAreaListings[4], defaultRegion)).toBe(false);
        expect(filterListings(serviceAreaListings, defaultFilters, new Set()).map((item) => item.listingNumber)).toEqual([
            '1',
        ]);
    });

    it('normalizes restored filters to canonical service-area geography', () => {
        const completeInventory = [
            listing({ listingNumber: '1', address: { line: '1 Cambridge Street', town: 'Cambridge', county: 'Middlesex', state: 'MA', zip: '02139' } }),
            listing({ listingNumber: '2', address: { line: '9 Chestnut Street', town: 'Salem', county: 'Essex', state: 'MA', zip: '01970' } }),
            listing({ listingNumber: '3', address: { line: '8 Granite Road', town: 'Portsmouth', county: 'Rockingham', state: 'NH', zip: '03801' } }),
            listing({ listingNumber: '4', address: { line: '4 Ocean Road', town: 'Newport', county: 'Newport', state: 'RI', zip: '02840' } }),
        ];
        const normalized = normalizeServiceAreaFilters({
            ...defaultFilters,
            state: 'NH',
            region: 'All reviewed areas',
            county: 'Rockingham',
            includeTowns: ['Portsmouth', 'Cambridge'],
            excludeTowns: ['Newport', 'Cambridge', 'Salem'],
        });

        expect(normalized).toMatchObject({
            state: 'MA',
            region: allRegionsLabel,
            county: allLabel,
            includeTowns: ['Cambridge'],
            excludeTowns: ['Salem'],
        });
        expect(filterListings(completeInventory, normalized, new Set()).map((item) => item.listingNumber))
            .toEqual(['1']);
    });

    it('filters by query, town rules, price, property type, and saved state', () => {
        const filtered = filterListings(listings, {
            ...defaultFilters,
            query: 'street',
            includeTowns: ['Boston', 'Salem'],
            excludeTowns: ['Boston'],
            propertyType: 'Single family',
            minPrice: '900000',
            maxPrice: '950000',
            savedOnly: true,
        }, new Set(['2']));

        expect(filtered.map((item) => item.listingNumber)).toEqual(['2']);
    });

    it('excludes homes whose only open houses have ended', () => {
        const now = Date.parse('2026-07-12T17:00:00.000Z');
        const openHouseListings = [
            listing({
                listingNumber: 'ended',
                openHouseCount: 1,
                openHouseEndTimes: ['2026-07-12T13:00:00'],
            }),
            listing({
                listingNumber: 'upcoming',
                openHouseCount: 1,
                openHouseEndTimes: ['2026-07-12T14:00:00'],
            }),
        ].map((item) => withCurrentOpenHouseCount(item, now));

        expect(filterListings(openHouseListings, {
            ...defaultFilters,
            openHouseOnly: true,
        }, new Set()).map((item) => item.listingNumber)).toEqual(['upcoming']);
    });

    it('keeps the free-text query scoped to address fields', () => {
        const addressOnlyListings = [
            listing({
                listingNumber: '73333444',
                address: { line: 'Beacon Street', town: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108' },
            }),
        ];

        expect(filterListings(addressOnlyListings, {
            ...defaultFilters,
            query: '73333444',
        }, new Set()).map((item) => item.listingNumber)).toEqual([]);

        expect(filterListings(addressOnlyListings, {
            ...defaultFilters,
            query: 'Beacon',
        }, new Set()).map((item) => item.listingNumber)).toEqual(['73333444']);
    });

    it('derives filter and town-rule options from listings', () => {
        expect(filterOptionsFor(listings)).toEqual({
            states: ['MA'],
            counties: ['Essex', 'Nantucket', 'Suffolk'],
            towns: ['Boston', 'Nantucket', 'Salem'],
            propertyTypes: ['Condo/co-op', 'Single family'],
        });

        expect(townRuleOptionsFor(listings, { region: allLabel }, 'sa')).toEqual(['Salem']);
    });

    it('normalizes town searches while returning canonical town names', () => {
        const towns = ['North Andover', 'São Tomé', 'Woburn'];

        expect(townRuleOptionsFor([], { region: allLabel }, '  NORTH---ANDOVER  ', towns))
            .toEqual(['North Andover']);
        expect(townRuleOptionsFor([], { region: allLabel }, 'sao_tome', towns))
            .toEqual(['São Tomé']);
        expect(townRuleOptionsFor([], { region: allLabel }, 'northandover', towns))
            .toEqual(['North Andover']);
    });

    it('ranks exact, prefix, word-prefix, and substring town matches before fuzzy matches', () => {
        const towns = ['Renewbury', 'West Newbury', 'Newburyport', 'Newbury', 'New Town'];

        expect(townRuleOptionsFor([], { region: allLabel }, 'newbury', towns)).toEqual([
            'Newbury',
            'Newburyport',
            'West Newbury',
            'Renewbury',
        ]);
    });

    it('corrects conservative town typos without accepting weak short matches', () => {
        const towns = ['Billerica', 'Boston', 'Burlington', 'North Andover', 'Woburn'];

        expect(townRuleOptionsFor([], { region: allLabel }, 'burlignton', towns)).toEqual(['Burlington']);
        expect(townRuleOptionsFor([], { region: allLabel }, 'wobrn', towns)).toEqual(['Woburn']);
        expect(townRuleOptionsFor([], { region: allLabel }, 'burligntn', towns)).toEqual(['Burlington']);
        expect(townRuleOptionsFor([], { region: allLabel }, 'wbrn', towns)).toEqual([]);
        expect(townRuleOptionsFor([], { region: allLabel }, 'xyz', towns)).toEqual([]);
    });

    it('caps ranked canonical town suggestions at eight', () => {
        const towns = Array.from({ length: 10 }, (_, index) => `North Town ${index + 1}`);

        expect(townRuleOptionsFor([], { region: allLabel }, 'north', towns)).toEqual(towns.slice(0, 8));
    });

    it('paginates without letting requested pages exceed bounds', () => {
        const page = paginateListings([1, 2, 3, 4, 5], 4, 2);

        expect(page).toEqual({
            totalPages: 3,
            effectivePage: 3,
            pageStartIndex: 4,
            pageEndIndex: 5,
            pagedListings: [5],
        });
    });

    it('sorts filtered listings by price or square feet while keeping missing values last', () => {
        const sortableListings = [
            listing({ listingNumber: '1', listPrice: 700000, facts: { ...listing({}).facts, sqft: 1800 } }),
            listing({ listingNumber: '2', listPrice: 950000, facts: { ...listing({}).facts, sqft: 1200 } }),
            listing({ listingNumber: '3', listPrice: null, facts: { ...listing({}).facts, sqft: null } }),
            listing({ listingNumber: '4', listPrice: 800000, facts: { ...listing({}).facts, sqft: 2400 } }),
        ];

        expect(defaultSort).toEqual({ key: 'recommended', direction: 'desc' });
        expect(sortListings(sortableListings, { key: 'price', direction: 'desc' }).map((item) => item.listingNumber)).toEqual([
            '2',
            '4',
            '1',
            '3',
        ]);
        expect(sortListings(sortableListings, { key: 'price', direction: 'asc' }).map((item) => item.listingNumber)).toEqual([
            '1',
            '4',
            '2',
            '3',
        ]);
        expect(sortListings(sortableListings, { key: 'sqft', direction: 'desc' }).map((item) => item.listingNumber)).toEqual([
            '4',
            '1',
            '2',
            '3',
        ]);
    });

    it('recommends Burlington first and representative service-area prices before luxury outliers', () => {
        const recommendedListings = [
            listing({
                listingNumber: 'luxury',
                listPrice: 38_000_000,
                address: { line: '1 Luxury Way', town: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108' },
            }),
            listing({
                listingNumber: 'representative',
                listPrice: 925_000,
                address: { line: '2 Main Street', town: 'Salem', county: 'Essex', state: 'MA', zip: '01970' },
            }),
            listing({
                listingNumber: 'burlington',
                listPrice: 1_100_000,
                address: { line: '3 Cambridge Street', town: 'Burlington', county: 'Middlesex', state: 'MA', zip: '01803' },
            }),
            listing({
                listingNumber: 'near-median',
                listPrice: 1_000_000,
                address: { line: '4 Main Street', town: 'Boston', county: 'Suffolk', state: 'MA', zip: '02108' },
            }),
        ];

        expect(sortListings(recommendedListings, defaultSort).map((item) => item.listingNumber)).toEqual([
            'burlington',
            'near-median',
            'representative',
            'luxury',
        ]);
    });
});
