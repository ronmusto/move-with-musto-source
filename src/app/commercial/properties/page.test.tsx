import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import CommercialPropertiesPage, {
    CommercialPropertiesPageContent,
    generateMetadata,
} from './page';

const { notFound } = vi.hoisted(() => ({
    notFound: vi.fn(() => {
        throw new Error('NEXT_HTTP_ERROR_FALLBACK;404');
    }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('@/features/commercial/CommercialPropertiesSearch', () => ({
    CommercialPropertiesSearch: ({ contact }: { contact: { email: string } }) => (
        <div>Commercial search for {contact.email}</div>
    ),
}));

describe('CommercialPropertiesPage', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('fails closed at the route while commercial is not public', () => {
        expect(() => CommercialPropertiesPage()).toThrow('NEXT_HTTP_ERROR_FALLBACK;404');
        expect(notFound).toHaveBeenCalledOnce();
        expect(generateMetadata()).toEqual({ robots: { index: false, follow: false } });
    });

    it('uses a distinct commercial canonical route when enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        const metadata = generateMetadata();

        expect(metadata.alternates).toEqual({ canonical: '/commercial/properties/' });
        expect(metadata.title).toContain('Commercial Property Search');
        render(<CommercialPropertiesPageContent profile={defaultRealEstateProfile} />);
        expect(screen.getByText(`Commercial search for ${defaultRealEstateProfile.contact.email}`))
            .toBeInTheDocument();
    });
});
