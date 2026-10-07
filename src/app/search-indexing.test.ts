import { afterEach, describe, expect, it, vi } from 'vitest';
import { metadata as homeMetadata } from './page';
import robots from './robots';
import sitemap from './sitemap';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

describe('search indexing metadata', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('publishes a canonical homepage URL', () => {
        expect(homeMetadata.alternates).toEqual({
            canonical: '/',
        });
    });

    it('allows crawling and advertises the canonical sitemap', () => {
        const { siteUrl } = resolveRealEstateProfile();

        expect(robots()).toEqual({
            rules: {
                userAgent: '*',
                allow: '/',
            },
            sitemap: `${siteUrl}/sitemap.xml`,
            host: siteUrl,
        });
    });

    it('lists only canonical, indexable public routes', () => {
        const { siteUrl } = resolveRealEstateProfile();
        const entries = sitemap();
        const urls = entries.map((entry) => entry.url);

        expect(urls).toEqual([
            `${siteUrl}/`,
            `${siteUrl}/about/`,
            `${siteUrl}/buy/properties/`,
            `${siteUrl}/sell/`,
            `${siteUrl}/contact/`,
            `${siteUrl}/privacy/`,
            `${siteUrl}/terms/`,
        ]);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls).not.toContain(`${siteUrl}/buy/`);
        expect(urls).not.toContain(`${siteUrl}/properties/`);
        expect(urls).not.toContain(`${siteUrl}/unsubscribe/`);
        expect(entries.find((entry) => entry.url === `${siteUrl}/buy/properties/`)).toMatchObject({
            changeFrequency: 'daily',
            priority: 0.9,
        });
    });

    it('adds both commercial routes only when the launch gate is enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        const { siteUrl } = resolveRealEstateProfile();

        expect(sitemap().map((entry) => entry.url)).toEqual(expect.arrayContaining([
            `${siteUrl}/commercial/`,
            `${siteUrl}/commercial/properties/`,
        ]));
        expect(sitemap().find((entry) => entry.url === `${siteUrl}/commercial/properties/`))
            .toMatchObject({ changeFrequency: 'daily', priority: 0.85 });
    });
});
