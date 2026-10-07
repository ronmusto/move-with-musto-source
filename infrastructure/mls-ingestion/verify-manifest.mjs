#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, utimes } from 'node:fs/promises';
import path from 'node:path';

function fail(message) {
    throw new Error(`Source manifest verification failed: ${message}`);
}

const [manifestPath, sourceDirectory] = process.argv.slice(2);
if (!manifestPath || !sourceDirectory) {
    fail('usage: node verify-manifest.mjs <manifest.json> <source-directory>');
}

const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (manifest.schemaVersion !== 'move-with-musto.mls-source-manifest.v1') {
    fail('unsupported schema version');
}
if (!Array.isArray(manifest.sourcePackage?.files) || manifest.sourcePackage.files.length === 0) {
    fail('file inventory is empty');
}

const expectedNames = new Set(manifest.sourcePackage.files.map((file) => file.name));
const actualNames = new Set((await readdir(sourceDirectory)).filter((name) => name.endsWith('.txt')));
for (const name of expectedNames) {
    if (!actualNames.has(name)) {
        fail(`${name} is missing`);
    }
}
for (const name of actualNames) {
    if (!expectedNames.has(name) && !['areas.txt', 'counties.txt', 'field_reference.txt', 'towns.txt'].includes(name)) {
        fail(`${name} was not declared in the signed package`);
    }
}

for (const file of manifest.sourcePackage.files) {
    const filePath = path.join(sourceDirectory, file.name);
    const metadata = await stat(filePath);
    if (metadata.size !== file.size) {
        fail(`${file.name} has the wrong size`);
    }
    const bytes = await readFile(filePath);
    const digest = createHash('sha256').update(bytes).digest();
    if (digest.toString('hex') !== file.sha256 || digest.toString('base64') !== file.checksumSha256) {
        fail(`${file.name} has the wrong SHA-256 checksum`);
    }
    const modifiedAt = new Date(file.sourceModifiedAt);
    if (Number.isNaN(modifiedAt.getTime()) || modifiedAt.getTime() > Date.now() + (5 * 60 * 1000)) {
        fail(`${file.name} has an invalid original modified time`);
    }
    // S3 download time is not MLS source time. Restore the signed browser
    // timestamp so the existing three-day publication gate evaluates the
    // export itself instead of when CodeBuild happened to download it.
    await utimes(filePath, modifiedAt, modifiedAt);
}

console.log(`Verified ${expectedNames.size} files against signed source manifest ${manifest.runId}.`);
