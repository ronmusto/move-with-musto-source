#!/usr/bin/env node
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    buildPublicListingOutputs,
    cleanSalesRows,
    decodeMlsText,
    MLS_COORDINATE_INDEX_FILE,
    MLS_PIN_PUBLIC_DISCLAIMER,
    parsePipeDelimited,
    serializeMlsJson,
} from './mls-pin-cleaner-lib.mjs';
import { sanitizePublicHttpsUrl } from './public-url-safety.mjs';

const SALES_FILES = [
    ['idx_sf.txt', 'single-family'],
    ['idx_cc.txt', 'condo'],
    ['idx_mf.txt', 'multi-family'],
];

const REQUIRED_FILES = [
    ...SALES_FILES.map(([file]) => file),
    'agents.txt',
    'areas.txt',
    'counties.txt',
    'field_reference.txt',
    'idx_OH.txt',
    'idx_VT.txt',
    'offices.txt',
    'optout.txt',
    'towns.txt',
];

function parseArgs(argv) {
    const args = {
        input: 'MLS PIN Exchange data',
        output: '.mls-publish',
        config: 'mls-compliance.config.json',
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--input' && next) {
            args.input = next;
            index += 1;
        } else if (arg === '--output' && next) {
            args.output = next;
            index += 1;
        } else if (arg === '--config' && next) {
            args.config = next;
            index += 1;
        }
    }

    return args;
}

async function readTable(inputDir, fileName) {
    const text = decodeMlsText(await readFile(path.join(inputDir, fileName)));
    return parsePipeDelimited(text);
}

