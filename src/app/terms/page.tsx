import type { Metadata } from 'next';
import styles from '../legal.module.css';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

const profile = resolveRealEstateProfile();

export const metadata: Metadata = {
    title: `Terms | ${profile.brandName}`,
    description: `Terms for using the ${profile.brandName} website and real-estate inquiry forms.`,
    alternates: { canonical: '/terms/' },
};

export default function TermsPage() {
    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <nav className={styles.nav} aria-label="Legal navigation">
                    <a href="/">Back to {profile.brandName}</a>
                    <a href="/privacy/">Privacy</a>
                    <a href="/unsubscribe/">Unsubscribe</a>
                </nav>

                <header className={styles.titleBlock}>
                    <p className={styles.eyebrow}>Terms of use</p>
                    <h1>Website and inquiry terms.</h1>
                    <p>Last updated {profile.termsVersion}</p>
                </header>

                <div className={styles.content}>
                    <section aria-labelledby="terms-acceptance">
                        <h2 id="terms-acceptance">Acceptance</h2>
                        <p>
                            By using this website or submitting a {profile.brandName}
                            inquiry, you agree to these terms. If you do not agree,
                            please do not submit a form.
                        </p>
                    </section>

                    <section aria-labelledby="terms-inquiry">
                        <h2 id="terms-inquiry">Inquiry and email consent</h2>
                        <p>
                            Inquiry forms and email signup are voluntary. If you consent
                            to updates, you may receive real-estate follow-up and
                            occasional market updates from {profile.brandName}. Property
                            request forms authorize email or phone follow-up for the
                            submitted property request. This does not authorize automated
                            SMS or automated text messaging. You can
                            unsubscribe at any time from the website or from links
                            included in future emails.
                        </p>
                    </section>

                    <section aria-labelledby="terms-listings">
                        <h2 id="terms-listings">Listing data</h2>
                        <p>
                            MLS listing data is deemed reliable but not guaranteed.
                            Availability, price, status, facts, open houses, and photos can
                            change and should be confirmed before making real-estate
                            decisions. Listing attribution and notices shown with a property
                            are part of the listing information and should be retained when
                            discussing that property.
                        </p>
                    </section>

                    <section aria-labelledby="terms-google-maps">
                        <h2 id="terms-google-maps">Google Maps</h2>
                        <p>
                            The property search includes Google Maps features and content.
                            Your use of those features and content is subject to the
                            then-current{' '}
                            <a href="https://maps.google.com/help/terms_maps/">
                                Google Maps/Google Earth Additional Terms of Service
                            </a>{' '}
                            and the{' '}
                            <a href="https://policies.google.com/privacy">
                                Google Privacy Policy
                            </a>
                            . Google Maps content may not be copied, extracted, scraped, or
                            reused except as those terms allow. Google Maps is a third-party
                            service and does not sponsor or endorse this website or its
                            listings.
                        </p>
                    </section>

                    <section aria-labelledby="terms-content">
                        <h2 id="terms-content">General information only</h2>
                        <p>
                            Website and newsletter content is provided for general
                            informational purposes. It is not legal, tax, mortgage,
                            appraisal, or financial advice. Real-estate decisions should
                            be made with appropriately licensed professionals.
                        </p>
                    </section>

                    <section aria-labelledby="terms-availability">
                        <h2 id="terms-availability">Availability</h2>
                        <p>
                            This website may change as services, market information, or
                            available contact options are updated. We may update, pause, or
                            remove features as the business needs change.
                        </p>
                    </section>

                    <section aria-labelledby="terms-contact">
                        <h2 id="terms-contact">Contact</h2>
                        <p>
                            Questions about these terms can be sent to{' '}
                            <a href={`mailto:${profile.contact.email}`}>
                                {profile.contact.email}
                            </a>
                            .
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
