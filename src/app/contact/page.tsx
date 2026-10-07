import Image from 'next/image';
import type { Metadata } from 'next';
import { ContactInquiryForm } from './ContactInquiryForm';
import styles from './ContactPage.module.css';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

const profile = resolveRealEstateProfile();
const contactInquiry = profile.inquiry;

export const metadata: Metadata = {
    title: `Contact | ${profile.brandName}`,
    description: 'Get in touch about buying, selling, leasing, relocating, or planning a real estate decision.',
    alternates: { canonical: '/contact/' },
};

const advisoryNotes = [
    'A first conversation centered on your questions and timing.',
    'Practical next steps for buying, selling, leasing, relocating, or planning ahead.',
    'Follow-up shaped around your goals and where you are in the process.',
    'Local context across Burlington and surrounding Massachusetts communities.',
];

export default function ContactPage() {
    return (
        <main className={styles.contactPage}>
            <div className={styles.shell}>
                <aside className={styles.sidebar} aria-label={`${profile.agentName} profile`}>
                    <div className={styles.portraitFrame}>
                        <Image
                            src={profile.assets.portrait.src}
                            alt={profile.assets.portrait.alt}
                            width={profile.assets.portrait.width}
                            height={profile.assets.portrait.height}
                            className={styles.portrait}
                            sizes="(max-width: 760px) 100vw, 360px"
                            priority
                        />
                    </div>

                    <div className={styles.sidebarIntro}>
                        <p className={styles.eyebrow}>A personal approach</p>
                        <h1>{profile.agentName}</h1>
                        <p>
                            Bring your questions, wherever you are in the process. Get thoughtful
                            help with buying, selling, leasing, or planning a real estate decision.
                        </p>
                    </div>

                    <dl className={styles.marketDetails}>
                        <div>
                            <dt>Market</dt>
                            <dd>{profile.marketLabel}</dd>
                        </div>
                        <div>
                            <dt>Brokerage</dt>
                            <dd>{profile.brokerageName}</dd>
                        </div>
                    </dl>
                </aside>

                <section
                    id="contact-form"
                    className={styles.formColumn}
                    aria-labelledby="contact-heading"
                >
                    <div className={styles.inquiryCard}>
                        <p className={styles.eyebrow}>Get in touch</p>
                        <h2 id="contact-heading">Start with what you are considering.</h2>
                        <p className={styles.lead}>
                            {contactInquiry.action
                                ? 'Share as much or as little as feels useful. Questions, timing, and early ideas are all welcome.'
                                : 'Send a note to share what you are considering, or call if a conversation feels easier.'}
                        </p>

                        <ContactInquiryForm
                            contact={profile.contact}
                            inquiry={contactInquiry}
                            privacyVersion={profile.privacyVersion}
                            termsVersion={profile.termsVersion}
                        />
                    </div>

                    <div className={styles.advisoryNote} aria-label="What to expect">
                        <p className={styles.eyebrow}>What to expect</p>
                        <ul>
                            {advisoryNotes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    </div>
                </section>
            </div>
        </main>
    );
}
