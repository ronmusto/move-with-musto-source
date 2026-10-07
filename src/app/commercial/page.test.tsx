import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import { CommercialPageContent, generateMetadata } from './page';

describe('CommercialPage', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('publishes noindex metadata while the commercial launch gate is closed', () => {
        expect(generateMetadata()).toEqual({
            robots: { index: false, follow: false },
        });
    });

    it('publishes commercial metadata with the canonical route when enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        const metadata = generateMetadata();

        expect(metadata.alternates).toEqual({ canonical: '/commercial/' });
        expect(metadata.title).toContain('Commercial Real Estate');
        expect(metadata.description).toContain(defaultRealEstateProfile.brokerageName);
    });

    it('offers distinct buy, sell, and lease paths without fabricated performance claims', () => {
        render(<CommercialPageContent profile={defaultRealEstateProfile} />);

        expect(screen.getByRole('heading', {
            name: /a clear starting point for your next commercial move/i,
        })).toBeInTheDocument();
        expect(screen.getByRole('heading', {
            name: /find a property that fits the plan/i,
        })).toBeInTheDocument();
        expect(screen.getByRole('heading', {
            name: /prepare for a thoughtful sale/i,
        })).toBeInTheDocument();
        expect(screen.getByRole('heading', {
            name: /approach a lease with context/i,
        })).toBeInTheDocument();

        const pageText = document.body.textContent ?? '';
        expect(pageText).toContain(defaultRealEstateProfile.brokerageName);
        expect(pageText).toContain(defaultRealEstateProfile.professionalLicense.number);
        expect(pageText).not.toMatch(
            /transactions? closed|years? of experience|guaranteed returns?|off-market access|ccim|sior/i,
        );
    });

    it('provides direct, actionable contact methods', () => {
        render(<CommercialPageContent profile={defaultRealEstateProfile} />);

        expect(screen.getByRole('link', { name: /search commercial listings/i }))
            .toHaveAttribute('href', '/commercial/properties');
        expect(screen.getAllByRole('link', { name: /discuss a commercial need/i })[0])
            .toHaveAttribute('href', '/contact#contact-form');
        expect(screen.getAllByRole('link', { name: /call \(781\) 315-3845/i })[0])
            .toHaveAttribute('href', 'tel:+17813153845');
    });
});
