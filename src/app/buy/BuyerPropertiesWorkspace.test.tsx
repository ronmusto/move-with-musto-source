import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BuyerPropertiesWorkspace } from './BuyerPropertiesWorkspace';

vi.mock('@/features/properties/PropertiesSearch', () => ({
    PropertiesSearch: ({ defaultQuery }: { defaultQuery?: string }) => (
        <div data-default-query={defaultQuery ?? ''} data-testid="properties-search" />
    ),
}));

const contact = {
    email: 'maily@movewithmusto.com',
    phone: '(781) 315-3845',
    phoneHref: 'tel:+17813153845',
};

describe('BuyerPropertiesWorkspace', () => {
    it('keeps the launch workspace focused on property search', () => {
        render(
            <BuyerPropertiesWorkspace
                contact={contact}
                inquiry={{ action: '', method: 'post' }}
                privacyVersion="2026-06-16"
                termsVersion="2026-06-16"
            />,
        );

        expect(screen.queryByRole('link', { name: /change path/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/^properties$/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /^neighborhoods$/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', {
            level: 1,
            name: /homes for sale with mai ly musto/i,
        })).toBeInTheDocument();
        expect(screen.getByTestId('properties-search')).toHaveAttribute('data-default-query', '');
    });

    it('shows a full maintenance page instead of search controls when MLS data is unavailable', () => {
        render(
            <BuyerPropertiesWorkspace
                contact={contact}
                inquiry={{ action: '', method: 'post' }}
                privacyVersion="2026-06-16"
                searchBundle={null}
                termsVersion="2026-06-16"
            />,
        );

        expect(screen.getByRole('heading', { name: /home search is temporarily unavailable/i })).toBeInTheDocument();
        expect(screen.getByText(/^home search$/i)).toBeInTheDocument();
        expect(screen.queryByTestId('properties-search')).not.toBeInTheDocument();
        expect(screen.queryByText(/^properties$/i)).not.toBeInTheDocument();
    });
});
