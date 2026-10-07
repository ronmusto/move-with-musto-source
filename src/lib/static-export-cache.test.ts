import { describe, expect, it } from 'vitest';
import {
    cacheControlForStaticRequest,
    immutableCacheControl,
    noStoreCacheControl,
} from '../../scripts/static-export-cache.mjs';

const generation = encodeURIComponent('2026-07-09T14:30:00.000Z');

describe('static export cache policy', () => {
    it('never caches the search manifest, even when a generation query is present', () => {
        expect(cacheControlForStaticRequest('/mls/mls-search-manifest.json')).toBe(noStoreCacheControl);
        expect(cacheControlForStaticRequest(
            `/mls/mls-search-manifest.json?generation=${generation}`,
        )).toBe(noStoreCacheControl);
    });

    it.each([
        '/mls/mls-search-preferred.json',
        '/mls/mls-search-index.json',
        '/mls/mls-coordinate-index.json',
        '/mls/listings/73333444.json',
    ])('caches generation-versioned MLS asset %s as immutable', (path) => {
        expect(cacheControlForStaticRequest(`${path}?generation=${generation}`)).toBe(
            immutableCacheControl,
        );
    });

    it('keeps unversioned and malformed-version MLS JSON freshness-first', () => {
        expect(cacheControlForStaticRequest('/mls/mls-search-preferred.json')).toBe(noStoreCacheControl);
        expect(cacheControlForStaticRequest('/mls/listings/73333444.json?generation=latest')).toBe(
            noStoreCacheControl,
        );
    });

    it('marks Next fingerprinted static assets immutable without caching page responses', () => {
        expect(cacheControlForStaticRequest('/_next/static/chunks/app-7d4f2.js')).toBe(
            immutableCacheControl,
        );
        expect(cacheControlForStaticRequest('/buy/properties/')).toBe(noStoreCacheControl);
        expect(cacheControlForStaticRequest('/buy/properties/index.html')).toBe(noStoreCacheControl);
    });
});
