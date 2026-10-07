import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UnsubscribePage from './page';

describe('Unsubscribe page', () => {
    it('keeps unconfigured previews from submitting to production', () => {
        render(<UnsubscribePage />);

        expect(screen.getByRole('heading', { name: 'Unsubscribe.' })).toBeInTheDocument();
        expect(screen.getByText(/do-not-contact list/i)).toBeInTheDocument();
        expect(screen.getByRole('form', { name: /unsubscribe from move with musto updates/i })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: /email address/i })).toBeRequired();
        expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
        expect(screen.getByRole('link', { name: /send an unsubscribe request/i })).toHaveAttribute(
            'href', 'mailto:maily@movewithmusto.com?subject=Unsubscribe',
        );
        expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy/');
        expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms/');
    });
});
