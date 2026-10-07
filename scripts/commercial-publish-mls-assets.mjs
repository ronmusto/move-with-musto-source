#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    assertCommercialPublicBundle,
    COMMERCIAL_CURRENT_POINTER_FILE,
    COMMERCIAL_INDEX_FILE,
    COMMERCIAL_MANIFEST_FILE,
    serializeCommercialJson,
} from './commercial-pin-cleaner-lib.mjs';

function parseArgs(argv) {
    const args = {
        input: '.commercial-mls-publish',
        output: 'public/commercial',
    };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--input' && next) args.input = next;
        else if (arg === '--output' && next) args.output = next;
        else continue;
        index += 1;
    }
    return args;
}

async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
}

function assertSafeOutputDirectory(outputDir) {
    const parsed = path.parse(outputDir);
    if (outputDir === parsed.root || outputDir === process.cwd()) {
        throw new Error('Commercial publisher output must be a dedicated directory.');
    }
}

export async function publishCommercialAssets(rawArgs = process.argv) {
    const args = parseArgs(rawArgs);
    const inputDir = path.resolve(args.input);
    const outputDir = path.resolve(args.output);
    assertSafeOutputDirectory(outputDir);

    const current = await readJson(path.join(inputDir, COMMERCIAL_CURRENT_POINTER_FILE));
    const generationDir = path.join(inputDir, 'generations', current.generation);
    const [manifest, index] = await Promise.all([
        readJson(path.join(generationDir, COMMERCIAL_MANIFEST_FILE)),
        readJson(path.join(generationDir, COMMERCIAL_INDEX_FILE)),
    ]);
    assertCommercialPublicBundle({ current, manifest, index });

    await rm(outputDir, { recursive: true, force: true });
    await mkdir(path.join(outputDir, 'generations'), { recursive: true });
    await cp(generationDir, path.join(outputDir, 'generations', current.generation), {
        recursive: true,
        errorOnExist: true,
    });
    // Pointer replacement is last so a consumer never observes a partial generation.
    await writeFile(
        path.join(outputDir, COMMERCIAL_CURRENT_POINTER_FILE),
        serializeCommercialJson(current),
        'utf8',
    );
    return { generation: current.generation, listingCount: index.listings.length, outputDir };
}

const invokedDirectly = process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
    publishCommercialAssets().then((summary) => {
        console.log(JSON.stringify(summary, null, 2));
    }).catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
