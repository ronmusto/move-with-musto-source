import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import { HighEndRealEstateHome } from './HighEndRealEstateHome';

describe('HighEndRealEstateHome', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the real-estate website essentials', () => {
        render(<HighEndRealEstateHome profile={defaultRealEstateProfile} />);

        expect(screen.getByRole('heading', { name: /move with musto/i })).toBeInTheDocument();
        expect(screen.getAllByText(/move with musto/i).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/personal guidance for buying, selling/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /search homes/i })).toHaveAttribute(
            'href',
            '/buy/properties',
        );
        expect(screen.getByRole('link', { name: /^get in touch$/i })).toHaveAttribute(
            'href',
            '/contact',
        );
        expect(screen.getByRole('heading', { name: /a steady partner for your move/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /support for your next move/i })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /areas served/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /search service-area homes/i })).toHaveAttribute(
            'href',
            '/buy/properties',
        );
        expect(screen.getByRole('heading', { name: /start with the move/i })).toBeInTheDocument();
        expect(screen.getByText(/^REALTOR® \/ Dream Seekers Realty, LLC$/i)).toBeInTheDocument();
        expect(screen.queryByText('Mai Ly Musto, REALTOR®')).not.toBeInTheDocument();
        expect(screen.queryByText(/launching soon/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /join the newsletter/i })).not.toBeInTheDocument();
    });

    it('renders the phone number in the contact section', () => {
        render(<HighEndRealEstateHome profile={defaultRealEstateProfile} />);

        const phoneLinks = screen.getAllByRole('link', { name: /\(781\) 315-3845/i });
        expect(phoneLinks.length).toBeGreaterThanOrEqual(1);
        expect(phoneLinks[0]).toHaveAttribute('href', 'tel:+17813153845');
    });

    it('submits a configured contact inquiry endpoint', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        const user = userEvent.setup();

        render(
            <HighEndRealEstateHome
                profile={{
                    ...defaultRealEstateProfile,
                    inquiry: {
                        action: '/api/inquiries',
                        method: 'post',
                    },
                }}
            />,
        );

        const form = screen.getByRole('form', { name: /contact form about your move/i });
        expect(form).not.toHaveAttribute('action');
        expect(form).not.toHaveAttribute('method');
        expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
        expect(screen.getByRole('checkbox', { name: /terms/i })).toBeRequired();
        expect(screen.getByLabelText(/name.*required/i)).toBeRequired();
        expect(screen.getByLabelText(/phone.*optional/i)).not.toBeRequired();

        await user.type(screen.getByLabelText(/^name/i), 'Musto Visitor');
        await user.type(screen.getByLabelText(/^email/i), 'visitor@example.com');
        await user.selectOptions(screen.getByLabelText(/timeline/i), 'selling-soon');
        await user.type(screen.getByLabelText(/anything else you would like to share/i), 'I am thinking about selling.');
        await user.click(screen.getByRole('checkbox', { name: /terms/i }));
        await user.click(screen.getByRole('button', { name: /send message/i }));

        expect(fetchMock).toHaveBeenCalledWith(
            new URL('/api/inquiries', window.location.origin),
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: expect.stringContaining('visitor@example.com'),
            }),
        );
        expect(fetchMock.mock.calls[0][1]?.body).toContain('move-with-musto-homepage-inquiry');
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"termsAccepted":true');
        const status = await screen.findByRole('status');
        expect(status).toHaveTextContent(/your message was sent/i);
        expect(status).toHaveFocus();
    });

    it('prioritizes the browser contact form while preserving direct contact options', () => {
        render(<HighEndRealEstateHome profile={defaultRealEstateProfile} />);

        expect(screen.queryByRole('form', { name: /contact form about your move/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /reach out whenever you are ready/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /get in touch ask a question/i })).toHaveAttribute(
            'href',
            '/contact/#contact-form',
        );
        const emailLink = screen.getByRole('link', { name: /email maily@movewithmusto\.com/i });
        expect(emailLink.getAttribute('href')).toMatch(
            /^mailto:maily@movewithmusto\.com\?subject=/,
        );
        expect(decodeURIComponent(emailLink.getAttribute('href') ?? '')).toContain('Hi Mai Ly,');
        expect(screen.getByRole('link', { name: /^call \(781\) 315-3845$/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
    });
});
