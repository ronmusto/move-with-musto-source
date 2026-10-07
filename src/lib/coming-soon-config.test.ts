import { describe, expect, it } from 'vitest';
import {
    buildComingSoonMetadata,
    defaultComingSoonProfile,
    parsePublicBoolean,
    resolveComingSoonProfile,
} from './coming-soon-config';

describe('coming soon config', () => {
    it('uses upscale real-estate defaults without env overrides', () => {
        const profile = resolveComingSoonProfile({});

        expect(profile.clientName).toBe('Move With Musto');
        expect(profile.businessType).toBe('Real estate guidance for your next move');
        expect(profile.headline).toBe('Your next move deserves a clearer path.');
        expect(profile.valueProp).toContain('thoughtful buyer and seller guidance');
        expect(profile.launchLabel).toBe('Launching soon');
        expect(profile.siteUrl).toBe('https://movewithmusto.com');
        expect(profile.heroImageSrc).toBe('/images/luxury-real-estate-hero.png');
        expect(profile.contact).toEqual({
            email: 'maily@movewithmusto.com',
            phone: '',
            phoneHref: '',
        });
        expect(profile.signup).toMatchObject({
            action: undefined,
            method: 'post',
        });
        expect(profile.unsubscribe.action).toBeUndefined();
        expect(profile.termsVersion).toBe('2026-06-16');
        expect(profile.privacyVersion).toBe('2026-06-16');
        expect(profile.socialLinks).toEqual([]);
        expect(profile.logo).toBeUndefined();
        expect(profile.jakomuCredit.show).toBe(true);
        expect(profile.builderCta).toEqual({
            label: 'Start a project with Jakomu',
            href: 'https://jakomu.com',
        });
    });

    it('applies public build-time overrides', () => {
        const profile = resolveComingSoonProfile({
            NEXT_PUBLIC_COMING_SOON_CLIENT_NAME: 'Harbor House Realty',
            NEXT_PUBLIC_COMING_SOON_BUSINESS_TYPE: 'Coastal property advisory',
            NEXT_PUBLIC_COMING_SOON_HEADLINE: 'A sharper way to buy on the coast.',
            NEXT_PUBLIC_COMING_SOON_VALUE_PROP: 'Private guidance for serious coastal buyers.',
            NEXT_PUBLIC_COMING_SOON_LAUNCH_LABEL: 'Opening Spring 2027',
            NEXT_PUBLIC_COMING_SOON_LOCATION_LABEL: 'Newport and coastal Rhode Island',
            NEXT_PUBLIC_COMING_SOON_SITE_URL: 'https://harbor.example',
            NEXT_PUBLIC_COMING_SOON_CONTACT_EMAIL: 'hello@harbor.example',
            NEXT_PUBLIC_COMING_SOON_CONTACT_PHONE: '401-555-0199',
            NEXT_PUBLIC_COMING_SOON_HERO_IMAGE_SRC: '/images/harbor-house.png',
            NEXT_PUBLIC_COMING_SOON_LOGO_SRC: '/client-logo.svg',
            NEXT_PUBLIC_COMING_SOON_LOGO_ALT: 'Harbor House Realty mark',
            NEXT_PUBLIC_COMING_SOON_SIGNUP_ACTION: 'https://forms.example.com/harbor',
            NEXT_PUBLIC_COMING_SOON_SIGNUP_METHOD: 'get',
            NEXT_PUBLIC_COMING_SOON_UNSUBSCRIBE_ACTION: 'https://forms.example.com/harbor-unsubscribe',
            NEXT_PUBLIC_COMING_SOON_INSTAGRAM_URL: 'https://instagram.example/harbor',
            NEXT_PUBLIC_COMING_SOON_FACEBOOK_URL: 'https://facebook.example/harbor',
            NEXT_PUBLIC_COMING_SOON_BUILDER_CTA_HREF: 'https://jakomu.com/contact',
            NEXT_PUBLIC_COMING_SOON_BUILDER_CTA_LABEL: 'Build my page',
            NEXT_PUBLIC_COMING_SOON_SHOW_JAKOMU_CREDIT: 'false',
        });

        expect(profile.clientName).toBe('Harbor House Realty');
        expect(profile.businessType).toBe('Coastal property advisory');
        expect(profile.headline).toBe('A sharper way to buy on the coast.');
        expect(profile.valueProp).toBe('Private guidance for serious coastal buyers.');
        expect(profile.launchLabel).toBe('Opening Spring 2027');
        expect(profile.locationLabel).toBe('Newport and coastal Rhode Island');
        expect(profile.siteUrl).toBe('https://harbor.example');
        expect(profile.contact).toEqual({
            email: 'hello@harbor.example',
            phone: '401-555-0199',
            phoneHref: 'tel:+14015550199',
        });
        expect(profile.heroImageSrc).toBe('/images/harbor-house.png');
        expect(profile.logo).toEqual({
            src: '/client-logo.svg',
            alt: 'Harbor House Realty mark',
        });
        expect(profile.signup.action).toBe('https://forms.example.com/harbor');
        expect(profile.signup.method).toBe('get');
        expect(profile.unsubscribe.action).toBe('https://forms.example.com/harbor-unsubscribe');
        expect(profile.socialLinks).toEqual([
            { label: 'Instagram', href: 'https://instagram.example/harbor' },
            { label: 'Facebook', href: 'https://facebook.example/harbor' },
        ]);
        expect(profile.builderCta).toEqual({
            label: 'Build my page',
            href: 'https://jakomu.com/contact',
        });
        expect(profile.jakomuCredit.show).toBe(false);
    });

    it('parses public boolean values conservatively', () => {
        expect(parsePublicBoolean('yes', false)).toBe(true);
        expect(parsePublicBoolean('0', true)).toBe(false);
        expect(parsePublicBoolean('not-sure', true)).toBe(true);
        expect(parsePublicBoolean(undefined, false)).toBe(false);
    });

    it('falls back to post for invalid signup methods', () => {
        const profile = resolveComingSoonProfile({
            NEXT_PUBLIC_COMING_SOON_SIGNUP_METHOD: 'put',
        });

        expect(profile.signup.method).toBe('post');
    });

    it('keeps unusual phone values linkable without inventing digits', () => {
        const profile = resolveComingSoonProfile({
            NEXT_PUBLIC_COMING_SOON_CONTACT_PHONE: '+44 20 7946 0958',
        });

        expect(profile.contact.phoneHref).toBe('tel:442079460958');
    });

    it('normalizes site URLs for static social metadata', () => {
        expect(
            resolveComingSoonProfile({
                NEXT_PUBLIC_COMING_SOON_SITE_URL: 'client.example/path',
            }).siteUrl,
        ).toBe('https://client.example');
        expect(
            resolveComingSoonProfile({
                NEXT_PUBLIC_COMING_SOON_SITE_URL: 'not a url',
            }).siteUrl,
        ).toBe(defaultComingSoonProfile.siteUrl);
    });

    it('builds metadata from the configured profile', () => {
        const metadata = buildComingSoonMetadata(
            resolveComingSoonProfile({
                NEXT_PUBLIC_COMING_SOON_CLIENT_NAME: 'Beacon Estates',
                NEXT_PUBLIC_COMING_SOON_SITE_URL: 'https://beacon.example',
                NEXT_PUBLIC_COMING_SOON_VALUE_PROP: 'Private real estate advisory in Beacon Hill.',
                NEXT_PUBLIC_COMING_SOON_HERO_IMAGE_SRC: '/images/beacon.png',
            }),
        );

        expect(metadata.title).toBe('Beacon Estates | Coming Soon');
        expect(metadata.description).toBe('Private real estate advisory in Beacon Hill.');
        expect(metadata.applicationName).toBe('Beacon Estates');
        expect(metadata.metadataBase).toEqual(new URL('https://beacon.example'));
        expect(metadata.openGraph).toMatchObject({
            title: 'Beacon Estates | Coming Soon',
            description: 'Private real estate advisory in Beacon Hill.',
            siteName: 'Beacon Estates',
        });
        expect(metadata.twitter).toMatchObject({
            card: 'summary_large_image',
            images: ['/images/beacon.png'],
        });
    });

    it('keeps default data exported for direct config consumers', () => {
        expect(defaultComingSoonProfile.highlights).toContain(
            'Buyer and seller guidance shaped around your goals',
        );
    });
});
