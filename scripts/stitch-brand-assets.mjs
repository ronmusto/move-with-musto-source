#!/usr/bin/env node
import {
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const publicDir = join(rootDir, 'public');
const imageRoot = join(publicDir, 'images', 'brand');
const outputPath = join(rootDir, 'src', 'lib', 'brand-assets.generated.ts');
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg', '.avif']);

function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...walk(fullPath));
            continue;
        }

        if (entry.isFile() && imageExtensions.has(extname(entry.name).toLowerCase())) {
            files.push(fullPath);
        }
    }

    return files;
}

function readPngDimensions(buffer) {
    if (
        buffer.length >= 24 &&
        buffer.toString('ascii', 1, 4) === 'PNG' &&
        buffer.toString('ascii', 12, 16) === 'IHDR'
    ) {
        return {
            width: buffer.readUInt32BE(16),
            height: buffer.readUInt32BE(20),
        };
    }

    return null;
}

function readJpegDimensions(buffer) {
    if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
    }

    let offset = 2;
    while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        const isStartOfFrame =
            marker >= 0xc0 &&
            marker <= 0xcf &&
            ![0xc4, 0xc8, 0xcc].includes(marker);

        if (isStartOfFrame) {
            return {
                height: buffer.readUInt16BE(offset + 5),
                width: buffer.readUInt16BE(offset + 7),
            };
        }

        offset += 2 + length;
    }

    return null;
}

function readWebpDimensions(buffer) {
    if (
        buffer.length < 30 ||
        buffer.toString('ascii', 0, 4) !== 'RIFF' ||
        buffer.toString('ascii', 8, 12) !== 'WEBP'
    ) {
        return null;
    }

    const chunkType = buffer.toString('ascii', 12, 16);
    if (chunkType === 'VP8X') {
        return {
            width: 1 + buffer.readUIntLE(24, 3),
            height: 1 + buffer.readUIntLE(27, 3),
        };
    }

    if (chunkType === 'VP8 ' && buffer.length >= 30) {
        return {
            width: buffer.readUInt16LE(26) & 0x3fff,
            height: buffer.readUInt16LE(28) & 0x3fff,
        };
    }

    if (chunkType === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return {
            width: (bits & 0x3fff) + 1,
            height: ((bits >> 14) & 0x3fff) + 1,
        };
    }

    return null;
}

function readSvgDimensions(buffer) {
    const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    const width = text.match(/\bwidth=["']?([0-9.]+)/i)?.[1];
    const height = text.match(/\bheight=["']?([0-9.]+)/i)?.[1];
    if (width && height) {
        return { width: Number(width), height: Number(height) };
    }

    const viewBox = text.match(/\bviewBox=["'][^"']*?([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)["']/i);
    if (viewBox) {
        return { width: Number(viewBox[3]), height: Number(viewBox[4]) };
    }

    return null;
}

function readDimensions(file, extension) {
    const buffer = readFileSync(file);
    if (extension === '.png') {
        return readPngDimensions(buffer);
    }

    if (extension === '.jpg' || extension === '.jpeg') {
        return readJpegDimensions(buffer);
    }

    if (extension === '.webp') {
        return readWebpDimensions(buffer);
    }

    if (extension === '.svg') {
        return readSvgDimensions(buffer);
    }

    return null;
}

function categoryFor(relativePath) {
    const firstFolder = relativePath.split(/[\\/]/)[0]?.toLowerCase() ?? '';
    if (firstFolder.includes('agent')) {
        return 'agent';
    }
    if (firstFolder.includes('century')) {
        return 'century21';
    }
    if (firstFolder.includes('realtor')) {
        return 'realtor';
    }
    if (firstFolder.includes('property') || firstFolder.includes('listing')) {
        return 'property';
    }

    return 'general';
}

function keyFor(relativePath) {
    return relativePath
        .replace(extname(relativePath), '')
        .split(/[\\/]+/)
        .map((part) =>
            part
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, ''),
        )
        .filter(Boolean)
        .join('-');
}

function toPublicPath(file) {
    return `/${relative(publicDir, file).replaceAll('\\', '/')}`;
}

function assetFor(file) {
    const relativePath = relative(imageRoot, file);
    const extension = extname(file).toLowerCase();
    const dimensions = readDimensions(file, extension);
    const stats = statSync(file);

    return {
        key: keyFor(relativePath),
        path: toPublicPath(file),
        fileName: basename(file),
        category: categoryFor(relativePath),
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        bytes: stats.size,
    };
}

function renderAsset(asset) {
    return `    ${JSON.stringify(asset)},`;
}

function renderManifest(assets) {
    return `// This file is generated by npm run stitch:assets. Do not edit by hand.

export type BrandAssetCategory = 'agent' | 'century21' | 'realtor' | 'property' | 'general';

export type BrandAsset = {
    key: string;
    path: string;
    fileName: string;
    category: BrandAssetCategory;
    width: number | null;
    height: number | null;
    bytes: number;
};

export const brandAssets: readonly BrandAsset[] = [
${assets.map(renderAsset).join('\n')}
];

export function getBrandAsset(key: string): BrandAsset | undefined {
    return brandAssets.find((asset) => asset.key === key);
}
`;
}

mkdirSync(imageRoot, { recursive: true });
mkdirSync(dirname(outputPath), { recursive: true });

const assets = walk(imageRoot).map(assetFor).sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(outputPath, renderManifest(assets), 'utf8');

console.log(`Stitched ${assets.length} brand asset${assets.length === 1 ? '' : 's'} into ${relative(rootDir, outputPath).replaceAll('\\', '/')}.`);
