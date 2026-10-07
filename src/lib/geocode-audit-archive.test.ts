import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveGeocodeAudit } from '../../scripts/archive-geocode-audit.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => (
        rm(directory, { recursive: true, force: true })
    )));
});

function validLedgerLine() {
    return JSON.stringify({
        schemaVersion: 'move-with-musto.google-geocode-audit.v1',
        eventType: 'run_completed',
        occurredAt: '2026-07-13T12:00:00.000Z',
        provider: 'google_geocoding',
        runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        dataPersisted: true,
        outcome: 'completed',
    });
}

describe('geocode audit archiving', () => {
    it('archives a redacted ledger without loading listing data or the enrichment CLI', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'geocode-audit-standalone-'));
        temporaryDirectories.push(directory);
        const scriptDirectory = path.join(directory, 'scripts');
        await mkdir(path.join(scriptDirectory, 'geocode'), { recursive: true });
        for (const relativePath of ['archive-geocode-audit.mjs', 'geocode/audit-events.mjs']) {
            await copyFile(
                path.resolve('scripts', relativePath),
                path.join(scriptDirectory, relativePath),
            );
        }
        const ledgerPath = path.join(directory, 'requests.jsonl');
        const ledger = `${validLedgerLine()}\n`;
        await writeFile(ledgerPath, ledger, 'utf8');
        const { stdout } = await promisify(execFile)(process.execPath, [
            path.join(scriptDirectory, 'archive-geocode-audit.mjs'),
            '--ledger', ledgerPath,
            '--archive-directory', path.join(directory, 'archive'),
            '--timestamp', '20260713T120003Z',
        ], { cwd: directory, windowsHide: true });
        const result = JSON.parse(stdout);
        expect(result.records).toBe(1);
        expect(await readFile(result.archivePath, 'utf8')).toBe(ledger);
        expect(await readFile(result.checksumPath, 'utf8')).toContain(
            createHash('sha256').update(ledger).digest('hex'),
        );
    });

    it('validates the redacted ledger and writes a checksummed immutable snapshot pair', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'geocode-audit-archive-'));
        temporaryDirectories.push(directory);
        const ledgerPath = path.join(directory, 'requests.jsonl');
        const archiveDirectory = path.join(directory, 'archive');
        const ledger = `${validLedgerLine()}\n`;
        await writeFile(ledgerPath, ledger, 'utf8');

        const result = await archiveGeocodeAudit({
            ledgerPath,
            archiveDirectory,
            timestamp: '20260713T120000Z',
        });

        const expectedHash = createHash('sha256').update(ledger).digest('hex');
        expect(result).toMatchObject({ records: 1, sha256: expectedHash });
        expect(await readFile(result.archivePath, 'utf8')).toBe(ledger);
        expect(await readFile(result.checksumPath, 'utf8')).toBe(
            `${expectedHash}  google-geocoding-requests-20260713T120000Z.jsonl\n`,
        );
        await expect(archiveGeocodeAudit({
            ledgerPath,
            archiveDirectory,
            timestamp: '20260713T120000Z',
        })).rejects.toThrow();
    });

    it('refuses to archive a ledger containing Google result data', async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'geocode-audit-invalid-'));
        temporaryDirectories.push(directory);
        const ledgerPath = path.join(directory, 'requests.jsonl');
        await writeFile(ledgerPath, `${JSON.stringify({
            ...JSON.parse(validLedgerLine()),
            lat: 42.5,
        })}\n`, 'utf8');

        await expect(archiveGeocodeAudit({
            ledgerPath,
            archiveDirectory: path.join(directory, 'archive'),
            timestamp: '20260713T120001Z',
        })).rejects.toThrow(/(?:forbidden|unsupported) field lat/i);
    });

    it.each([
        ['outcome', 'completed-api-key-or-address'],
        ['failureCode', 'AIzaSySecretValue'],
        ['providerStatus', '86 MOUNT VERNON STREET'],
        ['requestReason', 'raw error response'],
        ['requestHost', 'secret.example.test'],
    ])('rejects arbitrary text hidden in the allowed %s field', async (field, value) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'geocode-audit-tampered-'));
        temporaryDirectories.push(directory);
        const ledgerPath = path.join(directory, 'requests.jsonl');
        await writeFile(ledgerPath, `${JSON.stringify({
            ...JSON.parse(validLedgerLine()),
            [field]: value,
        })}\n`, 'utf8');

        await expect(archiveGeocodeAudit({
            ledgerPath,
            archiveDirectory: path.join(directory, 'archive'),
            timestamp: '20260713T120002Z',
        })).rejects.toThrow(new RegExp(`invalid ${field}`, 'i'));
    });
});
