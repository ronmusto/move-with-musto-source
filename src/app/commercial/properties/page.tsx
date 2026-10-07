import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CommercialPropertiesSearch } from '@/features/commercial/CommercialPropertiesSearch';
import { isCommercialPublic } from '@/lib/commercial-visibility';
import { resolveRealEstateProfile, type RealEstateProfile } from '@/lib/real-estate-profile';
import buyerPageStyles from '../../buy/BuyerPropertiesWorkspace.module.css';

const profile = resolveRealEstateProfile();

export function generateMetadata(): Metadata {
    if (!isCommercialPublic()) {
        return { robots: { index: false, follow: false } };
    }

    return {
        title: `Commercial Property Search | ${profile.brandName}`,
        description:
            `Search current commercial, land, and business-opportunity listings in ${profile.agentName}'s service area.`,
        alternates: { canonical: '/commercial/properties/' },
    };
}

export function CommercialPropertiesPageContent({
    profile,
}: Readonly<{ profile: RealEstateProfile }>) {
    return (
        <main className={buyerPageStyles.page}>
            <h1 className={buyerPageStyles.visuallyHidden}>
                Commercial properties with Mai Ly Musto
            </h1>
            <CommercialPropertiesSearch
                className={buyerPageStyles.embeddedSearch}
                contact={profile.contact}
            />
        </main>
    );
}

export default function CommercialPropertiesPage() {
    if (!isCommercialPublic()) {
        notFound();
    }

    return <CommercialPropertiesPageContent profile={profile} />;
}
