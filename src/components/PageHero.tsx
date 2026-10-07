import Image from 'next/image';
import type { RealEstateImage } from '@/lib/real-estate-profile';
import styles from './PageHero.module.css';

type PageHeroProps = {
    eyebrow?: string;
    title: string;
    subtitle?: string;
    image?: RealEstateImage;
    compact?: boolean;
};

export function PageHero({ eyebrow, title, subtitle, image, compact }: PageHeroProps) {
    return (
        <section className={`${styles.pageHero} ${compact ? styles.compact : ''}`}>
            {image ? (
                <>
                    <Image
                        alt={image.alt}
                        className={styles.heroImage}
                        fill
                        priority
                        sizes="100vw"
                        src={image.src}
                    />
                    <div className={styles.heroShade} />
                </>
            ) : null}
            <div className={styles.heroContent}>
                {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
                <h1 className={styles.heroTitle}>{title}</h1>
                {subtitle ? <p className={styles.heroSubtitle}>{subtitle}</p> : null}
            </div>
        </section>
    );
}
