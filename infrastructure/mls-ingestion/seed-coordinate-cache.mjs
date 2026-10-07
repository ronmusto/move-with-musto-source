#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { coordinateIsInMassachusetts } from '../../scripts/massachusetts-coordinate-guard.mjs';
import preferredServiceAreaTownList from '../../src/lib/preferred-service-area-towns.json' with { type: 'json' };

export const CACHE_SCHEMA_VERSION = 'move-with-musto.google-geocode-cache.v1';
export const SEED_SUMMARY_SCHEMA_VERSION = 'move-with-musto.coordinate-cache-seed.v1';
export const DESTINATION_KEY = 'cache/google-geocoding-cache.json';
export const MAX_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const sha256Pattern = /^[a-f0-9]{64}$/u;
const preferredServiceAreaTowns = new Set(
    preferredServiceAreaTownList.map((town) => normalizeAddressPart(town).toUpperCase()),
);
const cacheEntryFields = [
    'listingNumber',
    'address',
    'addressKey',
    'lat',
    'lng',
    'precision',
    'validation',
    'validatedState',
    'validatedPostalCode',
    'geocodedAt',
    'expiresAt',
    'rotationDueAt',
    'lastRefreshAttemptAt',
];

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAddressPart(value) {
    return String(value ?? '').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}

function listingAddressKey(listing) {
    return [
        listing?.address?.line,
        listing?.address?.town,
        listing?.address?.state,
        listing?.address?.zip,
    ].map(normalizeAddressPart).join('|');
}

export function listingCacheKey(listing) {
    return `${normalizeAddressPart(listing?.listingNumber)}|${listingAddressKey(listing)}`;
}

