#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
    bostonMapPoint,
    massachusettsMapViewBox,
    massachusettsTowns,
} from '../src/lib/massachusetts-map.generated.ts';
import { marketRegions } from '../src/lib/market-regions.ts';

export const REGION_MAP_WIDTH = 672;
export const REGION_MAP_HEIGHT = 715;
export const CORE_TOWN_FILL = '#8c6847';
export const EXTENDED_TOWN_FILL = '#cbb08d';
export const BURLINGTON_MAP_POINT = [254.38, 63.14];

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(rootDir, 'public', 'images', 'maps');
export const BUYER_REGION_MAP_SLUGS = Object.freeze(marketRegions.map((region) => region.slug));
export const SEARCH_OVERVIEW_MAP_SLUG = 'search-overview';

function escapeXml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

export function renderRegionMapSvg(region) {
    const coreTowns = new Set((region.coreTowns ?? region.towns).map((town) => town.toUpperCase()));
    const extendedTowns = new Set((region.extendedTowns ?? []).map((town) => town.toUpperCase()));
    const townPaths = massachusettsTowns.map((town) => {
        const isCore = coreTowns.has(town.town);
        const isExtended = extendedTowns.has(town.town);
        const fill = isCore ? CORE_TOWN_FILL : isExtended ? EXTENDED_TOWN_FILL : '#fffdf8';
        const stroke = isCore ? '#4d3827' : isExtended ? '#70563f' : '#625e57';
        const isHighlighted = isCore || isExtended;

        return `<path d="${escapeXml(town.path)}" fill="${fill}" ` +
            `fill-opacity="${isCore ? '0.94' : isExtended ? '0.88' : '0.72'}" stroke="${stroke}" ` +
            `stroke-opacity="${isHighlighted ? '0.82' : '0.34'}" stroke-linejoin="round" ` +
            `stroke-width="${isHighlighted ? '0.78' : '0.42'}"/>`;
    }).join('');
    const [bostonX, bostonY] = bostonMapPoint;
    const [burlingtonX, burlingtonY] = BURLINGTON_MAP_POINT;

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${REGION_MAP_WIDTH}" ` +
        `height="${REGION_MAP_HEIGHT}" viewBox="${massachusettsMapViewBox}">` +
        '<rect x="165" y="0" width="235" height="250" fill="#f4eee5"/>' +
        townPaths +
        `<circle cx="${burlingtonX}" cy="${burlingtonY}" r="3.5" fill="#24533f" stroke="#f4eee5" stroke-width="1.6"/>` +
        `<text x="${burlingtonX - 6}" y="${burlingtonY - 5}" fill="#24533f" font-family="Arial, sans-serif" ` +
        'font-size="7.5" font-weight="700" letter-spacing="0.28" text-anchor="end">BURLINGTON</text>' +
        `<circle cx="${bostonX}" cy="${bostonY}" r="3.5" fill="#171817" stroke="#f4eee5" stroke-width="1.6"/>` +
        `<text x="${bostonX + 7}" y="${bostonY + 3}" fill="#5b5852" font-family="Arial, sans-serif" ` +
        'font-size="8.5" font-weight="700" letter-spacing="0.35">BOSTON</text>' +
        '</svg>';
}

export async function generateRegionMapAssets() {
    const regions = [
        ...marketRegions,
        {
            slug: SEARCH_OVERVIEW_MAP_SLUG,
            name: 'Massachusetts search overview',
            towns: [],
        },
    ];

    await mkdir(outputDir, { recursive: true });
    for (const region of regions) {
        const outputPath = path.join(outputDir, `massachusetts-${region.slug}.webp`);
        await sharp(Buffer.from(renderRegionMapSvg(region)))
            .webp({ effort: 6, quality: 87, smartSubsample: true })
            .toFile(outputPath);
    }

    return regions.map((region) => `public/images/maps/massachusetts-${region.slug}.webp`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const files = await generateRegionMapAssets();
    console.log(`Generated ${files.length} pre-rendered Massachusetts region maps.`);
}
