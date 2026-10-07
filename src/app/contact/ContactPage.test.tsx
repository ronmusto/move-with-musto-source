import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ContactPage from './page';

const contactPageCss = readFileSync(resolve(process.cwd(), 'src/app/contact/ContactPage.module.css'), 'utf8');

function cssRuleFor(selector: string) {
    return contactPageCss.match(new RegExp(`${selector.replace('.', '\\.')}\\s*{[^}]+}`))?.[0] ?? '';
}

describe('ContactPage layout', () => {
    it('keeps the contact context visible beside the long form on desktop', () => {
        const shellRule = cssRuleFor('.shell');
        const sidebarRule = cssRuleFor('.sidebar');
        const formColumnRule = cssRuleFor('.formColumn');
        const selectionLabelRule = cssRuleFor('.selectionLabel');

        expect(shellRule).toContain('align-items: start;');
        expect(sidebarRule).toContain('position: sticky;');
        expect(sidebarRule).toContain('top: calc(5rem + clamp(1.25rem, 3vw, 2.5rem));');
        expect(formColumnRule).toContain('min-width: 0;');
        expect(formColumnRule).toContain('scroll-margin-top: 6rem;');
        expect(selectionLabelRule).toContain('min-height: 2.7em;');
        expect(contactPageCss).toMatch(
            /\.inquiryCard h2\s*{\s*font-size: clamp\(2\.25rem, 4\.4vw, 3\.9rem\);/,
        );
    });

    it('offers direct contact without a network form when no endpoint is configured', () => {
        render(<ContactPage />);

        expect(screen.getAllByText('Mai Ly Musto')).toHaveLength(1);
        expect(screen.queryByRole('form', { name: /real estate contact form/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: /start with what you are considering/i })).toHaveAttribute(
            'id',
            'contact-form',
        );
        expect(screen.getByRole('region', {
            name: /direct contact options/i,
        })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /call mai ly/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(screen.getByRole('link', { name: /email mai ly/i })).toHaveAttribute(
            'href',
            expect.stringMatching(/^mailto:maily@movewithmusto\.com\?subject=/),
        );
    });
});