function parseTimestamp(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function assertSeedInputs(cache, preferredIndex, latestLockedLedgerSha256, now) {
    if (!Number.isFinite(now)) {
        throw new Error('The coordinate-cache seed clock is invalid.');
    }
    if (!sha256Pattern.test(String(latestLockedLedgerSha256 ?? '').toLowerCase())) {
        throw new Error('The latest locked-ledger SHA-256 must be exactly 64 hexadecimal characters.');
    }
    if (!isRecord(cache) || cache.schemaVersion !== CACHE_SCHEMA_VERSION) {
        throw new Error(`The local coordinate cache must use ${CACHE_SCHEMA_VERSION}.`);
    }
    if (cache.provider !== 'google_geocoding' || cache.cacheTtlDays !== 30 || !isRecord(cache.entries)) {
        throw new Error('The local coordinate cache has invalid provider, TTL, or entries metadata.');
    }
    const cacheUpdatedAt = parseTimestamp(cache.updatedAt);
    if (cacheUpdatedAt === null || cacheUpdatedAt > now + (5 * 60 * 1000)) {
        throw new Error('The local coordinate cache has an invalid updatedAt timestamp.');
    }
    if (
        !isRecord(preferredIndex) ||
        preferredIndex.schemaVersion !== 1 ||
        preferredIndex.id !== 'preferred' ||
        !Array.isArray(preferredIndex.listings)
    ) {
        throw new Error('The service-area listing source must be the preferred MLS search index.');
    }
    const generatedAt = parseTimestamp(preferredIndex.generatedAt);
    if (generatedAt === null || generatedAt > now + (5 * 60 * 1000)) {
        throw new Error('The preferred MLS search index has an invalid generatedAt timestamp.');
    }
}

function currentServiceAreaListings(preferredIndex) {
    const byKey = new Map();
    for (const listing of preferredIndex.listings) {
        const state = normalizeAddressPart(listing?.address?.state).toUpperCase();
        const town = normalizeAddressPart(listing?.address?.town).toUpperCase();
        if (!isRecord(listing) || state !== 'MA') {
            throw new Error('The preferred MLS search index contains a non-Massachusetts or invalid listing.');
        }
        if (!preferredServiceAreaTowns.has(town)) {
            throw new Error(`The preferred MLS search index contains non-service-area town ${town || '(missing)'}.`);
        }
        const addressParts = ['line', 'town', 'state', 'zip']
            .map((field) => normalizeAddressPart(listing?.address?.[field]));
        const cacheKey = listingCacheKey(listing);
        if (!normalizeAddressPart(listing.listingNumber) || addressParts.some((part) => !part)) {
            throw new Error('A preferred MLS listing is missing its listing number or exact address.');
        }
        if (byKey.has(cacheKey)) {
            throw new Error(`The preferred MLS search index contains duplicate exact listing key ${cacheKey}.`);
        }
        byKey.set(cacheKey, listing);
    }
    return byKey;
}

function validSeedEntry(cacheKey, entry, listing, now) {
    if (!isRecord(entry)) {
        return false;
    }
    if (listingCacheKey(listing) !== cacheKey) {
        return false;
    }
    if (normalizeAddressPart(entry.listingNumber) !== normalizeAddressPart(listing.listingNumber)) {
        return false;
    }
    if (normalizeAddressPart(entry.addressKey) !== normalizeAddressPart(listingAddressKey(listing))) {
        return false;
    }
    if (
        typeof entry.address !== 'string' ||
        typeof entry.precision !== 'string' ||
        (Object.hasOwn(entry, 'validation') && typeof entry.validation !== 'string') ||
        (Object.hasOwn(entry, 'validatedState') && entry.validatedState !== 'MA') ||
        (
            Object.hasOwn(entry, 'validatedPostalCode') &&
            !/^\d{5}(?:-\d{4})?$/u.test(String(entry.validatedPostalCode))
        )
    ) {
        return false;
    }
    if (!Number.isFinite(entry.lat) || !Number.isFinite(entry.lng) || !coordinateIsInMassachusetts(entry)) {
        return false;
    }

    const geocodedAt = parseTimestamp(entry.geocodedAt);
    const expiresAt = parseTimestamp(entry.expiresAt);
    if (
        geocodedAt === null ||
        expiresAt === null ||
        geocodedAt > now ||
        expiresAt <= now ||
        expiresAt - geocodedAt <= 0 ||
        expiresAt - geocodedAt > MAX_CACHE_TTL_MS
    ) {
        return false;
    }

    if (Object.hasOwn(entry, 'rotationDueAt')) {
        const rotationDueAt = parseTimestamp(entry.rotationDueAt);
        if (rotationDueAt === null || rotationDueAt < geocodedAt || rotationDueAt > expiresAt) {
            return false;
        }
    }
    if (Object.hasOwn(entry, 'lastRefreshAttemptAt')) {
        const lastRefreshAttemptAt = parseTimestamp(entry.lastRefreshAttemptAt);
        if (lastRefreshAttemptAt === null || lastRefreshAttemptAt < geocodedAt || lastRefreshAttemptAt > now) {
            return false;
        }
    }

    return true;
}

function listingFromCacheEntry(entry) {
    const addressParts = normalizeAddressPart(entry?.addressKey).split('|');
    if (addressParts.length !== 4 || addressParts.some((part) => !part)) {
        return null;
    }
    const [line, town, state, zip] = addressParts;
    return {
        listingNumber: entry?.listingNumber,
        address: { line, town, state, zip },
    };
}

export function validateCoordinateCacheDocument(cache, now = Date.now()) {
    if (!Number.isFinite(now)) {
        throw new Error('The coordinate-cache validation clock is invalid.');
    }
    if (!isRecord(cache) || cache.schemaVersion !== CACHE_SCHEMA_VERSION) {
        throw new Error(`The reviewed coordinate cache must use ${CACHE_SCHEMA_VERSION}.`);
    }
    if (cache.provider !== 'google_geocoding' || cache.cacheTtlDays !== 30 || !isRecord(cache.entries)) {
        throw new Error('The reviewed coordinate cache has invalid provider, TTL, or entries metadata.');
    }
    const cacheUpdatedAt = parseTimestamp(cache.updatedAt);
    if (cacheUpdatedAt === null || cacheUpdatedAt > now + (5 * 60 * 1000)) {
        throw new Error('The reviewed coordinate cache has an invalid updatedAt timestamp.');
    }

    const entries = Object.entries(cache.entries);
    if (entries.length === 0) {
        throw new Error('The reviewed coordinate cache must contain at least one fresh service-area entry.');
    }

    const expirations = [];
    for (const [cacheKey, entry] of entries) {
        const sourceListing = listingFromCacheEntry(entry);
        const town = normalizeAddressPart(sourceListing?.address?.town).toUpperCase();
        const state = normalizeAddressPart(sourceListing?.address?.state).toUpperCase();
        if (
            !sourceListing ||
            state !== 'MA' ||
            !preferredServiceAreaTowns.has(town) ||
            !validSeedEntry(cacheKey, entry, sourceListing, now)
        ) {
            throw new Error(`The reviewed coordinate cache contains invalid entry ${cacheKey || '(missing key)'}.`);
        }
        expirations.push(parseTimestamp(entry.expiresAt));
    }

    return {
        entryCount: entries.length,
        earliestExpiresAt: new Date(Math.min(...expirations)).toISOString(),
        latestExpiresAt: new Date(Math.max(...expirations)).toISOString(),
        updatedAt: new Date(cacheUpdatedAt).toISOString(),
    };
}

function copySeedEntry(entry) {
    return Object.fromEntries(cacheEntryFields
        .filter((field) => Object.hasOwn(entry, field))
        .map((field) => [field, entry[field]]));
}

function sha256(text) {
    return createHash('sha256').update(text).digest('hex');
}

export function createCoordinateCacheSeedArtifact({
    cache,
    preferredIndex,
    latestLockedLedgerSha256,
    now = Date.now(),
}) {
    const ledgerSha256 = String(latestLockedLedgerSha256 ?? '').toLowerCase();
    assertSeedInputs(cache, preferredIndex, ledgerSha256, now);
    const serviceListings = currentServiceAreaListings(preferredIndex);
    const retainedEntries = {};

    for (const cacheKey of [...serviceListings.keys()].sort()) {
        const entry = cache.entries[cacheKey];
        const listing = serviceListings.get(cacheKey);
        if (validSeedEntry(cacheKey, entry, listing, now)) {
            retainedEntries[cacheKey] = copySeedEntry(entry);
        }
    }

    const retainedValues = Object.values(retainedEntries);
    if (retainedValues.length === 0) {
        throw new Error('No fresh, exact Massachusetts service-area coordinates are available to seed.');
    }

    const outputCache = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        provider: 'google_geocoding',
        cacheTtlDays: 30,
        updatedAt: new Date(parseTimestamp(cache.updatedAt)).toISOString(),
        entries: retainedEntries,
    };
    const text = `${JSON.stringify(outputCache, null, 2)}\n`;
    const expirations = retainedValues.map((entry) => parseTimestamp(entry.expiresAt));
    const summary = {
        schemaVersion: SEED_SUMMARY_SCHEMA_VERSION,
        destinationKey: DESTINATION_KEY,
        sourceEntryCount: Object.keys(cache.entries).length,
        serviceAreaListingCount: serviceListings.size,
        retainedEntryCount: retainedValues.length,
        excludedEntryCount: Object.keys(cache.entries).length - retainedValues.length,
        earliestExpiresAt: new Date(Math.min(...expirations)).toISOString(),
        latestExpiresAt: new Date(Math.max(...expirations)).toISOString(),
        latestLockedLedgerSha256: ledgerSha256,
        cacheSha256: sha256(text),
        preparedAt: new Date(now).toISOString(),
    };

    return { cache: outputCache, text, summary };
}

