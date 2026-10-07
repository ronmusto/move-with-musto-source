import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { pruneCoordinateDocument } from './handlers/coordinate-retention.mjs';
import { summarizeCoordinateCache, validateReviewedCoordinateCacheObject } from './validate-coordinate-cache-seed.mjs';

// Apply only this build's changes. An unchanged entry removed by maintenance
// must never be resurrected, and another writer's newer coordinates must win.
export function mergeCoordinateCaches(base, local, current, now = Date.now()) {
    const entries = { ...current.entries };
    for (const [key, entry] of Object.entries(base.entries)) {
        if (!Object.hasOwn(local.entries, key) && isDeepStrictEqual(entries[key], entry)) delete entries[key];
    }
    for (const [key, entry] of Object.entries(local.entries)) {
        if (isDeepStrictEqual(entry, base.entries[key])) continue;
        const original = base.entries[key];
        const latest = entries[key];
        // Metadata-only rotation updates cannot undo a concurrent deletion.
        if (!latest && original && entry.geocodedAt === original.geocodedAt) continue;
        if (latest && !isDeepStrictEqual(latest, original) &&
            Date.parse(latest.geocodedAt) >= Date.parse(entry.geocodedAt)) continue;
        entries[key] = entry;
    }
    return pruneCoordinateDocument({ ...local, entries, updatedAt: new Date(now).toISOString() }, now).document;
}

export function isCacheWriteConflict(error) {
    return ['PreconditionFailed', 'ConditionalRequestConflict'].includes(error?.name) ||
        /\((?:PreconditionFailed|ConditionalRequestConflict)\)/u.test(String(error?.stderr ?? ''));
}

export async function persistCoordinateCache({ base, local, etag, ledgerSha256, store, now = Date.now, maxAttempts = 4 }) {
    const checkpointText = `${JSON.stringify(pruneCoordinateDocument(local, now()).document)}\n`;
    const checkpointSummary = summarizeCoordinateCache({ cacheText: checkpointText, latestLockedLedgerSha256: ledgerSha256, now: now() });
    // A complete recoverable checkpoint remains in the private, expiring
    // coordinate bucket even when every conditional shared-cache write fails.
    await store.checkpoint(checkpointText, checkpointSummary.metadata);
    let cacheText = checkpointText;
    let summary = checkpointSummary;
    let expectedEtag = etag;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await store.put(cacheText, summary.metadata, expectedEtag);
            return { attempts: attempt, entryCount: summary.entryCount, cacheSha256: summary.cacheSha256 };
        } catch (error) {
            if (!isCacheWriteConflict(error) || attempt === maxAttempts) throw error;
            const latest = await store.read();
            const reviewed = validateReviewedCoordinateCacheObject({ cacheText: latest.text, objectResponse: latest.response, now: now() });
            expectedEtag = reviewed.eTag;
            const merged = mergeCoordinateCaches(base, local, JSON.parse(latest.text), now());
            cacheText = `${JSON.stringify(merged)}\n`;
            summary = summarizeCoordinateCache({ cacheText, latestLockedLedgerSha256: ledgerSha256, now: now() });
        }
    }
    throw new Error('Coordinate cache write exhausted its retry budget.');
}

async function main() {
    const env = (name) => {
        if (!process.env[name]) throw new Error(`Missing ${name}.`);
        return process.env[name];
    };
    const cachePath = env('CACHE_FILE');
    const basePath = `${cachePath}.base`;
    const bucket = env('COORDINATE_CACHE_BUCKET_NAME');
    const runId = env('RUN_ID');
    const buildNumber = env('CODEBUILD_BUILD_NUMBER');
    if (!/^[\w-]+$/u.test(runId) || !/^\d+$/u.test(buildNumber)) throw new Error('Invalid cache checkpoint identity.');
    const ledgerSha256 = process.argv[2];
    const etag = (await readFile(env('CACHE_ETAG_FILE'), 'utf8')).trim();
    const aws = (args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '{}');
    const upload = async (key, text, metadata, condition) => {
        const uploadPath = `${cachePath}.upload`;
        await writeFile(uploadPath, text);
        return aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', uploadPath,
            '--content-type', 'application/json', '--checksum-algorithm', 'SHA256', '--metadata', JSON.stringify(metadata), ...condition]);
    };
    const result = await persistCoordinateCache({
        base: JSON.parse(await readFile(basePath, 'utf8')),
        local: JSON.parse(await readFile(cachePath, 'utf8')),
        etag, ledgerSha256,
        store: {
            checkpoint: (text, metadata) => upload(`runs/${runId}/cache-checkpoints/${buildNumber}.json`, text, metadata, ['--if-none-match', '*']),
            put: (text, metadata, expected) => upload('cache/google-geocoding-cache.json', text, metadata, ['--if-match', expected]),
            read: async () => {
                const latestPath = `${cachePath}.latest`;
                const response = aws(['s3api', 'get-object', '--bucket', bucket, '--key', 'cache/google-geocoding-cache.json', '--checksum-mode', 'ENABLED', latestPath]);
                return { text: await readFile(latestPath, 'utf8'), response };
            },
        },
    });
    console.log(`Private coordinate cache committed: ${JSON.stringify(result)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`COORDINATE_CACHE_PERSISTENCE_FAILED: ${error.message}`);
        process.exitCode = 1;
    });
}
