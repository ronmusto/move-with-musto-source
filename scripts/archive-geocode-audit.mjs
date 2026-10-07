#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseGeocodeAuditLedger } from './geocode/audit-events.mjs';

const defaultLedgerPath = '.mls-geocode-audit/google-geocoding-requests.jsonl';
const defaultArchiveDirectory = '.mls-geocode-audit/archive';

function compactUtcTimestamp(date = new Date()) {
    if (!Number.isFinite(date.getTime())) {
        throw new Error('The audit archive timestamp is invalid.');
    }
    return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function parseArgs(argv) {
    const args = {
        ledgerPath: defaultLedgerPath,
        archiveDirectory: defaultArchiveDirectory,
        timestamp: null,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];
        if (arg === '--ledger' && next) {
            args.ledgerPath = next;
            index += 1;
        } else if (arg === '--archive-directory' && next) {
            args.archiveDirectory = next;
            index += 1;
        } else if (arg === '--timestamp' && next) {
            args.timestamp = next;
            index += 1;
        } else {
            throw new Error(`Unknown or incomplete argument: ${arg}`);
        }
    }
    return args;
}

export async function archiveGeocodeAudit({
    ledgerPath = defaultLedgerPath,
    archiveDirectory = defaultArchiveDirectory,
    timestamp = compactUtcTimestamp(),
} = {}) {
    const effectiveTimestamp = timestamp ?? compactUtcTimestamp();
    if (!/^\d{8}T\d{6}Z$/u.test(effectiveTimestamp)) {
        throw new Error('The audit archive timestamp must use YYYYMMDDTHHMMSSZ.');
    }

    const sourcePath = path.resolve(ledgerPath);
    const destinationDirectory = path.resolve(archiveDirectory);
    const archiveName = `google-geocoding-requests-${effectiveTimestamp}.jsonl`;
    const archivePath = path.join(destinationDirectory, archiveName);
    const checksumPath = archivePath.replace(/\.jsonl$/u, '.sha256');
    const ledger = await readFile(sourcePath);
    const events = parseGeocodeAuditLedger(ledger.toString('utf8'));
    if (events.length === 0) {
        throw new Error('The geocode audit ledger is empty.');
    }

    const sha256 = createHash('sha256').update(ledger).digest('hex');
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(archivePath, ledger, { flag: 'wx' });
    try {
        await writeFile(checksumPath, `${sha256}  ${archiveName}\n`, { flag: 'wx' });
    } catch (error) {
        // The immutable source ledger remains untouched. Surface the incomplete
        // snapshot so an operator can inspect it before retrying.
        throw new Error(`Audit snapshot was written but its checksum was not: ${error.message}`, { cause: error });
    }

    return {
        archivePath,
        checksumPath,
        sha256,
        records: events.length,
        bytes: ledger.length,
    };
}

export async function main() {
    const result = await archiveGeocodeAudit(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
