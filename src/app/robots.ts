import type { MetadataRoute } from 'next';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

export const dynamic = 'force-static';

export default function robots(): MetadataRoute.Robots {
    const { siteUrl } = resolveRealEstateProfile();

    return {
        rules: {
            userAgent: '*',
            allow: '/',
        },
        sitemap: `${siteUrl}/sitemap.xml`,
        host: siteUrl,
    };
}
