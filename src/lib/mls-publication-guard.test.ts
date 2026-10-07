// @vitest-environment node
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkMlsPublication } from '../../scripts/check-mls-publication.mjs';
import {
    createServiceAreaPublication,
    writeMlsSearchDelivery,
} from '../../scripts/publish-mls-assets.mjs';
import {
    buildMlsSearchDelivery,
    CANONICAL_SERVICE_AREA_TOWNS,
    CANONICAL_SERVICE_MARKET_AREA,
    MLS_PIN_PUBLIC_DISCLAIMER,
} from '../../scripts/mls-pin-cleaner-lib.mjs';
import { validateMlsPublication } from '../../scripts/mls-publication-lib.mjs';

const now = Date.parse('2026-07-01T16:00:00.000Z');
const listing = {
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
    facts: {},
    attribution: {
        listingOffice: 'Beacon Office',
        listingAgent: 'Avery Agent',
        listingOfficePhone: '617-555-0100',
    },
    source: { name: 'MLS PIN', photoDate: '', listingAlert: '' },
};

function validPublication() {
    const sourceSnapshot = {
        capturedAt: '2026-06-29T16:00:00.000Z',
        latestSalesFileModifiedAt: '2026-06-29T15:30:00.000Z',
        salesFiles: [
            {
                name: 'idx_sf.txt',
                propertyClass: 'single-family',
                modifiedAt: '2026-06-29T15:30:00.000Z',
                sizeBytes: 2048,
            },
            {
                name: 'idx_cc.txt',
                propertyClass: 'condo',
                modifiedAt: '2026-06-29T15:29:00.000Z',
                sizeBytes: 1024,
            },
            {
                name: 'idx_mf.txt',
                propertyClass: 'multi-family',
                modifiedAt: '2026-06-29T15:28:00.000Z',
                sizeBytes: 512,
            },
        ],
    };

    return {
        now,
        topLevelEntries: ['mls-search-index.json', 'listings'],
        index: {
            generatedAt: '2026-06-29T16:00:00.000Z',
            source: 'MLS PIN Exchange',
            sourceSnapshot,
            disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
            compliance: {
                participantFirmName: 'Test Participant Realty',
                officeAddress: '123 Main Street, Salem, MA 01970',
                phone: '(781) 315-3845',
                marketArea: CANONICAL_SERVICE_MARKET_AREA,
            },
            listings: [listing],
        },
        detailFiles: [{
            name: '73333444.json',
            value: {
                ...listing,
                generatedAt: '2026-06-29T16:00:00.000Z',
                remarks: 'Source-faithful public remarks.',
            },
        }],
    };
}

function validShardedPublication() {
    const publication = validPublication();
    const fullDelivery = buildMlsSearchDelivery(publication.index);
    const preferredRecord = fullDelivery.shardRecords.find((shard) => shard.id === 'preferred');
    if (!preferredRecord) {
        throw new Error('Test fixture is missing its service-area shard.');
    }
    const delivery = {
        ...fullDelivery,
        manifest: {
            ...fullDelivery.manifest,
            shards: fullDelivery.manifest.shards.filter((shard) => shard.id === 'preferred'),
        },
        shardRecords: [preferredRecord],
    };

    return {
        ...publication,
        topLevelEntries: [
            ...publication.topLevelEntries,
            'mls-search-manifest.json',
            'mls-search-preferred.json',
            'mls-coordinate-index.json',
        ],
        manifest: delivery.manifest,
        searchShards: Object.fromEntries(
            delivery.shardRecords.map((shard) => [shard.id, shard.value]),
        ),
        coordinateIndex: delivery.coordinateIndex,
    };
}

