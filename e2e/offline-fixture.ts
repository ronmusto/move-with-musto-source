import { test as base, expect } from '@playwright/test';
import {
    MLS_PIN_PUBLIC_DISCLAIMER,
    type MlsListingDetail,
    type MlsSearchManifest,
    type MlsSearchShard,
} from '../src/lib/mls-public-listings';

// Deliberately invented records, never copied from an MLS feed. Freshness uses
// the run time so these fixtures do not expire after the public 72-hour window.
export function createSyntheticInventory() {
    const generatedAt = new Date().toISOString();
    const listings: MlsListingDetail[] = Array.from({ length: 120 }, (_, index) => {
        const listPrice = 400_000 + index * 10_000;
        return {
            generatedAt,
            listingNumber: `SYNTHETIC-${String(index + 1).padStart(3, '0')}`,
            propertyType: index % 2 ? 'Condo/co-op' : 'Single family',
            status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
            listPrice,
            priceLabel: `$${listPrice.toLocaleString('en-US')}`,
            address: {
                line: `${index + 1} Synthetic Example Lane`,
                town: index % 2 ? 'Burlington' : 'Boston',
                county: index % 2 ? 'Middlesex' : 'Suffolk', state: 'MA', zip: '00000',
            },
            facts: {
                beds: 2 + index % 4, fullBaths: 2, halfBaths: 0, bathsLabel: '2f;0h',
                sqft: 1400 + index * 10, lotSize: null, acreage: null, yearBuilt: 2000,
                parking: 1, rooms: 6,
            },
            features: {
                style: ['Example'], propertySubtype: [], parking: [], waterfront: [], waterView: [],
                rooms: [{ name: 'Example bedroom', level: 'Second', dimensions: '12 x 12', features: [] }],
            },
            remarks: 'Synthetic browser-test record. This is not a real property or an offer for sale.',
            photoCount: 0, openHouses: [], virtualTourUrl: '',
            attribution: {
                listingAgent: 'Synthetic Example Agent', listingOffice: 'Synthetic Test Office',
                listingOfficePhone: '202-555-0100',
            },
            source: { name: 'Synthetic test inventory', photoDate: '', listingAlert: '' },
        };
    });
    const manifest: MlsSearchManifest = {
        schemaVersion: 1, generatedAt, source: 'Synthetic test inventory',
        disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
        compliance: {
            participantFirmName: 'Synthetic Test Office', officeAddress: 'Synthetic test fixture',
            phone: '202-555-0100', marketArea: 'Boston, Burlington',
        },
        totalListingCount: listings.length,
        facets: {
            states: ['MA'], counties: ['Middlesex', 'Suffolk'], towns: ['Boston', 'Burlington'],
            propertyTypes: ['Condo/co-op', 'Single family'],
        },
        coordinateIndex: { file: 'mls-coordinate-index.json', coordinateCount: 0 },
        shards: [{ id: 'preferred', file: 'mls-search-preferred.json', listingCount: listings.length }],
    };
    const shard: MlsSearchShard = {
        schemaVersion: 1, id: 'preferred', generatedAt,
        listings: listings.map((listing) => ({
            listingNumber: listing.listingNumber, propertyType: listing.propertyType,
            status: listing.status, listPrice: listing.listPrice, priceLabel: listing.priceLabel,
            address: listing.address, facts: listing.facts, attribution: listing.attribution,
            source: listing.source, photoCount: 0, openHouseCount: 0, hasVirtualTour: false,
        })),
    };
    return { manifest, shard, listings };
}

export const test = base.extend<{ offlineInventory: void }>({
    offlineInventory: [async ({ context, baseURL }, use) => {
        const inventory = createSyntheticInventory();
        const unexpectedRequests: string[] = [];
        const origin = new URL(baseURL!).origin;
        await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
                unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
                await route.abort('blockedbyclient');
                return;
            }
            if (!url.pathname.startsWith('/mls/')) {
                await route.continue();
                return;
            }
            let body: unknown;
            if (url.pathname === '/mls/mls-search-manifest.json') body = inventory.manifest;
            else if (url.pathname === '/mls/mls-search-preferred.json') body = inventory.shard;
            else if (url.pathname === '/mls/mls-coordinate-index.json') {
                body = { schemaVersion: 1, generatedAt: inventory.manifest.generatedAt, coordinates: {} };
            } else {
                const match = url.pathname.match(/^\/mls\/listings\/(SYNTHETIC-\d+)\.json$/u);
                if (match) body = inventory.listings.find((listing) => listing.listingNumber === match[1]);
            }
            await route.fulfill({ status: body ? 200 : 404, json: body ?? { error: 'No synthetic fixture' } });
        });
        await use();
        expect(unexpectedRequests, 'Offline browser tests must not contact services or submit forms').toEqual([]);
    }, { auto: true }],
});
export { expect };
