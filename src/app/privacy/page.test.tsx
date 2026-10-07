import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PrivacyPage from './page';

describe('Privacy page', () => {
    it('renders inquiry data handling and suppression details', () => {
        render(<PrivacyPage />);

        expect(screen.getByRole('heading', { name: /how inquiry data is handled/i })).toBeInTheDocument();
        expect(screen.getByText(/submit a move with musto inquiry/i)).toBeInTheDocument();
        expect(screen.getByText(/property lead records/i)).toBeInTheDocument();
        expect(screen.getByText(/saved homes, compared homes, filters, and sort order/i)).toBeInTheDocument();
        expect(screen.getByText(/mls listing interactions/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /maps and location information/i })).toBeInTheDocument();
        expect(screen.getByText(/listing addresses may be sent to the google geocoding api/i)).toBeInTheDocument();
        expect(screen.getByText(/keep them for no more than 30 days/i)).toBeInTheDocument();
        expect(screen.getByText(/does not request access to your device's precise location/i)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /google privacy policy/i })).toHaveAttribute(
            'href',
            'https://policies.google.com/privacy',
        );
        expect(screen.getByText(/minimal suppression records/i)).toBeInTheDocument();
        expect(screen.getByText(/amazon simple email service process a voluntary submission/i)).toBeInTheDocument();
        expect(screen.getByText(/does not by itself enroll you in marketing/i)).toBeInTheDocument();
        expect(screen.queryByText(/not currently configured/i)).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms/');
        expect(screen.getByRole('link', { name: /unsubscribe/i })).toHaveAttribute('href', '/unsubscribe/');
    });
});
