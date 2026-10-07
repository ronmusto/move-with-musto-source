#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeMlsText, parsePipeDelimited } from './mls-pin-cleaner-lib.mjs';
import {
    assertCommercialFilesAllOrNone,
    assertSafeCommercialGeneration,
    buildCommercialPublicOutputs,
    buildCommercialReferenceMaps,
    cleanCommercialRows,
    COMMERCIAL_CLASSES,
    COMMERCIAL_CURRENT_POINTER_FILE,
    COMMERCIAL_INDEX_FILE,
    COMMERCIAL_MANIFEST_FILE,
    COMMERCIAL_REQUIRED_FILES,
    COMMERCIAL_SERVICE_AREA_TOWN_COUNT,
    COMMERCIAL_SOURCE_FILES,
    parseOptOutOfficeIds,
    serializeCommercialJson,
    sha256CommercialBuffer,
} from './commercial-pin-cleaner-lib.mjs';

function parseArgs(argv) {
    const args = {
        input: 'MLS PIN Exchange data',
        output: '.commercial-mls-publish',
        config: 'mls-compliance.config.json',
        generation: '',
        sourceManifest: '',
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--input' && next) args.input = next;
        else if (arg === '--output' && next) args.output = next;
        else if (arg === '--config' && next) args.config = next;
        else if (arg === '--generation' && next) args.generation = next;
        else if (arg === '--source-manifest' && next) args.sourceManifest = next;
        else continue;
        index += 1;
    }
    return args;
}

function defaultGeneration(now = new Date()) {
    const timestamp = now.toISOString().replace(/[-:TZ.]/gu, '').slice(0, 14);
    return `${timestamp}-${randomUUID()}`;
}

async function readTable(inputDir, fileName) {
    const buffer = await readFile(path.join(inputDir, fileName));
    return parsePipeDelimited(decodeMlsText(buffer));
}

async function assertRequiredFiles(inputDir) {
    const fileNames = await readdir(inputDir);
    const lowerFileNames = fileNames.map((fileName) => fileName.toLowerCase());
    if (!assertCommercialFilesAllOrNone(lowerFileNames)) {
        throw new Error(
            `Commercial cleaner requires all three source files: ${COMMERCIAL_SOURCE_FILES.join(', ')}`,
        );
    }
    const present = new Set(lowerFileNames);
    const missing = COMMERCIAL_REQUIRED_FILES.filter((fileName) => !present.has(fileName));
    if (missing.length > 0) {
        throw new Error(`Missing required commercial MLS files: ${missing.join(', ')}`);
    }
}

async function readComplianceConfig(configPath) {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    return config.mlsPin ?? config;
}

async function readSignedSourceInventory(sourceManifestPath, generation) {
    if (!sourceManifestPath) return null;
    const manifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'));
    if (manifest.schemaVersion !== 'move-with-musto.mls-source-manifest.v1') {
        throw new Error('Commercial source manifest has an unsupported schema version.');
    }
    if (manifest.runId !== generation) {
        throw new Error('Commercial generation does not match the signed source manifest run.');
    }
    if (!Array.isArray(manifest.sourcePackage?.files)) {
        throw new Error('Commercial source manifest has no file inventory.');
    }
    const inventory = new Map();
    for (const file of manifest.sourcePackage.files) {
        if (inventory.has(file.name)) {
            throw new Error(`Commercial source manifest repeats ${file.name}.`);
        }
        inventory.set(file.name, file);
    }
    return inventory;
}

async function buildSourceSnapshot(inputDir, capturedAt, sourceManifestPath, generation) {
    const signedInventory = await readSignedSourceInventory(sourceManifestPath, generation);
    const files = [];
    for (const fileName of COMMERCIAL_SOURCE_FILES) {
        const filePath = path.join(inputDir, fileName);
        const [buffer, fileStats] = await Promise.all([readFile(filePath), stat(filePath)]);
        const sha256 = sha256CommercialBuffer(buffer);
        const signedFile = signedInventory?.get(fileName);
        if (signedInventory && !signedFile) {
            throw new Error(`Commercial source manifest is missing ${fileName}.`);
        }
        if (signedFile && (signedFile.size !== fileStats.size || signedFile.sha256 !== sha256)) {
            throw new Error(`Commercial source file ${fileName} does not match the signed manifest.`);
        }
        const sourceModifiedAt = signedFile?.sourceModifiedAt ?? fileStats.mtime.toISOString();
        const sourceModifiedTimestamp = Date.parse(sourceModifiedAt);
        if (
            !Number.isFinite(sourceModifiedTimestamp) ||
            sourceModifiedTimestamp > Date.parse(capturedAt) + (5 * 60 * 1000)
        ) {
            throw new Error(`Commercial source file ${fileName} has an invalid source modified time.`);
        }
        files.push({
            name: fileName,
            sourceModifiedAt,
            sizeBytes: fileStats.size,
            sha256,
        });
    }
    const sourceModifiedTimestamps = files.map((file) => Date.parse(file.sourceModifiedAt));
    const oldestTimestamp = Math.min(...sourceModifiedTimestamps);
    const newestTimestamp = Math.max(...sourceModifiedTimestamps);
    return {
        capturedAt,
        timestampSource: signedInventory ? 'signed-source-manifest' : 'filesystem-mtime',
        // The combined delivery is only as fresh as its oldest required class.
        // A newer BU export must never make stale CI or land data appear current.
        oldestSourceFileModifiedAt: new Date(oldestTimestamp).toISOString(),
        newestSourceFileModifiedAt: new Date(newestTimestamp).toISOString(),
        sourceFiles: files,
    };
}