async function assertRequiredFiles(inputDir) {
    const missing = [];
    for (const fileName of REQUIRED_FILES) {
        try {
            await readFile(path.join(inputDir, fileName));
        } catch {
            missing.push(fileName);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Missing required MLS PIN files: ${missing.join(', ')}`);
    }
}

function buildAgentMap(rows) {
    return new Map(rows.map((row) => [
        row.ID,
        [row.FIRST_NAME, row.LAST_NAME].filter(Boolean).join(' ').trim() || row.ID,
    ]));
}

function buildOfficeMap(rows) {
    return new Map(rows.map((row) => [
        row.ID,
        {
            name: row.NAME || row.ID,
            phone: row.PHONE || '',
        },
    ]));
}

function buildTownMap(rows) {
    return new Map(rows.map((row) => [
        row.TOWN_NUM,
        {
            town: row.LONG || row.TOWN_NUM,
            countyCode: row.COUNTY || '',
            state: row.STATE || '',
        },
    ]));
}

function buildCountyMap(rows) {
    return new Map(rows.map((row) => [row.SHORT, row.LONG || row.SHORT]));
}

function buildSimpleReferenceMap(rows) {
    return new Map(rows.map((row) => [row.SHORT, row.LONG || row.MEDIUM || row.SHORT]));
}

function buildFieldReferenceMap(rows) {
    return new Map(rows
        .filter((row) => row.Field && row.Short)
        .map((row) => [
            `${row.Field}:${row.Short}`,
            row.Long || row.Medium || row.Short,
        ]));
}

function buildOpenHouseMap(rows) {
    const openHouses = new Map();
    for (const row of rows) {
        const listingNumber = row.LIST_NO;
        if (!listingNumber) {
            continue;
        }

        const values = openHouses.get(listingNumber) ?? [];
        values.push({
            start: row.START_DATE || '',
            end: row.END_DATE || '',
            type: row.EVENTTYPEDESCRIPTION || '',
            url: sanitizePublicHttpsUrl(row.VIRTUALEVENTURL),
        });
        openHouses.set(listingNumber, values);
    }

    return openHouses;
}

function buildVirtualTourMap(rows) {
    return new Map(
        rows
            .filter((row) => row.LIST_NO && row.TOUR_URL)
            .map((row) => [row.LIST_NO, row.TOUR_URL]),
    );
}

async function readOptOutOfficeIds(inputDir) {
    const text = decodeMlsText(await readFile(path.join(inputDir, 'optout.txt')));
    return new Set((text.match(/[A-Z0-9]+/g) ?? []).filter(Boolean));
}

async function readComplianceConfig(configPath) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    return config.mlsPin ?? config;
}

async function writeJson(filePath, value, options) {
    await writeFile(filePath, serializeMlsJson(value, options), 'utf8');
}

async function buildSourceSnapshot(inputDir, capturedAt) {
    const salesFiles = [];
    for (const [fileName, propertyClass] of SALES_FILES) {
        const fileStats = await stat(path.join(inputDir, fileName));
        salesFiles.push({
            name: fileName,
            propertyClass,
            modifiedAt: fileStats.mtime.toISOString(),
            sizeBytes: fileStats.size,
        });
    }

    const latestSalesFileModifiedAt = salesFiles
        .map((file) => Date.parse(file.modifiedAt))
        .filter(Number.isFinite)
        .reduce((latest, timestamp) => Math.max(latest, timestamp), 0);

    return {
        capturedAt,
        latestSalesFileModifiedAt: new Date(latestSalesFileModifiedAt).toISOString(),
        salesFiles,
    };
}

async function main() {
    const args = parseArgs(process.argv);
    const inputDir = path.resolve(args.input);
    const outputDir = path.resolve(args.output);
    const configPath = path.resolve(args.config);

    await assertRequiredFiles(inputDir);
    const complianceConfig = await readComplianceConfig(configPath);
    const references = {
        agents: buildAgentMap(await readTable(inputDir, 'agents.txt')),
        offices: buildOfficeMap(await readTable(inputDir, 'offices.txt')),
        towns: buildTownMap(await readTable(inputDir, 'towns.txt')),
        areas: buildSimpleReferenceMap(await readTable(inputDir, 'areas.txt')),
        counties: buildCountyMap(await readTable(inputDir, 'counties.txt')),
        fieldReference: buildFieldReferenceMap(await readTable(inputDir, 'field_reference.txt')),
        openHouses: buildOpenHouseMap(await readTable(inputDir, 'idx_OH.txt')),
        virtualTours: buildVirtualTourMap(await readTable(inputDir, 'idx_VT.txt')),
    };
    const optOutOfficeIds = await readOptOutOfficeIds(inputDir);

    const listings = [];
    const quarantined = [];
    const remarksReviews = [];
    const reports = [];

    for (const [fileName, propertyClass] of SALES_FILES) {
        const result = cleanSalesRows({
            rows: await readTable(inputDir, fileName),
            propertyClass,
            references,
            optOutOfficeIds,
            complianceConfig,
        });

        listings.push(...result.listings);
        quarantined.push(...result.quarantined.map((record) => ({
            ...record,
            sourceFile: fileName,
        })));
        remarksReviews.push(...result.remarksReviews.map((record) => ({
            ...record,
            sourceFile: fileName,
        })));
        reports.push({
            sourceFile: fileName,
            propertyClass,
            ...result.report,
        });
    }

    const generatedAt = new Date().toISOString();
    const sourceSnapshot = await buildSourceSnapshot(inputDir, generatedAt);
    const outputBundles = buildPublicListingOutputs({
        generatedAt,
        source: 'MLS Property Information Network, Inc.',
        disclaimer: MLS_PIN_PUBLIC_DISCLAIMER,
        compliance: complianceConfig,
        listings,
        sourceSnapshot,
    });
    const report = {
        generatedAt,
        inputDir,
        outputDir,
        sourceSnapshot,
        totalPublished: listings.length,
        totalQuarantined: quarantined.length,
        totalRemarksSuppressed: remarksReviews.length,
        totalExcludedOutsideMassachusetts: reports.reduce(
            (total, sourceReport) => total + sourceReport.excludedOutsideMassachusetts,
            0,
        ),
        totalStateReferenceMismatches: reports.reduce(
            (total, sourceReport) => total + sourceReport.stateReferenceMismatches,
            0,
        ),
        optOutOfficeCount: optOutOfficeIds.size,
        searchIndexPath: 'public/mls-search-index.json',
        searchManifestPath: 'public/mls-search-manifest.json',
        searchShardPaths: outputBundles.searchShardRecords.map((record) => `public/${record.fileName}`),
        coordinateIndexPath: `public/${MLS_COORDINATE_INDEX_FILE}`,
        coordinateCount: Object.keys(outputBundles.coordinateIndex.coordinates).length,
        detailDirectory: 'public/listings',
        remarksReviewPath: 'review/mls-remarks-review.json',
        reports,
    };

    await rm(outputDir, { recursive: true, force: true });
    const publicDir = path.join(outputDir, 'public');
    const reviewDir = path.join(outputDir, 'review');
    const detailsDir = path.join(publicDir, 'listings');
    await mkdir(detailsDir, { recursive: true });
    await mkdir(reviewDir, { recursive: true });
    await writeJson(path.join(publicDir, 'mls-search-index.json'), outputBundles.searchIndexBundle);
    await writeJson(path.join(publicDir, 'mls-search-manifest.json'), outputBundles.searchManifest);
    for (const record of outputBundles.searchShardRecords) {
        await writeJson(path.join(publicDir, record.fileName), record.value);
    }
    await writeJson(path.join(publicDir, MLS_COORDINATE_INDEX_FILE), outputBundles.coordinateIndex);
    for (const record of outputBundles.detailRecords) {
        await writeJson(path.join(detailsDir, record.fileName), record.listing);
    }
    await writeJson(path.join(reviewDir, 'mls-ingestion-report.json'), report, { pretty: true });
    await writeJson(path.join(reviewDir, 'mls-quarantine.json'), quarantined, { pretty: true });
    await writeJson(path.join(reviewDir, 'mls-remarks-review.json'), remarksReviews, { pretty: true });

    console.log(`MLS PIN search index written to ${path.join(publicDir, 'mls-search-index.json')}`);
    console.log(`MLS PIN search manifest written to ${path.join(publicDir, 'mls-search-manifest.json')}`);
    console.log(`MLS PIN search shards written to ${publicDir}`);
    console.log(`MLS PIN coordinate index written to ${path.join(publicDir, MLS_COORDINATE_INDEX_FILE)}`);
    console.log(`MLS PIN detail files written to ${detailsDir}`);
    console.log(`Private review artifacts written to ${reviewDir}`);
    console.log(`Published listings: ${listings.length}`);
    console.log(`Out-of-state rows excluded: ${report.totalExcludedOutsideMassachusetts}`);
    console.log(`State-reference mismatches quarantined: ${report.totalStateReferenceMismatches}`);
    console.log(`Quarantined records: ${quarantined.length}`);
    console.log(`Listings published with Public Remarks suppressed: ${remarksReviews.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
