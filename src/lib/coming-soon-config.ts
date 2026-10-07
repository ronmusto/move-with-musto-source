import type { Metadata } from 'next';

export type ComingSoonLogo = {
    src: string;
    alt: string;
};

export type ComingSoonCta = {
    label: string;
    href: string;
};

export type ComingSoonContact = {
    email: string;
    phone: string;
    phoneHref: string;
};

export type ComingSoonSignupMethod = 'get' | 'post';

export type ComingSoonSignup = {
    action?: string;
    method: ComingSoonSignupMethod;
};

export type ComingSoonUnsubscribe = {
    action?: string;
};

export type ComingSoonSocialLink = {
    label: string;
    href: string;
};

export type ComingSoonProfile = {
    clientName: string;
    businessType: string;
    headline: string;
    valueProp: string;
    launchLabel: string;
    locationLabel: string;
    siteUrl: string;
    heroImageSrc: string;
    heroImageAlt: string;
    logo?: ComingSoonLogo;
    contact: ComingSoonContact;
    signup: ComingSoonSignup;
    unsubscribe: ComingSoonUnsubscribe;
    termsVersion: string;
    privacyVersion: string;
    socialLinks: ComingSoonSocialLink[];
    highlights: string[];
    builderCta: ComingSoonCta;
    jakomuCredit: {
        show: boolean;
        label: string;
        href: string;
    };
};

export const defaultComingSoonProfile: ComingSoonProfile = {
    clientName: 'Move With Musto',
    businessType: 'Real estate guidance for your next move',
    headline: 'Your next move deserves a clearer path.',
    valueProp:
        'Launching soon with thoughtful buyer and seller guidance, local market perspective, and steady support from first conversation to closing day.',
    launchLabel: 'Launching soon',
    locationLabel: 'Local buyers, sellers, and next-move planning',
    siteUrl: 'https://movewithmusto.com',
    heroImageSrc: '/images/luxury-real-estate-hero.png',
    heroImageAlt: 'Modern luxury residence at dusk with warm architectural lighting',
    logo: undefined,
    contact: {
        email: 'maily@movewithmusto.com',
        phone: '',
        phoneHref: '',
    },
    signup: {
        action: undefined,
        method: 'post',
    },
    unsubscribe: {
        action: undefined,
    },
    termsVersion: '2026-06-16',
    privacyVersion: '2026-06-16',
    socialLinks: [],
    highlights: [
        'Buyer and seller guidance shaped around your goals',
        'Listing preparation, pricing strategy, and market positioning',
        'Neighborhood search support with clear local context',
        'Clear communication from early planning through closing day',
    ],
    builderCta: {
        label: 'Start a project with Jakomu',
        href: 'https://jakomu.com',
    },
    jakomuCredit: {
        show: true,
        label: 'Being built by Jakomu',
        href: 'https://jakomu.com',
    },
};

type PublicEnv = Record<string, string | undefined>;

