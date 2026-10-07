import type { MetadataRoute } from 'next';
import { isCommercialPublic } from '@/lib/commercial-visibility';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

export const dynamic = 'force-static';

const indexableRoutes = [
    {
        path: '/',
        changeFrequency: 'weekly',
        priority: 1,
    },
    {
        path: '/about/',
        changeFrequency: 'monthly',
        priority: 0.7,
    },
    {
        path: '/buy/properties/',
        changeFrequency: 'daily',
        priority: 0.9,
    },
    {
        path: '/sell/',
        changeFrequency: 'monthly',
        priority: 0.8,
    },
    {
        path: '/commercial/',
        changeFrequency: 'monthly',
        priority: 0.8,
    },
    {
        path: '/commercial/properties/',
        changeFrequency: 'daily',
        priority: 0.85,
    },
    {
        path: '/contact/',
        changeFrequency: 'monthly',
        priority: 0.6,
    },
    {
        path: '/privacy/',
        changeFrequency: 'yearly',
        priority: 0.2,
    },
    {
        path: '/terms/',
        changeFrequency: 'yearly',
        priority: 0.2,
    },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
    const { siteUrl } = resolveRealEstateProfile();

    return indexableRoutes
        .filter(({ path }) => !path.startsWith('/commercial/') || isCommercialPublic())
        .map(({ path, changeFrequency, priority }) => ({
        url: new URL(path, `${siteUrl}/`).href,
        changeFrequency,
        priority,
        }));
}
