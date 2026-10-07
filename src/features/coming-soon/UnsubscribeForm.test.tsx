import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnsubscribeForm } from './UnsubscribeForm';

describe('UnsubscribeForm', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.history.replaceState({}, '', '/');
    });

    it('submits unsubscribe requests with a generic success response', async () => {
        const fetchMock = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 202 }));
        const user = userEvent.setup();

        render(
            <UnsubscribeForm
                action="https://api.example.com/newsletter/unsubscribe"
                contactEmail="maily@movewithmusto.com"
            />,
        );

        await user.type(screen.getByLabelText(/email/i), 'visitor@example.com');
        await user.click(screen.getByRole('button', { name: 'Send' }));

        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.example.com/newsletter/unsubscribe',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: 'visitor@example.com',
                    source: 'move-with-musto-unsubscribe-page',
                }),
            }),
        );
        expect(await screen.findByRole('status')).toHaveTextContent(/request was received/i);
        expect(screen.getByLabelText(/email address/i)).toHaveValue('');
    });

    it('requires an email address and never falls back to an email client', () => {
        render(
            <UnsubscribeForm
                action="https://api.example.com/newsletter/unsubscribe"
                contactEmail="maily@movewithmusto.com"
            />,
        );

        expect(screen.getByLabelText(/email address/i)).toBeRequired();
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('does not submit anywhere when no endpoint is configured, including programmatic submit', () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        render(<UnsubscribeForm contactEmail="help@example.com" />);

        expect(screen.getByLabelText(/email address/i)).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(screen.getByRole('link', { name: /send an unsubscribe request/i }))
            .toHaveAttribute('href', 'mailto:help@example.com?subject=Unsubscribe');
        fireEvent.submit(screen.getByRole('form'));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
