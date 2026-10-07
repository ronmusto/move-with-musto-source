import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './MarketSection.module.css';

type MarketSectionProps = {
    profile: RealEstateProfile;
};

export function MarketSection({ profile }: MarketSectionProps) {
    return (
        <section className={styles.marketSection} aria-labelledby="market-title">
            <div className={styles.marketCopy}>
                <p className={styles.eyebrow}>Market perspective</p>
                <h2 id="market-title">Clarity before urgency.</h2>
                <p>
                    A confident move is rarely made from a single showing or a single
                    estimate. It comes from understanding price, pace, presentation,
                    tradeoffs, and what each choice means for the next one.
                </p>
                <ul>
                    {profile.approach.map((item) => (
                        <li key={item} className={styles.approachItem}>
                            {item}
                        </li>
                    ))}
                </ul>
            </div>
            <div className={styles.marketImageWrap}>
                <LocalResponsiveImage
                    alt={profile.assets.detailPortrait.alt}
                    className={styles.marketImage}
                    height={profile.assets.detailPortrait.height}
                    sizes="(max-width: 900px) 92vw, 35vw"
                    src={profile.assets.detailPortrait.src}
                    width={profile.assets.detailPortrait.width}
                />
            </div>
        </section>
    );
}
