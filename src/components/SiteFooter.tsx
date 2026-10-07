import Link from 'next/link';
import { isCommercialPublic } from '@/lib/commercial-visibility';
import type { RealEstateProfile } from '@/lib/real-estate-profile';
import styles from './SiteFooter.module.css';

type SiteFooterProps = {
    profile: RealEstateProfile;
};

const socialIcons: Record<string, React.JSX.Element> = {
    Instagram: (
        <svg className={styles.socialIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="18" cy="6" r="1.5" fill="currentColor" />
        </svg>
    ),
    LinkedIn: (
        <svg className={styles.socialIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 10V17M7 7V7.01M11 17V13C11 11.5 12 10.5 13.5 10.5C15 10.5 16 11.5 16 13V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
    ),
    Facebook: (
        <svg className={styles.socialIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18 2H15C13.3431 2 12 3.34315 12 5V8H9V12H12V22H16V12H19L20 8H16V5C16 4.44772 16.4477 4 17 4H20V2H18Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
};

export function SiteFooter({ profile }: SiteFooterProps) {
    return (
        <footer className={styles.footer}>
            <div className={styles.footerInner}>
                <div className={styles.footerBrand}>
                    <strong>{profile.brandName}</strong>
                    <span>{profile.agentName}</span>
                    <span>
                        {profile.professionalLicense.jurisdiction}{' '}
                        {profile.professionalLicense.type} License #{profile.professionalLicense.number}
                    </span>
                    {profile.contact.phone ? (
                        <a href={profile.contact.phoneHref} className={styles.footerPhone}>
                            {profile.contact.phone}
                        </a>
                    ) : null}
                    <a href={`mailto:${profile.contact.email}`} className={styles.footerEmail}>
                        {profile.contact.email}
                    </a>
                </div>

                <div className={styles.footerLinks}>
                    <nav className={styles.footerPages} aria-label="Site pages">
                        <Link href="/about/">About</Link>
                        <Link href="/buy/properties/">Buy</Link>
                        <Link href="/sell/">Sell</Link>
                        {isCommercialPublic() ? <Link href="/commercial/">Commercial</Link> : null}
                        <Link href="/contact/">Contact</Link>
                    </nav>
                </div>

                <div className={styles.footerLinks}>
                    <nav className={styles.footerPolicies} aria-label="Policy links">
                        <Link href="/privacy/">Privacy</Link>
                        <Link href="/terms/">Terms</Link>
                        <Link href="/unsubscribe/">Unsubscribe</Link>
                    </nav>
                    {profile.socialLinks.length > 0 ? (
                        <nav className={styles.socialNav} aria-label="Social links">
                            {profile.socialLinks.map((link) => (
                                <a
                                    key={link.label}
                                    href={link.href}
                                    aria-label={link.label}
                                    className={styles.socialLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {socialIcons[link.label] ?? <span>{link.label}</span>}
                                </a>
                            ))}
                        </nav>
                    ) : null}
                </div>

                <div className={styles.footerBranding} aria-label="Affiliation and compliance marks">
                    <div className={styles.footerAffiliation} data-footer-mark="brokerage-affiliation">
                        <img
                            alt={profile.assets.brokerageLogo.alt}
                            decoding="async"
                            height={profile.assets.brokerageLogo.height}
                            loading="lazy"
                            src={profile.assets.brokerageLogo.src}
                            srcSet={profile.assets.brokerageLogo.srcSet}
                            width={profile.assets.brokerageLogo.width}
                        />
                        <span>{profile.brokerageName}</span>
                    </div>
                    <div className={styles.footerHousing} data-footer-mark="equal-housing">
                        <img
                            alt={profile.assets.equalHousingLogo.alt}
                            decoding="async"
                            height={profile.assets.equalHousingLogo.height}
                            loading="lazy"
                            src={profile.assets.equalHousingLogo.src}
                            srcSet={profile.assets.equalHousingLogo.srcSet}
                            width={profile.assets.equalHousingLogo.width}
                        />
                    </div>
                    <div className={styles.footerMembership} data-footer-mark="nar-membership">
                        <img
                            alt={profile.assets.realtorLogo.alt}
                            decoding="async"
                            height={profile.assets.realtorLogo.height}
                            loading="lazy"
                            src={profile.assets.realtorLogo.src}
                            srcSet={profile.assets.realtorLogo.srcSet}
                            width={profile.assets.realtorLogo.width}
                        />
                        <span>Membership mark used to identify NAR membership.</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
