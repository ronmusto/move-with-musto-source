#!/usr/bin/env node
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    buildMlsSearchDelivery,
    buildMlsCoordinateIndex,
    listingIsMassachusetts,
    listingMatchesPreferredServiceArea,
    MLS_COORDINATE_INDEX_FILE,
    MLS_SEARCH_MANIFEST_FILE,
    MLS_SEARCH_SHARD_FILES,
    serializeMlsJson,
    validateComplianceConfig,
} from './mls-pin-cleaner-lib.mjs';
import { validateMlsPublicationDirectory } from './mls-publication-lib.mjs';

function withoutMapPosition(listing) {
    const { mapPosition: _mapPosition, ...coordinateFreeListing } = listing;
    return coordinateFreeListing;
}

export async function writeMlsSearchDelivery(directory, now = Date.now()) {
    const index = JSON.parse(await readFile(path.join(directory, 'mls-search-index.json'), 'utf8'));
    const fullDelivery = buildMlsSearchDelivery(index, now);
    const coordinateIndex = buildMlsCoordinateIndex(index, now);
    const preferredRecord = fullDelivery.shardRecords.find((shard) => shard.id === 'preferred');
    const otherRecord = fullDelivery.shardRecords.find((shard) => shard.id === 'other');
    if (!preferredRecord || !otherRecord || otherRecord.value.listings.length > 0) {
        throw new Error('Public MLS search delivery can contain only canonical service-area listings.');
    }
    const delivery = {
        ...fullDelivery,
        coordinateIndex,
        manifest: {
            ...fullDelivery.manifest,
            coordinateIndex: {
                file: MLS_COORDINATE_INDEX_FILE,
                coordinateCount: Object.keys(coordinateIndex.coordinates).length,
            },
            shards: fullDelivery.manifest.shards.filter((shard) => shard.id === 'preferred'),
        },
        shardRecords: [preferredRecord],
    };

    await writeFile(
        path.join(directory, 'mls-search-index.json'),
        serializeMlsJson({
            ...index,
            listings: index.listings.map(withoutMapPosition),
        }),
        'utf8',
    );
    await writeFile(
        path.join(directory, MLS_SEARCH_MANIFEST_FILE),
        serializeMlsJson(delivery.manifest),
        'utf8',
    );
    for (const shard of delivery.shardRecords) {
        await writeFile(path.join(directory, shard.fileName), serializeMlsJson(shard.value), 'utf8');
    }
    await rm(path.join(directory, MLS_SEARCH_SHARD_FILES.other), { force: true });
    await writeFile(
        path.join(directory, MLS_COORDINATE_INDEX_FILE),
        serializeMlsJson(coordinateIndex),
        'utf8',
    );

    return delivery;
}

/**
 * @param {string} sourceDirectory
 * @param {string} destinationDirectory
 * @param {{ compliance?: Record<string, string>, now?: number }} [options]
 */
export async function createServiceAreaPublication(
    sourceDirectory,
    destinationDirectory,
    { compliance, now = Date.now() } = {},
) {
    const sourceIndex = JSON.parse(
        await readFile(path.join(sourceDirectory, 'mls-search-index.json'), 'utf8'),
    );
    const publicationCompliance = validateComplianceConfig(compliance ?? sourceIndex.compliance);
    const massachusettsListings = sourceIndex.listings.filter(listingIsMassachusetts);
    const serviceListings = massachusettsListings.filter(listingMatchesPreferredServiceArea);
    if (serviceListings.length === 0) {
        throw new Error('Reviewed MLS source contains no canonical service-area listings to publish.');
    }

    await rm(destinationDirectory, { recursive: true, force: true });
    const destinationListingsDirectory = path.join(destinationDirectory, 'listings');
    await mkdir(destinationListingsDirectory, { recursive: true });

    const serviceIndex = {
        ...sourceIndex,
        compliance: publicationCompliance,
        listings: serviceListings,
    };
    await writeFile(
        path.join(destinationDirectory, 'mls-search-index.json'),
        serializeMlsJson(serviceIndex),
        'utf8',
    );

    const sourceListingsDirectory = path.join(sourceDirectory, 'listings');
    const copyBatchSize = 128;
    for (let offset = 0; offset < serviceListings.length; offset += copyBatchSize) {
        await Promise.all(serviceListings.slice(offset, offset + copyBatchSize).map(async (listing) => {
            const detailFileName = `${encodeURIComponent(listing.listingNumber.trim())}.json`;
            const detail = JSON.parse(await readFile(
                path.join(sourceListingsDirectory, detailFileName),
                'utf8',
            ));
            await writeFile(
                path.join(destinationListingsDirectory, detailFileName),
                serializeMlsJson(withoutMapPosition(detail)),
                'utf8',
            );
        }));
    }

    const delivery = await writeMlsSearchDelivery(destinationDirectory, now);
    return {
        sourceListingCount: sourceIndex.listings.length,
        massachusettsListingCount: massachusettsListings.length,
        excludedOutsideMassachusetts: sourceIndex.listings.length - massachusettsListings.length,
        listingCount: serviceListings.length,
        coordinateCount: Object.keys(delivery.coordinateIndex.coordinates).length,
    };
}

export async function main() {
    const reviewedDirectory = path.resolve('.mls-publish', 'public');
    const publicDirectory = path.resolve('public', 'mls');
    const staticExportRoot = path.resolve('out');
    const staticExportDirectory = path.join(staticExportRoot, 'mls');
    const stagingParent = path.resolve('.mls-publish');
    const complianceConfigPath = path.resolve('mls-compliance.config.json');
    await mkdir(stagingParent, { recursive: true });
    const stagingDirectory = await mkdtemp(path.join(stagingParent, 'service-publication-'));

    try {
        const complianceConfigDocument = JSON.parse(await readFile(complianceConfigPath, 'utf8'));
        const compliance = validateComplianceConfig(
            complianceConfigDocument?.mlsPin ?? complianceConfigDocument,
        );
        const result = await createServiceAreaPublication(
            reviewedDirectory,
            stagingDirectory,
            { compliance },
        );
        await validateMlsPublicationDirectory(stagingDirectory, { mode: 'live' });
        await rm(publicDirectory, { recursive: true, force: true });
        await cp(stagingDirectory, publicDirectory, { recursive: true });
        await validateMlsPublicationDirectory(publicDirectory, { mode: 'live' });

        let updatedStaticExport = false;
        let hasStaticExport = false;
        try {
            await access(staticExportRoot);
            hasStaticExport = true;
        } catch (error) {
            if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
                throw error;
            }
        }
        if (hasStaticExport) {
            await rm(staticExportDirectory, { recursive: true, force: true });
            await cp(stagingDirectory, staticExportDirectory, { recursive: true });
            await validateMlsPublicationDirectory(staticExportDirectory, { mode: 'live' });
            updatedStaticExport = true;
        }

        console.log(
            `Published ${result.listingCount} of ${result.sourceListingCount} reviewed MLS listings ` +
            `(${result.coordinateCount} mapped) in Mai Ly's canonical service area to ${publicDirectory}` +
            `${updatedStaticExport ? ` and ${staticExportDirectory}` : ''}.`,
        );
        console.log(
            `Release gate excluded ${result.excludedOutsideMassachusetts} non-Massachusetts reviewed listings; ` +
            `${result.massachusettsListingCount} Massachusetts listings remained before service-area filtering.`,
        );
    } finally {
        await rm(stagingDirectory, { recursive: true, force: true });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
