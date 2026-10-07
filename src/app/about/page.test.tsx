import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AboutPage, { metadata } from './page';

describe('AboutPage', () => {
    it('introduces Mai Ly once while keeping her identity and credentials clear', () => {
        render(<AboutPage />);

        expect(screen.getByRole('heading', { level: 1, name: 'Mai Ly Musto.' })).toBeInTheDocument();
        expect(screen.getAllByRole('img', { name: /mai ly musto/i })).toHaveLength(2);
        expect(screen.getByText('Mai Ly Musto, REALTOR®')).toBeInTheDocument();
        expect(screen.getByText(/what working together looks like/i)).toBeInTheDocument();
        expect(screen.queryByText(/how mai ly works with you/i)).not.toBeInTheDocument();
        expect(metadata.title).toContain('Mai Ly Musto');
        expect(metadata.description).toContain('Mai Ly Musto');
    });

    it('keeps one contact action in the hero and only the search action in the local section', () => {
        render(<AboutPage />);

        const contactLinks = screen
            .getAllByRole('link')
            .filter((link) => link.getAttribute('href') === '/contact');
        expect(contactLinks).toHaveLength(1);
        expect(contactLinks[0]).toHaveAccessibleName('Start a conversation');

        const localSection = screen
            .getByRole('heading', { name: /burlington-centered reach/i })
            .closest('section');
        expect(localSection).not.toBeNull();
        expect(within(localSection!).getAllByRole('link')).toHaveLength(1);
        expect(within(localSection!).getByRole('link', { name: /search service-area homes/i }))
            .toHaveAttribute('href', '/buy/properties');
    });
});