describe('MLS publication guard', () => {
    it('accepts a fresh allowlisted publication with matching detail files', () => {
        expect(validateMlsPublication({ ...validPublication(), mode: 'live' })).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });
    });

    it('rejects every embedded listing coordinate because only the sidecar may carry locations', () => {
        const publication = validPublication();
        const poisonedListing = {
            ...publication.index.listings[0],
            mapPosition: {
                lat: 42.7847037,
                lng: -71.4524386,
                source: 'google_geocoding',
                precision: 'ROOFTOP',
                geocodedAt: '2026-06-29T16:00:00.000Z',
                expiresAt: '2026-07-29T16:00:00.000Z',
            },
        };

        expect(() => validateMlsPublication({
            ...publication,
            index: {
                ...publication.index,
                listings: [poisonedListing],
            },
            detailFiles: [{
                ...publication.detailFiles[0],
                value: {
                    ...publication.detailFiles[0].value,
                    mapPosition: poisonedListing.mapPosition,
                },
            }],
            mode: 'live',
        })).toThrow(/must not embed mapPosition.*only in the expiring sidecar/i);
    });

    it('rejects unsafe virtual-tour URLs at the publication boundary', () => {
        const publication = validPublication();
        const unsafeListing = {
            ...publication.index.listings[0],
            virtualTourUrl: 'http://example.com/tour',
        };

        expect(() => validateMlsPublication({
            ...publication,
            index: {
                ...publication.index,
                listings: [unsafeListing],
            },
            detailFiles: [{
                ...publication.detailFiles[0],
                value: {
                    ...publication.detailFiles[0].value,
                    virtualTourUrl: unsafeListing.virtualTourUrl,
                },
            }],
            mode: 'live',
        })).toThrow(/unsafe.*virtualTourUrl/i);
    });

    it('rejects unsafe virtual open-house URLs at the publication boundary', () => {
        const publication = validPublication();
        expect(() => validateMlsPublication({
            ...publication,
            detailFiles: [{
                ...publication.detailFiles[0],
                value: {
                    ...publication.detailFiles[0].value,
                    openHouses: [{
                        start: '2026-06-29T09:00:00',
                        end: '2026-06-29T10:00:00',
                        type: 'Virtual',
                        url: 'http://127.0.0.1/private-event',
                    }],
                },
            }],
            mode: 'live',
        })).toThrow(/invalid.*openHouses/i);
    });

    it('rejects missing or reordered canonical service towns at the publication boundary', () => {
        const missingTownPublication = validPublication();
        expect(() => validateMlsPublication({
            ...missingTownPublication,
            index: {
                ...missingTownPublication.index,
                compliance: {
                    ...missingTownPublication.index.compliance,
                    marketArea: CANONICAL_SERVICE_AREA_TOWNS
                        .filter((town) => town !== 'Burlington')
                        .join(', '),
                },
            },
        })).toThrow(/exactly the 106.*missing towns: Burlington/i);

        const reorderedPublication = validPublication();
        expect(() => validateMlsPublication({
            ...reorderedPublication,
            index: {
                ...reorderedPublication.index,
                compliance: {
                    ...reorderedPublication.index.compliance,
                    marketArea: [...CANONICAL_SERVICE_AREA_TOWNS].reverse().join(', '),
                },
            },
        })).toThrow(/canonical alphabetical town order and spelling/i);
    });

    it('accepts one service-area shard and rejects incomplete or out-of-service delivery', () => {
        expect(validateMlsPublication({ ...validShardedPublication(), mode: 'live' })).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });

        expect(() => validateMlsPublication({
            ...validShardedPublication(),
            topLevelEntries: validShardedPublication().topLevelEntries.filter(
                (entry) => entry !== 'mls-search-preferred.json',
            ),
        })).toThrow(/sharded search delivery is incomplete/i);

        const mispartitioned = validShardedPublication();
        expect(() => validateMlsPublication({
            ...mispartitioned,
            searchShards: {
                preferred: {
                    ...mispartitioned.searchShards.preferred,
                    listings: [{
                        ...listing,
                        address: { ...listing.address, town: 'Worcester' },
                    }],
                },
            },
        })).toThrow(/wrong service-area partition/i);

        expect(() => validateMlsPublication({
            ...validShardedPublication(),
            topLevelEntries: [
                ...validShardedPublication().topLevelEntries,
                'mls-search-other.json',
            ],
        })).toThrow(/non-publishable artifacts.*mls-search-other/i);
    });

    it('rejects a Boston, NH listing at the public index, detail, and preferred-shard boundaries', () => {
        const newHampshireBoston = {
            ...listing,
            address: {
                ...listing.address,
                state: 'NH',
            },
        };
        const invalidIndexPublication = validPublication();
        expect(() => validateMlsPublication({
            ...invalidIndexPublication,
            index: {
                ...invalidIndexPublication.index,
                listings: [newHampshireBoston],
            },
            detailFiles: [{
                ...invalidIndexPublication.detailFiles[0],
                value: {
                    ...invalidIndexPublication.detailFiles[0].value,
                    address: newHampshireBoston.address,
                },
            }],
        })).toThrow(/Massachusetts-only.*searchIndex\.listings\[0\]/i);

        const invalidDetailPublication = validPublication();
        expect(() => validateMlsPublication({
            ...invalidDetailPublication,
            detailFiles: [{
                ...invalidDetailPublication.detailFiles[0],
                value: {
                    ...invalidDetailPublication.detailFiles[0].value,
                    address: newHampshireBoston.address,
                },
            }],
        })).toThrow(/Massachusetts-only.*listings\/73333444\.json/i);

        const invalidShardPublication = validShardedPublication();
        expect(() => validateMlsPublication({
            ...invalidShardPublication,
            searchShards: {
                preferred: {
                    ...invalidShardPublication.searchShards.preferred,
                    listings: [newHampshireBoston],
                },
            },
        })).toThrow(/Massachusetts-only.*searchShard\.preferred/i);
    });

    it('rejects stale data, private review artifacts, and legacy bundles', () => {
        expect(() => validateMlsPublication({
            ...validPublication(),
            index: { ...validPublication().index, generatedAt: '2026-06-27T15:59:59.000Z' },
        })).toThrow(/three-day refresh limit/i);

        expect(() => validateMlsPublication({
            ...validPublication(),
            topLevelEntries: ['mls-search-index.json', 'listings', 'mls-quarantine.json'],
        })).toThrow(/non-publishable artifacts.*mls-quarantine/i);

        expect(() => validateMlsPublication({
            ...validPublication(),
            topLevelEntries: ['mls-search-index.json', 'listings', 'mls-public-listings.json'],
        })).toThrow(/non-publishable artifacts.*mls-public-listings/i);

        const outsideListing = {
            ...listing,
            address: { ...listing.address, town: 'Worcester', county: 'Worcester' },
        };
        expect(() => validateMlsPublication({
            ...validPublication(),
            index: { ...validPublication().index, listings: [outsideListing] },
            detailFiles: [{
                name: '73333444.json',
                value: {
                    ...outsideListing,
                    generatedAt: '2026-06-29T16:00:00.000Z',
                },
            }],
        })).toThrow(/public search index contains out-of-service listing/i);
    });

    it('rejects missing, stale, and prohibited listing detail data', () => {
        expect(() => validateMlsPublication({
            ...validPublication(),
            detailFiles: [],
        })).toThrow(/Missing: 1; stale: 0/i);

        expect(() => validateMlsPublication({
            ...validPublication(),
            detailFiles: [
                ...validPublication().detailFiles,
                {
                    name: '70000000.json',
                    value: { ...listing, generatedAt: '2026-06-29T16:00:00.000Z' },
                },
            ],
        })).toThrow(/Missing: 0; stale: 1/i);

        expect(() => validateMlsPublication({
            ...validPublication(),
            detailFiles: [{
                name: '73333444.json',
                value: {
                    ...listing,
                    generatedAt: '2026-06-29T16:00:00.000Z',
                    firmRemarks: 'Private showing instructions.',
                },
            }],
        })).toThrow(/prohibited field firmRemarks/i);
    });

    it('rejects family-targeted remarks even if a stale reviewed artifact bypassed ingestion', () => {
        const publication = validPublication();
        expect(() => validateMlsPublication({
            ...publication,
            detailFiles: [{
                ...publication.detailFiles[0],
                value: {
                    ...publication.detailFiles[0].value,
                    remarks: 'A family-friendly home with space for a growing family.',
                },
            }],
        })).toThrow(/fair-housing review.*listings\/73333444\.json\.remarks.*familial_status_preference.*family_friendly_claim/i);
    });

    it('requires fresh sales source snapshot metadata only for live publication mode', () => {
        const { sourceSnapshot: _sourceSnapshot, ...indexWithoutSourceSnapshot } = validPublication().index;
        const missingSourceSnapshot = {
            ...validPublication(),
            index: indexWithoutSourceSnapshot,
        };

        expect(validateMlsPublication(missingSourceSnapshot)).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });
        expect(() => validateMlsPublication({
            ...missingSourceSnapshot,
            mode: 'live',
        })).toThrow(/missing source snapshot metadata/i);

        expect(() => validateMlsPublication({
            ...validPublication(),
            mode: 'live',
            index: {
                ...validPublication().index,
                sourceSnapshot: {
                    ...validPublication().index.sourceSnapshot,
                    latestSalesFileModifiedAt: '2026-06-27T15:59:59.000Z',
                    salesFiles: validPublication().index.sourceSnapshot.salesFiles.map((file) => ({
                        ...file,
                        modifiedAt: '2026-06-27T15:59:59.000Z',
                    })),
                },
            },
        })).toThrow(/source snapshot.*three-day refresh limit/i);
    });

    it('does not apply the live listing freshness limit to MLS reference-table dates', () => {
        const publicationWithOlderReferenceTables = {
            ...validPublication(),
            mode: 'live',
            index: {
                ...validPublication().index,
                sourceSnapshot: {
                    ...validPublication().index.sourceSnapshot,
                    referenceTables: [
                        {
                            name: 'counties.txt',
                            modifiedAt: '2018-05-14T12:00:00.000Z',
                            sizeBytes: 512,
                        },
                        {
                            name: 'towns.txt',
                            modifiedAt: '2026-01-26T12:00:00.000Z',
                            sizeBytes: 2048,
                        },
                        {
                            name: 'areas.txt',
                            modifiedAt: '2025-10-20T12:00:00.000Z',
                            sizeBytes: 1024,
                        },
                        {
                            name: 'field_reference.txt',
                            modifiedAt: '2025-11-24T12:00:00.000Z',
                            sizeBytes: 4096,
                        },
                    ],
                },
            },
        };

        expect(validateMlsPublication(publicationWithOlderReferenceTables)).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });
    });

    it('allows current sidecar coordinates and rejects embedded, expired, or out-of-state coordinates', () => {
        const mapPosition = {
            lat: 42.3588,
            lng: -71.0707,
            source: 'google_geocoding',
            precision: 'ROOFTOP',
            geocodedAt: '2026-06-20T16:00:00.000Z',
            expiresAt: '2026-07-20T16:00:00.000Z',
        };
        const reviewedPublicationWithCoordinates = {
            ...validPublication(),
            index: {
                ...validPublication().index,
                listings: [{ ...listing, mapPosition }],
            },
            detailFiles: [{
                name: '73333444.json',
                value: {
                    ...listing,
                    generatedAt: '2026-06-29T16:00:00.000Z',
                    remarks: 'Source-faithful public remarks.',
                    mapPosition,
                },
            }],
        };

        expect(() => validateMlsPublication(reviewedPublicationWithCoordinates))
            .toThrow(/must not embed mapPosition/i);

        const fullCoordinateDelivery = buildMlsSearchDelivery(reviewedPublicationWithCoordinates.index, now);
        const coordinatePreferredRecord = fullCoordinateDelivery.shardRecords.find(
            (shard) => shard.id === 'preferred',
        );
        if (!coordinatePreferredRecord) {
            throw new Error('Coordinate test fixture is missing its service-area shard.');
        }
        const coordinateDelivery = {
            ...fullCoordinateDelivery,
            manifest: {
                ...fullCoordinateDelivery.manifest,
                shards: fullCoordinateDelivery.manifest.shards.filter(
                    (shard) => shard.id === 'preferred',
                ),
            },
            shardRecords: [coordinatePreferredRecord],
        };
        const publicCoordinateFreePublication = validPublication();
        const shardedPublicationWithCoordinates = {
            ...publicCoordinateFreePublication,
            topLevelEntries: [
                ...publicCoordinateFreePublication.topLevelEntries,
                'mls-search-manifest.json',
                'mls-search-preferred.json',
                'mls-coordinate-index.json',
            ],
            manifest: coordinateDelivery.manifest,
            searchShards: Object.fromEntries(
                coordinateDelivery.shardRecords.map((shard) => [shard.id, shard.value]),
            ),
            coordinateIndex: coordinateDelivery.coordinateIndex,
        };

        expect(validateMlsPublication(shardedPublicationWithCoordinates)).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });
        expect(shardedPublicationWithCoordinates.searchShards.preferred.listings[0])
            .not.toHaveProperty('mapPosition');
        const publishedCoordinate = {
            lat: 42.3588,
            lng: -71.0707,
            expiresAt: '2026-07-20T16:00:00.000Z',
        };
        expect(shardedPublicationWithCoordinates.coordinateIndex.coordinates).toEqual({
            '73333444': publishedCoordinate,
        });
        expect(validateMlsPublication({
            ...shardedPublicationWithCoordinates,
            coordinateIndex: {
                ...shardedPublicationWithCoordinates.coordinateIndex,
                coordinates: {
                    '73333444': {
                        ...publishedCoordinate,
                        // A coordinate refresh may legitimately occur after
                        // the MLS export's generatedAt timestamp.
                        expiresAt: '2026-07-31T12:00:00.000Z',
                    },
                },
            },
        })).toEqual({
            generatedAt: '2026-06-29T16:00:00.000Z',
            listingCount: 1,
        });
        expect(() => validateMlsPublication({
            ...shardedPublicationWithCoordinates,
            coordinateIndex: {
                ...shardedPublicationWithCoordinates.coordinateIndex,
                coordinates: {
                    '73333444': {
                        ...publishedCoordinate,
                        expiresAt: '2026-06-30T16:00:00.000Z',
                    },
                },
            },
        })).toThrow(/invalid or expired listing 73333444/i);
        expect(() => validateMlsPublication({
            ...shardedPublicationWithCoordinates,
            coordinateIndex: {
                ...shardedPublicationWithCoordinates.coordinateIndex,
                coordinates: {
                    '73333444': {
                        ...publishedCoordinate,
                        expiresAt: '2026-08-01T16:05:01.000Z',
                    },
                },
            },
        })).toThrow(/invalid or expired listing 73333444/i);
        expect(() => validateMlsPublication({
            ...shardedPublicationWithCoordinates,
            coordinateIndex: {
                ...shardedPublicationWithCoordinates.coordinateIndex,
                coordinates: {
                    '73333444': {
                        ...publishedCoordinate,
                        lat: 42.7847037,
                        lng: -71.4524386,
                    },
                },
            },
        })).toThrow(/invalid or expired listing 73333444/i);
        expect(() => validateMlsPublication({
            ...shardedPublicationWithCoordinates,
            searchShards: {
                ...shardedPublicationWithCoordinates.searchShards,
                preferred: {
                    ...shardedPublicationWithCoordinates.searchShards.preferred,
                    listings: [{ ...listing, mapPosition }],
                },
            },
        })).toThrow(/must not embed mapPosition/i);

    });
});

