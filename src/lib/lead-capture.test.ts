import { describe, expect, it } from 'vitest';
import {
    SEARCH_CONSULT_DELIVERY,
    SEARCH_CONSULT_LEAD_SCHEMA_VERSION,
    SEARCH_CONSULT_LEAD_TYPE,
    buildSearchConsultLeadPayload,
} from './lead-capture';

describe('search consult lead capture contract', () => {
    it('freezes v1 search-context and email-fallback delivery fields', () => {
        const payload = buildSearchConsultLeadPayload({
            requestType: 'get_matching_homes',
            contact: {
                name: ' Buyer One ',
                email: ' buyer@example.com ',
                phone: ' 781-555-0101 ',
                preferredContact: ' email ',
            },
            freeformMessage: ' Help me compare these homes. ',
            propertyLink: ' https://example.com/listing/73333444 ',
            sourcePage: '/buy/properties/',
            searchContext: {
                activeRegion: 'North Shore',
                searchAreaLabel: 'Salem',
                searchAreaBounds: { north: 42.6, east: -70.7, south: 42.4, west: -71 },
                searchAreaGeometry: {
                    kind: 'polygon',
                    bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71 },
                    path: [
                        { lat: 42.6, lng: -71 },
                        { lat: 42.55, lng: -70.7 },
                        { lat: 42.4, lng: -70.9 },
                    ],
                },
                filters: {
                    query: 'harbor',
                    state: 'MA',
                    region: 'North Shore',
                    county: 'Essex',
                    includeTowns: ['Salem', 'Salem'],
                    excludeTowns: ['Lynn'],
                    propertyType: 'Single family',
                    minPrice: '750000',
                    maxPrice: '1500000',
                    minBeds: '3',
                    maxBeds: '',
                    minBaths: '2',
                    maxBaths: '',
                    openHouseOnly: true,
                    virtualTourOnly: false,
                    savedOnly: false,
                    sortBy: 'price',
                    sortDirection: 'desc',
                    mode: 'map',
                },
                selectedMlsNumbers: ['73333444', '73333444'],
            },
            attachedListings: [{
                listingNumber: '73333445',
                title: '12 Beacon Street, Brookline',
                town: 'Brookline',
                status: 'ACT',
                priceLabel: '$750,000',
                detailUrl: 'https://movewithmusto.com/buy/properties/?listing=73333445',
            }],
            website: '',
            consent: {
                termsAccepted: true,
                privacyAccepted: true,
                contactAuthorized: true,
                emailUpdatesOptIn: true,
                termsVersion: '2026-06-16',
                privacyVersion: '2026-07-01',
            },
        });

        expect(payload.schemaVersion).toBe(SEARCH_CONSULT_LEAD_SCHEMA_VERSION);
        expect(payload.leadType).toBe(SEARCH_CONSULT_LEAD_TYPE);
        expect(payload.delivery).toBe(SEARCH_CONSULT_DELIVERY);
        expect(payload.freeformMessage).toBe('Help me compare these homes.');
        expect(payload.message).toBe(payload.freeformMessage);
        expect(payload.activeRegion).toBe('North Shore');
        expect(payload.searchAreaLabel).toBe('Salem');
        expect(payload.searchAreaBounds).toEqual({ north: 42.6, east: -70.7, south: 42.4, west: -71 });
        expect(payload.searchAreaGeometry).toEqual({
            kind: 'polygon',
            bounds: { north: 42.6, east: -70.7, south: 42.4, west: -71 },
            path: [
                { lat: 42.6, lng: -71 },
                { lat: 42.55, lng: -70.7 },
                { lat: 42.4, lng: -70.9 },
            ],
        });
        expect(payload.filters).toMatchObject({
            region: 'North Shore',
            includeTowns: ['Salem'],
            sortBy: 'price',
            sortDirection: 'desc',
            mode: 'map',
        });
        expect(payload.selectedMlsNumbers).toEqual(['73333444', '73333445']);
        expect(payload.consent).toMatchObject({
            contactAuthorized: true,
            emailUpdatesOptIn: true,
            termsVersion: '2026-06-16',
            privacyVersion: '2026-07-01',
        });
    });
});
