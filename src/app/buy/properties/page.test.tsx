import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const workspaceProps = vi.hoisted(() => vi.fn());

vi.mock('@/lib/real-estate-profile', () => ({
    resolveRealEstateProfile: () => ({
        appointmentCta: undefined,
        brandName: 'Move With Musto',
        contact: {
            email: 'maily@movewithmusto.com',
            phone: '(781) 315-3845',
            phoneHref: 'tel:+17813153845',
        },
        inquiry: { action: '', method: 'post' },
        privacyVersion: '2026-06-16',
        termsVersion: '2026-06-16',
    }),
}));

vi.mock('../BuyerPropertiesWorkspace', () => ({
    BuyerPropertiesWorkspace: (props: unknown) => {
        workspaceProps(props);
        return <div data-testid="buyer-properties-workspace" />;
    },
}));

import BuyPropertiesPage from './page';

describe('BuyPropertiesPage', () => {
    it('lets the client load the MLS index instead of embedding it in the page payload', () => {
        render(<BuyPropertiesPage />);

        expect(screen.getByTestId('buyer-properties-workspace')).toBeInTheDocument();
        expect(workspaceProps).toHaveBeenCalledTimes(1);
        expect(workspaceProps.mock.calls[0][0]).not.toHaveProperty('searchBundle');
        expect(workspaceProps.mock.calls[0][0]).toHaveProperty(
            'inquiry.action',
            '',
        );
    });
});
