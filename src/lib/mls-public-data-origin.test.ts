import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe.sequential('public MLS data origin', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.resetModules();
    });

    it('keeps every default MLS asset on the same public HTTPS origin', async () => {
        vi.stubEnv('NEXT_PUBLIC_MLS_DATA_ORIGIN', 'https://data.movewithmusto.com/');
        const listings = await import('./mls-public-listings');

        expect(listings.defaultMlsSearchManifestUrl).toBe(
            'https://data.movewithmusto.com/mls/mls-search-manifest.json',
        );
        expect(listings.defaultMlsCurrentPointerUrl).toBe(
            'https://data.movewithmusto.com/mls/current.json',
        );
        expect(listings.hasExternalMlsDataOrigin).toBe(true);
        expect(listings.defaultMlsSearchIndexUrl).toBe(
            'https://data.movewithmusto.com/mls/mls-search-index.json',
        );
        expect(listings.defaultMlsCoordinateIndexUrl).toBe(
            'https://data.movewithmusto.com/mls/mls-coordinate-index.json',
        );
        expect(listings.defaultMlsDetailBaseUrl).toBe(
            'https://data.movewithmusto.com/mls/listings',
        );
        expect(listings.buildSiblingMlsPublicDataUrl(
            listings.defaultMlsSearchManifestUrl,
            listings.mlsSearchShardFiles.preferred,
        )).toBe('https://data.movewithmusto.com/mls/mls-search-preferred.json');
    });

    it('uses same-origin /mls paths when the setting is absent', async () => {
        vi.stubEnv('NEXT_PUBLIC_MLS_DATA_ORIGIN', '');
        const listings = await import('./mls-public-listings');

        expect(listings.defaultMlsSearchManifestUrl).toBe('/mls/mls-search-manifest.json');
        expect(listings.defaultMlsCurrentPointerUrl).toBe('/mls/current.json');
        expect(listings.hasExternalMlsDataOrigin).toBe(false);
        expect(listings.defaultMlsSearchIndexUrl).toBe('/mls/mls-search-index.json');
        expect(listings.defaultMlsCoordinateIndexUrl).toBe('/mls/mls-coordinate-index.json');
        expect(listings.defaultMlsDetailBaseUrl).toBe('/mls/listings');
        expect(listings.buildSiblingMlsPublicDataUrl(
            listings.defaultMlsSearchManifestUrl,
            listings.mlsSearchShardFiles.preferred,
        )).toBe('/mls/mls-search-preferred.json');
    });

    it('fails closed to same-origin paths for unsafe or malformed origins', async () => {
        const listings = await import('./mls-public-listings');
        const rejectedOrigins = [
            'http://data.movewithmusto.com',
            'https://data.movewithmusto.com/private',
            'https://data.movewithmusto.com?redirect=1',
            'https://user:secret@data.movewithmusto.com',
            'https://localhost:3019',
            'https://127.0.0.1',
            'not a URL',
        ];

        for (const origin of rejectedOrigins) {
            expect(listings.sanitizeMlsDataOrigin(origin)).toBe('');
            expect(listings.buildMlsPublicDataUrl('mls-search-manifest.json', origin)).toBe(
                '/mls/mls-search-manifest.json',
            );
        }
    });

    it('validates and resolves generation pointers without accepting arbitrary paths', async () => {
        vi.stubEnv('NEXT_PUBLIC_MLS_DATA_ORIGIN', 'https://data.movewithmusto.com');
        const listings = await import('./mls-public-listings');
        const pointer = {
            schemaVersion: 1,
            generation: '20260713040000-11111111-1111-4111-8111-111111111111',
            generatedAt: new Date().toISOString(),
            manifestFile: 'mls-search-manifest.json',
        } as const;

        expect(listings.isMlsCurrentPointerReady(pointer)).toBe(true);
        expect(listings.buildMlsGenerationBaseUrl(
            listings.defaultMlsCurrentPointerUrl,
            pointer,
        )).toBe(
            'https://data.movewithmusto.com/mls/generations/20260713040000-11111111-1111-4111-8111-111111111111',
        );
        expect(listings.isMlsCurrentPointerReady({ ...pointer, generation: '../live' })).toBe(false);
        expect(listings.isMlsCurrentPointerReady({ ...pointer, manifestFile: '../manifest.json' })).toBe(false);
        expect(listings.isMlsCurrentPointerReady({ ...pointer, extra: true })).toBe(false);
        expect(() => listings.buildMlsGenerationBaseUrl(
            'https://data.movewithmusto.com/private/current.json',
            pointer,
        )).toThrow(/invalid current pointer URL/i);
    });
});
