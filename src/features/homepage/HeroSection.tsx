import Link from 'next/link';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './HeroSection.module.css';

type HeroSectionProps = {
    profile: RealEstateProfile;
};

export function HeroSection({ profile }: HeroSectionProps) {
    return (
        <>
            <section className={styles.hero} aria-labelledby="home-title">
                <LocalResponsiveImage
                    alt=""
                    className={styles.heroImage}
                    fill
                    loading="eager"
                    priority
                    sizes="100vw"
                    src={profile.assets.hero.src}
                />
                <div className={styles.heroOverlay} />
                <div className={styles.heroInner}>
                    <div className={styles.heroContent}>
                        <p className={styles.eyebrow}>{profile.availabilityLabel}</p>
                        <h1 id="home-title" className={styles.heroTitle}>
                            {profile.headline}
                        </h1>
                        <p className={styles.heroCopy}>{profile.valueProp}</p>
                        <div className={styles.heroActions}>
                            <Link className={styles.primaryAction} href={profile.ctas.primary.href}>
                                {profile.ctas.primary.label}
                            </Link>
                            <Link className={styles.secondaryAction} href={profile.ctas.secondary.href}>
                                {profile.ctas.secondary.label}
                            </Link>
                        </div>
                    </div>
                    <aside className={styles.agentAside} aria-label={`${profile.agentName} real estate guidance`}>
                        <div className={styles.agentImageFrame}>
                            <LocalResponsiveImage
                                alt={profile.assets.detailPortrait.alt}
                                className={styles.agentImage}
                                height={profile.assets.detailPortrait.height}
                                sizes="(max-width: 760px) 38vw, 18vw"
                                src={profile.assets.detailPortrait.src}
                                width={profile.assets.detailPortrait.width}
                            />
                        </div>
                        <div className={styles.agentCaption}>
                            <span>{profile.agentName}</span>
                            <p>{profile.marketLabel}</p>
                        </div>
                    </aside>
                </div>
            </section>

            <section className={styles.trustBar} aria-label="Service highlights">
                <div className={styles.trustInner}>
                    {profile.proofPoints.map((point) => (
                        <div key={point} className={styles.trustItem}>
                            <span aria-hidden="true" className={styles.trustIcon} />
                            <span>{point}</span>
                        </div>
                    ))}
                </div>
            </section>
        </>
    );
}
