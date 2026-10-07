import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { marketRegions } from '@/lib/market-regions';

const formerPublicGuidePages = [
    'src/app/guides/page.tsx',
    'src/app/guides/buyers/page.tsx',
    'src/app/guides/sellers/page.tsx',
    'src/app/neighborhoods/page.tsx',
    'src/app/buy/neighborhoods/page.tsx',
] as const;

const formerPublicGuideComponents = [
    'src/app/buy/BuyerNeighborhoodWorkspace.tsx',
    'src/app/buy/BuyExperience.tsx',
] as const;

describe('private client planning materials', () => {
    it.each(formerPublicGuidePages)('does not publish %s as an App Router page', (routeFile) => {
        expect(existsSync(resolve(process.cwd(), routeFile))).toBe(false);
    });

    it.each(formerPublicGuideComponents)('does not retain %s as a public-site experience', (componentFile) => {
        expect(existsSync(resolve(process.cwd(), componentFile))).toBe(false);
    });

    it('keeps the canonical region artifact consistent without publishing private guides', () => {
        const definitions = JSON.parse(readFileSync(
            resolve(process.cwd(), 'src/lib/market-regions.json'),
            'utf8',
        )) as Array<{
            name: string;
            summary: string;
            coreTowns: string[];
            extendedTowns?: string[];
            searchOnlyTowns?: string[];
        }>;

        expect(existsSync(resolve(process.cwd(), 'materials/client-guides'))).toBe(false);
        expect(existsSync(resolve(process.cwd(), 'scripts/build-private-client-guides.py'))).toBe(false);
        expect(definitions.map((region) => ({
            name: region.name,
            summary: region.summary,
            coreTowns: [...region.coreTowns].sort(),
            extendedTowns: [...(region.extendedTowns ?? [])].sort(),
            searchOnlyTowns: [...(region.searchOnlyTowns ?? [])].sort(),
        }))).toEqual(marketRegions.map((region) => ({
            name: region.name,
            summary: region.summary,
            coreTowns: [...region.coreTowns],
            extendedTowns: [...region.extendedTowns],
            searchOnlyTowns: [...region.searchOnlyTowns],
        })));
    });
});
