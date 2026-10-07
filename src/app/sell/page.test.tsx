import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import SellPage, { SellerPageContent } from './page';

const sellPageCss = readFileSync(resolve(process.cwd(), 'src/app/sell/sell-page.module.css'), 'utf8');

describe('SellPage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps detailed seller tactics private and provides a welcoming direct contact fallback', () => {
        render(<SellPage />);

        expect(screen.getByRole('heading', { name: /your next move can start with a simple conversation/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /guidance shaped around your home and your goals/i })).toBeInTheDocument();
        expect(screen.getByRole('img', { name: /mai ly musto in a bright home interior/i })).toBeInTheDocument();
        expect(screen.getByText(/the detailed planning materials that fit your situation/i)).toBeInTheDocument();
        expect(screen.queryByText(/offer tradeoff board|market position read|launch rhythm/i)).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /share what you are considering/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /send an email/i }).getAttribute('href')).toMatch(
            /^mailto:maily@movewithmusto\.com\?subject=/,
        );
        expect(screen.getByRole('link', { name: /^call/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(screen.queryByRole('link', { name: /mai ly/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('form', { name: /seller conversation form/i })).not.toBeInTheDocument();
    });

    it('offers appointment scheduling once as a supporting hero action', () => {
        render(
            <SellerPageContent
                profile={{
                    ...defaultRealEstateProfile,
                    appointmentCta: {
                        href: 'https://calendar.example.com/move-with-musto',
                        label: 'Choose a time to talk',
                    },
                }}
            />,
        );

        expect(screen.getAllByRole('link', { name: /choose a time to talk/i })).toHaveLength(1);
    });

    it('keeps the direct call fallback visually secondary to email', () => {
        const secondaryActionRule = sellPageCss.match(
            /\.directContactActions a\.directContactSecondaryAction\s*\{[^}]+}/,
        )?.[0] ?? '';

        expect(secondaryActionRule).toContain('background: transparent;');
        expect(secondaryActionRule).toContain('color: var(--sell-ink);');
    });

    it('submits configured seller intake in place and reports success', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        const user = userEvent.setup();

        render(
            <SellerPageContent
                profile={{
                    ...defaultRealEstateProfile,
                    inquiry: {
                        action: 'https://forms.example.com/seller-intake',
                        method: 'post',
                    },
                }}
            />,
        );

        const form = screen.getByRole('form', { name: /seller conversation form/i });
        expect(form).not.toHaveAttribute('action');
        expect(screen.getByRole('textbox', { name: /first name/i })).toBeRequired();
        expect(screen.getByRole('textbox', { name: /last name/i })).toBeRequired();
        expect(screen.getByRole('textbox', { name: /property address or town/i })).not.toBeRequired();
        expect(screen.getByRole('textbox', { name: /email address/i })).toBeRequired();

        await user.type(screen.getByRole('textbox', { name: /first name/i }), 'Jamie');
        await user.type(screen.getByRole('textbox', { name: /last name/i }), 'Seller');
        await user.type(screen.getByRole('textbox', { name: /email address/i }), 'jamie@example.com');
        await user.click(screen.getByRole('checkbox', { name: /terms/i }));
        await user.click(screen.getByRole('button', { name: /send message/i }));

        expect(fetchMock).toHaveBeenCalledWith(
            new URL('https://forms.example.com/seller-intake'),
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('move-with-musto-seller-consultation'),
            }),
        );
        expect(await screen.findByRole('status')).toHaveTextContent(/your message was sent.*personal reply/i);
        expect(screen.getByRole('status')).toHaveFocus();
    });

    it('keeps the form in place and offers direct email after an endpoint failure', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
        const user = userEvent.setup();

        render(
            <SellerPageContent
                profile={{
                    ...defaultRealEstateProfile,
                    inquiry: { action: 'https://forms.example.com/seller-intake', method: 'post' },
                }}
            />,
        );

        await user.type(screen.getByRole('textbox', { name: /first name/i }), 'Jamie');
        await user.type(screen.getByRole('textbox', { name: /last name/i }), 'Seller');
        await user.type(screen.getByRole('textbox', { name: /property address or town/i }), '1 Main St');
        await user.type(screen.getByRole('textbox', { name: /email address/i }), 'jamie@example.com');
        await user.click(screen.getByRole('checkbox', { name: /terms/i }));
        await user.click(screen.getByRole('button', { name: /send message/i }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/did not go through/i);
        expect(alert).toHaveFocus();
        expect(screen.getByRole('form', { name: /seller conversation form/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /email directly/i })).toHaveAttribute(
            'href',
            expect.stringMatching(/^mailto:/),
        );
    });
});
