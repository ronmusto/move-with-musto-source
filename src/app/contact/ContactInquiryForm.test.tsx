import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContactInquiryForm } from './ContactInquiryForm';

const contact = {
    email: 'maily@movewithmusto.com',
    phone: '(781) 315-3845',
    phoneHref: 'tel:+17813153845',
};

describe('ContactInquiryForm', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });
    it('renders direct email and phone actions when the inquiry endpoint is unavailable', () => {
        render(
            <ContactInquiryForm
                contact={contact}
                inquiry={{ action: '', method: 'post' }}
                privacyVersion="2026-06-16"
                termsVersion="2026-06-16"
            />,
        );

        expect(screen.queryByRole('form', { name: /real estate contact form/i })).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: /direct contact options/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /email mai ly/i }).getAttribute('href')).toMatch(
            /^mailto:maily@movewithmusto\.com\?subject=/,
        );
        expect(screen.getByRole('link', { name: /call mai ly/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(screen.queryByRole('button', { name: /send message/i })).not.toBeInTheDocument();
    });

    it('uses clear property-type and timing selectors with compact native controls', async () => {
        const user = userEvent.setup();

        render(
            <ContactInquiryForm
                contact={contact}
                inquiry={{ action: 'https://forms.example.com/musto', method: 'post' }}
                privacyVersion="2026-06-16"
                termsVersion="2026-06-16"
            />,
        );

        const propertyType = screen.getByRole('combobox', { name: /property type/i });
        const timeline = screen.getByRole('combobox', { name: /what timeline are you considering/i });
        expect(screen.queryByRole('radiogroup', { name: /timing/i })).not.toBeInTheDocument();
        expect(propertyType).toHaveDisplayValue('Choose a property type');
        expect(timeline).toHaveDisplayValue('Choose a timeframe');
        expect(screen.getByRole('option', { name: /single-family home/i })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /condominium/i })).toBeInTheDocument();

        await user.selectOptions(propertyType, 'Condominium');
        await user.selectOptions(timeline, 'not-sure-yet');

        expect(propertyType).toHaveValue('Condominium');
        expect(timeline).toHaveValue('not-sure-yet');
    });

    it('keeps submission discoverable while native validation protects required consent', () => {
        render(
            <ContactInquiryForm
                contact={contact}
                inquiry={{ action: 'https://forms.example.com/musto', method: 'post' }}
                privacyVersion="2026-06-16"
                termsVersion="2026-06-16"
            />,
        );

        expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
        expect(screen.getByRole('link', { name: /email mai ly/i })).toHaveAttribute(
            'href',
            expect.stringMatching(/^mailto:maily@movewithmusto\.com\?subject=/),
        );
        expect(screen.getByRole('link', { name: /call mai ly/i })).toHaveAttribute(
            'href',
            'tel:+17813153845',
        );
        expect(screen.getByRole('checkbox', { name: /terms/i })).toBeRequired();
        expect(screen.queryByRole('textbox', { name: /^website$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /first name.*required/i })).toBeRequired();
        expect(screen.getByRole('textbox', { name: /phone number.*optional/i })).not.toBeRequired();
    });

    it('moves focus to the in-page completion message after submission', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
        const user = userEvent.setup();

        render(
            <ContactInquiryForm
                contact={contact}
                inquiry={{ action: '/api/inquiries', method: 'post' }}
                privacyVersion="2026-06-16"
                termsVersion="2026-06-16"
            />,
        );

        await user.type(screen.getByRole('textbox', { name: /first name/i }), 'Jamie');
        await user.type(screen.getByRole('textbox', { name: /last name/i }), 'Visitor');
        await user.type(screen.getByRole('textbox', { name: /email address/i }), 'jamie@example.com');
        await user.selectOptions(
            screen.getByRole('combobox', { name: /property type/i }),
            'Single-family home',
        );
        await user.selectOptions(
            screen.getByRole('combobox', { name: /what timeline are you considering/i }),
            'one-to-three-months',
        );
        await user.click(screen.getByRole('checkbox', { name: /terms/i }));
        await user.click(screen.getByRole('button', { name: /send message/i }));

        const status = await screen.findByRole('status');
        expect(fetchMock).toHaveBeenCalledWith(
            new URL('/api/inquiries', window.location.origin),
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"primaryGoal":"Single-family home"'),
            }),
        );
        expect(fetchMock.mock.calls[0][1]?.body).toContain('"timeline":"one-to-three-months"');
        expect(fetchMock.mock.calls[0][1]?.body).toContain('Property type: Single-family home');
        expect(status).toHaveTextContent(/your message was sent/i);
        expect(status).toHaveFocus();
    });
});
