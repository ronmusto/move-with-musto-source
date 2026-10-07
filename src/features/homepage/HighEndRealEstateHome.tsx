import type { RealEstateProfile } from '@/lib/real-estate-profile';
import { neighborhoods } from '@/lib/neighborhoods-data';
import { properties } from '@/lib/properties-data';
import { HeroSection } from './HeroSection';
import { AboutSection } from './AboutSection';
import { ServicesSection } from './ServicesSection';
import { InquirySection } from './InquirySection';
import { FeaturedProofSection } from './FeaturedProofSection';

type HighEndRealEstateHomeProps = {
    profile: RealEstateProfile;
};

export function HighEndRealEstateHome({ profile }: HighEndRealEstateHomeProps) {
    return (
        <main>
            <HeroSection profile={profile} />
            <AboutSection profile={profile} />
            <ServicesSection profile={profile} />
            <FeaturedProofSection properties={properties} neighborhoods={neighborhoods} />
            <InquirySection profile={profile} />
        </main>
    );
}
