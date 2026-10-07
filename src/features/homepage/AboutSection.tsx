import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './AboutSection.module.css';

type AboutSectionProps = {
    profile: RealEstateProfile;
};

export function AboutSection({ profile }: AboutSectionProps) {
    const roleLabel = profile.agentTitle.startsWith(`${profile.agentName},`)
        ? profile.agentTitle.slice(profile.agentName.length + 1).trim()
        : profile.agentTitle;

    return (
        <section id="about" className={styles.aboutSection} aria-labelledby="about-title">
            <div className={styles.aboutImageWrap}>
                <LocalResponsiveImage
                    alt={profile.assets.portrait.alt}
                    className={styles.aboutImage}
                    height={profile.assets.portrait.height}
                    sizes="(max-width: 900px) 90vw, 34vw"
                    src={profile.assets.portrait.src}
                    width={profile.assets.portrait.width}
                />
            </div>
            <div className={styles.aboutCopy}>
                <h2 id="about-title">
                    A steady partner <span>for your move.</span>
                </h2>
                <p>
                    Buying or selling a home comes with a lot of moving pieces. You will have
                    thoughtful help preparing, comparing options, and understanding what comes next.
                </p>
                <p>
                    You can expect thoughtful communication, practical local context,
                    and the support of {profile.brokerageName}.
                </p>
                <div className={styles.signature}>
                    <strong>{profile.agentName}</strong>
                    <span>{roleLabel} / {profile.brokerageName}</span>
                </div>
            </div>
        </section>
    );
}
