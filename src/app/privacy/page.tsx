import type { Metadata } from 'next';
import styles from '../legal.module.css';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

const profile = resolveRealEstateProfile();

export const metadata: Metadata = {
    title: `Privacy | ${profile.brandName}`,
    description: `Privacy policy for the ${profile.brandName} website and real-estate inquiry forms.`,
    alternates: { canonical: '/privacy/' },
};

export default function PrivacyPage() {
    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <nav className={styles.nav} aria-label="Legal navigation">
                    <a href="/">Back to {profile.brandName}</a>
                    <a href="/terms/">Terms</a>
                    <a href="/unsubscribe/">Unsubscribe</a>
                </nav>

                <header className={styles.titleBlock}>
                    <p className={styles.eyebrow}>Privacy policy</p>
                    <h1>How inquiry data is handled.</h1>
                    <p>Last updated {profile.privacyVersion}</p>
                </header>

                <div className={styles.content}>
                    <section aria-labelledby="privacy-collection">
                        <h2 id="privacy-collection">Information collected</h2>
                        <p>
                            If you submit a {profile.brandName} inquiry or join an email list, we collect
                            the email address you provide and, if entered, your name, phone
                            number, and message. We also record consent metadata such as
                            signup source, terms/privacy version, and submission timestamp.
                            Property requests create property lead records that may include
                            the request type, attached MLS numbers, pasted property address
                            or listing link, source page, selected listing context, and
                            consent metadata.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-use">
                        <h2 id="privacy-use">How it is used</h2>
                        <p>
                            Inquiry information is used to respond to your request, send
                            occasional real-estate updates when you consent, and notify the
                            team that a voluntary submission was received. We do not sell the list or use it
                            for unrelated third-party advertising. MLS listing interactions
                            are used only to understand the homes, filters, or property
                            links connected to your request.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-browser-storage">
                        <h2 id="privacy-browser-storage">Browser storage</h2>
                        <p>
                            The properties page uses localStorage to remember saved homes,
                            compared homes, filters, and sort order on your device. It is
                            not used to store your name, email address, phone number, or
                            request message.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-maps">
                        <h2 id="privacy-maps">Maps and location information</h2>
                        <p>
                            The property search uses Google Maps to display listings and
                            search areas. When you open or use the map, Google may receive
                            information needed to provide it, such as your IP address,
                            browser or device information, the area shown, and your
                            interactions with the map. Google may use cookies or similar
                            technologies while providing the map and handles that
                            information under the{' '}
                            <a href="https://policies.google.com/privacy">
                                Google Privacy Policy
                            </a>
                            .
                        </p>
                        <p>
                            To place homes on the map, listing addresses may be sent to the
                            Google Geocoding API. We use the resulting coordinates only to
                            support property search and mapping, and keep them for no more
                            than 30 days. They are then deleted or updated if the listing
                            still needs to appear on the map. The website does not request
                            access to your device&apos;s precise location.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-unsubscribe">
                        <h2 id="privacy-unsubscribe">Unsubscribing</h2>
                        <p>
                            You may unsubscribe at any time. Unsubscribed addresses are kept
                            as minimal suppression records so they are not accidentally added
                            back to the newsletter list.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-service-providers">
                        <h2 id="privacy-service-providers">Service providers</h2>
                        <p>
                            The site may use hosting, form-processing, data-storage, and
                            email-delivery providers to operate the website and respond to
                            voluntary requests. Information is shared with those providers
                            only as needed to perform those services, subject to their
                            service terms and privacy practices.
                        </p>
                        <p>
                            During the temporary inquiry-email setup, Amazon Web Services
                            and Amazon Simple Email Service process a voluntary submission
                            only to deliver it to the agent&apos;s verified mailbox. Submitting
                            an inquiry does not by itself enroll you in marketing or send an
                            automated confirmation to your email address.
                        </p>
                    </section>

                    <section aria-labelledby="privacy-rights">
                        <h2 id="privacy-rights">Privacy requests</h2>
                        <p>
                            You can request access, correction, unsubscribe, or deletion by
                            contacting{' '}
                            <a href={`mailto:${profile.contact.email}`}>
                                {profile.contact.email}
                            </a>
                            . Some requests may require retaining a minimal suppression
                            record so email opt-out preferences remain honored.
                        </p>
                    </section>
                </div>
            </div>
        </main>
    );
}
