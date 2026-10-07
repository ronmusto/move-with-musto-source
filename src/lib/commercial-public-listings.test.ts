import { describe, expect, it, vi } from 'vitest';
import {
    buildCommercialGenerationBaseUrl,
    buildCommercialPublicDataUrl,
    commercialSearchIndexMatchesManifest,
    isCommercialCurrentPointerReady,
    isCommercialSearchIndexReady,
    isCommercialSearchManifestReady,
    readCommercialJson,
    type CommercialSearchIndex,
    type CommercialSearchManifest,
} from './commercial-public-listings';
import { MLS_PIN_PUBLIC_DISCLAIMER } from './mls-public-listings';

const now = Date.parse('2026-08-08T12:00:00.000Z');
const generatedAt = '2026-08-08T11:00:00.000Z';
const listing = {
    listingNumber: 'C1001',
    category: 'business-opportunity' as const,
    availability: null,
    listingTypes: ['Restaurant with liquor'],
    status: { code: 'ACT', label: 'Active', isActive: true as const },
    listPrice: 425000,
    priceLabel: '$425,000',
    address: {
        line: '10 Main Street',
        town: 'Acton',
        county: 'Middlesex',
        state: 'MA' as const,
        zip: '01720',
    },
    facts: {
        buildingSqft: 2500,
        lotSizeSqft: 10000,
        acreage: null,
        parkingSpaces: 5,
        totalUnits: null,
        stories: null,
    },
    realEstateIncluded: true,
    attribution: { listingAgent: 'Avery Agent', listingOffice: 'Synthetic Brokerage' },
    source: { name: 'MLS Property Information Network, Inc.' },
    photoCount: 2,
};

const manifest: CommercialSearchManifest = {
    schemaVersion: 2,
    generatedAt,
    source: 'MLS Property Information Network, Inc.',
    sourceUpdatedAt: '2026-08-08T10:00:00.000Z',
    disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
    compliance: {
        participantFirmName: 'Synthetic Test Realty',
        officeAddress: '1 Test Way, Acton, MA 01720',
        phone: '978-555-0100',
        marketArea: 'Acton',
    },
    totalListingCount: 1,
    facets: {
        availabilities: ['for-sale'],
        categories: ['business-opportunity'],
        counties: ['Middlesex'],
        towns: ['Acton'],
        listingTypes: ['Restaurant with liquor'],
    },
    index: { file: 'commercial-search-index.json', listingCount: 1 },
};
const index: CommercialSearchIndex = {
    schemaVersion: 2,
    generatedAt,
    listings: [listing],
};

describe('commercial public data contract', () => {
    it('builds only the separate /commercial data namespace', () => {
        expect(buildCommercialPublicDataUrl('current.json', 'https://data.example.com'))
            .toBe('https://data.example.com/commercial/current.json');
        expect(buildCommercialPublicDataUrl('/current.json', 'invalid-origin'))
            .toBe('/commercial/current.json');
    });

    it('validates a fresh pointer and resolves its generation with an injected clock', () => {
        const pointer = {
            schemaVersion: 2 as const,
            generation: 'synthetic-run-001',
            generatedAt,
            manifestFile: 'commercial-search-manifest.json' as const,
        };
        expect(isCommercialCurrentPointerReady(pointer, now)).toBe(true);
        expect(buildCommercialGenerationBaseUrl(
            'https://data.example.com/commercial/current.json?cache=1',
            pointer,
            now,
        )).toBe('https://data.example.com/commercial/generations/synthetic-run-001');
        expect(() => buildCommercialGenerationBaseUrl(
            'https://data.example.com/mls/commercial/current.json',
            pointer,
            now,
        )).toThrow(/unexpected namespace/i);
    });

    it('validates manifest, index, exact counts, and source freshness', () => {
        expect(isCommercialSearchManifestReady(manifest, now)).toBe(true);
        expect(isCommercialSearchIndexReady(index, manifest)).toBe(true);
        expect(commercialSearchIndexMatchesManifest(index, manifest)).toBe(true);
        const stale = { ...manifest, sourceUpdatedAt: '2026-08-01T10:00:00.000Z' };
        expect(isCommercialSearchManifestReady(stale, now)).toBe(false);
        const wrongCount = { ...manifest, totalListingCount: 2 };
        expect(isCommercialSearchIndexReady(index, wrongCount)).toBe(false);
    });

    it('fails closed on prohibited Attachment C, remarks, adult-community, and coordinate fields', () => {
        const prohibitedKeys = [
            'firmRemarks',
            'publicRecord',
            'specialShowingInstructions',
            'showingBuyerAgent',
            'entryOnly',
            'expirationDate',
            'typeOfListingAgreement',
            'remarks',
            'adultCommunity',
            'mapPosition',
            'coordinates',
        ];
        for (const prohibitedKey of prohibitedKeys) {
            const invalidIndex = {
                ...index,
                listings: [{
                    ...listing,
                    source: { ...listing.source, [prohibitedKey]: 'private' },
                }],
            };
            expect(isCommercialSearchIndexReady(invalidIndex, manifest), prohibitedKey).toBe(false);
        }
    });

    it('fetches JSON and reports HTTP failures without leaking response bodies', async () => {
        const successFetch = vi.fn(async () => new Response(JSON.stringify(index), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        }));
        await expect(readCommercialJson<CommercialSearchIndex>('/commercial/index.json', successFetch))
            .resolves.toEqual(index);
        const failureFetch = vi.fn(async () => new Response('private upstream body', { status: 503 }));
        await expect(readCommercialJson('/commercial/index.json', failureFetch))
            .rejects.toThrow('HTTP 503');
    });
});
