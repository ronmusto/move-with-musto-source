import Link from 'next/link';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import type { Neighborhood } from '@/lib/neighborhoods-data';
import type { Property } from '@/lib/properties-data';
import styles from './FeaturedProofSection.module.css';

type FeaturedProofSectionProps = {
    properties: Property[];
    neighborhoods: Neighborhood[];
};

export function FeaturedProofSection({ properties, neighborhoods }: FeaturedProofSectionProps) {
    const fallbackImage = properties[0]?.images[0];

    return (
        <section id="neighborhoods" className={styles.localSection} aria-labelledby="local-title">
            <div className={styles.backgroundWash} aria-hidden="true" />
            <div className={styles.localInner}>
                <div className={styles.sectionIntro}>
                    <div>
                        <h2 id="local-title">
                            Areas <span>served.</span>
                        </h2>
                        <p>
                            Explore homes across the Burlington-centered service area, organized
                            into seven connected regions. Get local context to understand how a
                            community may fit your plans.
                        </p>
                    </div>
                    <Link href="/buy/properties/">Search service-area homes</Link>
                </div>

                <div className={styles.neighborhoodGrid}>
                    {neighborhoods.map((neighborhood) => {
                        const image = neighborhood.image ?? fallbackImage;

                        return (
                            <Link
                                className={styles.neighborhoodCard}
                                href={`/buy/properties/?area=${encodeURIComponent(neighborhood.slug)}`}
                                key={neighborhood.slug}
                            >
                                {image ? (
                                    <div className={styles.imageFrame}>
                                        <LocalResponsiveImage
                                            alt={image.alt}
                                            className={styles.neighborhoodImage}
                                            height={image.height}
                                            sizes="(max-width: 900px) 90vw, 20vw"
                                            src={image.src}
                                            width={image.width}
                                        />
                                    </div>
                                ) : null}
                                <h3>{neighborhood.name}</h3>
                                <p>{neighborhood.description}</p>
                                <small>View listings</small>
                            </Link>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