async function writeJson(filePath, value, pretty = false) {
    await writeFile(filePath, serializeCommercialJson(value, { pretty }), 'utf8');
}

function assertSafeOutputDirectory(outputDir) {
    const parsed = path.parse(outputDir);
    if (outputDir === parsed.root || outputDir === process.cwd()) {
        throw new Error('Commercial cleaner output must be a dedicated directory.');
    }
}

export async function runCommercialCleaner(rawArgs = process.argv) {
    const args = parseArgs(rawArgs);
    const inputDir = path.resolve(args.input);
    const outputDir = path.resolve(args.output);
    const configPath = path.resolve(args.config);
    const generatedAt = new Date().toISOString();
    const generation = assertSafeCommercialGeneration(args.generation || defaultGeneration());

    assertSafeOutputDirectory(outputDir);

    await assertRequiredFiles(inputDir);
    const [compliance, agents, offices, towns, counties, fieldReference, optOutText] = await Promise.all([
        readComplianceConfig(configPath),
        readTable(inputDir, 'agents.txt'),
        readTable(inputDir, 'offices.txt'),
        readTable(inputDir, 'towns.txt'),
        readTable(inputDir, 'counties.txt'),
        readTable(inputDir, 'field_reference.txt'),
        readFile(path.join(inputDir, 'optout.txt')).then(decodeMlsText),
    ]);
    const references = buildCommercialReferenceMaps({
        agents,
        offices,
        towns,
        counties,
        fieldReference,
    });
    const optOutOfficeIds = parseOptOutOfficeIds(optOutText);
    const listings = [];
    const quarantined = [];
    const classReports = [];

    for (const [propertyClass, classConfig] of Object.entries(COMMERCIAL_CLASSES)) {
        const result = cleanCommercialRows({
            rows: await readTable(inputDir, classConfig.file),
            propertyClass,
            references,
            optOutOfficeIds,
        });
        listings.push(...result.listings);
        quarantined.push(...result.quarantined.map((entry) => ({
            ...entry,
            sourceFile: classConfig.file,
        })));
        classReports.push({
            sourceFile: classConfig.file,
            propertyClass,
            category: classConfig.category,
            ...result.report,
        });
    }

    const sourceManifestPath = args.sourceManifest ? path.resolve(args.sourceManifest) : '';
    const sourceSnapshot = await buildSourceSnapshot(
        inputDir,
        generatedAt,
        sourceManifestPath,
        generation,
    );
    const outputs = buildCommercialPublicOutputs({
        generation,
        generatedAt,
        sourceUpdatedAt: sourceSnapshot.oldestSourceFileModifiedAt,
        compliance,
        listings,
    });
    const generationDir = path.join(outputDir, 'generations', generation);
    await rm(outputDir, { recursive: true, force: true });
    await mkdir(generationDir, { recursive: true });
    await Promise.all([
        writeJson(path.join(outputDir, COMMERCIAL_CURRENT_POINTER_FILE), outputs.current),
        writeJson(path.join(generationDir, COMMERCIAL_MANIFEST_FILE), outputs.manifest),
        writeJson(path.join(generationDir, COMMERCIAL_INDEX_FILE), outputs.index),
    ]);

    const report = {
        generatedAt,
        generation,
        inputDir,
        outputDir,
        totalSourceRows: classReports.reduce((total, item) => total + item.sourceRows, 0),
        totalPublished: listings.length,
        totalQuarantined: quarantined.length,
        totalExcludedInactive: classReports.reduce((total, item) => total + item.excludedInactive, 0),
        totalExcludedOptOut: classReports.reduce((total, item) => total + item.excludedOptOut, 0),
        totalExcludedOutsideMassachusetts: classReports.reduce(
            (total, item) => total + item.excludedOutsideMassachusetts,
            0,
        ),
        totalExcludedOutsideServiceArea: classReports.reduce(
            (total, item) => total + item.excludedOutsideServiceArea,
            0,
        ),
        classReports,
        quarantined,
        safeguards: {
            allThreeSourceFilesRequired: true,
            massachusettsOnly: true,
            canonicalServiceAreaTownCount: COMMERCIAL_SERVICE_AREA_TOWN_COUNT,
            geocodingEnabled: false,
            mapsEnabled: false,
            publicRemarksIncluded: false,
            adultCommunityIncluded: false,
        },
    };
    await Promise.all([
        writeJson(path.join(outputDir, 'commercial-cleaner-report.json'), report, true),
        writeJson(path.join(outputDir, 'commercial-source-snapshot.json'), sourceSnapshot, true),
    ]);

    return { report, sourceSnapshot, outputs };
}

const invokedDirectly = process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
    runCommercialCleaner().then(({ report }) => {
        console.log(JSON.stringify({
            generation: report.generation,
            totalSourceRows: report.totalSourceRows,
            totalPublished: report.totalPublished,
            totalQuarantined: report.totalQuarantined,
            totalExcludedInactive: report.totalExcludedInactive,
            totalExcludedOptOut: report.totalExcludedOptOut,
            totalExcludedOutsideMassachusetts: report.totalExcludedOutsideMassachusetts,
            totalExcludedOutsideServiceArea: report.totalExcludedOutsideServiceArea,
        }, null, 2));
    }).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