function parseArguments(argv) {
    const argumentsByName = new Map();
    for (let index = 0; index < argv.length; index += 2) {
        const name = argv[index];
        const value = argv[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid coordinate-cache seed argument ${name ?? ''}.`);
        }
        argumentsByName.set(name, value);
    }
    for (const required of ['--cache', '--listings', '--output', '--latest-locked-ledger-sha256']) {
        if (!argumentsByName.has(required)) {
            throw new Error(`Missing required coordinate-cache seed argument ${required}.`);
        }
    }
    return {
        cachePath: argumentsByName.get('--cache'),
        listingsPath: argumentsByName.get('--listings'),
        outputPath: argumentsByName.get('--output'),
        latestLockedLedgerSha256: argumentsByName.get('--latest-locked-ledger-sha256'),
    };
}

async function readJson(filePath, description) {
    try {
        return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`${description} could not be read as JSON: ${error.message}`, { cause: error });
    }
}

async function writeAtomic(filePath, text) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
        await writeFile(temporaryPath, text, { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, { force: true });
    }
}

async function main() {
    const args = parseArguments(process.argv.slice(2));
    const [cache, preferredIndex] = await Promise.all([
        readJson(args.cachePath, 'The local coordinate cache'),
        readJson(args.listingsPath, 'The preferred MLS search index'),
    ]);
    const artifact = createCoordinateCacheSeedArtifact({
        cache,
        preferredIndex,
        latestLockedLedgerSha256: args.latestLockedLedgerSha256,
    });
    await writeAtomic(path.resolve(args.outputPath), artifact.text);
    process.stdout.write(`${JSON.stringify(artifact.summary)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
