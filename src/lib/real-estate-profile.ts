import type { Metadata } from 'next';
import { getBrandAsset, type BrandAsset } from './brand-assets.generated';
import type { ComingSoonSignupMethod } from './coming-soon-config';

type PublicEnv = Record<string, string | undefined>;

export type RealEstateImage = {
    src: string;
    srcSet?: string;
    alt: string;
    width: number;
    height: number;
};

export type RealEstateLogo = RealEstateImage;

export type RealEstateCta = {
    label: string;
    href: string;
};

export type RealEstateContact = {
    email: string;
    phone: string;
    phoneHref: string;
};

export type RealEstateProfessionalLicense = {
    jurisdiction: string;
    type: string;
    number: string;
};

export type RealEstateInquiry = {
    action?: string;
    method: ComingSoonSignupMethod;
};

export type RealEstateSocialLink = {
    label: string;
    href: string;
};

export type RealEstateService = {
    title: string;
    description: string;
    href: string;
};

export type RealEstateProfile = {
    brandName: string;
    agentName: string;
    agentTitle: string;
    brokerageName: string;
    professionalLicense: RealEstateProfessionalLicense;
    siteUrl: string;
    headline: string;
    valueProp: string;
    marketLabel: string;
    availabilityLabel: string;
    proofPoints: string[];
    services: RealEstateService[];
    approach: string[];
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    appointmentCta?: RealEstateCta;
    unsubscribeAction?: string;
    termsVersion: string;
    privacyVersion: string;
    socialLinks: RealEstateSocialLink[];
    ctas: {
        primary: RealEstateCta;
        secondary: RealEstateCta;
        email: RealEstateCta;
    };
    assets: {
        hero: RealEstateImage;
        portrait: RealEstateImage;
        detailPortrait: RealEstateImage;
        brokerageLogo: RealEstateLogo;
        equalHousingLogo: RealEstateLogo;
        realtorLogo: RealEstateLogo;
    };
};

function readEnv(env: PublicEnv, key: string): string | undefined {
    const value = env[key];
    return value && value.trim() ? value.trim() : undefined;
}

