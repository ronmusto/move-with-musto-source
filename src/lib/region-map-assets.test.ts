import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
    BUYER_REGION_MAP_SLUGS,
    CORE_TOWN_FILL,
    EXTENDED_TOWN_FILL,
    renderRegionMapSvg,
    SEARCH_OVERVIEW_MAP_SLUG,
} from '../../scripts/generate-region-map-assets.mjs';
import { marketRegions } from './market-regions';

describe('pre-rendered buyer region maps', () => {
    it('derives map slugs from every canonical buyer region', () => {
        expect(BUYER_REGION_MAP_SLUGS).toEqual(marketRegions.map((region) => region.slug));
        expect(BUYER_REGION_MAP_SLUGS).toHaveLength(7);
    });

    it('keeps every buyer region asset present, correctly sized, and compact', async () => {
        await Promise.all([...BUYER_REGION_MAP_SLUGS, SEARCH_OVERVIEW_MAP_SLUG].map(async (slug) => {
            const assetPath = resolve(
                process.cwd(),
                'public',
                'images',
                'maps',
                `massachusetts-${slug}.webp`,
            );
            const size = statSync(assetPath).size;

            expect(size).toBeGreaterThan(10_000);
            expect(size).toBeLessThan(45_000);
            await expect(sharp(assetPath).metadata()).resolves.toMatchObject({
                format: 'webp',
                height: 715,
                width: 672,
            });
        }));
    });

    it('renders complete municipality geometry with separate core and extended tones', () => {
        const northShore = marketRegions.find((region) => region.slug === 'north-shore');
        expect(northShore).toBeDefined();

        const svg = renderRegionMapSvg(northShore!);

        expect(svg.match(/<path /g)).toHaveLength(351);
        expect(svg.match(new RegExp(`fill="${CORE_TOWN_FILL}"`, 'g'))).toHaveLength(
            northShore!.coreTowns.length,
        );
        expect(svg.match(new RegExp(`fill="${EXTENDED_TOWN_FILL}"`, 'g'))).toHaveLength(
            northShore!.extendedTowns.length,
        );
        expect(svg).toContain('BURLINGTON');
        expect(svg).toContain('BOSTON');
    });

    it('keeps the property-search overview neutral rather than implying a selected region', () => {
        const svg = renderRegionMapSvg({
            slug: SEARCH_OVERVIEW_MAP_SLUG,
            name: 'Massachusetts search overview',
            towns: [],
        });

        expect(svg.match(/<path /g)).toHaveLength(351);
        expect(svg).not.toContain(`fill="${CORE_TOWN_FILL}"`);
        expect(svg).not.toContain(`fill="${EXTENDED_TOWN_FILL}"`);
    });
});