describe('MLS publication check modes', () => {
    it('regenerates coordinate-free shards and the coordinate sidecar from the reviewed index', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-search-delivery-'));
        const mapPosition = {
            lat: 42.3588,
            lng: -71.0707,
            source: 'google_geocoding',
            precision: 'ROOFTOP',
            geocodedAt: '2026-06-20T16:00:00.000Z',
            expiresAt: '2026-07-20T16:00:00.000Z',
        };

        try {
            await writeFile(
                path.join(tempRoot, 'mls-search-index.json'),
                JSON.stringify({
                    ...validPublication().index,
                    listings: [{ ...listing, mapPosition }],
                }),
                'utf8',
            );

            await writeMlsSearchDelivery(tempRoot, now);

            const manifest = JSON.parse(
                await readFile(path.join(tempRoot, 'mls-search-manifest.json'), 'utf8'),
            );
            const preferred = JSON.parse(
                await readFile(path.join(tempRoot, 'mls-search-preferred.json'), 'utf8'),
            );
            const coordinateIndex = JSON.parse(
                await readFile(path.join(tempRoot, 'mls-coordinate-index.json'), 'utf8'),
            );
            const rewrittenIndex = JSON.parse(
                await readFile(path.join(tempRoot, 'mls-search-index.json'), 'utf8'),
            );
            const generatedFiles = await readdir(tempRoot);

            expect(manifest.coordinateIndex).toEqual({
                file: 'mls-coordinate-index.json',
                coordinateCount: 1,
            });
            expect(preferred.listings[0]).not.toHaveProperty('mapPosition');
            expect(rewrittenIndex.listings[0]).not.toHaveProperty('mapPosition');
            expect(manifest.shards).toEqual([
                { id: 'preferred', file: 'mls-search-preferred.json', listingCount: 1 },
            ]);
            expect(generatedFiles).not.toContain('mls-search-other.json');
            expect(coordinateIndex.coordinates).toEqual({
                '73333444': {
                    lat: 42.3588,
                    lng: -71.0707,
                    expiresAt: '2026-07-20T16:00:00.000Z',
                },
            });
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('stages only Massachusetts service-area artifacts from a legacy mixed reviewed source', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-service-publication-'));
        const sourceDirectory = path.join(tempRoot, 'reviewed-full-source');
        const destinationDirectory = path.join(tempRoot, 'public-service-only');
        const sourceListingsDirectory = path.join(sourceDirectory, 'listings');
        const mapPosition = {
            lat: 42.3588,
            lng: -71.0707,
            source: 'reviewed_coordinates',
            precision: 'ROOFTOP',
            geocodedAt: '2026-06-20T16:00:00.000Z',
            expiresAt: '2026-07-20T16:00:00.000Z',
        };
        const worcesterListing = {
            ...listing,
            listingNumber: '79999999',
            address: {
                ...listing.address,
                line: '1 Main Street',
                town: 'Worcester',
                county: 'Worcester',
                zip: '01608',
            },
            mapPosition: { ...mapPosition, lat: 42.2626, lng: -71.8023 },
        };
        const newHampshireListing = {
            ...listing,
            listingNumber: '78888888',
            address: {
                ...listing.address,
                line: '1 Granite State Road',
                state: 'NH',
                zip: '03060',
            },
            mapPosition: { ...mapPosition, lat: 42.7654, lng: -71.4676 },
        };
        const serviceListing = { ...listing, mapPosition };
        const sourceIndex = {
            ...validPublication().index,
            compliance: {
                ...validPublication().index.compliance,
                marketArea: 'Boston, Brookline, Salem',
            },
            listings: [serviceListing, worcesterListing, newHampshireListing],
        };
        const approvedCompliance = validPublication().index.compliance;

        try {
            await mkdir(sourceListingsDirectory, { recursive: true });
            await writeFile(
                path.join(sourceDirectory, 'mls-search-index.json'),
                JSON.stringify(sourceIndex),
                'utf8',
            );
            for (const sourceListing of sourceIndex.listings) {
                await writeFile(
                    path.join(sourceListingsDirectory, `${sourceListing.listingNumber}.json`),
                    JSON.stringify({
                        ...sourceListing,
                        generatedAt: sourceIndex.generatedAt,
                        remarks: 'Source-faithful public remarks.',
                    }),
                    'utf8',
                );
            }

            await expect(createServiceAreaPublication(
                sourceDirectory,
                destinationDirectory,
                { compliance: approvedCompliance, now },
            )).resolves.toEqual({
                sourceListingCount: 3,
                massachusettsListingCount: 2,
                excludedOutsideMassachusetts: 1,
                listingCount: 1,
                coordinateCount: 1,
            });

            const destinationFiles = await readdir(destinationDirectory);
            const destinationIndex = JSON.parse(await readFile(
                path.join(destinationDirectory, 'mls-search-index.json'),
                'utf8',
            ));
            const destinationManifest = JSON.parse(await readFile(
                path.join(destinationDirectory, 'mls-search-manifest.json'),
                'utf8',
            ));
            const destinationCoordinates = JSON.parse(await readFile(
                path.join(destinationDirectory, 'mls-coordinate-index.json'),
                'utf8',
            ));
            const destinationDetail = JSON.parse(await readFile(
                path.join(destinationDirectory, 'listings', '73333444.json'),
                'utf8',
            ));

            expect(destinationFiles).not.toContain('mls-search-other.json');
            expect(destinationIndex.listings.map((item: typeof listing) => item.listingNumber))
                .toEqual(['73333444']);
            expect(destinationIndex.listings[0]).not.toHaveProperty('mapPosition');
            expect(destinationDetail).not.toHaveProperty('mapPosition');
            expect(JSON.stringify([destinationIndex, destinationDetail]))
                .not.toMatch(/"(?:mapPosition|lat|lng|latitude|longitude|geocodedAt)"/);
            expect(destinationIndex.compliance.marketArea).toBe(CANONICAL_SERVICE_MARKET_AREA);
            expect(destinationManifest).toMatchObject({
                totalListingCount: 1,
                facets: { towns: ['Boston'], counties: ['Suffolk'], states: ['MA'] },
                shards: [{
                    id: 'preferred',
                    file: 'mls-search-preferred.json',
                    listingCount: 1,
                }],
            });
            expect(Object.keys(destinationCoordinates.coordinates)).toEqual(['73333444']);
            expect(await readdir(path.join(destinationDirectory, 'listings')))
                .toEqual(['73333444.json']);

            const unchangedSourceIndex = JSON.parse(await readFile(
                path.join(sourceDirectory, 'mls-search-index.json'),
                'utf8',
            ));
            expect(unchangedSourceIndex.listings).toHaveLength(3);
            expect(unchangedSourceIndex.compliance.marketArea).toBe('Boston, Brookline, Salem');
            expect(unchangedSourceIndex.listings.map((item: typeof listing) => ({
                town: item.address.town,
                state: item.address.state,
            }))).toEqual([
                { town: 'Boston', state: 'MA' },
                { town: 'Worcester', state: 'MA' },
                { town: 'Boston', state: 'NH' },
            ]);
            expect(await readdir(sourceListingsDirectory)).toHaveLength(3);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('allows missing public MLS files in import-pending mode and rejects them in live mode', async () => {
        const tempRoot = await mkdtemp(path.join(tmpdir(), 'mls-publication-'));
        const missingPublicDirectory = path.join(tempRoot, 'public', 'mls');

        try {
            await expect(checkMlsPublication({
                mode: 'import-pending',
                publicDirectory: missingPublicDirectory,
                now,
            })).resolves.toMatchObject({
                status: 'import-pending',
                publicDirectory: missingPublicDirectory,
            });

            await expect(checkMlsPublication({
                mode: 'live',
                publicDirectory: missingPublicDirectory,
                now,
            })).rejects.toThrow(/public\/mls is missing/i);

            await mkdir(path.join(missingPublicDirectory, 'listings'), { recursive: true });
            await writeFile(
                path.join(missingPublicDirectory, 'mls-search-index.json'),
                JSON.stringify(validPublication().index),
                'utf8',
            );
            await writeFile(
                path.join(missingPublicDirectory, 'listings', '73333444.json'),
                JSON.stringify(validPublication().detailFiles[0].value),
                'utf8',
            );
            await expect(checkMlsPublication({
                mode: 'import-pending',
                publicDirectory: missingPublicDirectory,
                now,
            })).rejects.toThrow(/missing its service-area search delivery/i);
        } finally {
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
