import { describe, expect, it } from 'vitest';
import {
    buildRealEstateMetadata,
    defaultRealEstateProfile,
    resolveRealEstateProfile,
} from './real-estate-profile';

describe('real estate profile', () => {
    it('uses durable high-end real-estate defaults', () => {
        const profile = resolveRealEstateProfile({});

        expect(profile.brandName).toBe('Move With Musto');
        expect(profile.agentName).toBe('Mai Ly Musto');
        expect(profile.agentTitle).toBe('Mai Ly Musto, REALTOR®');
        expect(profile.brokerageName).toBe('Dream Seekers Realty, LLC');
        expect(profile.professionalLicense).toEqual({
            jurisdiction: 'Massachusetts',
            type: 'Real Estate Salesperson',
            number: '9572796-RE-S',
        });
        expect(profile.headline).toBe('Move With Musto');
        expect(profile.valueProp).toContain('Personal guidance for buying, selling');
        expect(profile.availabilityLabel).toBe('Serving Burlington and surrounding Massachusetts communities');
        expect(profile.assets.brokerageLogo).toMatchObject({
            src: '/images/brand/general/dream-seekers-realty-logo-96w.png',
            srcSet: '/images/brand/general/dream-seekers-realty-logo-96w.png 1x, /images/brand/general/dream-seekers-realty-logo-192w.png 2x',
            width: 96,
            height: 96,
        });
        expect(profile.assets.equalHousingLogo).toMatchObject({
            src: '/images/brand/general/equal-housing-opportunity-logo-1200w-96w.png',
            srcSet: '/images/brand/general/equal-housing-opportunity-logo-1200w-96w.png 1x, /images/brand/general/equal-housing-opportunity-logo-1200w-192w.png 2x',
            width: 96,
            height: 103,
        });
        expect(profile.assets.realtorLogo).toMatchObject({
            src: '/images/brand/realtor/realtor-logo-blue-96w.png',
            srcSet: '/images/brand/realtor/realtor-logo-blue-96w.png 1x, /images/brand/realtor/realtor-logo-blue-192w.png 2x',
            width: 96,
            height: 106,
        });
        expect(profile.inquiry).toMatchObject({
            action: undefined,
            method: 'post',
        });
        expect(profile.unsubscribeAction).toBeUndefined();
        expect(profile.appointmentCta).toBeUndefined();
        expect(profile.ctas.primary).toEqual({
            label: 'Search homes',
            href: '/buy/properties/',
        });
        expect(profile.ctas.secondary).toEqual({
            label: 'Get in touch',
            href: '/contact/',
        });
        expect(profile.ctas.email).toEqual({
            label: 'Send an email',
            href: 'mailto:maily@movewithmusto.com',
        });
    });

    it('applies public build-time overrides with coming-soon env compatibility', () => {
        const profile = resolveRealEstateProfile({
            NEXT_PUBLIC_REAL_ESTATE_BRAND_NAME: 'Harbor House Realty',
            NEXT_PUBLIC_REAL_ESTATE_AGENT_NAME: 'Avery Stone',
            NEXT_PUBLIC_REAL_ESTATE_AGENT_TITLE: 'Avery Stone, REALTOR®',
            NEXT_PUBLIC_REAL_ESTATE_BROKERAGE_NAME: 'Harbor House Brokerage',
            NEXT_PUBLIC_REAL_ESTATE_HEADLINE: 'Private property guidance on the coast.',
            NEXT_PUBLIC_REAL_ESTATE_VALUE_PROP: 'Buy and sell with careful coastal strategy.',
            NEXT_PUBLIC_REAL_ESTATE_MARKET_LABEL: 'Newport and coastal Rhode Island',
            NEXT_PUBLIC_REAL_ESTATE_SITE_URL: 'harbor.example/path',
            NEXT_PUBLIC_REAL_ESTATE_CONTACT_EMAIL: 'hello@harbor.example',
            NEXT_PUBLIC_REAL_ESTATE_CONTACT_PHONE: '401-555-0199',
            NEXT_PUBLIC_INQUIRY_FORM_ACTION: 'https://forms.example.com/harbor',
            NEXT_PUBLIC_INQUIRY_FORM_METHOD: 'get',
            NEXT_PUBLIC_REAL_ESTATE_UNSUBSCRIBE_ACTION: 'https://forms.example.com/harbor-unsubscribe',
            NEXT_PUBLIC_REAL_ESTATE_APPOINTMENT_URL: 'https://calendly.example/harbor',
            NEXT_PUBLIC_REAL_ESTATE_APPOINTMENT_LABEL: 'Book a buyer consult',
            NEXT_PUBLIC_REAL_ESTATE_INSTAGRAM_URL: 'https://instagram.example/harbor',
        });

        expect(profile.brandName).toBe('Harbor House Realty');
        expect(profile.agentName).toBe('Avery Stone');
        expect(profile.agentTitle).toBe('Avery Stone, REALTOR®');
        expect(profile.brokerageName).toBe('Harbor House Brokerage');
        expect(profile.siteUrl).toBe('https://harbor.example');
        expect(profile.contact).toEqual({
            email: 'hello@harbor.example',
            phone: '401-555-0199',
            phoneHref: 'tel:+14015550199',
        });
        expect(profile.ctas.email.href).toBe('mailto:hello@harbor.example');
        expect(profile.inquiry).toEqual({
            action: 'https://forms.example.com/harbor',
            method: 'post',
        });
        expect(profile.unsubscribeAction).toBe('https://forms.example.com/harbor-unsubscribe');
        expect(profile.appointmentCta).toEqual({
            label: 'Book a buyer consult',
            href: 'https://calendly.example/harbor',
        });
        expect(profile.socialLinks).toEqual([
            { label: 'Instagram', href: 'https://instagram.example/harbor' },
        ]);
    });

    it('does not connect an unconfigured clone to production submission services', () => {
        const profile = resolveRealEstateProfile({});
        expect(profile.inquiry.action).toBeUndefined();
        expect(profile.unsubscribeAction).toBeUndefined();
    });

    it('builds metadata without coming-soon language', () => {
        const metadata = buildRealEstateMetadata(
            resolveRealEstateProfile({
                NEXT_PUBLIC_REAL_ESTATE_BRAND_NAME: 'Beacon Estates',
                NEXT_PUBLIC_REAL_ESTATE_AGENT_NAME: 'Avery Stone',
                NEXT_PUBLIC_REAL_ESTATE_SITE_URL: 'https://beacon.example',
                NEXT_PUBLIC_REAL_ESTATE_VALUE_PROP: 'Private real estate advisory in Beacon Hill.',
            }),
        );

        expect(metadata.title).toBe('Beacon Estates | Avery Stone Real Estate');
        expect(metadata.description).toBe('Private real estate advisory in Beacon Hill.');
        expect(metadata.applicationName).toBe('Beacon Estates');
        expect(metadata.metadataBase).toEqual(new URL('https://beacon.example'));
        expect(metadata.openGraph).toMatchObject({
            title: 'Beacon Estates | Avery Stone Real Estate',
            description: 'Private real estate advisory in Beacon Hill.',
            siteName: 'Beacon Estates',
        });
        expect(JSON.stringify(metadata)).not.toContain('Coming Soon');
    });

    it('keeps service paths exported for direct profile consumers', () => {
        expect(defaultRealEstateProfile.services.map((service) => [service.title, service.href])).toEqual([
            ['Sell With a Clear Plan', '/sell/'],
            ['Buy With Local Insight', '/buy/properties/'],
            ['Plan Your Next Move', '/contact/'],
        ]);
    });
});
