import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
    assertCommercialFilesAllOrNone,
    assertCommercialPublicBundle,
    buildCommercialPublicOutputs,
    buildCommercialReferenceMaps,
    cleanCommercialRows,
    COMMERCIAL_SOURCE_FILES,
} from '../../scripts/commercial-pin-cleaner-lib.mjs';
import { runCommercialCleaner } from '../../scripts/commercial-pin-cleaner.mjs';
import { publishCommercialAssets } from '../../scripts/commercial-publish-mls-assets.mjs';
import { CANONICAL_SERVICE_AREA_TOWNS } from '../../scripts/mls-pin-cleaner-lib.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
        rm(directory, { recursive: true, force: true })
    )));
});

const compliance = {
    participantFirmName: 'Synthetic Test Realty',
    officeAddress: '1 Test Way, Acton, MA 01720',
    phone: '978-555-0100',
    marketArea: CANONICAL_SERVICE_AREA_TOWNS,
};

function rawReferenceRows() {
    return {
        agents: [{ ID: 'A1', FIRST_NAME: 'Avery', LAST_NAME: 'Agent' }],
        offices: [
            { ID: 'O1', NAME: 'Synthetic Brokerage', PHONE: '978-555-0100' },
            { ID: 'O999', NAME: 'Opt Out Brokerage', PHONE: '978-555-0199' },
        ],
        towns: [
            { TOWN_NUM: '101', LONG: 'Acton', COUNTY: 'MIDD', STATE: 'MA' },
            { TOWN_NUM: '102', LONG: 'Albany', COUNTY: 'ALBA', STATE: 'NY' },
            { TOWN_NUM: '103', LONG: 'Springfield', COUNTY: 'HAMP', STATE: 'MA' },
        ],
        counties: [
            { SHORT: 'MIDD', LONG: 'Middlesex' },
            { SHORT: 'ALBA', LONG: 'Albany' },
            { SHORT: 'HAMP', LONG: 'Hampden' },
        ],
        fieldReference: [
            { bu: '1', ci: '0', ld: '0', Field: 'BU_TYPE', Short: 'B', Long: 'Restaurant with liquor' },
            { bu: '0', ci: '1', ld: '0', Field: 'BU_TYPE', Short: 'B', Long: 'Wrong cross-class label' },
            { bu: '0', ci: '1', ld: '0', Field: 'CI_TYPE', Short: 'E', Long: 'Office' },
            { bu: '0', ci: '1', ld: '0', Field: 'SPACE_AVAILABLE', Short: 'A', Long: 'For Sale' },
            { bu: '0', ci: '1', ld: '0', Field: 'SPACE_AVAILABLE', Short: 'B', Long: 'For Lease' },
            { bu: '0', ci: '1', ld: '0', Field: 'SPACE_AVAILABLE', Short: 'C', Long: 'For Sale/Lease' },
            { bu: '0', ci: '0', ld: '1', Field: 'LD_TYPE', Short: 'C', Long: 'Commercial land' },
            { bu: '0', ci: '0', ld: '1', Field: 'LD_TYPE', Short: 'Z', Long: 'Other (See Remarks)' },
        ],
    };
}

function validBusinessRow(overrides: Record<string, string> = {}) {
    return {
        PROP_TYPE: 'BU',
        LIST_NO: 'C1001',
        LIST_AGENT: 'A1',
        LIST_OFFICE: 'O1',
        STATUS: 'ACT',
        LIST_PRICE: '425000',
        STREET_NO: '10',
        STREET_NAME: 'Main Street',
        UNIT_NO: '',
        TOWN_NUM: '101',
        ZIP_CODE: '01720',
        PHOTO_COUNT: '2',
        STATE: 'MA',
        BU_TYPE: 'B',
        LOT_SIZE: '10000',
        BLDG_SQ_FEET: '2500',
        PARKING_SPCS: '5',
        REAL_ESTATE_INCLD: 'Y',
        REMARKS: 'Never publish this text.',
        FIRM_REMARKS: 'Private firm text.',
        PUBLIC_RECORD: 'Private public-record field.',
        SPECIAL_SHOWING_INSTRUCTIONS: 'Private showing instructions.',
        ADULT_COMMUNITY: 'N',
        ...overrides,
    };
}

