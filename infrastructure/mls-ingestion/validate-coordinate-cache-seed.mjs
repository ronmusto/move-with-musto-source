#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

import { validateCoordinateCacheDocument } from './seed-coordinate-cache.mjs';
import {
    coordinateCacheMetadata,
    summarizeCoordinateCache as summarizeCoordinateCacheCore,
    validateReviewedCoordinateCacheObject as validateReviewedCoordinateCacheObjectCore,
} from './handlers/coordinate-cache-provenance.mjs';

export { coordinateCacheMetadata };

export function summarizeCoordinateCache(options) {
    return summarizeCoordinateCacheCore({
        ...options,
        validateDocument: validateCoordinateCacheDocument,
    });
}

export function validateReviewedCoordinateCacheObject(options) {
    return validateReviewedCoordinateCacheObjectCore({
        ...options,
        validateDocument: validateCoordinateCacheDocument,
    });
}

function parseArguments(argv) {
    const values = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid reviewed coordinate-cache argument ${name ?? ''}.`);
        }
        values.set(name, value);
    }
    if (!values.has('--cache')) {
        throw new Error('Missing required reviewed coordinate-cache argument --cache.');
    }
    const objectResponsePath = values.get('--object-response');
    const latestLockedLedgerSha256 = values.get('--latest-locked-ledger-sha256');
    if (Boolean(objectResponsePath) === Boolean(latestLockedLedgerSha256)) {
        throw new Error(
            'Choose exactly one reviewed cache mode: --object-response or --latest-locked-ledger-sha256.',
        );
    }
    return {
        cachePath: values.get('--cache'),
        objectResponsePath,
        latestLockedLedgerSha256,
    };
}

async function readJson(filePath, description) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`${description} could not be read as JSON: ${error.message}`, { cause: error });
    }
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const cacheText = await readFile(args.cachePath, 'utf8');
    const summary = args.objectResponsePath
        ? validateReviewedCoordinateCacheObject({
            cacheText,
            objectResponse: await readJson(args.objectResponsePath, 'The S3 cache object response'),
        })
        : summarizeCoordinateCache({
            cacheText,
            latestLockedLedgerSha256: args.latestLockedLedgerSha256,
        });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
