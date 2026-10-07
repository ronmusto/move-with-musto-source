import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import { isCommercialPublic } from '@/lib/commercial-visibility';
import {
    resolveRealEstateProfile,
    type RealEstateProfile,
} from '@/lib/real-estate-profile';
import styles from './commercial-page.module.css';

const profile = resolveRealEstateProfile();

export function generateMetadata(): Metadata {
    if (!isCommercialPublic()) {
        return {
            robots: { index: false, follow: false },
        };
    }

    return {
        title: `Commercial Real Estate | ${profile.brandName}`,
        description:
            `Talk with ${profile.agentName} about buying, selling, or leasing commercial property in Massachusetts. Commercial real estate brokerage services are offered through ${profile.brokerageName}.`,
        alternates: { canonical: '/commercial/' },
    };
}

const servicePaths = [
    {
        number: '01',
        label: 'Buy',
        title: 'Find a property that fits the plan.',
        copy:
            'Clarify the intended use, location, size, timing, and practical constraints before comparing available opportunities.',
    },
    {
        number: '02',
        label: 'Sell',
        title: 'Prepare for a thoughtful sale.',
        copy:
            'Begin with the property, your priorities, and the information buyers may need so the next steps can be organized clearly.',
    },
    {
        number: '03',
        label: 'Lease',
        title: 'Approach a lease with context.',
        copy:
            'Whether you need space or have space to offer, start by defining the business requirements and terms that matter most.',
    },
] as const;

const propertyTypes = [
    {
        title: 'Office',
        copy: 'Professional, medical, and flexible workplace considerations.',
    },
    {
        title: 'Retail',
        copy: 'Storefront, service, restaurant, and customer-facing spaces.',
    },
    {
        title: 'Industrial & flex',
        copy: 'Warehouse, production, distribution, and adaptable business space.',
    },
    {
        title: 'Multifamily',
        copy: 'Commercial residential properties with five or more units.',
    },
    {
        title: 'Mixed-use',
        copy: 'Properties that bring commercial and residential uses together.',
    },
    {
        title: 'Land & development sites',
        copy: 'Sites where use, access, utilities, approvals, and feasibility matter.',
    },
] as const;

const processSteps = [
    {
        title: 'Define the need',
        copy:
            'Put the intended use, preferred location, budget range, timing, and decision-makers in one clear starting brief.',
    },
    {
        title: 'Review the landscape',
        copy:
            'Look at available options and market context, then narrow the field around the criteria that matter to you.',
    },
    {
        title: 'Verify the details',
        copy:
            'Coordinate appropriate due diligence with qualified legal, financial, environmental, engineering, zoning, and lending professionals.',
    },
    {
        title: 'Move toward a decision',
        copy:
            'Organize the questions, communication, and transaction steps so you can make an informed choice at your own pace.',
    },
] as const;

const conversationStarters = [
    'Property address or target area',
    'Intended use and approximate size',
    'Buying, selling, leasing, or still deciding',
    'Budget or pricing expectations, if known',
    'Ideal timing and important constraints',
    'Other professionals already involved',
] as const;

function buildCommercialEmailHref(email: string) {
    const subject = encodeURIComponent('Commercial real estate conversation');
    const body = encodeURIComponent(
        [
            'Hi Mai Ly,',
            '',
            'I would like to discuss a commercial real estate need.',
            '',
            'Property or space:',
            'Location:',
            'Timing:',
            '',
            'Thank you,',
        ].join('\n'),
    );

    return `mailto:${email}?subject=${subject}&body=${body}`;
}

