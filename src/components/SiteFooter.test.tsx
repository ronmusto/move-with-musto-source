import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import { SiteFooter } from './SiteFooter';

const footerCss = readFileSync(resolve(process.cwd(), 'src/components/SiteFooter.module.css'), 'utf8');

describe('SiteFooter', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('shows the canonical professional license beneath the agent name', () => {
        render(<SiteFooter profile={defaultRealEstateProfile} />);

        const footer = screen.getByRole('contentinfo');
        const agentName = within(footer).getByText(defaultRealEstateProfile.agentName);
        const license = within(footer).getByText(
            'Massachusetts Real Estate Salesperson License #9572796-RE-S',
        );

        expect(agentName.nextElementSibling).toBe(license);
    });

    it('keeps private planning materials out of public navigation', () => {
        render(<SiteFooter profile={defaultRealEstateProfile} />);

        const pageNavigation = screen.getByRole('navigation', { name: /site pages/i });

        expect(within(pageNavigation).queryByRole('link', { name: /guides?/i })).not.toBeInTheDocument();
        expect(within(pageNavigation).queryByRole('link', { name: /^areas$/i })).not.toBeInTheDocument();
        expect(within(pageNavigation).getByRole('link', { name: /contact/i })).toHaveAttribute(
            'href',
            '/contact',
        );
        expect(within(pageNavigation).queryByRole('link', { name: /commercial/i }))
            .not.toBeInTheDocument();
    });

    it('shows the commercial destination only when its launch gate is enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        render(<SiteFooter profile={defaultRealEstateProfile} />);

        const pageNavigation = screen.getByRole('navigation', { name: /site pages/i });
        expect(within(pageNavigation).getByRole('link', { name: /commercial/i }))
            .toHaveAttribute('href', '/commercial');
    });

    it('opens the Jakomu website credit in a new tab', () => {
        render(<SiteFooter profile={defaultRealEstateProfile} />);

        const jakomuCredit = screen.getByRole('link', { name: /website by jakomu/i });

        expect(jakomuCredit).toHaveAttribute('href', 'https://jakomu.com');
        expect(jakomuCredit).toHaveAttribute('target', '_blank');
        expect(jakomuCredit).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('keeps brokerage affiliation, Equal Housing, and REALTOR® membership marks separated', () => {
        render(<SiteFooter profile={defaultRealEstateProfile} />);

        const footer = screen.getByRole('contentinfo');
        const brokerageLogo = within(footer).getByAltText(defaultRealEstateProfile.assets.brokerageLogo.alt);
        const equalHousingLogo = within(footer).getByAltText(defaultRealEstateProfile.assets.equalHousingLogo.alt);
        const realtorLogo = within(footer).getByAltText('REALTOR® logo');
        const brokerageMark = brokerageLogo.closest('[data-footer-mark]');
        const equalHousingMark = equalHousingLogo.closest('[data-footer-mark]');
        const realtorMark = realtorLogo.closest('[data-footer-mark]');

        expect(brokerageLogo).toHaveAttribute('src', expect.stringContaining('dream-seekers-realty-logo-96w.png'));
        expect(brokerageLogo).toHaveAttribute('srcset', expect.stringContaining('dream-seekers-realty-logo-192w.png 2x'));
        expect(equalHousingLogo).toHaveAttribute('src', expect.stringContaining('equal-housing-opportunity-logo-1200w-96w.png'));
        expect(equalHousingLogo).toHaveAttribute('srcset', expect.stringContaining('equal-housing-opportunity-logo-1200w-192w.png 2x'));
        expect(realtorLogo).toHaveAttribute('src', expect.stringContaining('realtor-logo-blue-96w.png'));
        expect(realtorLogo).toHaveAttribute('srcset', expect.stringContaining('realtor-logo-blue-192w.png 2x'));
        expect(brokerageLogo).toHaveAttribute('width', '96');
        expect(equalHousingLogo).toHaveAttribute('width', '96');
        expect(realtorLogo).toHaveAttribute('width', '96');
        expect(brokerageMark).not.toBe(equalHousingMark);
        expect(brokerageMark).not.toBe(realtorMark);
        expect(equalHousingMark).not.toBe(realtorMark);
        expect(within(footer).getByText(/membership mark used to identify nar membership/i)).toBeInTheDocument();
    });

    it('uses a compact footer spacing budget', () => {
        const footerRule = footerCss.match(/\.footer\s*{[^}]+}/)?.[0] ?? '';
        const footerInnerRule = footerCss.match(/\.footerInner\s*{[^}]+}/)?.[0] ?? '';

        expect(footerRule).toContain('padding: clamp(2rem, 4vw, 3rem) var(--space-gutter);');
        expect(footerInnerRule).toContain('gap: clamp(1.1rem, 2.5vw, 2.25rem);');
    });

    it('places affiliation and compliance marks in a full-width bottom row', () => {
        const footerInnerRule = footerCss.match(/\.footerInner\s*{[^}]+}/)?.[0] ?? '';
        const footerBrandingRule = footerCss.match(/\.footerBranding\s*{[^}]+}/)?.[0] ?? '';
        const separatedMarksRules = footerCss.match(/\.footerHousing,\s*\.footerMembership\s*{[^}]+}/g) ?? [];

        expect(footerInnerRule).toContain('grid-template-columns: minmax(13rem, 1.35fr) minmax(8rem, 0.6fr) minmax(9rem, 0.65fr);');
        expect(footerBrandingRule).toContain('grid-column: 1 / -1;');
        expect(footerBrandingRule).toContain('grid-template-columns: minmax(11rem, 1fr) minmax(8rem, 0.7fr) minmax(15rem, 1.2fr);');
        expect(separatedMarksRules.some((rule) => rule.includes('border-left: 1px solid rgba(255, 255, 255, 0.14);'))).toBe(true);
    });

    it('gives every affiliation and compliance mark the same proportional display slot', () => {
        const sharedLogoRule = footerCss.match(
            /\.footerAffiliation img,\s*\.footerHousing img,\s*\.footerMembership img\s*{[^}]+}/,
        )?.[0] ?? '';

        expect(sharedLogoRule).toContain('width: 5.2rem;');
        expect(sharedLogoRule).toContain('height: 5.2rem;');
        expect(sharedLogoRule).toContain('object-fit: contain;');
    });
});
