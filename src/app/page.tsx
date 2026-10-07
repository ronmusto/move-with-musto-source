import type { Metadata } from 'next';
import { HighEndRealEstateHome } from '@/features/homepage/HighEndRealEstateHome';
import { resolveRealEstateProfile } from '@/lib/real-estate-profile';

export const metadata: Metadata = {
    alternates: { canonical: '/' },
};

export default function Home() {
    const profile = resolveRealEstateProfile();

    return <HighEndRealEstateHome profile={profile} />;
}
