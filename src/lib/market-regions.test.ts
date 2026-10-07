import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    marketRegions,
    marketTowns,
    preferredServiceAreaTowns,
    serviceTierForTown,
    townMatchesPreferredServiceArea,
} from './market-regions';

const plannedAdditions = [
    'Ashland',
    'Ayer',
    'Billerica',
    'Bolton',
    'Boxborough',
    'Canton',
    'Chelsea',
    'Cohasset',
    'Dedham',
    'Dover',
    'Dracut',
    'Dunstable',
    'Everett',
    'Framingham',
    'Groveland',
    'Harvard',
    'Haverhill',
    'Hudson',
    'Lawrence',
    'Lincoln',
    'Littleton',
    'Lowell',
    'Marlborough',
    'Maynard',
    'Merrimac',
    'Methuen',
    'Milton',
    'Natick',
    'Needham',
    'Norwood',
    'Pepperell',
    'Randolph',
    'Salisbury',
    'Sherborn',
    'Shirley',
    'Stow',
    'Sudbury',
    'Townsend',
    'Tyngsborough',
    'Wayland',
    'Wellesley',
    'Weston',
    'Westwood',
    'Winthrop',
] as const;

describe('canonical market regions', () => {
    it('publishes the seven Burlington-centered buyer guide areas in one canonical order', () => {
        expect(marketRegions.map((region) => region.name)).toEqual([
            'Greater Boston',
            'Burlington & Route 128',
            'Greater Lowell & Nashoba',
            'Merrimack Valley',
            'North Shore',
            'Route 2 & MetroWest',
            'South of Boston & Route 128',
        ]);
        expect(marketRegions.every((region) => region.towns.length > 0)).toBe(true);
    });

    it('assigns every curated Massachusetts town to exactly one region and tier', () => {
        const townNames = marketTowns.map((town) => town.name);
        const regionSlugs = new Set(marketRegions.map((region) => region.slug));

        expect(new Set(townNames).size).toBe(townNames.length);
        marketTowns.forEach((town) => {
            expect(town.state).toBe('MA');
            expect(regionSlugs).toContain(town.regionSlug);
            expect(['core', 'extended', 'search-only']).toContain(town.tier);
            expect(town.lastReviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    it('keeps all 106 core and extended towns in the preferred compatibility artifact', () => {
        const compatibilityTowns = JSON.parse(
            readFileSync(resolve(process.cwd(), 'src/lib/preferred-service-area-towns.json'), 'utf8'),
        ) as string[];
        const groupedTowns = marketRegions.flatMap((region) => [...region.towns]).sort();

        expect(preferredServiceAreaTowns).toHaveLength(106);
        expect(groupedTowns).toEqual([...preferredServiceAreaTowns].sort());
        expect(compatibilityTowns).toEqual([...preferredServiceAreaTowns].sort());
        expect(new Set(groupedTowns).size).toBe(groupedTowns.length);
        expect(plannedAdditions).toHaveLength(44);
        expect(preferredServiceAreaTowns).toEqual(expect.arrayContaining([...plannedAdditions]));
    });

    it('uses core for the Burlington-centered radius and extended for established edge markets', () => {
        expect(serviceTierForTown('Burlington')).toBe('core');
        expect(serviceTierForTown('Lowell')).toBe('core');
        expect(serviceTierForTown('Lawrence')).toBe('core');
        expect(serviceTierForTown('Salisbury')).toBe('extended');
        expect(serviceTierForTown('Rockport')).toBe('extended');
        expect(serviceTierForTown('Hingham')).toBe('extended');
    });

    it('keeps Worcester searchable without claiming it as part of the served boundary', () => {
        expect(serviceTierForTown('Worcester')).toBe('search-only');
        expect(townMatchesPreferredServiceArea('Worcester')).toBe(false);
        expect(marketRegions.flatMap((region) => region.towns)).not.toContain('Worcester');
        expect(townMatchesPreferredServiceArea('Burlington')).toBe(true);
        expect(townMatchesPreferredServiceArea('Burlington', 'NH')).toBe(false);
    });

    it('keeps the explicit broker-approved MLS disclosure aligned with all 106 service towns', () => {
        const config = JSON.parse(
            readFileSync(resolve(process.cwd(), 'mls-compliance.config.json'), 'utf8'),
        ) as { mlsPin: { marketArea: string } };
        const exampleConfig = JSON.parse(
            readFileSync(resolve(process.cwd(), 'mls-compliance.config.example.json'), 'utf8'),
        ) as { mlsPin: { marketArea: string } };
        const configuredTowns = config.mlsPin.marketArea.split(',').map((town) => town.trim());
        const exampleTowns = exampleConfig.mlsPin.marketArea.split(',').map((town) => town.trim());

        expect(configuredTowns).toHaveLength(106);
        expect(configuredTowns).toEqual(preferredServiceAreaTowns);
        expect(exampleTowns).toEqual(preferredServiceAreaTowns);
        expect(configuredTowns).toEqual(
            [...configuredTowns].sort((left, right) => left.localeCompare(right)),
        );
    });
});
