import type { Metadata } from 'next';
import Link from 'next/link';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import { resolveRealEstateProfile, type RealEstateProfile } from '@/lib/real-estate-profile';
import { SellerInquiryForm } from './SellerInquiryForm';
import styles from './sell-page.module.css';

const profile = resolveRealEstateProfile();

export const metadata: Metadata = {
    title: `Sell With ${profile.agentName} | ${profile.brandName}`,
    description:
        'Talk with Mai Ly Musto about your home, timing, and hopes for the move, and get thoughtful guidance for what comes next.',
    alternates: { canonical: '/sell/' },
};

const representationPromises = [
    {
        title: 'A conversation centered on you',
        copy:
            'Start with what you are considering, what feels uncertain, and what would make the move feel successful.',
    },
    {
        title: 'A plan for your home',
        copy:
            'You will have help understanding the market, preparing thoughtfully, and choosing next steps that fit your timing and priorities.',
    },
    {
        title: 'Support from start to finish',
        copy:
            'You will have clear communication and a steady point of contact as decisions, offers, and details unfold.',
    },
] as const;

export function SellerPageContent({ profile }: Readonly<{ profile: RealEstateProfile }>) {
    return (
        <main className={styles.page}>
            <section className={styles.hero} aria-labelledby="sell-hero-title">
                <LocalResponsiveImage
                    alt={profile.assets.hero.alt}
                    className={styles.heroImage}
                    fill
                    priority
                    sizes="100vw"
                    src={profile.assets.hero.src}
                />
                <div className={styles.heroTint} />
                <div className={styles.heroShell}>
                    <div className={styles.heroCopy}>
                        <p className={styles.eyebrow}>Thinking about selling?</p>
                        <h1 id="sell-hero-title">Your next move can start with a simple conversation.</h1>
                        <p>
                            You do not need to have every detail figured out. Share what you are
                            considering, and start with a comfortable next step.
                        </p>
                        <div className={styles.heroActions}>
                            <Link className={styles.primaryButton} href="#valuation">
                                Share what you are considering
                            </Link>
                            {profile.appointmentCta ? (
                                <a className={styles.secondaryButton} href={profile.appointmentCta.href}>
                                    Choose a time to talk
                                </a>
                            ) : null}
                        </div>
                    </div>
                    <aside className={styles.heroPlanCard} aria-label="What working together feels like">
                        <span>A thoughtful process</span>
                        <dl>
                            <div><dt>01</dt><dd>Listen first</dd></div>
                            <div><dt>02</dt><dd>Plan together</dd></div>
                            <div><dt>03</dt><dd>Stay connected</dd></div>
                        </dl>
                    </aside>
                </div>
            </section>

            <section className={styles.needSection} aria-labelledby="seller-representation-title">
                <div className={styles.needLayout}>
                    <div>
                        <div className={styles.sectionHeader}>
                            <p className={styles.eyebrow}>What you can expect</p>
                            <h2 id="seller-representation-title">Guidance shaped around your home and your goals.</h2>
                            <p>
                                Every seller&apos;s situation is different. The process begins by
                                listening, then building a plan that fits your timing, priorities,
                                and comfort level.
                            </p>
                        </div>
                        <div className={styles.valueList}>
                            {representationPromises.map((promise) => (
                                <article className={styles.valuePoint} key={promise.title}>
                                    <h3>{promise.title}</h3>
                                    <p>{promise.copy}</p>
                                </article>
                            ))}
                        </div>
                    </div>

                    <figure className={styles.needVisual}>
                        <div className={styles.needImageFrame}>
                            <LocalResponsiveImage
                                alt="Mai Ly Musto in a bright home interior"
                                fill
                                sizes="(max-width: 980px) 100vw, 34vw"
                                src="/images/brand/agent/mai-ly-musto-interior-color-web.webp"
                            />
                        </div>
                        <figcaption>
                            A thoughtful plan begins with your home, your timing, and what a
                            successful move looks like to you.
                        </figcaption>
                    </figure>
                </div>
            </section>

            <section className={styles.valuationSection} id="valuation" aria-labelledby="valuation-title">
                <div className={styles.valuationIntro}>
                    <p className={styles.eyebrow}>A comfortable first step</p>
                    <h2 id="valuation-title">Share what is on your mind.</h2>
                    <p>
                        You can share as much or as little as you are ready to. You will receive a
                        personal follow-up and, as you begin working together, the detailed planning
                        materials that fit your situation.
                    </p>
                </div>

                <SellerInquiryForm
                    contact={profile.contact}
                    inquiry={profile.inquiry}
                    privacyVersion={profile.privacyVersion}
                    termsVersion={profile.termsVersion}
                />
            </section>
        </main>
    );
}

export default function SellPage() {
    return <SellerPageContent profile={profile} />;
}
