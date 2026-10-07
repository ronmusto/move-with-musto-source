#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const rootDir = path.join(fileURLToPath(new URL('.', import.meta.url)), '..');

const deliverySets = [
    {
        source: 'public/images/brand/general/dream-seekers-realty-logo.jpg',
        widths: [96, 192],
    },
    {
        source: 'public/images/brand/general/equal-housing-opportunity-logo-1200w.png',
        widths: [96, 192],
    },
    {
        source: 'public/images/brand/realtor/realtor-logo-blue.jpg',
        widths: [62, 96, 124, 192],
    },
];

function outputPathFor(sourcePath, width) {
    const extension = path.extname(sourcePath);
    return `${sourcePath.slice(0, -extension.length)}-${width}w.png`;
}

for (const deliverySet of deliverySets) {
    const sourcePath = path.join(rootDir, deliverySet.source);
    const sourceMetadata = await sharp(sourcePath).metadata();

    if (!sourceMetadata.width || !sourceMetadata.height) {
        throw new Error(`Could not read dimensions for ${deliverySet.source}.`);
    }

    for (const width of deliverySet.widths) {
        const outputPath = outputPathFor(sourcePath, width);
        await mkdir(path.dirname(outputPath), { recursive: true });

        await sharp(sourcePath)
            .resize({
                width,
                fit: 'inside',
                kernel: sharp.kernel.lanczos3,
                withoutEnlargement: true,
            })
            .png({
                compressionLevel: 9,
                palette: false,
            })
            .toFile(outputPath);

        const outputMetadata = await sharp(outputPath).metadata();
        if (!outputMetadata.width || !outputMetadata.height || outputMetadata.width !== width) {
            throw new Error(`Unexpected dimensions for ${path.relative(rootDir, outputPath)}.`);
        }

        const sourceRatio = sourceMetadata.width / sourceMetadata.height;
        const outputRatio = outputMetadata.width / outputMetadata.height;
        const onePixelRatioTolerance = 1 / outputMetadata.height;
        if (Math.abs(sourceRatio - outputRatio) > onePixelRatioTolerance) {
            throw new Error(`Aspect ratio changed for ${path.relative(rootDir, outputPath)}.`);
        }

        console.log(path.relative(rootDir, outputPath));
    }
}
