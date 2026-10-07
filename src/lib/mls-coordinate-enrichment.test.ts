import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    acquireGeocodeRunLock,
    assertSafeGeocodePlan,
    buildGeocodePlan,
    createGeocodeAuditWriter,
    createImmutableGeocodeAuditMirror,
    enrichPublicationCoordinates,
    geocodeCacheKey,
    GOOGLE_GEOCODE_CACHE_TTL_MS,
    GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS,
    mapPositionNeedsRefresh,
    MLS_INGEST_INTERVAL_MS,
    parseArgs,
    parseGeocodeAuditLedger,
    PREFERRED_SERVICE_AREA_TOWNS,
    pruneGeocodeCacheEntries,
    recoverGeocodeAuditFromCache,
    validatedGoogleGeocodeResult,
} from '../../scripts/enrich-mls-coordinates.mjs';
import { coordinateIsInMassachusetts } from '../../scripts/massachusetts-coordinate-guard.mjs';
import { marketRegions, townMatchesPreferredServiceArea } from './market-regions';


// Deliberately synthetic record: exercise reviewed-override behavior without
// redistributing the privately operated address override or its listing ID.
vi.mock('../../scripts/mls-coordinate-overrides.json', () => ({
    default: {
        schemaVersion: 'move-with-musto.reviewed-coordinate-overrides.v1',
        entries: {
            'synthetic-override-001|1 synthetic fixture way|hudson|ma|01749': {
                listingNumber: 'SYNTHETIC-OVERRIDE-001',
                addressKey: '1 synthetic fixture way|hudson|ma|01749',
                lat: 42.3601,
                lng: -71.0589,
                source: 'massgis_address_point',
                precision: 'ADDRESS_POINT',
            },
        },
    },
}));
const now = Date.parse('2026-07-02T12:00:00.000Z');

function listing(overrides: Record<string, unknown> = {}) {
    const base = {
        listingNumber: '73333444',
        propertyType: 'Single family',
        status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
        listPrice: 899000,
        priceLabel: '$899,000',
        address: {
            line: '86 Mount Vernon Street',
            town: 'Boston',
            state: 'MA',
            county: 'Suffolk',
            zip: '02108',
        },
        facts: {
            beds: 5,
            fullBaths: 4,
            halfBaths: 2,
            bathsLabel: '4f;2h',
            sqft: 4492,
            lotSize: null,
            acreage: 0.03,
            yearBuilt: 1875,
            parking: 1,
        },
        attribution: {
            listingOffice: 'Beacon Office',
            listingAgent: 'Avery Agent',
            listingOfficePhone: '617-555-0100',
        },
        source: { name: 'MLS PIN', photoDate: '', listingAlert: '' },
        photoCount: 2,
        openHouseCount: 0,
        hasVirtualTour: false,
    };

    return {
        ...base,
        ...overrides,
        address: {
            ...base.address,
            ...((overrides.address as Record<string, unknown> | undefined) ?? {}),
        },
    };
}

function cacheEntry(
    sourceListing: ReturnType<typeof listing>,
    overrides: Record<string, unknown> = {},
) {
    const { line, town, state, zip } = sourceListing.address;
    return {
        listingNumber: sourceListing.listingNumber,
        address: `${line}, ${town}, ${state}, ${zip}, USA`,
        addressKey: [line, town, state, zip].map((part) => String(part).trim().toLowerCase()).join('|'),
        lat: 42.3588,
        lng: -71.0707,
        precision: 'ROOFTOP',
        geocodedAt: '2026-07-01T12:00:00.000Z',
        expiresAt: '2026-07-31T12:00:00.000Z',
        ...overrides,
    };
}

function requestAuditEvent(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 'move-with-musto.google-geocode-audit.v1',
        eventType: 'request_started',
        occurredAt: '2026-07-02T12:00:00.000Z',
        provider: 'google_geocoding',
        runId: '11111111-1111-4111-8111-111111111111',
        requestId: '22222222-2222-4222-8222-222222222222',
        sequence: 1,
        listingNumber: '73333444',
        addressIdentitySha256: 'a'.repeat(64),
        cacheEntryIdentitySha256: 'b'.repeat(64),
        requestReason: 'missing',
        httpMethod: 'GET',
        requestHost: 'maps.googleapis.com',
        requestPath: '/maps/api/geocode/json',
        requestComponents: 'country:US|administrative_area:MA|postal_code:REDACTED',
        providerSku: 'Geocoding',
        transmissionState: 'prepared',
        outcome: 'prepared',
        ...overrides,
    };
}

