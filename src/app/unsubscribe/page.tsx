import type { Metadata } from 'next';
import { UnsubscribeForm } from '@/features/coming-soon/UnsubscribeForm';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';
import styles from '../legal.module.css';

const profile = resolveRealEstateProfile();

export const metadata: Metadata = {
    title: `Unsubscribe | ${profile.brandName}`,
    description: `Unsubscribe from ${profile.brandName} real-estate guidance and updates.`,
    alternates: { canonical: '/unsubscribe/' },
    robots: { index: false, follow: true },
};

export default function UnsubscribePage() {
    return (
        <main className={styles.page}>
            <div className={styles.shell}>
                <nav className={styles.nav} aria-label="Legal navigation">
                    <a href="/">Back to {profile.brandName}</a>
                    <a href="/privacy/">Privacy</a>
                    <a href="/terms/">Terms</a>
                </nav>

                <header className={styles.titleBlock}>
                    <p className={styles.eyebrow}>Email preferences</p>
                    <h1>Unsubscribe.</h1>
                    <p>
                        Enter your email address and we will add it to the Move With Musto
                        do-not-contact list.
                    </p>
                </header>

                <section className={styles.unsubscribePanel} aria-labelledby="unsubscribe-title">
                    <h2 id="unsubscribe-title">Email address</h2>
                    <UnsubscribeForm
                        action={profile.unsubscribeAction}
                        contactEmail={profile.contact.email}
                    />
                </section>
            </div>
        </main>
    );
}
