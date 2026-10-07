import Link from 'next/link';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './ServicesSection.module.css';

type ServicesSectionProps = {
    profile: RealEstateProfile;
};

const serviceIcons: Record<string, React.JSX.Element> = {
    'Sell With a Clear Plan': (
        <svg className={styles.serviceIcon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="4" y="12" width="24" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M16 4L26 12H6L16 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <rect x="13" y="20" width="6" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    ),
    'Buy With Local Insight': (
        <svg className={styles.serviceIcon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="9" stroke="currentColor" strokeWidth="1.5" />
            <path d="M21 21L28 28" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M10 14H18M14 10V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    ),
    'Plan Your Next Move': (
        <svg className={styles.serviceIcon} viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect x="4" y="6" width="24" height="22" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 12H28" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 2V8M22 2V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="16" cy="20" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
    ),
};

export function ServicesSection({ profile }: ServicesSectionProps) {
    return (
        <section id="services" className={styles.servicesSection} aria-labelledby="services-title">
            <div className={styles.sectionIntro}>
                <p className={styles.eyebrow}>Ways to move forward</p>
                <h2 id="services-title">Support for your next move</h2>
                <p>
                    Whether you are buying, selling, or planning ahead, each service starts
                    with your questions, timing, and what matters most to you.
                </p>
            </div>
            <div className={styles.serviceGrid}>
                {profile.services.map((service) => (
                    <Link
                        className={styles.serviceCard}
                        href={service.href}
                        key={service.title}
                    >
                        <div className={styles.cardHeader}>
                            {serviceIcons[service.title] ?? null}
                            <h3>{service.title}</h3>
                        </div>
                        <p>{service.description}</p>
                        <span className={styles.cardArrow} aria-hidden="true">&rarr;</span>
                    </Link>
                ))}
            </div>
        </section>
    );
}
