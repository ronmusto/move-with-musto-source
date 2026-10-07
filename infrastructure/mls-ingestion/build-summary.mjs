#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [reportPath, manifestPath, destinationPath, commercialManifestPath] = process.argv.slice(2);
if (!reportPath || !manifestPath || !destinationPath) {
    throw new Error('usage: node build-summary.mjs <private-report> <public-manifest> <destination>');
}

const [report, manifest] = await Promise.all([
    readFile(reportPath, 'utf8').then(JSON.parse),
    readFile(manifestPath, 'utf8').then(JSON.parse),
]);
const commercialManifest = commercialManifestPath
    ? await readFile(commercialManifestPath, 'utf8').then(JSON.parse)
    : null;
const serviceAreaListings = Number(manifest.totalListingCount ?? 0);
const mappedListings = Number(manifest.coordinateIndex?.coordinateCount ?? 0);
if (!Number.isSafeInteger(serviceAreaListings) || serviceAreaListings <= 0
    || !Number.isSafeInteger(mappedListings) || mappedListings < 0
    || mappedListings > serviceAreaListings) {
    throw new Error('The publication manifest has invalid listing or coordinate totals.');
}

const summary = {
    schemaVersion: 'move-with-musto.mls-portal-summary.v1',
    generatedAt: String(manifest.generatedAt ?? report.generatedAt ?? ''),
    sourceLatestModifiedAt: String(report.sourceSnapshot?.latestSalesFileModifiedAt ?? ''),
    serviceAreaListings,
    mappedListings,
    awaitingCoordinates: serviceAreaListings - mappedListings,
    quarantinedListings: Number(report.totalQuarantined ?? 0),
    remarksSuppressed: Number(report.totalRemarksSuppressed ?? 0),
    outsideMassachusettsExcluded: Number(report.totalExcludedOutsideMassachusetts ?? 0),
    stateReferenceMismatches: Number(report.totalStateReferenceMismatches ?? 0),
    optOutOffices: Number(report.optOutOfficeCount ?? 0),
    includesCommercial: Boolean(commercialManifest),
};

if (process.env.MAX_GEOCODE_REQUESTS_PER_RUN === '-1') {
    summary.geocodeBatch = JSON.parse(await readFile(path.join(path.dirname(reportPath), 'geocode-batch.json'), 'utf8'));
}

if (commercialManifest) {
    const commercialListings = Number(commercialManifest.totalListingCount);
    if (
        commercialManifest.schemaVersion !== 2
        || !Number.isSafeInteger(commercialListings)
        || commercialListings < 0
        || commercialManifest.index?.listingCount !== commercialListings
    ) {
        throw new Error('The commercial publication manifest has invalid listing totals.');
    }
    summary.commercialListings = commercialListings;
    summary.commercialCategories = commercialManifest.facets?.categories ?? {};
}

await writeFile(destinationPath, `${JSON.stringify(summary)}\n`, 'utf8');
console.log(`Prepared metadata-only portal summary for ${serviceAreaListings} service-area listings.`);