function validCommercialRow(overrides: Record<string, string> = {}) {
    return {
        PROP_TYPE: 'CI',
        LIST_NO: 'CI1001',
        LIST_AGENT: 'A1',
        LIST_OFFICE: 'O1',
        STATUS: 'ACT',
        LIST_PRICE: '24',
        STREET_NO: '20',
        STREET_NAME: 'Commerce Way',
        UNIT_NO: '',
        TOWN_NUM: '101',
        ZIP_CODE: '01720',
        PHOTO_COUNT: '2',
        STATE: 'MA',
        CI_TYPE: 'E',
        SPACE_AVAILABLE: 'B',
        TOTAL_BLDG_SF: '8000',
        LOT_SIZE: '20000',
        ACRE: '0.46',
        PARKING_SPACES: '12',
        TOTAL_UNITS: '4',
        NO_STORIES: '2',
        ...overrides,
    };
}

describe('commercial MLS cleaner and public-listing artifacts', () => {
    it('enforces all-three-or-none commercial input', () => {
        expect(assertCommercialFilesAllOrNone([])).toBe(false);
        expect(assertCommercialFilesAllOrNone(COMMERCIAL_SOURCE_FILES)).toBe(true);
        expect(() => assertCommercialFilesAllOrNone(['idx_bu.txt', 'idx_ci.txt']))
            .toThrow(/all-three-or-none.*idx_ld\.txt/i);
    });

    it('decodes field references only for the active commercial class', () => {
        const references = buildCommercialReferenceMaps(rawReferenceRows());
        const result = cleanCommercialRows({
            rows: [validBusinessRow()],
            propertyClass: 'BU',
            references,
            optOutOfficeIds: new Set(),
        });

        expect(result.listings[0].listingTypes).toEqual(['Restaurant with liquor']);
        expect(result.listings[0].listingTypes).not.toContain('Wrong cross-class label');
        expect(references.fieldReference.get('CI:BU_TYPE:B')).toBe('Wrong cross-class label');
        expect(references.fieldReference.get('LD:LD_TYPE:Z')).toBe('Other');
    });

    it('decodes commercial offering codes instead of treating SPACE_AVAILABLE as square footage', () => {
        const references = buildCommercialReferenceMaps(rawReferenceRows());
        const rows = [
            validCommercialRow({ LIST_NO: 'CI-A', SPACE_AVAILABLE: 'A' }),
            validCommercialRow({ LIST_NO: 'CI-B', SPACE_AVAILABLE: 'B' }),
            validCommercialRow({ LIST_NO: 'CI-C', SPACE_AVAILABLE: 'C' }),
        ];
        const result = cleanCommercialRows({
            rows,
            propertyClass: 'CI',
            references,
            optOutOfficeIds: new Set(),
        });

        expect(result.listings.map((listing) => listing.availability))
            .toEqual(['for-sale', 'for-lease', 'for-sale-or-lease']);
        expect(result.listings[0].facts).not.toHaveProperty('spaceAvailableSqft');

        const invalid = cleanCommercialRows({
            rows: [validCommercialRow({ SPACE_AVAILABLE: 'Z' })],
            propertyClass: 'CI',
            references,
            optOutOfficeIds: new Set(),
        });
        expect(invalid.report.quarantineReasons)
            .toMatchObject({ missing_or_unknown_commercial_availability: 1 });
    });

    it('filters inactive, opted-out, out-of-state, and out-of-area rows and quarantines bad references', () => {
        const references = buildCommercialReferenceMaps(rawReferenceRows());
        const rows = [
            validBusinessRow(),
            validBusinessRow({ LIST_NO: 'C1002', STATUS: 'SLD' }),
            validBusinessRow({ LIST_NO: 'C1003', LIST_OFFICE: 'O999' }),
            validBusinessRow({ LIST_NO: 'C1004', TOWN_NUM: '102', STATE: 'NY' }),
            validBusinessRow({ LIST_NO: 'C1005', TOWN_NUM: '103' }),
            validBusinessRow({ LIST_NO: 'C1006', LIST_AGENT: 'MISSING' }),
            validBusinessRow({ LIST_NO: 'C1007', BU_TYPE: 'Z' }),
        ];
        const result = cleanCommercialRows({
            rows,
            propertyClass: 'BU',
            references,
            optOutOfficeIds: new Set(['O999']),
        });

        expect(result.report).toMatchObject({
            sourceRows: 7,
            published: 1,
            excludedInactive: 1,
            excludedOptOut: 1,
            excludedOutsideMassachusetts: 1,
            excludedOutsideServiceArea: 1,
            quarantined: 2,
        });
        expect(result.report.quarantineReasons).toMatchObject({
            missing_agent_reference: 1,
            missing_listing_type_reference: 1,
            unknown_or_cross_class_listing_type_code: 1,
        });
    });

    it('uses a strict public whitelist and excludes Attachment C, remarks, adult-community, and map fields', () => {
        const references = buildCommercialReferenceMaps(rawReferenceRows());
        const { listings } = cleanCommercialRows({
            rows: [validBusinessRow()],
            propertyClass: 'BU',
            references,
            optOutOfficeIds: new Set(),
        });
        const outputs = buildCommercialPublicOutputs({
            generation: 'synthetic-generation',
            generatedAt: '2026-08-08T12:00:00.000Z',
            sourceUpdatedAt: '2026-08-08T11:00:00.000Z',
            compliance,
            listings,
        });
        const serialized = JSON.stringify(outputs);

        for (const prohibited of [
            'remarks',
            'adultCommunity',
            'firmRemarks',
            'publicRecord',
            'specialShowingInstructions',
            'entryOnly',
            'expirationDate',
            'typeOfListingAgreement',
            'showingBuyerAgent',
            'mapPosition',
            'coordinates',
        ]) {
            expect(serialized.toLowerCase()).not.toContain(prohibited.toLowerCase());
        }
        expect(outputs.index.listings[0].realEstateIncluded).toBe(true);
        expect(() => assertCommercialPublicBundle({
            ...outputs,
            index: {
                ...outputs.index,
                listings: [{ ...outputs.index.listings[0], firmRemarks: 'private' }],
            },
        })).toThrow(/unexpected public keys/i);
    });

    it('preserves true, false, and unknown real-estate-included values for business opportunities', () => {
        const references = buildCommercialReferenceMaps(rawReferenceRows());
        const { listings } = cleanCommercialRows({
            rows: [
                validBusinessRow({ LIST_NO: 'C1', REAL_ESTATE_INCLD: 'Y' }),
                validBusinessRow({ LIST_NO: 'C2', REAL_ESTATE_INCLD: 'N' }),
                validBusinessRow({ LIST_NO: 'C3', REAL_ESTATE_INCLD: '' }),
            ],
            propertyClass: 'BU',
            references,
            optOutOfficeIds: new Set(),
        });
        expect(listings.map((listing) => listing.realEstateIncluded)).toEqual([true, false, null]);
    });

    it('builds a complete synthetic staged generation and publishes only public artifacts', async () => {
        const testDir = await mkdtemp(path.join(tmpdir(), 'musto-commercial-cleaner-'));
        temporaryDirectories.push(testDir);
        const stagedDir = path.join(testDir, 'staged');
        const publicDir = path.join(testDir, 'public', 'commercial');
        const configPath = path.join(testDir, 'config.json');
        const sourceManifestPath = path.join(testDir, 'source-manifest.json');
        const fixtureDir = path.resolve('tests/fixtures/commercial-mls');
        await writeFile(configPath, JSON.stringify({ mlsPin: compliance }), 'utf8');
        const timestampBase = Date.now();
        const signedSourceModifiedTimes = [
            new Date(timestampBase - (60 * 60 * 1000)).toISOString(),
            new Date(timestampBase - (2 * 60 * 60 * 1000)).toISOString(),
            new Date(timestampBase - (3 * 60 * 60 * 1000)).toISOString(),
        ];
        const sourceFiles = await Promise.all(COMMERCIAL_SOURCE_FILES.map(async (name, index) => {
            const filePath = path.join(fixtureDir, name);
            const [bytes, metadata] = await Promise.all([readFile(filePath), stat(filePath)]);
            return {
                name,
                size: metadata.size,
                sha256: createHash('sha256').update(bytes).digest('hex'),
                checksumSha256: createHash('sha256').update(bytes).digest('base64'),
                sourceModifiedAt: signedSourceModifiedTimes[index],
            };
        }));
        await writeFile(sourceManifestPath, JSON.stringify({
            schemaVersion: 'move-with-musto.mls-source-manifest.v1',
            runId: 'synthetic-run-001',
            sourcePackage: { files: sourceFiles },
        }), 'utf8');

        const { report } = await runCommercialCleaner([
            'node',
            'commercial-pin-cleaner.mjs',
            '--input', fixtureDir,
            '--output', stagedDir,
            '--config', configPath,
            '--generation', 'synthetic-run-001',
            '--source-manifest', sourceManifestPath,
        ]);
        expect(report.totalSourceRows).toBe(3);
        expect(report.totalPublished).toBe(3);
        expect(report.safeguards).toMatchObject({
            canonicalServiceAreaTownCount: 106,
            geocodingEnabled: false,
            mapsEnabled: false,
            publicRemarksIncluded: false,
            adultCommunityIncluded: false,
        });
        const sourceSnapshot = JSON.parse(
            await readFile(path.join(stagedDir, 'commercial-source-snapshot.json'), 'utf8'),
        );
        expect(sourceSnapshot.timestampSource).toBe('signed-source-manifest');
        expect(sourceSnapshot.oldestSourceFileModifiedAt).toBe(signedSourceModifiedTimes[2]);
        expect(sourceSnapshot.newestSourceFileModifiedAt).toBe(signedSourceModifiedTimes[0]);
        const manifest = JSON.parse(await readFile(
            path.join(stagedDir, 'generations', 'synthetic-run-001', 'commercial-search-manifest.json'),
            'utf8',
        ));
        expect(manifest.schemaVersion).toBe(2);
        expect(manifest.facets.availabilities).toEqual(['for-sale']);
        expect(manifest.sourceUpdatedAt).toBe(signedSourceModifiedTimes[2]);

        const summary = await publishCommercialAssets([
            'node',
            'commercial-publish-mls-assets.mjs',
            '--input', stagedDir,
            '--output', publicDir,
        ]);
        expect(summary).toMatchObject({ generation: 'synthetic-run-001', listingCount: 3 });
        const current = JSON.parse(await readFile(path.join(publicDir, 'current.json'), 'utf8'));
        expect(current.generation).toBe('synthetic-run-001');
        await expect(readFile(path.join(publicDir, 'commercial-cleaner-report.json'), 'utf8'))
            .rejects.toThrow();
        const publicGeneration = path.join(publicDir, 'generations', 'synthetic-run-001');
        const index = await readFile(path.join(publicGeneration, 'commercial-search-index.json'), 'utf8');
        const parsedIndex = JSON.parse(index);
        expect(parsedIndex.schemaVersion).toBe(2);
        expect(parsedIndex.listings).toHaveLength(3);
        expect(parsedIndex.listings.find((listing: { category: string }) => (
            listing.category === 'commercial-industrial'
        )).availability).toBe('for-sale');
        expect(index).not.toMatch(/remarks|adult.?community|firm.?remarks|public.?record/iu);
        expect((await readdir(publicGeneration)).sort()).toEqual([
            'commercial-search-index.json',
            'commercial-search-manifest.json',
        ]);
    });
});
