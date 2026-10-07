import { describe, expect, it } from 'vitest';
import {
    businessRealEstateLabel,
    commercialListingSizeLabel,
    defaultCommercialSearchFilters,
    filterCommercialListings,
    type CommercialFilterableListing,
} from './commercial-search-filters';

const fixtures = [
    {
        listingNumber: 'CI-SALE',
        category: 'commercial-industrial',
        availability: 'for-sale',
        listingTypes: ['Office'],
        listPrice: 900_000,
        address: { line: '10 Commerce Way', town: 'Burlington', zip: '01803' },
        facts: { buildingSqft: 8_000, acreage: 1.2 },
        realEstateIncluded: null,
    },
    {
        listingNumber: 'CI-LEASE',
        category: 'commercial-industrial',
        availability: 'for-lease',
        listingTypes: ['Retail'],
        listPrice: 18,
        address: { line: '20 Lease Street', town: 'Burlington', zip: '01803' },
        facts: { buildingSqft: 3_000, acreage: 0.5 },
        realEstateIncluded: null,
    },
    {
        listingNumber: 'CI-BOTH',
        category: 'commercial-industrial',
        availability: 'for-sale-or-lease',
        listingTypes: ['Industrial'],
        listPrice: 1_200_000,
        address: { line: '30 Flexible Road', town: 'Woburn', zip: '01801' },
        facts: { buildingSqft: 12_000, acreage: 2.5 },
        realEstateIncluded: null,
    },
    {
        listingNumber: 'LD-1',
        category: 'land',
        availability: null,
        listingTypes: ['Commercial land'],
        listPrice: 550_000,
        address: { line: '40 Land Lane', town: 'Woburn', zip: '01801' },
        facts: { buildingSqft: null, acreage: 4.5 },
        realEstateIncluded: null,
    },
    {
        listingNumber: 'BU-1',
        category: 'business-opportunity',
        availability: null,
        listingTypes: ['Service'],
        listPrice: 175_000,
        address: { line: '50 Main Street', town: 'Burlington', zip: '01803' },
        facts: { buildingSqft: 2_100, acreage: null },
        realEstateIncluded: null,
    },
] as const satisfies readonly CommercialFilterableListing[];

describe('commercial search filters', () => {
    it('combines category, included community, sale price, building size, acreage, and subtype boundaries', () => {
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            category: 'commercial-industrial',
            listingType: 'Office',
            includeTowns: ['Burlington'],
            minPrice: '800000',
            maxPrice: '1000000',
            minSquareFeet: '2500',
            minAcreage: '1',
        })).toEqual([fixtures[0]]);
    });

    it('supports inclusive and exclusive community rules without overlap', () => {
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            includeTowns: ['Burlington', 'Woburn'],
            excludeTowns: ['Burlington'],
        })).toEqual([fixtures[2], fixtures[3]]);
    });

    it('searches address, town, ZIP, and MLS number', () => {
        for (const query of ['Commerce Way', 'Burlington', '01803', 'CI-SALE']) {
            expect(filterCommercialListings(fixtures, {
                ...defaultCommercialSearchFilters,
                query,
            })).toContain(fixtures[0]);
        }
    });

    it('treats sale-or-lease as overlapping both offering filters', () => {
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            availability: 'for-lease',
        })).toEqual([fixtures[1], fixtures[2]]);
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            availability: 'for-sale-or-lease',
        })).toEqual([fixtures[2]]);
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            availability: 'for-sale',
        })).toEqual([fixtures[0], fixtures[2], fixtures[3], fixtures[4]]);
    });

    it('never compares a pure lease amount to sale-price limits', () => {
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            maxPrice: '100',
        })).not.toContain(fixtures[1]);
    });

    it('treats the business real-estate filter as business-only and preserves unknown', () => {
        expect(filterCommercialListings(fixtures, {
            ...defaultCommercialSearchFilters,
            realEstateIncluded: 'unknown',
        })).toEqual([fixtures[4]]);
        expect(businessRealEstateLabel('business-opportunity', null))
            .toBe('Real estate included: Unknown');
    });

    it('uses positive building area, then acreage, and suppresses zero sentinels', () => {
        expect(commercialListingSizeLabel(fixtures[0])).toBe('8,000 building sq ft');
        expect(commercialListingSizeLabel(fixtures[3])).toBe('4.5 acres');
        expect(commercialListingSizeLabel({
            ...fixtures[0],
            facts: { buildingSqft: 0, acreage: 0 },
        })).toBe('Size not provided');
    });
});