export function parsePublicBoolean(value: string | undefined, fallback: boolean): boolean {
    if (value === undefined || value.trim() === '') {
        return fallback;
    }

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function readEnv(env: PublicEnv, key: string): string | undefined {
    const value = env[key];
    return value && value.trim() ? value.trim() : undefined;
}

function readSignupMethod(env: PublicEnv): ComingSoonSignupMethod {
    const configured = readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SIGNUP_METHOD')?.toLowerCase();
    return configured === 'get' ? 'get' : 'post';
}

function normalizeSiteUrl(siteUrl: string): string {
    const withProtocol = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;

    try {
        return new URL(withProtocol).origin;
    } catch {
        return defaultComingSoonProfile.siteUrl;
    }
}

function buildPhoneHref(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (!phone.trim()) {
        return '';
    }

    if (digits.length === 10) {
        return `tel:+1${digits}`;
    }

    if (digits.length === 11 && digits.startsWith('1')) {
        return `tel:+${digits}`;
    }

    return `tel:${digits || phone}`;
}

function readSocialLinks(env: PublicEnv): ComingSoonSocialLink[] {
    const socialCandidates = [
        ['Instagram', readEnv(env, 'NEXT_PUBLIC_COMING_SOON_INSTAGRAM_URL')],
        ['LinkedIn', readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LINKEDIN_URL')],
        ['Facebook', readEnv(env, 'NEXT_PUBLIC_COMING_SOON_FACEBOOK_URL')],
    ] as const;
    const configuredLinks = socialCandidates
        .filter(([, href]) => href !== undefined)
        .map(([label, href]) => ({ label, href: href as string }));

    return configuredLinks;
}

export function resolveComingSoonProfile(env: PublicEnv = process.env): ComingSoonProfile {
    const clientName =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_CLIENT_NAME') ??
        defaultComingSoonProfile.clientName;
    const businessType =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_BUSINESS_TYPE') ??
        defaultComingSoonProfile.businessType;
    const headline =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_HEADLINE') ??
        defaultComingSoonProfile.headline;
    const valueProp =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_VALUE_PROP') ??
        defaultComingSoonProfile.valueProp;
    const launchLabel =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LAUNCH_LABEL') ??
        defaultComingSoonProfile.launchLabel;
    const locationLabel =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LOCATION_LABEL') ??
        defaultComingSoonProfile.locationLabel;
    const siteUrl =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SITE_URL') ??
        defaultComingSoonProfile.siteUrl;
    const contactEmail =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_CONTACT_EMAIL') ??
        defaultComingSoonProfile.contact.email;
    const contactPhone =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_CONTACT_PHONE') ??
        defaultComingSoonProfile.contact.phone;
    const heroImageSrc =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_HERO_IMAGE_SRC') ??
        defaultComingSoonProfile.heroImageSrc;
    const logoSrc = readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LOGO_SRC');
    const logoAlt =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LOGO_ALT') ?? `${clientName} logo`;
    const signupAction = readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SIGNUP_ACTION');
    const unsubscribeAction = readEnv(env, 'NEXT_PUBLIC_COMING_SOON_UNSUBSCRIBE_ACTION');
    const builderCtaHref =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_BUILDER_CTA_HREF') ??
        defaultComingSoonProfile.builderCta.href;
    const builderCtaLabel =
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_BUILDER_CTA_LABEL') ??
        defaultComingSoonProfile.builderCta.label;
    const showJakomuCredit = parsePublicBoolean(
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SHOW_JAKOMU_CREDIT'),
        defaultComingSoonProfile.jakomuCredit.show,
    );

    return {
        ...defaultComingSoonProfile,
        clientName,
        businessType,
        headline,
        valueProp,
        launchLabel,
        locationLabel,
        siteUrl: normalizeSiteUrl(siteUrl),
        heroImageSrc,
        logo: logoSrc ? { src: logoSrc, alt: logoAlt } : undefined,
        contact: {
            email: contactEmail,
            phone: contactPhone,
            phoneHref: buildPhoneHref(contactPhone),
        },
        signup: {
            ...defaultComingSoonProfile.signup,
            action: signupAction,
            method: readSignupMethod(env),
        },
        unsubscribe: {
            ...defaultComingSoonProfile.unsubscribe,
            action: unsubscribeAction,
        },
        socialLinks: readSocialLinks(env),
        builderCta: {
            ...defaultComingSoonProfile.builderCta,
            href: builderCtaHref,
            label: builderCtaLabel,
        },
        jakomuCredit: {
            ...defaultComingSoonProfile.jakomuCredit,
            show: showJakomuCredit,
        },
    };
}

export function buildComingSoonMetadata(profile: ComingSoonProfile): Metadata {
    const title = `${profile.clientName} | Coming Soon`;

    return {
        metadataBase: new URL(profile.siteUrl),
        title,
        description: profile.valueProp,
        applicationName: profile.clientName,
        robots: {
            index: true,
            follow: true,
        },
        openGraph: {
            type: 'website',
            title,
            description: profile.valueProp,
            siteName: profile.clientName,
            images: [
                {
                    url: profile.heroImageSrc,
                    alt: profile.heroImageAlt,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description: profile.valueProp,
            images: [profile.heroImageSrc],
        },
    };
}
