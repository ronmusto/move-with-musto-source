import { describe, expect, it } from 'vitest';
import type { MlsSearchListing } from './mls-public-listings';
import {
    currentMlsOpenHouses,
    currentOpenHouseCount,
    parseMlsOpenHouseTimestamp,
    withCurrentOpenHouseCount,
} from './mls-open-house-time';

function searchListing(overrides: Partial<MlsSearchListing> = {}): MlsSearchListing {
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
        openHouseCount: 2,
        openHouseEndTimes: ['2026-07-12T13:00:00', '2026-07-12T16:00:00'],
        hasVirtualTour: false,
        attribution: { listingAgent: 'Avery Agent', listingOffice: 'Beacon Office' },
        source: { name: 'MLS PIN' },
        ...overrides,
    };
}

describe('MLS open-house time handling', () => {
    it('interprets offset-free MLS timestamps in Massachusetts time across DST', () => {
        expect(new Date(parseMlsOpenHouseTimestamp('2026-01-15T12:00:00')).toISOString())
            .toBe('2026-01-15T17:00:00.000Z');
        expect(new Date(parseMlsOpenHouseTimestamp('2026-07-15T12:00:00')).toISOString())
            .toBe('2026-07-15T16:00:00.000Z');
        expect(parseMlsOpenHouseTimestamp('2026-03-08T02:30:00')).toBeNaN();
    });

    it('removes ended and malformed events while retaining ongoing and upcoming events', () => {
        const now = Date.parse('2026-07-12T17:00:00.000Z'); // 1:00 PM Eastern
        const events = [
            { start: '2026-07-12T10:00:00', end: '2026-07-12T13:00:00', type: 'Ended now', url: '' },
            { start: '2026-07-12T12:30:00', end: '2026-07-12T13:30:00', type: 'Ongoing', url: '' },
            { start: '2026-07-12T15:00:00', end: '2026-07-12T16:00:00', type: 'Upcoming', url: '' },
            { start: 'not-a-date', end: 'also-not-a-date', type: 'Malformed', url: '' },
            { start: '2026-07-12T16:00:00', end: '2026-07-12T15:00:00', type: 'Backwards', url: '' },
        ];

        expect(currentMlsOpenHouses(events, now).map((event) => event.type))
            .toEqual(['Ongoing', 'Upcoming']);
    });

    it('recomputes compact search counts from event end times as static data ages', () => {
        const listing = searchListing();
        const duringFirst = Date.parse('2026-07-12T16:30:00.000Z'); // 12:30 PM Eastern
        const afterFirst = Date.parse('2026-07-12T17:00:00.000Z'); // 1:00 PM Eastern
        const afterAll = Date.parse('2026-07-12T20:00:00.000Z'); // 4:00 PM Eastern

        expect(currentOpenHouseCount(listing, duringFirst)).toBe(2);
        expect(withCurrentOpenHouseCount(listing, afterFirst).openHouseCount).toBe(1);
        expect(withCurrentOpenHouseCount(listing, afterAll).openHouseCount).toBe(0);
    });

    it('retains the legacy count when old search data has no event timestamps', () => {
        const listing = searchListing({ openHouseCount: 1, openHouseEndTimes: undefined });
        expect(currentOpenHouseCount(listing, Date.parse('2099-01-01T00:00:00.000Z'))).toBe(1);
    });
});
