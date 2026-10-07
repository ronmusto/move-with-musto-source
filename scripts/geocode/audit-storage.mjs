// Persistence adapters for validated audit events. Imports perform no I/O.
import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    auditTimestamp,
    GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION,
    parseGeocodeAuditLedger,
    serializeGeocodeAuditEvent,
    uuidPattern,
} from './audit-events.mjs';

const execFileAsync = promisify(execFileCallback);

function sha256(value) {
    return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function validatedImmutableAuditBucket(value) {
    const bucket = String(value ?? '').trim();
    if (
        bucket.length < 3 ||
        bucket.length > 63 ||
        !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u.test(bucket) ||
        bucket.includes('..') ||
        /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(bucket)
    ) {
        throw new Error('The immutable geocode audit bucket name is invalid.');
    }
    return bucket;
}

function validatedImmutableAuditPrefix(value) {
    const prefix = String(value ?? '').trim();
    const segments = prefix.split('/');
    if (
        prefix.length > 512 ||
        !prefix.startsWith('geocoding/') ||
        prefix.endsWith('/') ||
        prefix.includes('\\') ||
        segments.some((segment) => (
            !segment ||
            segment === '.' ||
            segment === '..' ||
            !/^[A-Za-z0-9][A-Za-z0-9._=-]{0,127}$/u.test(segment)
        ))
    ) {
        throw new Error(
            'The immutable geocode audit prefix must be a canonical key below geocoding/.',
        );
    }
    return prefix;
}

async function runAwsCli(args) {
    const result = await execFileAsync('aws', args, {
        maxBuffer: 1024 * 1024,
        windowsHide: true,
    });
    return {
        stderr: String(result.stderr ?? ''),
        stdout: String(result.stdout ?? ''),
    };
}

function awsCliFailureText(error) {
    return [error?.message, error?.stderr, error?.stdout]
        .map((value) => String(value ?? ''))
        .filter(Boolean)
        .join('\n');
}

function isConditionalPutConflict(error) {
    return /(?:PreconditionFailed|precondition failed|status code:\s*412|\(412\))/iu
        .test(awsCliFailureText(error));
}

function immutableAuditObjectKey(prefix, event) {
    return [
        prefix,
        `${String(event.sequence).padStart(8, '0')}-${event.requestId}-${event.eventType}.json`,
    ].join('/');
}

/**
 * Mirrors each request lifecycle event into a unique Object-Locked S3 object.
 * The deterministic key and conditional write make retries idempotent without
 * ever replacing prior evidence. A request_started mirror must resolve before
 * its corresponding Google request is allowed to leave the process.
 *
 * @param {{
 *   bucket: string,
 *   commandRunner?: (args: string[]) => Promise<{stderr?: string, stdout?: string}>,
 *   prefix: string,
 *   sensitiveValues?: unknown[],
 *   temporaryDirectory?: string,
 * }} options
 */
export function createImmutableGeocodeAuditMirror({
    bucket,
    commandRunner = runAwsCli,
    prefix,
    sensitiveValues = [],
    temporaryDirectory = path.resolve('.mls-geocode-audit/immutable-events'),
} = {}) {
    const auditBucket = validatedImmutableAuditBucket(bucket);
    const auditPrefix = validatedImmutableAuditPrefix(prefix);
    if (typeof commandRunner !== 'function') {
        throw new Error('An immutable geocode audit command runner is required.');
    }

    return async function mirrorGeocodeAuditEvent(event) {
        if (!String(event?.eventType ?? '').startsWith('request_')) {
            return null;
        }

        const serializedEvent = serializeGeocodeAuditEvent(event, {
            context: 'immutable event',
            sensitiveValues,
        });
        const body = `${serializedEvent}\n`;
        const bodySha256 = sha256(body);
        const objectKey = immutableAuditObjectKey(auditPrefix, event);
        const temporaryPath = path.join(
            temporaryDirectory,
            `${event.requestId}-${event.eventType}-${randomUUID()}.json`,
        );
        const metadata = [
            `run-id=${event.runId}`,
            `request-id=${event.requestId}`,
            `event-type=${event.eventType}`,
            `sha256=${bodySha256}`,
            `schema=${GOOGLE_GEOCODE_AUDIT_SCHEMA_VERSION}`,
            'contains-google-results=false',
        ].join(',');

        await mkdir(temporaryDirectory, { recursive: true });
        await writeFile(temporaryPath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        try {
            try {
                await commandRunner([
                    's3api',
                    'put-object',
                    '--bucket', auditBucket,
                    '--key', objectKey,
                    '--body', temporaryPath,
                    '--content-type', 'application/json',
                    '--checksum-algorithm', 'SHA256',
                    '--metadata', metadata,
                    '--if-none-match', '*',
                    '--no-cli-pager',
                ]);
            } catch (error) {
                if (!isConditionalPutConflict(error)) {
                    throw new Error(
                        `Could not persist immutable geocode audit event ${event.eventType}.`,
                        { cause: error },
                    );
                }

                const headResult = await commandRunner([
                    's3api',
                    'head-object',
                    '--bucket', auditBucket,
                    '--key', objectKey,
                    '--output', 'json',
                    '--no-cli-pager',
                ]);
                let existing;
                try {
                    existing = JSON.parse(String(headResult?.stdout ?? ''));
                } catch (headError) {
                    throw new Error(
                        'The existing immutable geocode audit object could not be verified.',
                        { cause: headError },
                    );
                }
                if (
                    existing?.Metadata?.sha256 !== bodySha256 ||
                    Number(existing?.ContentLength) !== Buffer.byteLength(body)
                ) {
                    throw new Error(
                        'The immutable geocode audit key already exists with different evidence.',
                        { cause: error },
                    );
                }
            }
        } finally {
            await unlink(temporaryPath).catch((error) => {
                if (error?.code !== 'ENOENT') {
                    throw error;
                }
            });
        }

        return { bucket: auditBucket, key: objectKey, sha256: bodySha256 };
    };
}

/**
 * Returns a single-process, append-only JSONL writer. Every append is synced to
 * durable storage before its promise resolves; callers can therefore await a
 * request_started event before allowing the corresponding network call.
 *
 * @param {string} filePath
 * @param {{
 *   mirrorEvent?: ((event: Record<string, unknown>) => Promise<unknown>) | null,
 *   sensitiveValues?: unknown[],
 * }} options
 */
export function createGeocodeAuditWriter(filePath, {
    mirrorEvent = null,
    sensitiveValues = [],
} = {}) {
    const auditPath = String(filePath ?? '').trim();
    if (!auditPath) {
        throw new Error('A geocode audit log path is required.');
    }

    let writeChain = Promise.resolve();
    let ledgerValidated = false;
    if (mirrorEvent !== null && typeof mirrorEvent !== 'function') {
        throw new Error('The geocode audit mirror must be a function.');
    }

    return function appendGeocodeAuditEvent(event) {
        const pendingWrite = writeChain.then(async () => {
            await mkdir(path.dirname(auditPath), { recursive: true });
            if (!ledgerValidated) {
                let existingText = '';
                try {
                    existingText = await readFile(auditPath, 'utf8');
                } catch (error) {
                    if (error?.code !== 'ENOENT') {
                        throw error;
                    }
                }
                if (existingText && !existingText.endsWith('\n')) {
                    throw new Error(
                        'The geocode audit ledger ends with an incomplete JSONL record; refusing to append.',
                    );
                }
                parseGeocodeAuditLedger(existingText);
                ledgerValidated = true;
            }

            const serializedEvent = serializeGeocodeAuditEvent(event, { sensitiveValues });
            const handle = await open(auditPath, 'a+', 0o600);
            try {
                const { size } = await handle.stat();
                if (size > 0) {
                    const finalByte = Buffer.allocUnsafe(1);
                    await handle.read(finalByte, 0, 1, size - 1);
                    if (finalByte[0] !== 0x0a) {
                        throw new Error(
                            'The geocode audit ledger ends with an incomplete JSONL record; refusing to append.',
                        );
                    }
                }
                await handle.appendFile(`${serializedEvent}\n`, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }
            if (mirrorEvent && event.eventType.startsWith('request_')) {
                await mirrorEvent(event);
            }
        });

        // Keep later appends serialized even when a caller handles one failed
        // append and attempts to record or report another event.
        writeChain = pendingWrite.catch(() => undefined);
        return pendingWrite;
    };
}

export async function acquireGeocodeRunLock(filePath, {
    clock = Date.now,
    runId = randomUUID(),
} = {}) {
    const lockPath = String(filePath ?? '').trim();
    if (!lockPath) {
        throw new Error('A geocode run lock path is required.');
    }
    if (!uuidPattern.test(runId)) {
        throw new Error('The geocode run lock requires a UUID runId.');
    }

    await mkdir(path.dirname(lockPath), { recursive: true });
    let handle;
    try {
        handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify({
            schemaVersion: 1,
            runId,
            pid: process.pid,
            acquiredAt: auditTimestamp(clock),
        })}\n`, 'utf8');
        await handle.sync();
    } catch (error) {
        if (handle) {
            await handle.close().catch(() => undefined);
            await unlink(lockPath).catch(() => undefined);
        }
        if (error?.code === 'EEXIST') {
            throw new Error(
                `Another geocode or audit-recovery run holds ${lockPath}. ` +
                'If the prior process crashed, inspect the cache and ledger before removing the stale lock.',
                { cause: error },
            );
        }
        throw error;
    }

    let released = false;
    return async function releaseGeocodeRunLock() {
        if (released) {
            return;
        }
        released = true;
        await handle.close();
        await unlink(lockPath);
    };
}
