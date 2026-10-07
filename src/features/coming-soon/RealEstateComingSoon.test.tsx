import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultComingSoonProfile } from '@/lib/coming-soon-config';
import { RealEstateComingSoon } from './RealEstateComingSoon';

describe('RealEstateComingSoon', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the real-estate landing essentials', () => {
        render(<RealEstateComingSoon profile={defaultComingSoonProfile} />);

        expect(
            screen.getByRole('heading', {
                name: /your next move deserves a clearer path/i,
            }),
        ).toBeInTheDocument();
        expect(screen.getByText(/real estate guidance for your next move/i)).toBeInTheDocument();
        expect(screen.getAllByText(/launching soon/i)[0]).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /contact move with musto/i })).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /join the private list/i })).not.toBeInTheDocument();
        expect(screen.getAllByRole('link', { name: /being built by jakomu/i })[0]).toHaveAttribute(
            'href',
            'https://jakomu.com',
        );
        expect(
            screen.getByRole('heading', { name: /need a website before your own launch/i }),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /start a project with jakomu/i })).toHaveAttribute(
            'href',
            'https://jakomu.com',
        );
        expect(screen.getAllByRole('link', { name: /privacy/i })[0]).toHaveAttribute('href', '/privacy/');
        expect(screen.getAllByRole('link', { name: /terms/i })[0]).toHaveAttribute('href', '/terms/');
        expect(screen.getByRole('link', { name: /unsubscribe/i })).toHaveAttribute('href', '/unsubscribe/');
    });

    it('hides social links until they are configured', () => {
        render(<RealEstateComingSoon profile={defaultComingSoonProfile} />);

        expect(screen.queryByRole('navigation', { name: /social links/i })).not.toBeInTheDocument();
    });

    it('submits to a configured static form endpoint without opening mail', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        const user = userEvent.setup();

        render(
            <RealEstateComingSoon
                profile={{
                    ...defaultComingSoonProfile,
                    signup: {
                        ...defaultComingSoonProfile.signup,
                        action: 'https://forms.example.com/avery-stone',
                        method: 'post',
                    },
                }}
            />,
        );

        const form = screen.getByRole('form');
        expect(form).not.toHaveAttribute('action');
        expect(form).not.toHaveAttribute('method');
        expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/email/i)).toBeRequired();
        expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: /terms/i })).toBeRequired();
        expect(screen.getByRole('button', { name: /join the newsletter/i })).toBeDisabled();
        await user.type(screen.getByLabelText(/name/i), 'Musto Visitor');
        await user.type(screen.getByLabelText(/email/i), 'visitor@example.com');
        await user.type(screen.getByLabelText(/message/i), 'I would like launch updates.');
        await user.click(screen.getByRole('checkbox', { name: /terms/i }));
        await user.click(screen.getByRole('button', { name: /join the newsletter/i }));

        expect(fetchMock).toHaveBeenCalledWith(
            new URL('https://forms.example.com/avery-stone'),
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: expect.stringContaining('visitor@example.com'),
            }),
        );
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"termsAccepted":true');
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"privacyAccepted":true');
        expect(await screen.findByText(/you are on the move with musto launch list/i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/crafted by jakomu/i);
    });

    it('does not open a mail app when no form endpoint is configured', () => {
        render(<RealEstateComingSoon profile={defaultComingSoonProfile} />);

        const form = screen.getByRole('form');
        expect(form).not.toHaveAttribute('action');
        expect(form).not.toHaveAttribute('method');
        expect(screen.getByRole('button', { name: /join the newsletter/i })).toBeDisabled();
        expect(screen.queryByText(/email delivery is being connected/i)).not.toBeInTheDocument();
        expect(within(form).queryByText(/newsletter storage is being connected/i)).not.toBeInTheDocument();
        expect(within(form).queryByRole('link', { name: /maily@movewithmusto\.com/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/submit the form/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/launch updates only/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/opens your email app/i)).not.toBeInTheDocument();
    });
});