function normalizeSiteUrl(siteUrl: string): string {
    const withProtocol = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;

    try {
        return new URL(withProtocol).origin;
    } catch {
        return 'https://movewithmusto.com';
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

function readInquiryMethod(): ComingSoonSignupMethod {
    return 'post';
}

function readSocialLinks(env: PublicEnv): RealEstateSocialLink[] {
    const socialCandidates: Array<[string, string | undefined]> = [
        ['Instagram', readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_INSTAGRAM_URL') ?? readEnv(env, 'NEXT_PUBLIC_COMING_SOON_INSTAGRAM_URL')],
        ['LinkedIn', readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_LINKEDIN_URL') ?? readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LINKEDIN_URL')],
        ['Facebook', readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_FACEBOOK_URL') ?? readEnv(env, 'NEXT_PUBLIC_COMING_SOON_FACEBOOK_URL')],
    ];

    return socialCandidates
        .filter((candidate): candidate is [string, string] => candidate[1] !== undefined)
        .map(([label, href]) => ({ label, href }));
}

function imageFromAsset(asset: BrandAsset | undefined, fallback: RealEstateImage): RealEstateImage {
    if (!asset || asset.width === null || asset.height === null) {
        return fallback;
    }

    return {
        ...fallback,
        src: asset.path,
        width: asset.width,
        height: asset.height,
    };
}

function imageSetFromAssets(
    standardAsset: BrandAsset | undefined,
    highDensityAsset: BrandAsset | undefined,
    fallback: RealEstateImage,
): RealEstateImage {
    if (!standardAsset || standardAsset.width === null || standardAsset.height === null) {
        return fallback;
    }

    const standardImage = imageFromAsset(standardAsset, fallback);
    if (
        !highDensityAsset ||
        highDensityAsset.width === null ||
        highDensityAsset.height === null
    ) {
        return standardImage;
    }

    return {
        ...standardImage,
        srcSet: `${standardAsset.path} 1x, ${highDensityAsset.path} 2x`,
    };
}

export const defaultRealEstateProfile: RealEstateProfile = {
    brandName: 'Move With Musto',
    agentName: 'Mai Ly Musto',
    agentTitle: 'Mai Ly Musto, REALTOR®',
    brokerageName: 'Dream Seekers Realty, LLC',
    professionalLicense: {
        jurisdiction: 'Massachusetts',
        type: 'Real Estate Salesperson',
        number: '9572796-RE-S',
    },
    siteUrl: 'https://movewithmusto.com',
    headline: 'Move With Musto',
    valueProp:
        'Personal guidance for buying, selling, and planning a move across Burlington and surrounding Massachusetts communities.',
    marketLabel: 'Burlington-area and surrounding Massachusetts communities',
    availabilityLabel: 'Serving Burlington and surrounding Massachusetts communities',
    proofPoints: [
        'Clear preparation and next steps',
        'Local context for buyers',
        'A thoughtful plan for sellers',
    ],
    services: [
        {
            title: 'Sell With a Clear Plan',
            href: '/sell/',
            description:
                'Get thoughtful help preparing, pricing, and presenting your home in a way that fits your goals and timing.',
        },
        {
            title: 'Buy With Local Insight',
            href: '/buy/properties/',
            description:
                'Explore homes with local context, compare what matters to you, and feel prepared when you find the right fit.',
        },
        {
            title: 'Plan Your Next Move',
            href: '/contact/',
            description:
                'Talk through timing, equity, neighborhoods, and early questions without needing to have every detail figured out.',
        },
    ],
    approach: [
        'Start with your goals, questions, and preferred pace.',
        'Make each showing and conversation easier to understand.',
        'Stay informed with clear, practical communication.',
    ],
    contact: {
        email: 'maily@movewithmusto.com',
        phone: '(781) 315-3845',
        phoneHref: 'tel:+17813153845',
    },
    inquiry: {
        action: undefined,
        method: 'post',
    },
    appointmentCta: undefined,
    unsubscribeAction: undefined,
    termsVersion: '2026-07-13',
    privacyVersion: '2026-07-13',
    socialLinks: [],
    ctas: {
        primary: {
            label: 'Search homes',
            href: '/buy/properties/',
        },
        secondary: {
            label: 'Get in touch',
            href: '/contact/',
        },
        email: {
            label: 'Send an email',
            href: 'mailto:maily@movewithmusto.com',
        },
    },
    assets: {
        hero: {
            src: '/images/areas/massachusetts-daytime-hero.webp',
            alt: 'Daytime Massachusetts harbor neighborhood with shingle homes, hydrangeas, and water views',
            width: 1847,
            height: 851,
        },
        portrait: imageFromAsset(getBrandAsset('agent-mai-ly-musto-studio-standing-bw-web'), {
            src: '/images/brand/agent/mai-ly-musto-studio-standing-bw-web.webp',
            alt: 'Black and white portrait of Mai Ly Musto in a studio setting',
            width: 1067,
            height: 1600,
        }),
        detailPortrait: imageFromAsset(getBrandAsset('agent-mai-ly-musto-couch-color-web'), {
            src: '/images/brand/agent/mai-ly-musto-couch-color-web.webp',
            alt: 'Mai Ly Musto seated in a bright living room',
            width: 960,
            height: 1600,
        }),
        brokerageLogo: imageSetFromAssets(
            getBrandAsset('general-dream-seekers-realty-logo-96w'),
            getBrandAsset('general-dream-seekers-realty-logo-192w'),
            {
                src: '/images/brand/general/dream-seekers-realty-logo.jpg',
                alt: 'Dream Seekers Realty logo',
                width: 2137,
                height: 2137,
            },
        ),
        equalHousingLogo: imageSetFromAssets(
            getBrandAsset('general-equal-housing-opportunity-logo-1200w-96w'),
            getBrandAsset('general-equal-housing-opportunity-logo-1200w-192w'),
            {
                src: '/images/brand/general/equal-housing-opportunity-logo-1200w.png',
                alt: 'Equal Housing Opportunity logo',
                width: 1130,
                height: 1209,
            },
        ),
        realtorLogo: imageSetFromAssets(
            getBrandAsset('realtor-realtor-logo-blue-96w'),
            getBrandAsset('realtor-realtor-logo-blue-192w'),
            {
                src: '/images/brand/realtor/realtor-logo-blue.jpg',
                alt: 'REALTOR® logo',
                width: 450,
                height: 499,
            },
        ),
    },
};

export function resolveRealEstateProfile(env: PublicEnv = process.env): RealEstateProfile {
    const brandName = readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_BRAND_NAME') ?? defaultRealEstateProfile.brandName;
    const agentName = readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_AGENT_NAME') ?? defaultRealEstateProfile.agentName;
    const contactEmail =
        readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_CONTACT_EMAIL') ??
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_CONTACT_EMAIL') ??
        defaultRealEstateProfile.contact.email;
    const contactPhone =
        readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_CONTACT_PHONE') ??
        readEnv(env, 'NEXT_PUBLIC_COMING_SOON_CONTACT_PHONE') ??
        defaultRealEstateProfile.contact.phone;
    const appointmentHref =
        readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_APPOINTMENT_URL') ??
        readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_BOOKING_URL') ??
        readEnv(env, 'NEXT_PUBLIC_CALENDLY_URL');

    return {
        ...defaultRealEstateProfile,
        brandName,
        agentName,
        agentTitle:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_AGENT_TITLE') ??
            defaultRealEstateProfile.agentTitle,
        brokerageName:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_BROKERAGE_NAME') ??
            defaultRealEstateProfile.brokerageName,
        siteUrl: normalizeSiteUrl(
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_SITE_URL') ??
                readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SITE_URL') ??
                defaultRealEstateProfile.siteUrl,
        ),
        headline:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_HEADLINE') ??
            defaultRealEstateProfile.headline,
        valueProp:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_VALUE_PROP') ??
            defaultRealEstateProfile.valueProp,
        marketLabel:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_MARKET_LABEL') ??
            readEnv(env, 'NEXT_PUBLIC_COMING_SOON_LOCATION_LABEL') ??
            defaultRealEstateProfile.marketLabel,
        availabilityLabel:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_AVAILABILITY_LABEL') ??
            defaultRealEstateProfile.availabilityLabel,
        contact: {
            email: contactEmail,
            phone: contactPhone,
            phoneHref: buildPhoneHref(contactPhone),
        },
        inquiry: {
            action:
                readEnv(env, 'NEXT_PUBLIC_INQUIRY_FORM_ACTION') ??
                readEnv(env, 'NEXT_PUBLIC_COMING_SOON_SIGNUP_ACTION'),
            method: readInquiryMethod(),
        },
        appointmentCta: appointmentHref
            ? {
                label:
                    readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_APPOINTMENT_LABEL') ??
                    'Choose a time to talk',
                href: appointmentHref,
            }
            : undefined,
        unsubscribeAction:
            readEnv(env, 'NEXT_PUBLIC_REAL_ESTATE_UNSUBSCRIBE_ACTION') ??
            readEnv(env, 'NEXT_PUBLIC_COMING_SOON_UNSUBSCRIBE_ACTION') ??
            defaultRealEstateProfile.unsubscribeAction,
        socialLinks: readSocialLinks(env),
        ctas: {
            ...defaultRealEstateProfile.ctas,
            email: {
                label: defaultRealEstateProfile.ctas.email.label,
                href: `mailto:${contactEmail}`,
            },
        },
        termsVersion: defaultRealEstateProfile.termsVersion,
        privacyVersion: defaultRealEstateProfile.privacyVersion,
    };
}

export function buildRealEstateMetadata(profile: RealEstateProfile): Metadata {
    const title = `${profile.brandName} | ${profile.agentName} Real Estate`;

    return {
        metadataBase: new URL(profile.siteUrl),
        title,
        description: profile.valueProp,
        applicationName: profile.brandName,
        robots: {
            index: true,
            follow: true,
        },
        openGraph: {
            type: 'website',
            title,
            description: profile.valueProp,
            siteName: profile.brandName,
            images: [
                {
                    url: profile.assets.hero.src,
                    alt: profile.assets.hero.alt,
                },
            ],
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description: profile.valueProp,
            images: [profile.assets.hero.src],
        },
    };
}
