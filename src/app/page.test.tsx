import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Home from './page';

describe('Home page', () => {
    it('renders the high-end real-estate homepage content', () => {
        render(<Home />);

        expect(screen.getByRole('heading', { name: /move with musto/i })).toBeInTheDocument();
        expect(
            screen.getByText(/personal guidance for buying, selling/i),
        ).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /search homes/i })).toHaveAttribute(
            'href',
            '/buy/properties',
        );
        expect(screen.getByRole('link', { name: /^get in touch$/i })).toHaveAttribute(
            'href',
            '/contact',
        );
        expect(screen.queryByRole('form', { name: /contact form about your move/i })).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /reach out whenever you are ready/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /get in touch ask a question/i })).toHaveAttribute(
            'href',
            '/contact/#contact-form',
        );
        expect(screen.getByRole('link', { name: /email maily@movewithmusto\.com/i }).getAttribute('href'))
            .toMatch(/^mailto:maily@movewithmusto\.com\?subject=/);
        expect(screen.getByRole('heading', { name: /areas served/i })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /search service-area homes/i })).toHaveAttribute(
            'href',
            '/buy/properties',
        );
        expect(screen.queryByText(/launching soon/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /join the newsletter/i })).not.toBeInTheDocument();
    });
});
