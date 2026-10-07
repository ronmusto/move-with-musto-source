#!/usr/bin/env node
import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateMlsPublicationDirectory } from './mls-publication-lib.mjs';

const PUBLICATION_MODES = new Set(['import-pending', 'live']);

function usage() {
    return [
        'Usage: node scripts/check-mls-publication.mjs --mode=import-pending|live',
        '',
        'Modes:',
        '  import-pending  Allows a missing public/mls directory and validates it when present.',
        '  live            Requires public/mls and validates publication plus sales source freshness.',
    ].join('\n');
}

export function parseArgs(argv) {
    const args = {
        mode: '',
        publicDirectory: path.resolve('public', 'mls'),
    };

    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--help' || arg === '-h') {
            args.help = true;
        } else if (arg.startsWith('--mode=')) {
            args.mode = arg.slice('--mode='.length);
        } else if (arg === '--mode' && next) {
            args.mode = next;
            index += 1;
        } else if (arg.startsWith('--public-dir=')) {
            args.publicDirectory = path.resolve(arg.slice('--public-dir='.length));
        } else if (arg === '--public-dir' && next) {
            args.publicDirectory = path.resolve(next);
            index += 1;
        } else {
            throw new Error(`Unknown MLS publication check argument: ${arg}\n\n${usage()}`);
        }
    }

    if (args.help) {
        return args;
    }

    if (!PUBLICATION_MODES.has(args.mode)) {
        throw new Error(`${usage()}\n\nPass an explicit --mode value.`);
    }

    return args;
}

function isMissingPathError(error) {
    return error && typeof error === 'object' && error.code === 'ENOENT';
}

export async function checkMlsPublication({
    mode,
    publicDirectory = path.resolve('public', 'mls'),
    now = Date.now(),
}) {
    if (!PUBLICATION_MODES.has(mode)) {
        throw new Error('MLS publication check mode must be import-pending or live.');
    }

    try {
        await access(publicDirectory);
    } catch (error) {
        if (!isMissingPathError(error)) {
            throw error;
        }

        if (mode === 'import-pending') {
            return {
                status: 'import-pending',
                publicDirectory,
            };
        }

        throw new Error(
            [
                'MLS live publication check failed: public/mls is missing.',
                'Run npm run mls:clean, review .mls-publish/review, then run npm run mls:publish before a live build.',
            ].join(' '),
            { cause: error },
        );
    }

    const result = await validateMlsPublicationDirectory(publicDirectory, { mode, now });
    return {
        status: 'published',
        publicDirectory,
        ...result,
    };
}

export async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log(usage());
        return;
    }

    const result = await checkMlsPublication(args);
    if (result.status === 'import-pending') {
        console.log(
            'MLS publication check (import-pending) passed: no public/mls directory; the site will use its maintenance state.',
        );
        return;
    }

    console.log(
        `MLS publication check (${args.mode}) passed for ${result.listingCount} listings generated ${result.generatedAt}.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
