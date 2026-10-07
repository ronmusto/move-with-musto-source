import { describe, expect, it } from 'vitest';
import {
    buildMlsPhotoSet,
    getMlsPhotoUrl,
    isMlsCoordinateIndexReady,
    isMlsSearchIndexBundleReady,
    isMlsSearchManifestReady,
    isMlsSearchShardReady,
    MLS_PIN_PUBLIC_DISCLAIMER,
    searchBundleFromShard,
    type MlsCoordinateIndex,
    type MlsSearchManifest,
    type MlsSearchShard,
    type MlsSearchIndexBundle,
    type MlsSearchListing,
} from './mls-public-listings';

describe('MLS PIN photo URL helpers', () => {
    it('generates MLS PIN media URLs from listing number, photo index, and display size', () => {
        expect(getMlsPhotoUrl('73333444', 1, 'card')).toBe(
            'https://media.mlspin.com/photo.aspx?mls=73333444&n=1&w=600&h=450',
        );
        expect(getMlsPhotoUrl('73333444', 1, 'detail')).toBe(
            'https://media.mlspin.com/photo.aspx?mls=73333444&n=1&w=1024&h=768',
        );
        expect(getMlsPhotoUrl('73333444', 1, 'thumbnail')).toBe(
            'https://media.mlspin.com/photo.aspx?mls=73333444&n=1&w=320&h=250',
        );
    });

    it('builds photo sets from photoCount without storing generated URLs in listing data', () => {
        const photos = buildMlsPhotoSet('73333444', 99);

        expect(photos).toHaveLength(42);
        expect(photos[0]).toEqual({
            index: 0,
            card: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=600&h=450',
            detail: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=1024&h=768',
            thumbnail: 'https://media.mlspin.com/photo.aspx?mls=73333444&n=0&w=320&h=250',
        });
    });
});

describe('MLS search index contract', () => {
    it('accepts the compact listing fields without detail-only data', () => {
        const listing = {
            listingNumber: '73333444',
            propertyType: 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true },
            listPrice: 899000,
            priceLabel: '$899,000',
            address: {
                line: '86 Mount Vernon Street',
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
            photoCount: 2,
            openHouseCount: 0,
            openHouseEndTimes: [],
            hasVirtualTour: false,
            attribution: {
                listingAgent: 'Avery Agent',
                listingOffice: 'Beacon Office',
            },
            source: { name: 'MLS PIN' },
        } satisfies MlsSearchListing;
        const bundle = {
            generatedAt: '2026-07-09T12:00:00.000Z',
            source: 'MLS Property Information Network, Inc.',
            disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
            compliance: {
                participantFirmName: 'Test Participant Realty',
                officeAddress: '123 Main Street, Salem, MA 01970',
                phone: '(781) 315-3845',
                marketArea: 'Boston, Brookline, Salem',
            },
            listings: [listing],
        } satisfies MlsSearchIndexBundle;

        expect(isMlsSearchIndexBundleReady(bundle, Date.parse('2026-07-09T12:30:00.000Z'))).toBe(true);
        expect(isMlsSearchIndexBundleReady({
            ...bundle,
            listings: [{
                ...listing,
                address: {
                    ...listing.address,
                    state: 'NH',
                },
            }],
        }, Date.parse('2026-07-09T12:30:00.000Z'))).toBe(false);

        const manifest = {
            schemaVersion: 1,
            generatedAt: bundle.generatedAt,
            source: bundle.source,
            disclaimer: bundle.disclaimer,
            compliance: bundle.compliance,
            totalListingCount: 1,
            facets: {
                states: ['MA'],
                counties: ['Suffolk'],
                towns: ['Boston'],
                propertyTypes: ['Single family'],
            },
            coordinateIndex: {
                file: 'mls-coordinate-index.json',
                coordinateCount: 1,
            },
            shards: [
                { id: 'preferred', file: 'mls-search-preferred.json', listingCount: 1 },
            ],
        } satisfies MlsSearchManifest;
        const preferredShard = {
            schemaVersion: 1,
            id: 'preferred',
            generatedAt: bundle.generatedAt,
            listings: [listing],
        } satisfies MlsSearchShard;
        const validationTime = Date.parse('2026-07-09T12:30:00.000Z');
        const coordinateIndex = {
            schemaVersion: 1,
            generatedAt: bundle.generatedAt,
            coordinates: {
                '73333444': {
                    lat: 42.3588,
                    lng: -71.0707,
                    expiresAt: '2026-08-01T12:00:00.000Z',
                },
            },
        } satisfies MlsCoordinateIndex;

        expect(isMlsSearchManifestReady(manifest, validationTime)).toBe(true);
        expect(isMlsSearchManifestReady({
            ...manifest,
            facets: {
                ...manifest.facets,
                states: ['NH'],
            },
        }, validationTime)).toBe(false);
        expect(isMlsSearchManifestReady({
            ...manifest,
            facets: {
                ...manifest.facets,
                states: ['MA', 'NH'],
            },
        }, validationTime)).toBe(false);
        expect(isMlsCoordinateIndexReady(coordinateIndex, manifest, validationTime)).toBe(true);
        expect(isMlsCoordinateIndexReady({
            ...coordinateIndex,
            coordinates: {
                '73333444': {
                    ...coordinateIndex.coordinates['73333444'],
                    expiresAt: '2026-07-08T12:00:00.000Z',
                },
            },
        }, manifest, validationTime)).toBe(true);
        expect(isMlsCoordinateIndexReady({
            ...coordinateIndex,
            coordinates: {
                '73333444': {
                    ...coordinateIndex.coordinates['73333444'],
                    source: 'google_geocoding',
                },
            },
        }, manifest, validationTime)).toBe(false);
        expect(isMlsSearchShardReady(preferredShard, manifest, 'preferred', validationTime)).toBe(true);
        expect(isMlsSearchShardReady({
            ...preferredShard,
            listings: [{
                ...listing,
                address: {
                    ...listing.address,
                    state: 'NH',
                },
            }],
        }, manifest, 'preferred', validationTime)).toBe(false);
        expect(searchBundleFromShard(manifest, preferredShard)).toEqual(bundle);
        expect(isMlsSearchManifestReady({
            ...manifest,
            shards: [
                ...manifest.shards,
                { id: 'other', file: 'mls-search-other.json', listingCount: 0 },
            ],
        }, validationTime)).toBe(false);
    });
});
