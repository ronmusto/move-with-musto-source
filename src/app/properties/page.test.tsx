import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PropertiesPage from './page';

describe('legacy properties route', () => {
    it('immediately and accessibly forwards to the canonical buyer search', () => {
        const { container } = render(<PropertiesPage />);

        expect(document.querySelector('meta[http-equiv="refresh"]')).toHaveAttribute(
            'content',
            '0;url=/buy/properties/',
        );
        expect(container.querySelector('script')?.textContent).toContain("current.searchParams.delete('scope')");
        expect(container.querySelector('script')?.textContent).toContain(
            'window.location.replace(target.pathname+target.search+target.hash)',
        );
        expect(screen.getByRole('link', { name: /continue to property search/i })).toHaveAttribute(
            'href',
            '/buy/properties',
        );
    });
});
