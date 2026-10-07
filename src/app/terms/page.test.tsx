import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TermsPage from './page';

describe('Terms page', () => {
    it('renders inquiry consent terms and legal navigation', () => {
        render(<TermsPage />);

        expect(screen.getByRole('heading', { name: /website and inquiry terms/i })).toBeInTheDocument();
        expect(screen.getByText(/inquiry forms and email signup are voluntary/i)).toBeInTheDocument();
        expect(screen.getByText(/email or phone follow-up/i)).toBeInTheDocument();
        expect(screen.getByText(/listing data is deemed reliable but not guaranteed/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /^google maps$/i })).toBeInTheDocument();
        expect(screen.getByText(/includes google maps features and content/i)).toBeInTheDocument();
        expect(screen.getByText(/does not sponsor or endorse this website or its listings/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /google maps\/google earth additional terms/i })).toHaveAttribute(
            'href',
            'https://maps.google.com/help/terms_maps/',
        );
        expect(screen.getByRole('link', { name: /google privacy policy/i })).toHaveAttribute(
            'href',
            'https://policies.google.com/privacy',
        );
        expect(screen.queryByText(/broker and mls approval is required/i)).not.toBeInTheDocument();
        expect(screen.getByText(/does not authorize automated sms/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy/');
        expect(screen.getByRole('link', { name: /unsubscribe/i })).toHaveAttribute('href', '/unsubscribe/');
    });
});