describe('MLS coordinate enrichment', () => {
    it('rejects the Hudson NH rooftop result returned for the Hudson MA listing', () => {
        const googleResponse = {
            status: 'OK',
            results: [{
                partial_match: false,
                types: ['street_address'],
                address_components: [
                    { short_name: 'NH', long_name: 'New Hampshire', types: ['administrative_area_level_1'] },
                    { short_name: '03051', long_name: '03051', types: ['postal_code'] },
                    { short_name: 'US', long_name: 'United States', types: ['country'] },
                ],
                geometry: {
                    location: { lat: 42.7847037, lng: -71.4524386 },
                    location_type: 'ROOFTOP',
                },
            }],
        };

        expect(coordinateIsInMassachusetts(googleResponse.results[0].geometry.location)).toBe(false);
        expect(validatedGoogleGeocodeResult(googleResponse, {
            line: '1 Synthetic Fixture Way',
            town: 'Hudson',
            state: 'MA',
            zip: '01749',
        })).toBeNull();
    });

    it('allows reviewed waterfront points within the municipal-boundary tolerance', () => {
        expect(coordinateIsInMassachusetts({
            lat: 42.3686181,
            lng: -71.0432767,
        })).toBe(true);
    });

    it('uses a synthetic reviewed override and purges the stale cache entry without a request', async () => {
        const hudsonListing = listing({
            listingNumber: 'SYNTHETIC-OVERRIDE-001',
            address: {
                line: '1 Synthetic Fixture Way',
                town: 'Hudson',
                state: 'MA',
                zip: '01749',
            },
        });
        const detail = { ...hudsonListing, generatedAt: '2026-07-02T12:00:00.000Z' };
        const key = geocodeCacheKey(hudsonListing);
        const geocode = vi.fn();
        const result = await enrichPublicationCoordinates({
            apiKey: '',
            cache: {
                entries: {
                    [key]: cacheEntry(hudsonListing, {
                        lat: 42.7847037,
                        lng: -71.4524386,
                    }),
                },
            },
            details: new Map([['SYNTHETIC-OVERRIDE-001.json', detail]]),
            geocode,
            index: { listings: [hudsonListing] },
            now,
        });

        expect(geocode).not.toHaveBeenCalled();
        expect(result.cache.entries).not.toHaveProperty(key);
        expect((hudsonListing as typeof hudsonListing & { mapPosition: unknown }).mapPosition).toMatchObject({
            lat: 42.3601,
            lng: -71.0589,
            source: 'massgis_address_point',
            precision: 'ADDRESS_POINT',
        });
        expect((detail as typeof detail & { mapPosition: unknown }).mapPosition).toEqual(
            (hudsonListing as typeof hudsonListing & { mapPosition: unknown }).mapPosition,
        );
    });

    it('rejects partial, ambiguous, approximate, or ZIP-mismatched Google results', () => {
        const exactResult = {
            partial_match: false,
            types: ['street_address'],
            address_components: [
                { short_name: 'MA', long_name: 'Massachusetts', types: ['administrative_area_level_1'] },
                { short_name: '02108', long_name: '02108', types: ['postal_code'] },
                { short_name: 'US', long_name: 'United States', types: ['country'] },
            ],
            geometry: {
                location: { lat: 42.3588, lng: -71.0707 },
                location_type: 'ROOFTOP',
            },
        };
        const expectedAddress = { town: 'Boston', state: 'MA', zip: '02108' };

        expect(validatedGoogleGeocodeResult({ status: 'OK', results: [exactResult] }, expectedAddress))
            .toMatchObject({ lat: 42.3588, lng: -71.0707, validation: 'exact_state_zip_address' });
        expect(validatedGoogleGeocodeResult({
            status: 'OK', results: [{ ...exactResult, partial_match: true }],
        }, expectedAddress)).toBeNull();
        expect(validatedGoogleGeocodeResult({
            status: 'OK', results: [exactResult, exactResult],
        }, expectedAddress)).toBeNull();
        expect(validatedGoogleGeocodeResult({
            status: 'OK',
            results: [{ ...exactResult, geometry: { ...exactResult.geometry, location_type: 'APPROXIMATE' } }],
        }, expectedAddress)).toBeNull();
        expect(validatedGoogleGeocodeResult({
            status: 'OK',
            results: [{
                ...exactResult,
                address_components: exactResult.address_components.map((component) =>
                    component.types.includes('postal_code')
                        ? { ...component, short_name: '02109', long_name: '02109' }
                        : component),
            }],
        }, expectedAddress)).toBeNull();
    });

    it('refuses out-of-state input before planning or requesting a Google geocode', async () => {
        const geocode = vi.fn();
        const outsideMassachusetts = listing({
            address: {
                line: '1 Granite State Road',
                town: 'Nashua',
                state: 'NH',
                zip: '03060',
            },
        });

        expect(() => buildGeocodePlan({
            cache: { entries: {} },
            index: { listings: [outsideMassachusetts] },
            now,
        })).toThrow(/MLS geocode input.*Massachusetts.*73333444/i);

        await expect(enrichPublicationCoordinates({
            apiKey: 'unused',
            cache: { entries: {} },
            details: new Map(),
            geocode,
            index: { listings: [outsideMassachusetts] },
            now,
        })).rejects.toThrow(/MLS geocode input.*Massachusetts.*73333444/i);
        expect(geocode).not.toHaveBeenCalled();
    });

    it('uses a fresh private Google geocode cache entry for index and detail output', async () => {
        const searchListing = listing();
        const detailListing = {
            ...listing(),
            generatedAt: '2026-07-02T12:00:00.000Z',
            remarks: 'Source-faithful public remarks.',
        };
        const details = new Map([['73333444.json', detailListing]]);
        const enrichedSearchListing = searchListing as typeof searchListing & { mapPosition?: unknown };
        const enrichedDetailListing = detailListing as typeof detailListing & { mapPosition?: unknown };
        const key = geocodeCacheKey(searchListing);
        const result = await enrichPublicationCoordinates({
            apiKey: '',
            cache: {
                entries: {
                    [key]: {
                        listingNumber: '73333444',
                        address: '86 Mount Vernon Street, Boston, MA, 02108, USA',
                        addressKey: '86 mount vernon street|boston|ma|02108',
                        lat: 42.3588,
                        lng: -71.0707,
                        precision: 'ROOFTOP',
                        geocodedAt: '2026-07-01T12:00:00.000Z',
                        expiresAt: '2026-07-31T12:00:00.000Z',
                    },
                },
            },
            details,
            index: { listings: [searchListing] },
            limit: 0,
            now,
        });

        expect(enrichedSearchListing.mapPosition).toMatchObject({
            lat: 42.3588,
            lng: -71.0707,
            source: 'google_geocoding',
            expiresAt: '2026-07-31T12:00:00.000Z',
        });
        expect(enrichedDetailListing.mapPosition).toEqual(enrichedSearchListing.mapPosition);
        expect(result.stats).toMatchObject({
            enriched: 1,
            cached: 1,
            fetched: 0,
        });
    });

    it('plans fresh, cached, missing, expired, and changed listings with preferred-area work first', () => {
        const fresh = listing({ listingNumber: '100', address: { town: 'Boston' } });
        const outsideArea = listing({
            listingNumber: '200',
            address: { line: '2 Island Road', town: 'Nantucket', zip: '02554' },
        });
        const expired = listing({
            listingNumber: '300',
            address: { line: '3 Harbor Street', town: 'Salem', zip: '01970' },
        });
        const changed = listing({
            listingNumber: '400',
            address: { line: '4 New Street', town: 'Burlington', zip: '01803' },
        });
        const priorAddress = listing({
            listingNumber: '400',
            address: { line: '4 Old Street', town: 'Burlington', zip: '01803' },
        });
        const preferredMissing = listing({
            listingNumber: '500',
            address: { line: '5 Main Street', town: 'Lowell', zip: '01852' },
        });
        const plan = buildGeocodePlan({
            cache: {
                entries: {
                    [geocodeCacheKey(fresh)]: cacheEntry(fresh),
                    [geocodeCacheKey(expired)]: cacheEntry(expired, {
                        expiresAt: '2026-07-02T11:59:59.000Z',
                    }),
                    [geocodeCacheKey(priorAddress)]: cacheEntry(priorAddress),
                },
            },
            index: { listings: [fresh, outsideArea, expired, changed, preferredMissing] },
            limit: 2,
            now,
        });

        expect(plan.counts).toEqual({
            totalListings: 5,
            preferredListings: 4,
            excludedOutsidePreferredScope: 0,
            cached: 2,
            fresh: 0,
            refreshDue: 1,
            missing: 2,
            expired: 1,
            changed: 1,
        });
        expect(plan.requests).toEqual({
            needed: 5,
            selected: 2,
            deferred: 3,
            preferredNeeded: 4,
            preferredSelected: 2,
            urgent: {
                needed: 4,
                selected: 2,
                deferred: 2,
            },
            proactive: {
                enabled: false,
                configuredLimit: 0,
                due: 1,
                selected: 0,
                deferred: 1,
            },
        });
        expect(plan.selectedItems.map((item) => [item.listingNumber, item.reason])).toEqual([
            ['300', 'expired'],
            ['400', 'changed'],
        ]);
        expect(plan.costEstimate.selected).toMatchObject({
            requests: 2,
            grossListPriceUsd: 0.01,
            withFullMonthlyFreeUsageAvailableUsd: 0,
        });
    });

    it('excludes proactive refresh by default and includes it only with an explicit bounded opt-in', () => {
        const sourceListing = listing();
        const dueSoon = cacheEntry(sourceListing, {
            expiresAt: '2026-07-06T12:00:00.000Z',
        });
        const defaultPlan = buildGeocodePlan({
            cache: { entries: { [geocodeCacheKey(sourceListing)]: dueSoon } },
            index: { listings: [sourceListing] },
            now,
        });
        const optedInPlan = buildGeocodePlan({
            cache: { entries: { [geocodeCacheKey(sourceListing)]: dueSoon } },
            includeProactiveRefresh: true,
            index: { listings: [sourceListing] },
            now,
            proactiveRefreshLimit: 1,
        });

        expect(mapPositionNeedsRefresh(dueSoon, now)).toBe(true);
        expect(defaultPlan.counts).toMatchObject({ cached: 1, fresh: 0, refreshDue: 1 });
        expect(defaultPlan.selectedItems).toEqual([]);
        expect(defaultPlan.requests.proactive).toEqual({
            enabled: false,
            configuredLimit: 0,
            due: 1,
            selected: 0,
            deferred: 1,
        });
        expect(optedInPlan.selectedItems).toEqual([
            expect.objectContaining({ listingNumber: '73333444', reason: 'refresh_due' }),
        ]);
        expect(optedInPlan.requests.proactive).toEqual({
            enabled: true,
            configuredLimit: 1,
            due: 1,
            selected: 1,
            deferred: 0,
        });
    });

    it('reports that a 500-request proactive cap cannot maintain 7,689 entries', () => {
        const synchronizedAt = now;
        const serviceListings = Array.from({ length: 7_689 }, (_, index) => listing({
            listingNumber: String(74_000_000 + index),
            address: {
                line: `${index + 1} Rotation Way`,
                town: 'Boston',
                zip: '02108',
            },
        }));
        const entries: Record<string, ReturnType<typeof cacheEntry> & {
            rotationDueAt?: string;
        }> = Object.fromEntries(
            serviceListings.map((sourceListing) => [
                geocodeCacheKey(sourceListing),
                cacheEntry(sourceListing, {
                    geocodedAt: new Date(synchronizedAt).toISOString(),
                    expiresAt: new Date(synchronizedAt + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString(),
                }),
            ]),
        );
        const selectedAcrossRotation = new Set<string>();
        const cycleSizes: number[] = [];

        for (let cycle = 0; cycle < 8; cycle += 1) {
            const runAt = synchronizedAt + (cycle * MLS_INGEST_INTERVAL_MS);
            const plan = buildGeocodePlan({
                cache: { entries },
                includeProactiveRefresh: true,
                index: { listings: serviceListings },
                limit: 1_000,
                now: runAt,
                preferredOnly: true,
                proactiveRefreshLimit: 500,
            });
            if (cycle === 0) {
                expect(plan.rotation).toMatchObject({
                    requestEligibleListings: 7_689,
                    targetRequestsPerCycle: 962,
                    projectedThirtyDayRequests: 9_620,
                    projectedThirtyDayWithinFreeUsageCap: true,
                    freeUsageRemainingUnknown: true,
                    configuredRequestLimit: 1_000,
                    configuredProactiveRefreshLimit: 500,
                    sustainableInventoryCapacity: 4_000,
                    inventoryWithinConfiguredCapacity: false,
                });
                expect(plan.requests.proactive).toMatchObject({
                    enabled: true,
                    configuredLimit: 500,
                    due: 962,
                    selected: 500,
                    deferred: 462,
                });
                expect(() => assertSafeGeocodePlan(plan)).toThrow(
                    /proactive refresh cap of 500[\s\S]*cannot sustain[\s\S]*(?:7,689|7689)/i,
                );
            }

            for (const update of plan.rotation.scheduleUpdates) {
                entries[update.cacheKey] = {
                    ...entries[update.cacheKey],
                    rotationDueAt: update.rotationDueAt,
                };
            }
            cycleSizes.push(plan.selectedItems.length);
            for (const item of plan.selectedItems) {
                expect(item.reason).toBe('refresh_due');
                expect(selectedAcrossRotation.has(item.listingNumber)).toBe(false);
                selectedAcrossRotation.add(item.listingNumber);
                const sourceListing = serviceListings[item.listingIndex];
                const key = geocodeCacheKey(sourceListing);
                entries[key] = {
                    ...entries[key],
                    geocodedAt: new Date(runAt).toISOString(),
                    expiresAt: new Date(runAt + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString(),
                    rotationDueAt: new Date(
                        runAt + GOOGLE_GEOCODE_TARGET_REFRESH_AGE_MS,
                    ).toISOString(),
                };
            }
        }

        expect(cycleSizes).toEqual([500, 500, 500, 500, 500, 500, 500, 500]);
        expect(selectedAcrossRotation.size).toBe(4_000);
        expect(selectedAcrossRotation.size).toBeLessThan(serviceListings.length);
    }, 60_000);

    it('prioritizes urgent homes and applies both the proactive and overall request caps', () => {
        const due = listing({ listingNumber: '400', address: { line: '4 Due Street' } });
        const dueSecond = listing({ listingNumber: '500', address: { line: '5 Due Street' } });
        const missing = listing({ listingNumber: '300', address: { line: '3 Missing Street' } });
        const changed = listing({ listingNumber: '200', address: { line: '2 Changed Street' } });
        const changedOld = listing({ listingNumber: '200', address: { line: '2 Old Street' } });
        const expired = listing({ listingNumber: '100', address: { line: '1 Expired Street' } });
        const cache = {
            entries: {
                [geocodeCacheKey(due)]: cacheEntry(due, {
                    rotationDueAt: new Date(now).toISOString(),
                }),
                [geocodeCacheKey(dueSecond)]: cacheEntry(dueSecond, {
                    rotationDueAt: new Date(now).toISOString(),
                }),
                [geocodeCacheKey(changedOld)]: cacheEntry(changedOld),
                [geocodeCacheKey(expired)]: cacheEntry(expired, {
                    expiresAt: new Date(now - 1).toISOString(),
                }),
            },
        };
        const capLimitedPlan = buildGeocodePlan({
            cache,
            includeProactiveRefresh: true,
            index: { listings: [due, dueSecond, missing, changed, expired] },
            limit: 5,
            now,
            preferredOnly: true,
            proactiveRefreshLimit: 1,
        });
        const overallLimitedPlan = buildGeocodePlan({
            cache,
            includeProactiveRefresh: true,
            index: { listings: [due, dueSecond, missing, changed, expired] },
            limit: 4,
            now,
            preferredOnly: true,
            proactiveRefreshLimit: 2,
        });

        expect(capLimitedPlan.selectedItems.map((item) => item.reason)).toEqual([
            'expired',
            'changed',
            'missing',
            'refresh_due',
        ]);
        expect(capLimitedPlan.requests).toMatchObject({
            urgent: { needed: 3, selected: 3, deferred: 0 },
            proactive: {
                enabled: true,
                configuredLimit: 1,
                due: 2,
                selected: 1,
                deferred: 1,
            },
        });
        expect(overallLimitedPlan.selectedItems.map((item) => item.reason)).toEqual([
            'expired',
            'changed',
            'missing',
            'refresh_due',
        ]);
        expect(overallLimitedPlan.requests.proactive).toEqual({
            enabled: true,
            configuredLimit: 2,
            due: 2,
            selected: 1,
            deferred: 1,
        });
    });

    it('automatic parts cover every needed address once, including unresolved results, without redoing valid cache hits', async () => {
        const fresh = listing({ listingNumber: 'fresh' });
        const due = listing({ listingNumber: 'due', address: { line: '2 Due Street' } });
        const missing = Array.from({ length: 1300 }, (_, i) => listing({
            listingNumber: String(10000 + i), address: { line: `${i + 10} Missing Street` },
        }));
        const sources = [fresh, due, ...missing];
        let cache = { entries: {
            [geocodeCacheKey(fresh)]: cacheEntry(fresh),
            [geocodeCacheKey(due)]: cacheEntry(due, { rotationDueAt: new Date(now).toISOString() }),
        } };
        const requested = new Set<string>();
        const fingerprints = new Set<string>();
        for (let batchIndex = 0; batchIndex < 2; batchIndex += 1) {
            const result = await enrichPublicationCoordinates({
                apiKey: 'synthetic', cache, details: new Map(), now, preferredOnly: true,
                batchSize: 900, batchIndex,
                index: { listings: batchIndex ? [...sources].reverse() : sources },
                onAuditEvent: async () => {},
                geocode: async (_key: string, address: string) => {
                    expect(requested.has(address)).toBe(false);
                    requested.add(address);
                    return null;
                },
            });
            expect(result.stats.fetched).toBeLessThanOrEqual(900);
            if (!result.plan.batch) throw new Error("Expected automatic batch metadata");
            expect(result.plan.batch.count).toBe(2);
            fingerprints.add(result.plan.batch.fingerprint);
            cache = result.cache;
        }
        expect(requested.size).toBe(1300);
        expect(fingerprints.size).toBe(1);
        expect(Object.keys(cache.entries)).toHaveLength(2);
        expect(() => buildGeocodePlan({ index: { listings: sources }, cache, now, batchSize: 900, batchIndex: 2 })).toThrow(/exceeds/);
    });

    it('uncapped normal uploads select all urgent work above 1200 and reuse valid coordinates', () => {
        const fresh = listing({ listingNumber: 'fresh' });
        const due = listing({ listingNumber: 'due', address: { line: '2 Due Street' } });
        const expired = listing({ listingNumber: 'expired', address: { line: '3 Expired Street' } });
        const changed = listing({ listingNumber: 'changed', address: { line: '4 New Street' } });
        const old = listing({ listingNumber: 'changed', address: { line: '4 Old Street' } });
        const missing = Array.from({ length: 1300 }, (_, i) => listing({
            listingNumber: String(10000 + i), address: { line: `${i + 10} Missing Street` },
        }));
        const args = parseArgs(['node', 'enrich-mls-coordinates.mjs', '--preferred-only', '--allow-large-run']);
        const plan = buildGeocodePlan({
            index: { listings: [fresh, due, expired, changed, ...missing] },
            cache: { entries: {
                [geocodeCacheKey(fresh)]: cacheEntry(fresh),
                [geocodeCacheKey(due)]: cacheEntry(due, { rotationDueAt: new Date(now).toISOString() }),
                [geocodeCacheKey(expired)]: cacheEntry(expired, { expiresAt: new Date(now - 1).toISOString() }),
                [geocodeCacheKey(old)]: cacheEntry(old),
            } },
            now, limit: args.limit, preferredOnly: args.preferredOnly,
        });
        expect(plan.requests.urgent).toEqual({ needed: 1302, selected: 1302, deferred: 0 });
        expect(plan.requests.proactive.selected).toBe(0);
        expect(plan.selectedItems.some((item) => ['fresh', 'due'].includes(item.listingNumber))).toBe(false);
        expect(() => assertSafeGeocodePlan(plan, { allowLargeRun: args.allowLargeRun })).not.toThrow();
    });

    it('selects every urgent address while deferring only still-valid refreshes in emergency mode', () => {
        const due = listing({ listingNumber: '400', address: { line: '4 Due Street' } });
        const missing = listing({ listingNumber: '300', address: { line: '3 Missing Street' } });
        const changed = listing({ listingNumber: '200', address: { line: '2 Changed Street' } });
        const changedOld = listing({ listingNumber: '200', address: { line: '2 Old Street' } });
        const expired = listing({ listingNumber: '100', address: { line: '1 Expired Street' } });
        const plan = buildGeocodePlan({
            cache: {
                entries: {
                    [geocodeCacheKey(due)]: cacheEntry(due, {
                        rotationDueAt: new Date(now).toISOString(),
                    }),
                    [geocodeCacheKey(changedOld)]: cacheEntry(changedOld),
                    [geocodeCacheKey(expired)]: cacheEntry(expired, {
                        expiresAt: new Date(now - 1).toISOString(),
                    }),
                },
            },
            emergencyUrgentOnly: true,
            index: { listings: [due, missing, changed, expired] },
            limit: 3,
            now,
            preferredOnly: true,
        });

        expect(plan.requests).toMatchObject({
            needed: 4,
            selected: 3,
            deferred: 1,
            preferredNeeded: 4,
            preferredSelected: 3,
            urgent: { needed: 3, selected: 3, deferred: 0 },
            proactive: {
                enabled: false,
                configuredLimit: 0,
                due: 1,
                selected: 0,
                deferred: 1,
            },
        });
        expect(plan.selectedItems.map((item) => item.reason)).toEqual([
            'expired',
            'changed',
            'missing',
        ]);
        expect(plan.emergency).toMatchObject({
            urgentOnly: true,
            urgentRequestCount: 3,
            selectedUrgentRequestCount: 3,
            deferredRefreshDueCount: 1,
        });
        expect(() => assertSafeGeocodePlan(plan)).not.toThrow();
    });

    it('refuses partial urgent coverage or an emergency cap above 2,000', () => {
        const sources = [
            listing({ listingNumber: '100', address: { line: '1 Missing Street' } }),
            listing({ listingNumber: '200', address: { line: '2 Missing Street' } }),
        ];
        const partial = buildGeocodePlan({
            cache: { entries: {} },
            emergencyUrgentOnly: true,
            index: { listings: sources },
            limit: 1,
            now,
            preferredOnly: true,
        });
        expect(() => assertSafeGeocodePlan(partial)).toThrow(
            /all 2 missing, changed, or expired.*refusing partial urgent coverage/i,
        );

        const overCap = buildGeocodePlan({
            cache: { entries: {} },
            emergencyUrgentOnly: true,
            index: { listings: sources },
            limit: 2_001,
            now,
            preferredOnly: true,
        });
        expect(() => assertSafeGeocodePlan(overCap, { allowLargeRun: true })).toThrow(
            /finite --limit no greater than 2000/i,
        );
    });

    it('rejects combining emergency urgent-only mode with proactive refresh', () => {
        expect(() => buildGeocodePlan({
            cache: { entries: {} },
            emergencyUrgentOnly: true,
            includeProactiveRefresh: true,
            index: { listings: [listing()] },
            now,
            proactiveRefreshLimit: 1,
        })).toThrow(/emergencyUrgentOnly cannot be combined with proactive refresh/i);
    });

    it('backs off an unresolved proactive refresh, then retries it after another cohort', async () => {
        const serviceListings = Array.from({ length: 16 }, (_, index) => listing({
            listingNumber: String(75_000_000 + index),
            address: { line: `${index + 1} Recovery Road` },
        }));
        const entries = Object.fromEntries(serviceListings.map((sourceListing) => [
            geocodeCacheKey(sourceListing),
            cacheEntry(sourceListing, {
                geocodedAt: new Date(now).toISOString(),
                expiresAt: new Date(now + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString(),
            }),
        ]));
        const failedCycle = await enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries },
            details: new Map(),
            geocode: vi.fn().mockResolvedValue(null),
            includeProactiveRefresh: true,
            index: { listings: serviceListings },
            limit: 1_000,
            now,
            onAuditEvent: vi.fn().mockResolvedValue(undefined),
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        const failedIds = failedCycle.plan.selectedItems.map((item) => item.listingNumber);
        expect(failedIds).toHaveLength(2);

        const nextCycle = buildGeocodePlan({
            cache: failedCycle.cache,
            includeProactiveRefresh: true,
            index: { listings: serviceListings },
            limit: 1_000,
            now: now + MLS_INGEST_INTERVAL_MS,
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(nextCycle.selectedItems.map((item) => item.listingNumber))
            .not.toEqual(expect.arrayContaining(failedIds));

        const recoveryCycle = buildGeocodePlan({
            cache: failedCycle.cache,
            includeProactiveRefresh: true,
            index: { listings: serviceListings },
            limit: 1_000,
            now: now + (2 * MLS_INGEST_INTERVAL_MS),
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(recoveryCycle.selectedItems.map((item) => item.listingNumber))
            .toEqual(expect.arrayContaining(failedIds));
    });

    it('fails before paid work when inventory or remaining deadline slots are unsustainable', () => {
        const oversizedListings = Array.from({ length: 8_001 }, (_, index) => listing({
            listingNumber: String(76_000_000 + index),
            address: { line: `${index + 1} Capacity Lane` },
        }));
        const oversizedPlan = buildGeocodePlan({
            cache: { entries: {} },
            includeProactiveRefresh: true,
            index: { listings: oversizedListings },
            limit: 1_000,
            now,
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(oversizedPlan.rotation).toMatchObject({
            inventoryWithinConfiguredCapacity: false,
            targetRequestsPerCycle: 1_001,
            projectedThirtyDayRequests: 10_010,
            projectedThirtyDayWithinFreeUsageCap: false,
        });
        expect(() => assertSafeGeocodePlan(oversizedPlan, { allowLargeRun: true }))
            .toThrow(/cannot sustain the 24-day/i);

        const deadlineListings = Array.from({ length: 3_347 }, (_, index) => listing({
            listingNumber: String(77_000_000 + index),
            address: { line: `${index + 1} Deadline Drive` },
        }));
        const geocodedAt = now - (4 * 24 * 60 * 60 * 1000);
        const deadlineEntries = Object.fromEntries(deadlineListings.map((sourceListing) => [
            geocodeCacheKey(sourceListing),
            cacheEntry(sourceListing, {
                geocodedAt: new Date(geocodedAt).toISOString(),
                expiresAt: new Date(geocodedAt + GOOGLE_GEOCODE_CACHE_TTL_MS).toISOString(),
            }),
        ]));
        const onTimePlan = buildGeocodePlan({
            cache: { entries: deadlineEntries },
            includeProactiveRefresh: true,
            index: { listings: deadlineListings },
            limit: 1_000,
            now,
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(onTimePlan.rotation.deadlineCapacity).toMatchObject({ withinCapacity: true });
        expect(onTimePlan.rotation.targetDeadlineCapacity).toMatchObject({ withinCapacity: true });
        expect(() => assertSafeGeocodePlan(onTimePlan, { allowLargeRun: true })).not.toThrow();

        const marginPlan = buildGeocodePlan({
            cache: { entries: deadlineEntries },
            includeProactiveRefresh: true,
            index: { listings: deadlineListings },
            limit: 1_000,
            now: now + MLS_INGEST_INTERVAL_MS,
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(marginPlan.rotation.deadlineCapacity).toMatchObject({ withinCapacity: true });
        expect(marginPlan.rotation.targetDeadlineCapacity).toMatchObject({
            withinCapacity: false,
            firstViolation: {
                cyclesAvailable: 6,
                requiredRequests: 3_347,
                availableRequests: 3_000,
                shortfall: 347,
            },
        });
        expect(() => assertSafeGeocodePlan(marginPlan, { allowLargeRun: true })).not.toThrow();

        const expiryFailurePlan = buildGeocodePlan({
            cache: { entries: deadlineEntries },
            includeProactiveRefresh: true,
            index: { listings: deadlineListings },
            limit: 1_000,
            now: now + (3 * MLS_INGEST_INTERVAL_MS),
            preferredOnly: true,
            proactiveRefreshLimit: 500,
        });
        expect(expiryFailurePlan.rotation.deadlineCapacity).toMatchObject({
            withinCapacity: false,
            firstViolation: {
                cyclesAvailable: 6,
                requiredRequests: 3_347,
                availableRequests: 3_000,
                shortfall: 347,
            },
        });
        expect(() => assertSafeGeocodePlan(expiryFailurePlan, { allowLargeRun: true }))
            .toThrow(/backlog cannot be cleared/i);
    });

    it('keeps preferred-only runs inside the canonical service area regardless of request limit', async () => {
        const boston = listing({
            listingNumber: '100',
            address: { line: '1 Beacon Street', town: 'Boston', zip: '02108' },
        });
        const nantucket = listing({
            listingNumber: '200',
            address: { line: '2 Island Road', town: 'Nantucket', zip: '02554' },
        });
        const geocode = vi.fn().mockResolvedValue({
            lat: 42.3588,
            lng: -71.0707,
            precision: 'ROOFTOP',
            validatedState: 'MA',
            validatedPostalCode: '02108',
            validation: 'exact_state_zip_address',
        });
        const result = await enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries: {} },
            details: new Map(),
            geocode,
            index: { listings: [nantucket, boston] },
            limit: Number.POSITIVE_INFINITY,
            now,
            onAuditEvent: vi.fn().mockResolvedValue(undefined),
            preferredOnly: true,
        });

        expect(result.plan).toMatchObject({
            scope: 'preferred-service-area',
            counts: { preferredListings: 1, excludedOutsidePreferredScope: 1 },
            requests: { needed: 1, selected: 1, preferredSelected: 1 },
        });
        expect(result.plan.selectedItems.map((item) => item.listingNumber)).toEqual(['100']);
        expect(geocode).toHaveBeenCalledTimes(1);
        expect(geocode.mock.calls[0][1]).toContain('Boston, MA');
    });

    it('purges expired, removed, and changed-address cache records on every ingest', () => {
        const active = listing({ listingNumber: '100' });
        const removed = listing({ listingNumber: '200', address: { line: '2 Removed Street' } });
        const changedOld = listing({ listingNumber: '300', address: { line: '3 Old Street' } });
        const changedCurrent = listing({ listingNumber: '300', address: { line: '3 New Street' } });
        const expired = listing({ listingNumber: '400', address: { line: '4 Expired Street' } });
        const overlong = listing({ listingNumber: '500', address: { line: '5 Overlong Street' } });
        const entries = pruneGeocodeCacheEntries({
            entries: {
                [geocodeCacheKey(active)]: cacheEntry(active),
                [geocodeCacheKey(removed)]: cacheEntry(removed),
                [geocodeCacheKey(changedOld)]: cacheEntry(changedOld),
                [geocodeCacheKey(expired)]: cacheEntry(expired, {
                    expiresAt: '2026-07-02T11:59:59.000Z',
                }),
                [geocodeCacheKey(overlong)]: cacheEntry(overlong, {
                    expiresAt: '2026-08-01T12:00:00.000Z',
                }),
            },
        }, {
            listings: [active, changedCurrent, expired, overlong],
        }, now);

        expect(Object.keys(entries)).toEqual([geocodeCacheKey(active)]);
    });

    it('removes out-of-service cache entries from preferred-only cloud snapshots', () => {
        const serviceListing = listing({ listingNumber: '100' });
        const outsideServiceListing = listing({
            listingNumber: '200',
            address: { line: '2 Island Road', town: 'Nantucket', zip: '02554' },
        });
        const cache = {
            entries: {
                [geocodeCacheKey(serviceListing)]: cacheEntry(serviceListing),
                [geocodeCacheKey(outsideServiceListing)]: cacheEntry(outsideServiceListing),
            },
        };
        const index = { listings: [serviceListing, outsideServiceListing] };

        expect(Object.keys(pruneGeocodeCacheEntries(cache, index, now))).toHaveLength(2);
        expect(Object.keys(pruneGeocodeCacheEntries(
            cache,
            index,
            now,
            { preferredOnly: true },
        ))).toEqual([geocodeCacheKey(serviceListing)]);
    });

    it('keeps a still-current coordinate when a proactive refresh is unresolved', async () => {
        const sourceListing = listing();
        const detail = { ...sourceListing, generatedAt: '2026-07-02T12:00:00.000Z' };
        const key = geocodeCacheKey(sourceListing);
        const currentEntry = cacheEntry(sourceListing, {
            expiresAt: '2026-07-06T12:00:00.000Z',
        });
        const result = await enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries: { [key]: currentEntry } },
            details: new Map([['73333444.json', detail]]),
            geocode: vi.fn().mockResolvedValue(null),
            includeProactiveRefresh: true,
            index: { listings: [sourceListing] },
            now,
            onAuditEvent: vi.fn().mockResolvedValue(undefined),
            proactiveRefreshLimit: 1,
        });

        expect(result.cache.entries[key]).toMatchObject({
            ...currentEntry,
            lastRefreshAttemptAt: '2026-07-02T12:00:00.000Z',
            rotationDueAt: '2026-07-05T12:00:00.000Z',
        });
        expect((sourceListing as typeof sourceListing & { mapPosition: unknown }).mapPosition)
            .toMatchObject({ lat: currentEntry.lat, lng: currentEntry.lng, expiresAt: currentEntry.expiresAt });
        expect(result.stats).toMatchObject({ refreshDue: 1, fetched: 1, unresolved: 1 });
    });

    it('keeps planning priority aligned with the buyer-search preferred service area', () => {
        const expectedTowns = marketRegions
            .flatMap((region) => [...region.towns])
            .filter((town) => townMatchesPreferredServiceArea(town))
            .sort();

        expect([...PREFERRED_SERVICE_AREA_TOWNS].sort()).toEqual(expectedTowns);
    });

    it('keeps dry runs network-free and does not mutate publication inputs', async () => {
        const searchListing = listing();
        const detailListing = { ...listing(), generatedAt: '2026-07-02T12:00:00.000Z' };
        const index = { listings: [searchListing] };
        const details = new Map([['73333444.json', detailListing]]);
        const beforeIndex = structuredClone(index);
        const beforeDetail = structuredClone(detailListing);
        const geocode = vi.fn();

        const result = await enrichPublicationCoordinates({
            apiKey: '',
            cache: { entries: {} },
            details,
            dryRun: true,
            geocode,
            index,
            now,
        });

        expect(geocode).not.toHaveBeenCalled();
        expect(index).toEqual(beforeIndex);
        expect(detailListing).toEqual(beforeDetail);
        expect(result.plan.requests.needed).toBe(1);
        expect(result.stats).toMatchObject({ fetched: 0, missing: 1 });
    });

    it('fails closed before a paid request when no durable audit writer is configured', async () => {
        const geocode = vi.fn();

        await expect(enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries: {} },
            details: new Map(),
            geocode,
            index: { listings: [listing()] },
            now,
        })).rejects.toThrow(/durable geocode audit writer/i);
        expect(geocode).not.toHaveBeenCalled();
    });

    it('honors the request limit, prioritizes the preferred area, and checkpoints the private cache', async () => {
        const outsideArea = listing({
            listingNumber: '200',
            address: { line: '2 Island Road', town: 'Nantucket', zip: '02554' },
        });
        const boston = listing({
            listingNumber: '100',
            address: { line: '1 Beacon Street', town: 'Boston', zip: '02108' },
        });
        const salem = listing({
            listingNumber: '300',
            address: { line: '3 Harbor Street', town: 'Salem', zip: '01970' },
        });
        const geocode = vi.fn().mockResolvedValue({
            lat: 42.4,
            lng: -71.1,
            precision: 'ROOFTOP',
            validatedState: 'MA',
            validatedPostalCode: '02108',
            validation: 'exact_state_zip_address',
        });
        const onCheckpoint = vi.fn().mockResolvedValue(undefined);
        const onAuditEvent = vi.fn().mockResolvedValue(undefined);

        const result = await enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries: {} },
            checkpointEvery: 2,
            details: new Map(),
            geocode,
            index: { listings: [outsideArea, boston, salem] },
            limit: 2,
            now,
            onAuditEvent,
            onCheckpoint,
        });

        expect(geocode.mock.calls.map(([, address]) => address)).toEqual([
            '1 Beacon Street, Boston, MA, 02108, USA',
            '3 Harbor Street, Salem, MA, 01970, USA',
        ]);
        expect(result.stats).toMatchObject({ fetched: 2, skippedForLimit: 1 });
        expect(Object.keys(result.cache.entries)).toHaveLength(2);
        expect(onCheckpoint).toHaveBeenCalledTimes(2);
        expect(onCheckpoint).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ entries: {} }),
            { fetched: 0, unresolved: 0, remainingSelected: 2 },
        );
        expect(onCheckpoint).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ entries: expect.any(Object) }),
            { fetched: 2, unresolved: 0, remainingSelected: 0 },
        );
        expect(onAuditEvent.mock.calls.map(([event]) => [event.eventType, event.sequence])).toEqual([
            ['request_started', 1],
            ['request_completed', 1],
            ['request_started', 2],
            ['request_completed', 2],
        ]);
    });

    it('forces a private-cache checkpoint before surfacing a later request failure', async () => {
        const first = listing({ listingNumber: '100', address: { line: '1 Beacon Street', town: 'Boston' } });
        const second = listing({ listingNumber: '200', address: { line: '2 Beacon Street', town: 'Boston' } });
        const geocode = vi.fn()
            .mockResolvedValueOnce({
                lat: 42.4,
                lng: -71.1,
                precision: 'ROOFTOP',
                validatedState: 'MA',
                validatedPostalCode: '02108',
                validation: 'exact_state_zip_address',
            })
            .mockRejectedValueOnce(new Error('quota stopped'));
        const onCheckpoint = vi.fn().mockResolvedValue(undefined);
        const onAuditEvent = vi.fn().mockResolvedValue(undefined);

        await expect(enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: { entries: {} },
            checkpointEvery: 25,
            details: new Map(),
            geocode,
            index: { listings: [first, second] },
            now,
            onAuditEvent,
            onCheckpoint,
        })).rejects.toThrow('quota stopped');

        expect(onCheckpoint).toHaveBeenCalledTimes(2);
        expect(onCheckpoint.mock.calls[0][0].entries).toEqual({});
        expect(onCheckpoint.mock.calls[0][1]).toMatchObject({ fetched: 0, remainingSelected: 2 });
        expect(Object.keys(onCheckpoint.mock.calls[1][0].entries)).toEqual([geocodeCacheKey(first)]);
        expect(onCheckpoint.mock.calls[1][1]).toMatchObject({ fetched: 1, remainingSelected: 1 });
        expect(onAuditEvent.mock.calls.map(([event]) => event.eventType)).toEqual([
            'request_started',
            'request_completed',
            'request_started',
            'request_failed',
        ]);
    });

    it('persists removed and expired cache pruning before a first request can fail', async () => {
        const removed = listing({
            listingNumber: '999',
            address: { line: '9 Old Road', town: 'Boston' },
        });
        const current = listing({
            listingNumber: '100',
            address: { line: '1 Beacon Street', town: 'Boston' },
        });
        const onCheckpoint = vi.fn().mockResolvedValue(undefined);

        await expect(enrichPublicationCoordinates({
            apiKey: 'test-key',
            cache: {
                entries: {
                    [geocodeCacheKey(removed)]: cacheEntry(removed, {
                        geocodedAt: '2026-05-01T12:00:00.000Z',
                        expiresAt: '2026-05-31T12:00:00.000Z',
                    }),
                },
            },
            details: new Map(),
            geocode: vi.fn().mockRejectedValue(new Error('network stopped')),
            index: { listings: [current] },
            now,
            onAuditEvent: vi.fn().mockResolvedValue(undefined),
            onCheckpoint,
        })).rejects.toThrow('network stopped');

        expect(onCheckpoint).toHaveBeenCalledTimes(1);
        expect(onCheckpoint.mock.calls[0][0].entries).toEqual({});
        expect(onCheckpoint.mock.calls[0][1]).toMatchObject({ fetched: 0, remainingSelected: 1 });
    });

    it('writes strictly validated request evidence to deterministic immutable S3 keys', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-immutable-'));
        let uploadedBody = '';
        const commandRunner = vi.fn(async (args: string[]) => {
            expect(args.slice(0, 2)).toEqual(['s3api', 'put-object']);
            const bodyPath = args[args.indexOf('--body') + 1];
            uploadedBody = await readFile(bodyPath, 'utf8');
            return { stderr: '', stdout: '{}' };
        });
        const mirrorEvent = createImmutableGeocodeAuditMirror({
            bucket: 'move-with-musto-geocode-audit-123456789012-us-east-1',
            commandRunner,
            prefix: 'geocoding/run-123/build-7/events',
            sensitiveValues: ['must-not-appear'],
            temporaryDirectory: tempRoot,
        });

        try {
            const result = await mirrorEvent(requestAuditEvent());
            const command = commandRunner.mock.calls[0][0];
            const objectKey = command[command.indexOf('--key') + 1];

            expect(result).toMatchObject({
                bucket: 'move-with-musto-geocode-audit-123456789012-us-east-1',
                key: objectKey,
                sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
            expect(objectKey).toBe(
                'geocoding/run-123/build-7/events/' +
                '00000001-22222222-2222-4222-8222-222222222222-request_started.json',
            );
            expect(command).toContain('--if-none-match');
            expect(command[command.indexOf('--if-none-match') + 1]).toBe('*');
            expect(uploadedBody).toBe(`${JSON.stringify(requestAuditEvent())}\n`);
            expect(uploadedBody).not.toContain('must-not-appear');
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('rejects sensitive immutable audit payloads before invoking AWS', async () => {
        const commandRunner = vi.fn();
        const mirrorEvent = createImmutableGeocodeAuditMirror({
            bucket: 'move-with-musto-geocode-audit-123456789012-us-east-1',
            commandRunner,
            prefix: 'geocoding/run-123/build-7/events',
        });

        await expect(mirrorEvent(requestAuditEvent({
            address: '86 Mount Vernon Street, Boston, MA',
        }))).rejects.toThrow(/(?:forbidden|unsupported) field address/i);
        expect(commandRunner).not.toHaveBeenCalled();
    });

    it('treats an identical immutable object as an idempotent retry', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-idempotent-'));
        const commandRunner = vi.fn(async (args: string[]) => {
            if (args[1] === 'put-object') {
                throw Object.assign(new Error('PreconditionFailed (412)'), {
                    stderr: 'An error occurred (PreconditionFailed) with status code: 412',
                });
            }
            const putCommand = commandRunner.mock.calls[0][0];
            const bodyPath = putCommand[putCommand.indexOf('--body') + 1];
            const body = await readFile(bodyPath, 'utf8');
            const metadata = putCommand[putCommand.indexOf('--metadata') + 1];
            const sha = /(?:^|,)sha256=([a-f0-9]{64})(?:,|$)/u.exec(metadata)?.[1];
            return {
                stderr: '',
                stdout: JSON.stringify({
                    ContentLength: Buffer.byteLength(body),
                    Metadata: { sha256: sha },
                }),
            };
        });
        const mirrorEvent = createImmutableGeocodeAuditMirror({
            bucket: 'move-with-musto-geocode-audit-123456789012-us-east-1',
            commandRunner,
            prefix: 'geocoding/run-123/build-7/events',
            temporaryDirectory: tempRoot,
        });

        try {
            await expect(mirrorEvent(requestAuditEvent())).resolves.toMatchObject({
                key: expect.stringContaining('request_started.json'),
            });
            expect(commandRunner.mock.calls.map(([args]) => args.slice(0, 2))).toEqual([
                ['s3api', 'put-object'],
                ['s3api', 'head-object'],
            ]);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('blocks a Google request when its immutable start evidence cannot be persisted', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-fail-closed-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const mirrorEvent = vi.fn().mockRejectedValue(new Error('S3 audit unavailable'));
        const geocode = vi.fn();
        const onCheckpoint = vi.fn().mockResolvedValue(undefined);

        try {
            await expect(enrichPublicationCoordinates({
                apiKey: 'test-key',
                auditRunId: '11111111-1111-4111-8111-111111111111',
                cache: { entries: {} },
                details: new Map(),
                geocode,
                index: { listings: [listing()] },
                now,
                onAuditEvent: createGeocodeAuditWriter(auditPath, { mirrorEvent }),
                onCheckpoint,
                requestIdFactory: () => '22222222-2222-4222-8222-222222222222',
            })).rejects.toThrow('S3 audit unavailable');

            expect(geocode).not.toHaveBeenCalled();
            expect(mirrorEvent).toHaveBeenCalledTimes(1);
            expect(mirrorEvent.mock.calls[0][0]).toMatchObject({
                eventType: 'request_started',
                transmissionState: 'prepared',
            });
            expect(onCheckpoint).toHaveBeenCalledTimes(1);
            expect(onCheckpoint.mock.calls[0][1]).toMatchObject({
                fetched: 0,
                remainingSelected: 1,
            });
            expect(parseGeocodeAuditLedger(await readFile(auditPath, 'utf8'))).toHaveLength(1);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('fsyncs an append-only redacted start event before each request and records its outcome afterward', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-audit-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const apiKey = 'test-api-key-that-must-never-be-logged';
        const sourceListing = listing();
        const requestedAddress = '86 Mount Vernon Street, Boston, MA, 02108, USA';
        const mirrorEvent = vi.fn().mockResolvedValue(undefined);
        const appendAuditEvent = createGeocodeAuditWriter(auditPath, { mirrorEvent });
        let clockTick = 0;
        const auditClock = () => now + (clockTick += 1);

        await writeFile(auditPath, `${JSON.stringify({
            schemaVersion: 'move-with-musto.google-geocode-audit.v1',
            eventType: 'run_completed',
            occurredAt: '2026-07-01T12:00:00.000Z',
            provider: 'google_geocoding',
            runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            dataPersisted: true,
            outcome: 'completed',
        })}\n`, 'utf8');

        try {
            const geocode = vi.fn(async (receivedKey, address) => {
                expect(receivedKey).toBe(apiKey);
                expect(address).toBe(requestedAddress);

                // Reading the file from inside the request function proves the
                // awaited start append (including fsync) happened first.
                const durableLines = (await readFile(auditPath, 'utf8')).trim().split(/\r?\n/);
                expect(JSON.parse(durableLines.at(-1) ?? '{}')).toMatchObject({
                    eventType: 'request_started',
                    sequence: 1,
                    listingNumber: '73333444',
                    transmissionState: 'prepared',
                    outcome: 'prepared',
                });

                return {
                    lat: 42.358812345,
                    lng: -71.070712345,
                    precision: 'SECRET_GOOGLE_RESULT_CONTENT',
                    validatedState: 'MA',
                    validatedPostalCode: '02108',
                    validation: 'exact_state_zip_address',
                };
            });

            await enrichPublicationCoordinates({
                apiKey,
                auditClock,
                auditRunId: '11111111-1111-4111-8111-111111111111',
                cache: { entries: {} },
                details: new Map(),
                geocode,
                index: { listings: [sourceListing] },
                now,
                onAuditEvent: appendAuditEvent,
                requestIdFactory: () => '22222222-2222-4222-8222-222222222222',
            });

            const auditText = await readFile(auditPath, 'utf8');
            const events = auditText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
            expect(events.map((event) => event.eventType)).toEqual([
                'run_completed',
                'request_started',
                'request_completed',
            ]);
            expect(events[1]).toMatchObject({
                runId: '11111111-1111-4111-8111-111111111111',
                requestId: '22222222-2222-4222-8222-222222222222',
                sequence: 1,
                requestReason: 'missing',
                httpMethod: 'GET',
                requestHost: 'maps.googleapis.com',
                requestPath: '/maps/api/geocode/json',
                requestComponents: 'country:US|administrative_area:MA|postal_code:REDACTED',
                providerSku: 'Geocoding',
                addressIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                cacheEntryIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            });
            expect(events[2]).toMatchObject({
                eventType: 'request_completed',
                outcome: 'resolved',
                cacheExpiresAt: '2026-08-01T12:00:00.000Z',
            });
            expect(mirrorEvent.mock.calls.map(([event]) => event.eventType)).toEqual([
                'request_started',
                'request_completed',
            ]);
            expect(auditText).not.toContain(apiKey);
            expect(auditText).not.toContain(requestedAddress);
            expect(auditText).not.toContain('42.358812345');
            expect(auditText).not.toContain('-71.070712345');
            expect(auditText).not.toContain('SECRET_GOOGLE_RESULT_CONTENT');
            expect(auditText).not.toMatch(/"(?:lat|lng|precision|results|errorMessage)"/);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('exports strict metadata-only ledger validation for pre-archive checks', () => {
        const validLine = JSON.stringify({
            schemaVersion: 'move-with-musto.google-geocode-audit.v1',
            eventType: 'run_completed',
            occurredAt: '2026-07-02T12:00:00.000Z',
            provider: 'google_geocoding',
            runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            dataPersisted: true,
            outcome: 'completed',
        });

        expect(parseGeocodeAuditLedger(`${validLine}\n`)).toHaveLength(1);
        expect(() => parseGeocodeAuditLedger(`${JSON.stringify({
            ...JSON.parse(validLine),
            lat: 42.3588,
        })}\n`)).toThrow(/(?:forbidden|unsupported) field lat/i);
    });

    it('records a sanitized failed outcome without retaining arbitrary error text', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-audit-failure-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const mirrorEvent = vi.fn().mockResolvedValue(undefined);
        const appendAuditEvent = createGeocodeAuditWriter(auditPath, { mirrorEvent });
        const secret = 'test-secret-key-and-result-payload';

        try {
            await expect(enrichPublicationCoordinates({
                apiKey: secret,
                auditRunId: '33333333-3333-4333-8333-333333333333',
                cache: { entries: {} },
                details: new Map(),
                geocode: vi.fn().mockRejectedValue(new Error(
                    `${secret}; 86 Mount Vernon Street; {"lat":42.3588,"lng":-71.0707}`,
                )),
                index: { listings: [listing()] },
                now,
                onAuditEvent: appendAuditEvent,
                requestIdFactory: () => '44444444-4444-4444-8444-444444444444',
            })).rejects.toThrow(secret);

            const auditText = await readFile(auditPath, 'utf8');
            const events = auditText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
            expect(events.map((event) => event.eventType)).toEqual([
                'request_started',
                'request_failed',
            ]);
            expect(events[1]).toMatchObject({
                outcome: 'failed',
                failureCode: 'GEOCODE_REQUEST_FAILED',
            });
            expect(mirrorEvent.mock.calls.map(([event]) => event.eventType)).toEqual([
                'request_started',
                'request_failed',
            ]);
            expect(events[1]).not.toHaveProperty('message');
            expect(auditText).not.toContain(secret);
            expect(auditText).not.toContain('86 Mount Vernon Street');
            expect(auditText).not.toContain('42.3588');
            expect(auditText).not.toContain('-71.0707');
            expect(auditText).not.toMatch(/"(?:lat|lng|results|errorMessage)"/);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('fails closed instead of appending after a crash-truncated JSONL tail', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-audit-tail-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const truncated = '{"eventType":"request_started"';

        try {
            await writeFile(auditPath, truncated, 'utf8');
            const appendAuditEvent = createGeocodeAuditWriter(auditPath);
            await expect(appendAuditEvent({
                eventType: 'request_started',
            })).rejects.toThrow(/incomplete JSONL record/i);
            expect(await readFile(auditPath, 'utf8')).toBe(truncated);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('validates every existing ledger record before the first append', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-audit-invalid-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const existingText = [
            JSON.stringify({
                schemaVersion: 'move-with-musto.google-geocode-audit.v1',
                eventType: 'run_completed',
                occurredAt: '2026-07-01T12:00:00.000Z',
                provider: 'google_geocoding',
                runId: '77777777-7777-4777-8777-777777777777',
                dataPersisted: true,
                outcome: 'completed',
            }),
            '{not-valid-json}',
            '',
        ].join('\n');

        try {
            await writeFile(auditPath, existingText, 'utf8');
            const appendAuditEvent = createGeocodeAuditWriter(auditPath);
            await expect(appendAuditEvent({
                schemaVersion: 'move-with-musto.google-geocode-audit.v1',
                eventType: 'run_started',
                occurredAt: '2026-07-02T12:00:00.000Z',
                provider: 'google_geocoding',
                runId: '88888888-8888-4888-8888-888888888888',
                outcome: 'started',
            })).rejects.toThrow(/invalid JSON on line 2/i);
            expect(await readFile(auditPath, 'utf8')).toBe(existingText);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('uses an exclusive run lock to prevent concurrent cache and ledger mutation', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-lock-'));
        const lockPath = path.join(tempRoot, 'geocode.run.lock');

        try {
            const releaseFirst = await acquireGeocodeRunLock(lockPath, {
                clock: () => now,
                runId: '99999999-9999-4999-8999-999999999999',
            });
            await expect(acquireGeocodeRunLock(lockPath, {
                clock: () => now,
                runId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            })).rejects.toThrow(/another geocode or audit-recovery run/i);

            await releaseFirst();
            const releaseSecond = await acquireGeocodeRunLock(lockPath, {
                clock: () => now,
                runId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
            });
            await releaseSecond();
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('backfills only confirmed cache evidence and one explicit 0-to-N historical gap without network calls', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-geocode-audit-recovery-'));
        const auditPath = path.join(tempRoot, 'google-geocoding-requests.jsonl');
        const first = listing({ listingNumber: '100', address: { line: '1 Beacon Street' } });
        const second = listing({ listingNumber: '200', address: { line: '2 Beacon Street' } });
        const cache = {
            updatedAt: '2026-07-09T12:00:00.000Z',
            entries: {
                [geocodeCacheKey(first)]: cacheEntry(first),
                [geocodeCacheKey(second)]: cacheEntry(second),
            },
        };

        try {
            const firstRecovery = await recoverGeocodeAuditFromCache({
                auditClock: () => now,
                auditLogPath: auditPath,
                cache,
                historicalGapId: 'pre-ledger-2026-07-09',
                maxUnloggedRequestCount: 25,
                recoveryId: '55555555-5555-4555-8555-555555555555',
            });
            expect(firstRecovery).toMatchObject({
                confirmedCacheEntryCount: 2,
                recoveredEntryCount: 2,
                previouslyRecordedEntryCount: 0,
                historicalGapRecorded: true,
            });

            const secondRecovery = await recoverGeocodeAuditFromCache({
                auditClock: () => now + 1,
                auditLogPath: auditPath,
                cache,
                historicalGapId: 'pre-ledger-2026-07-09',
                maxUnloggedRequestCount: 25,
                recoveryId: '66666666-6666-4666-8666-666666666666',
            });
            expect(secondRecovery).toMatchObject({
                confirmedCacheEntryCount: 2,
                recoveredEntryCount: 0,
                previouslyRecordedEntryCount: 2,
                historicalGapRecorded: false,
            });

            const third = listing({ listingNumber: '300', address: { line: '3 Beacon Street' } });
            const postLedgerRun = await enrichPublicationCoordinates({
                apiKey: 'test-key',
                auditRunId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                cache,
                details: new Map(),
                geocode: vi.fn().mockResolvedValue({
                    lat: 42.35,
                    lng: -71.06,
                    precision: 'ROOFTOP',
                }),
                index: { listings: [third] },
                now,
                onAuditEvent: createGeocodeAuditWriter(auditPath),
                requestIdFactory: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            });
            const grownCacheRecovery = await recoverGeocodeAuditFromCache({
                auditClock: () => now + 2,
                auditLogPath: auditPath,
                cache: postLedgerRun.cache,
                historicalGapId: 'pre-ledger-2026-07-09',
                maxUnloggedRequestCount: 25,
                recoveryId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            });
            expect(grownCacheRecovery).toMatchObject({
                confirmedCacheEntryCount: 1,
                recoveredEntryCount: 0,
                previouslyRecordedEntryCount: 1,
                historicalGapRecorded: false,
            });

            const auditText = await readFile(auditPath, 'utf8');
            const events = auditText.trim().split(/\r?\n/).map((line) => JSON.parse(line));
            const recovered = events.filter((event) => event.eventType === 'cache_success_recovered');
            const gaps = events.filter((event) => event.eventType === 'historical_gap');
            expect(recovered).toHaveLength(2);
            expect(recovered[0]).toMatchObject({
                evidenceSource: 'private_geocode_cache',
                outcome: 'confirmed_success_recovered',
                addressIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                cacheEntryIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                recoveryEvidenceIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
                // The cache timestamp is evidence from the original run; it is
                // not represented as the precise API-call time.
                cacheGeocodedAt: '2026-07-01T12:00:00.000Z',
                cacheTimestampSemantics: 'ENRICHMENT_RUN_SNAPSHOT_NOT_REQUEST_TIME',
            });
            expect(gaps).toEqual([
                expect.objectContaining({
                    minimumPotentialRequestCount: 0,
                    maximumPotentialRequestCount: 25,
                    historicalGapId: 'pre-ledger-2026-07-09',
                    reasonCode: 'INTERRUPTED_BEFORE_AUDIT_LEDGER',
                    outcome: 'uncertain',
                }),
            ]);
            expect(auditText).not.toContain('42.3588');
            expect(auditText).not.toContain('-71.0707');
            expect(auditText).not.toContain('1 Beacon Street');
            expect(auditText).not.toContain('2 Beacon Street');
            expect(auditText).not.toMatch(/"(?:lat|lng|precision|results)"/);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('requires explicit confirmation for more than 500 selected requests', () => {
        expect(() => assertSafeGeocodePlan({ requests: { selected: 501 } })).toThrow(/--allow-large-run/);
        expect(() => assertSafeGeocodePlan(
            { requests: { selected: 501 } },
            { allowLargeRun: true },
        )).not.toThrow();
    });

    it('parses read-only planning and checkpoint safety flags', () => {
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--no-network',
            '--limit=200',
            '--checkpoint-every',
            '10',
            '--audit-log=.private/geocode-requests.jsonl',
            '--immutable-audit-bucket',
            'move-with-musto-geocode-audit-123456789012-us-east-1',
            '--immutable-audit-prefix=geocoding/run-123/build-7/events',
        ])).toMatchObject({
            dryRun: true,
            limit: 200,
            checkpointEvery: 10,
            auditLog: '.private/geocode-requests.jsonl',
            immutableAuditBucket: 'move-with-musto-geocode-audit-123456789012-us-east-1',
            immutableAuditPrefix: 'geocoding/run-123/build-7/events',
        });
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--preferred-only',
        ])).toMatchObject({ preferredOnly: true });
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--emergency-urgent-only',
        ])).toMatchObject({ emergencyUrgentOnly: true });
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--include-proactive-refresh',
            '--proactive-refresh-limit=25',
        ])).toMatchObject({
            includeProactiveRefresh: true,
            proactiveRefreshLimit: 25,
        });
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--service-area-only',
        ])).toMatchObject({ preferredOnly: true });
        expect(parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--recover-audit-from-cache',
            '--audit-gap-max-requests=25',
            '--audit-gap-id',
            'pre-ledger-2026-07-09',
        ])).toMatchObject({
            recoverAuditFromCache: true,
            auditGapMaxRequests: 25,
            auditGapId: 'pre-ledger-2026-07-09',
        });
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--limit',
            '-1',
        ])).toThrow(/--limit/);
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--include-proactive-refresh',
        ])).toThrow(/must be provided together/i);
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--proactive-refresh-limit=25',
        ])).toThrow(/must be provided together/i);
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--include-proactive-refresh',
            '--proactive-refresh-limit=501',
        ])).toThrow(/cannot exceed 500/i);
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--emergency-urgent-only',
            '--include-proactive-refresh',
            '--proactive-refresh-limit=25',
        ])).toThrow(/emergency-urgent-only cannot be combined with proactive refresh/i);
        expect(() => parseArgs([
            'node',
            'enrich-mls-coordinates.mjs',
            '--immutable-audit-bucket',
            'audit-bucket-without-prefix',
        ])).toThrow(/must be provided together/i);
    });
});



