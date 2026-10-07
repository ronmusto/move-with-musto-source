import type { RealEstateProfile } from '@/lib/real-estate-profile';
import { LeadInquiryForm } from './LeadInquiryForm';
import styles from './InquirySection.module.css';

type InquirySectionProps = {
    profile: RealEstateProfile;
};

export function InquirySection({ profile }: InquirySectionProps) {
    return (
        <section id="inquiry" className={styles.inquirySection} aria-labelledby="inquiry-title">
            <div className={styles.inquiryCard}>
                <div className={styles.inquiryIntro}>
                    <p className={styles.eyebrow}>Start a conversation</p>
                    <h2 id="inquiry-title">Start with the move you are considering.</h2>
                    <p>
                        Share what you are weighing, even if the timeline is early. A thoughtful
                        conversation can help clarify the next practical step.
                    </p>
                    <dl className={styles.contactList}>
                        {profile.inquiry.action ? (
                            <>
                                <div>
                                    <dt>Email</dt>
                                    <dd>
                                        <a href={`mailto:${profile.contact.email}`}>{profile.contact.email}</a>
                                    </dd>
                                </div>
                                {profile.contact.phone ? (
                                    <div>
                                        <dt>Phone</dt>
                                        <dd>
                                            <a href={profile.contact.phoneHref}>{profile.contact.phone}</a>
                                        </dd>
                                    </div>
                                ) : null}
                            </>
                        ) : null}
                        <div>
                            <dt>Market</dt>
                            <dd>{profile.marketLabel}</dd>
                        </div>
                    </dl>
                </div>
                <div className={styles.inquiryPanel}>
                    <LeadInquiryForm
                        contact={profile.contact}
                        inquiry={profile.inquiry}
                        privacyVersion={profile.privacyVersion}
                        termsVersion={profile.termsVersion}
                    />
                </div>
            </div>
        </section>
    );
}
