import { PropertiesSearch } from '@/features/properties/PropertiesSearch';
import type { MlsSearchIndexBundle } from '@/lib/mls-public-listings';
import type { RealEstateContact, RealEstateCta, RealEstateInquiry } from '@/lib/real-estate-profile';
import styles from './BuyerPropertiesWorkspace.module.css';

type BuyerPropertiesWorkspaceProps = Readonly<{
    appointmentCta?: RealEstateCta;
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    privacyVersion: string;
    searchBundle?: MlsSearchIndexBundle | null;
    termsVersion: string;
}>;

export function BuyerPropertiesWorkspace({
    appointmentCta,
    contact,
    inquiry,
    privacyVersion,
    searchBundle,
    termsVersion,
}: BuyerPropertiesWorkspaceProps) {
    if (searchBundle === null) {
        return (
            <main className={[styles.page, styles.maintenancePage].join(' ')}>
                <section className={styles.buyMaintenance} aria-labelledby="buy-maintenance-title">
                    <p className={styles.eyebrow}>Home search</p>
                    <h1 id="buy-maintenance-title">Home search is temporarily unavailable.</h1>
                    <p>
                        Please check back shortly, or get in touch for help with your search.
                    </p>
                </section>
            </main>
        );
    }

    return (
        <main className={styles.page}>
            <h1 className={styles.visuallyHidden}>Homes for sale with Mai Ly Musto</h1>
            <PropertiesSearch
                appointmentCta={appointmentCta}
                className={styles.embeddedSearch}
                contact={contact}
                inquiry={inquiry}
                initialSearchBundle={searchBundle}
                privacyVersion={privacyVersion}
                sourcePage="/buy/properties/"
                termsVersion={termsVersion}
            />
        </main>
    );
}
