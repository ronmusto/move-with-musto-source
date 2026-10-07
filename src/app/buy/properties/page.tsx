import type { Metadata } from 'next';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';
import { BuyerPropertiesWorkspace } from '../BuyerPropertiesWorkspace';

const profile = resolveRealEstateProfile();
const propertyInquiry = profile.inquiry;

export const metadata: Metadata = {
    title: `Buy Properties | ${profile.brandName}`,
    description:
        'Search current MLS listings across Mai Ly Musto\'s Burlington-centered service area, save homes, compare properties, and talk through promising options.',
    alternates: { canonical: '/buy/properties/' },
};

export default function BuyPropertiesPage() {
    return (
        <BuyerPropertiesWorkspace
            appointmentCta={profile.appointmentCta}
            contact={profile.contact}
            inquiry={propertyInquiry}
            privacyVersion={profile.privacyVersion}
            termsVersion={profile.termsVersion}
        />
    );
}
