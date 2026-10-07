import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { LocalResponsiveImage } from '@/components/LocalResponsiveImage';
import { marketRegionNames } from '@/lib/market-regions';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';
import styles from './page.module.css';

const profile = resolveRealEstateProfile();

const advisoryCards = [
    {
        number: '01',
        title: 'Start with your goals',
        copy:
            'Begin with your timing, questions, and what a successful move looks like for you.',
    },
    {
        number: '02',
        title: 'Steady support',
        copy:
            'Work through pricing, offers, negotiation, and the decisions along the way with steady support.',
    },
    {
        number: '03',
        title: 'Clear communication',
        copy:
            'You receive clear context and consistent communication so each next step makes sense.',
    },
];

const localNotes = marketRegionNames;

const maiLyInteriorImage = {
    src: '/images/brand/agent/mai-ly-musto-interior-color-web.webp',
    alt: 'Mai Ly Musto standing in a bright interior space',
    width: 1800,
    height: 1500,
};

export const metadata: Metadata = {
    title: `About ${profile.agentName} | ${profile.brandName}`,
    description: `${profile.agentName} offers thoughtful residential real estate guidance through ${profile.brandName}.`,
    alternates: { canonical: '/about/' },
};

export default function AboutPage() {
    return (
        <main className={styles.aboutPage}>
            <section className={styles.hero} aria-labelledby="about-title">
                <div className={styles.shell}>
                    <div className={styles.heroGrid}>
                        <figure className={styles.portraitFrame}>
                            <Image
                                alt={profile.assets.portrait.alt}
                                className={styles.portraitImage}
                                height={profile.assets.portrait.height}
                                priority
                                sizes="(max-width: 760px) 88vw, (max-width: 1100px) 40vw, 430px"
                                src={profile.assets.portrait.src}
                                width={profile.assets.portrait.width}
                            />
                            <figcaption className={styles.imageCaption}>
                                {profile.marketLabel}
                            </figcaption>
                        </figure>

                        <div className={styles.heroCopy}>
                            <p className={styles.eyebrow}>Meet your agent</p>
                            <h1 id="about-title">Mai Ly Musto.</h1>
                            <p className={styles.lead}>
                                Every move begins in a different place—an early question, a change
                                in timing, or a home that no longer fits. The goal is to bring the
                                pieces together in a way that feels manageable.
                            </p>
                            <p className={styles.copy}>
                                Her prepared, personal approach supports buyers, sellers, and clients
                                weighing their next chapter across a Burlington-centered Massachusetts
                                service area.
                            </p>
                            <div className={styles.actions}>
                                <Link className={styles.primaryAction} href="/contact/">
                                    Start a conversation
                                </Link>
                                <Link className={styles.secondaryAction} href="/buy/properties/">
                                    Start buyer search
                                </Link>
                            </div>
                            <dl className={styles.credentials} aria-label="Mai Ly Musto credentials">
                                <div>
                                    <dt>Role</dt>
                                    <dd>{profile.agentTitle}</dd>
                                </div>
                                <div>
                                    <dt>Market</dt>
                                    <dd>{profile.marketLabel}</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                </div>
            </section>

            <section className={styles.approach} aria-labelledby="approach-title">
                <div className={styles.shell}>
                    <div className={styles.sectionHeading}>
                        <p className={styles.eyebrow}>What working together looks like</p>
                        <h2 id="approach-title">A thoughtful approach centered on your move.</h2>
                    </div>
                    <div className={styles.approachGrid}>
                        {advisoryCards.map((card) => (
                            <article className={styles.approachCard} key={card.title}>
                                <span className={styles.cardNumber}>{card.number}</span>
                                <h3>{card.title}</h3>
                                <p>{card.copy}</p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <section className={styles.localSection} aria-labelledby="local-title">
                <div className={styles.shell}>
                    <div className={styles.localGrid}>
                        <div className={styles.localCopy}>
                            <p className={styles.eyebrow}>Local expertise</p>
                            <h2 id="local-title">
                                Burlington-centered reach across connected Massachusetts markets.
                            </h2>
                            <p>
                                The service area connects communities centered on Burlington, generally
                                within approximately 45 minutes in normal traffic, along with established
                                extended markets. Travel times vary, and the home search stays focused on
                                the communities served.
                            </p>
                            <ul className={styles.localNotes}>
                                {localNotes.map((note) => (
                                    <li key={note}>{note}</li>
                                ))}
                            </ul>
                            <div className={styles.actions}>
                                <Link className={styles.primaryAction} href="/buy/properties/">
                                    Search service-area homes
                                </Link>
                            </div>
                        </div>
                        <figure className={styles.editorialImageFrame}>
                            <LocalResponsiveImage
                                alt={maiLyInteriorImage.alt}
                                className={styles.editorialImage}
                                height={maiLyInteriorImage.height}
                                sizes="(max-width: 760px) 88vw, (max-width: 1100px) 45vw, 540px"
                                src={maiLyInteriorImage.src}
                                width={maiLyInteriorImage.width}
                            />
                            <figcaption className={styles.imageCaption}>
                                Thoughtful guidance for every stage of your move.
                            </figcaption>
                        </figure>
                    </div>
                </div>
            </section>

            <section className={styles.affiliation} aria-labelledby="affiliation-title">
                <div className={styles.shell}>
                    <div className={styles.affiliationGrid}>
                        <div>
                            <p className={styles.eyebrow}>Brokerage affiliation</p>
                            <h2 id="affiliation-title">{profile.brokerageName}</h2>
                        </div>
                        <div className={styles.affiliationCopy}>
                            <p>
                                Personal attention is backed by the resources and transaction support
                                of {profile.brokerageName}, helping buyers and sellers move forward with
                                clear information.
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    );
}
