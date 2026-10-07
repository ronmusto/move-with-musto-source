import Image from 'next/image';
import type { ComingSoonProfile } from '@/lib/coming-soon-config';
import { LaunchWaitlistForm } from './LaunchWaitlistForm';
import styles from './RealEstateComingSoon.module.css';

type RealEstateComingSoonProps = {
    profile: ComingSoonProfile;
};

export function RealEstateComingSoon({ profile }: RealEstateComingSoonProps) {
    return (
        <main className={styles.page}>
            <section className={styles.hero} aria-labelledby="coming-soon-title">
                <Image
                    alt={profile.heroImageAlt}
                    className={styles.heroImage}
                    fill
                    priority
                    sizes="100vw"
                    src={profile.heroImageSrc}
                />
                <div className={styles.heroShade} />

                <header className={styles.header}>
                    <a className={styles.brand} href="#top" aria-label={`${profile.clientName} home`}>
                        {profile.logo ? (
                            <Image
                                alt={profile.logo.alt}
                                className={styles.logo}
                                height={44}
                                src={profile.logo.src}
                                width={160}
                            />
                        ) : (
                            <span>{profile.clientName}</span>
                        )}
                    </a>
                    {profile.jakomuCredit.show ? (
                        <a className={styles.credit} href={profile.jakomuCredit.href}>
                            {profile.jakomuCredit.label}
                        </a>
                    ) : null}
                </header>

                <div className={styles.heroLayout}>
                    <div className={styles.heroContent}>
                        <p className={styles.eyebrow}>{profile.businessType}</p>
                        <h1 id="coming-soon-title">{profile.headline}</h1>
                        <p className={styles.valueProp}>{profile.valueProp}</p>
                        <dl className={styles.launchMeta} aria-label="Launch timing and market">
                            <div>
                                <dt>Launch</dt>
                                <dd>{profile.launchLabel}</dd>
                            </div>
                            <div>
                                <dt>Markets</dt>
                                <dd>{profile.locationLabel}</dd>
                            </div>
                        </dl>
                    </div>

                    <aside
                        id="waitlist"
                        className={styles.heroInquiry}
                        aria-labelledby="waitlist-title"
                    >
                        <p className={styles.formKicker}>Private launch list</p>
                        <h2 id="waitlist-title">Start the conversation early.</h2>
                        <LaunchWaitlistForm
                            action={profile.signup.action}
                            builderCta={profile.builderCta}
                            contactEmail={profile.contact.email}
                            method={profile.signup.method}
                            privacyVersion={profile.privacyVersion}
                            termsVersion={profile.termsVersion}
                        />
                    </aside>
                </div>
            </section>

            <section className={styles.details} aria-label={`${profile.clientName} launch details`}>
                <div className={styles.detailsIntro}>
                    <p className={styles.eyebrow}>Coming soon</p>
                    <h2>{profile.clientName} is preparing to guide your next move.</h2>
                </div>

                <div className={styles.detailGrid}>
                    <section className={styles.valueList} aria-labelledby="coming-next-title">
                        <h3 id="coming-next-title">What is coming</h3>
                        <ul>
                            {profile.highlights.map((highlight) => (
                                <li key={highlight}>{highlight}</li>
                            ))}
                        </ul>
                    </section>

                    <section className={styles.contactPanel} aria-labelledby="contact-title">
                        <h3 id="contact-title">Contact</h3>
                        <dl>
                            <div>
                                <dt>Email</dt>
                                <dd>
                                    <a href={`mailto:${profile.contact.email}`}>
                                        {profile.contact.email}
                                    </a>
                                </dd>
                            </div>
                            {profile.contact.phone ? (
                                <div>
                                    <dt>Phone</dt>
                                    <dd>
                                        <a href={profile.contact.phoneHref}>
                                            {profile.contact.phone}
                                        </a>
                                    </dd>
                                </div>
                            ) : null}
                            <div>
                                <dt>Markets</dt>
                                <dd>{profile.locationLabel}</dd>
                            </div>
                        </dl>
                    </section>

                    <section className={styles.promisePanel} aria-labelledby="promise-title">
                        <p className={styles.eyebrow}>Approach</p>
                        <h3 id="promise-title">Thoughtful strategy, steady guidance.</h3>
                        <p>
                            Expect buyer and seller guidance shaped around timing,
                            pricing, neighborhood context, and the decisions that make a
                            move feel less overwhelming.
                        </p>
                    </section>
                </div>

                <section className={styles.builderPanel} aria-labelledby="builder-title">
                    <div>
                        <p className={styles.eyebrow}>Built by Jakomu</p>
                        <h2 id="builder-title">Need a website before your own launch?</h2>
                    </div>
                    <p>
                        Jakomu builds polished websites and practical business tools for local
                        brands that need to look credible before the full operation is ready.
                    </p>
                    <a href={profile.builderCta.href}>{profile.builderCta.label}</a>
                </section>

                <footer className={styles.footer}>
                    {profile.socialLinks.length > 0 ? (
                        <nav aria-label="Social links">
                            {profile.socialLinks.map((link) => (
                                <a key={link.label} href={link.href}>
                                    {link.label}
                                </a>
                            ))}
                        </nav>
                    ) : null}
                    <nav aria-label="Policy links">
                        <a href="/privacy/">Privacy</a>
                        <a href="/terms/">Terms</a>
                        <a href="/unsubscribe/">Unsubscribe</a>
                    </nav>
                    {profile.jakomuCredit.show ? (
                        <a href={profile.jakomuCredit.href}>{profile.jakomuCredit.label}</a>
                    ) : null}
                </footer>
            </section>
        </main>
    );
}