export function CommercialPageContent({
    profile,
}: Readonly<{ profile: RealEstateProfile }>) {
    const commercialEmailHref = buildCommercialEmailHref(profile.contact.email);

    return (
        <main className={styles.page}>
            <section className={styles.hero} aria-labelledby="commercial-title">
                <div className={styles.shell}>
                    <div className={styles.heroGrid}>
                        <div className={styles.heroCopy}>
                            <p className={styles.eyebrow}>Commercial real estate</p>
                            <h1 id="commercial-title">
                                A clear starting point for your next commercial move.
                            </h1>
                            <p className={styles.heroLead}>
                                Thoughtful brokerage support for people buying, selling, or leasing
                                commercial property in Massachusetts.
                            </p>
                            <div className={styles.heroActions}>
                                <Link className={styles.primaryAction} href="/commercial/properties/">
                                    Search commercial listings
                                </Link>
                                <Link className={styles.primaryAction} href="/contact#contact-form">
                                    Discuss a commercial need
                                </Link>
                                {profile.contact.phone ? (
                                    <a
                                        className={styles.secondaryAction}
                                        href={profile.contact.phoneHref}
                                    >
                                        Call {profile.contact.phone}
                                    </a>
                                ) : null}
                            </div>
                            <p className={styles.licenseLine}>
                                Commercial real estate brokerage services offered through{' '}
                                {profile.brokerageName}. {profile.agentName} is a{' '}
                                {profile.professionalLicense.jurisdiction}-licensed{' '}
                                {profile.professionalLicense.type}, License #
                                {profile.professionalLicense.number}.
                            </p>
                        </div>

                        <figure className={styles.heroVisual}>
                            <div className={styles.heroImageFrame}>
                                <LocalResponsiveImage
                                    alt="A commercial streetscape with storefronts and office buildings"
                                    fill
                                    priority
                                    sizes="(max-width: 960px) calc(100vw - 2rem), 48vw"
                                    src="/images/commercial/massachusetts-commercial-streetscape.webp"
                                />
                            </div>
                            <figcaption>
                                Commercial decisions begin with the property, the people, and the
                                purpose behind the move.
                            </figcaption>
                        </figure>
                    </div>
                </div>
            </section>

            <section className={styles.contextStrip} aria-label="Commercial service overview">
                <div className={styles.shell}>
                    <dl className={styles.contextList}>
                        <div>
                            <dt>Service paths</dt>
                            <dd>Buy · Sell · Lease</dd>
                        </div>
                        <div>
                            <dt>Market</dt>
                            <dd>Massachusetts</dd>
                        </div>
                        <div>
                            <dt>Approach</dt>
                            <dd>Clear, careful, collaborative</dd>
                        </div>
                    </dl>
                </div>
            </section>

            <section className={styles.pathways} aria-labelledby="pathways-title">
                <div className={styles.shell}>
                    <div className={styles.sectionIntro}>
                        <p className={styles.eyebrow}>Where the conversation can begin</p>
                        <h2 id="pathways-title">One commercial page. Three distinct paths.</h2>
                        <p>
                            Commercial buyers, sellers, landlords, and tenants share some of the
                            same questions, but the work begins differently. Choose the path closest
                            to your situation, even if the details are still taking shape.
                        </p>
                    </div>

                    <div className={styles.pathwayGrid}>
                        {servicePaths.map((path) => (
                            <article className={styles.pathwayCard} key={path.label}>
                                <div className={styles.cardMeta}>
                                    <span>{path.number}</span>
                                    <span>{path.label}</span>
                                </div>
                                <h3>{path.title}</h3>
                                <p>{path.copy}</p>
                                <a href={commercialEmailHref}>
                                    Start this conversation
                                    <span aria-hidden="true">→</span>
                                </a>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className={styles.propertySection} aria-labelledby="property-types-title">
                <div className={styles.shell}>
                    <div className={styles.propertyLayout}>
                        <div className={styles.propertyIntro}>
                            <p className={styles.eyebrow}>Property conversations</p>
                            <h2 id="property-types-title">
                                Start with the type of property—or simply the need.
                            </h2>
                            <p>
                                If your situation does not fit neatly into a category, that is fine.
                                An initial conversation can help identify the right questions and
                                the right specialists for the next step.
                            </p>
                        </div>

                        <div className={styles.propertyGrid}>
                            {propertyTypes.map((property, index) => (
                                <article className={styles.propertyCard} key={property.title}>
                                    <span>{String(index + 1).padStart(2, '0')}</span>
                                    <h3>{property.title}</h3>
                                    <p>{property.copy}</p>
                                </article>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            <section className={styles.processSection} aria-labelledby="commercial-process-title">
                <div className={styles.shell}>
                    <div className={styles.processHeader}>
                        <div>
                            <p className={styles.eyebrow}>A practical framework</p>
                            <h2 id="commercial-process-title">
                                Keep the process understandable from the first question forward.
                            </h2>
                        </div>
                        <p>
                            Commercial property can involve more variables and more professional
                            disciplines than a residential move. The role of a clear process is to
                            keep those pieces visible and organized.
                        </p>
                    </div>

                    <ol className={styles.processList}>
                        {processSteps.map((step, index) => (
                            <li key={step.title}>
                                <span>{String(index + 1).padStart(2, '0')}</span>
                                <div>
                                    <h3>{step.title}</h3>
                                    <p>{step.copy}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                </div>
            </section>

            <section className={styles.prepSection} aria-labelledby="commercial-prep-title">
                <div className={styles.shell}>
                    <div className={styles.prepGrid}>
                        <div className={styles.prepCopy}>
                            <p className={styles.eyebrow}>Before we talk</p>
                            <h2 id="commercial-prep-title">
                                A few details can make the first conversation more useful.
                            </h2>
                            <p>
                                Bring what you know and leave the unknowns open. The goal of the
                                first conversation is to understand the situation—not to have every
                                answer already prepared.
                            </p>
                            <div className={styles.prepActions}>
                                <a className={styles.primaryAction} href={commercialEmailHref}>
                                    Email the details
                                </a>
                                {profile.contact.phone ? (
                                    <a
                                        className={styles.darkSecondaryAction}
                                        href={profile.contact.phoneHref}
                                    >
                                        Call {profile.contact.phone}
                                    </a>
                                ) : null}
                            </div>
                        </div>

                        <ul className={styles.prepList}>
                            {conversationStarters.map((item) => (
                                <li key={item}>
                                    <span aria-hidden="true">✓</span>
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <p className={styles.disclaimer}>
                        Commercial real estate information on this page is general and is not legal,
                        tax, accounting, investment, appraisal, engineering, environmental, zoning,
                        or lending advice. Property availability, permitted use, zoning, financial
                        information, physical condition, and other material facts should be
                        independently verified with qualified professionals. Submitting an inquiry
                        alone does not establish an agency relationship. Commercial real estate
                        brokerage services are offered through {profile.brokerageName}.
                    </p>
                </div>
            </section>
        </main>
    );
}

export default function CommercialPage() {
    if (!isCommercialPublic()) {
        notFound();
    }

    return <CommercialPageContent profile={profile} />;
}
