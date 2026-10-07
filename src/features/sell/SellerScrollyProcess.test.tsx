import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SellerScrollyProcess, type SellerProcessStep } from './SellerScrollyProcess';

const sellerScrollyCss = readFileSync(
    resolve(process.cwd(), 'src/features/sell/SellerScrollyProcess.module.css'),
    'utf8',
);

const steps: SellerProcessStep[] = [
    {
        title: 'Prepare the property',
        summary: 'Prepare every room for the market.',
        detail: 'Condition and presentation.',
        signal: 'The home is ready to photograph.',
        outcome: 'Buyers see the strongest version of the home.',
        visual: {
            type: 'market-lenses',
            label: 'Preparation review',
            lenses: [{ label: 'Condition', note: 'Prioritize the work buyers will notice.' }],
        },
    },
    {
        title: 'Launch the listing',
        summary: 'Introduce the home with a coordinated plan.',
        detail: 'Buyer response and showing activity.',
        signal: 'The launch is reaching qualified buyers.',
        outcome: 'The market receives one clear story.',
        visual: {
            type: 'market-lenses',
            label: 'Launch review',
            lenses: [{ label: 'Response', note: 'Watch early demand and feedback.' }],
        },
    },
];

const originalMatchMedia = window.matchMedia;
const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;

afterEach(() => {
    window.matchMedia = originalMatchMedia;
    window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe('SellerScrollyProcess', () => {
    it('does not announce normal scroll-driven step changes as live updates', () => {
        const { container } = render(<SellerScrollyProcess steps={steps} />);

        expect(container.querySelector('[aria-live]')).toBeNull();
        expect(screen.getAllByText(/what the plan considers/i)).toHaveLength(2);
        expect(screen.queryByText(/what mai ly is reading/i)).not.toBeInTheDocument();
    });

    it('uses instant programmatic scrolling when reduced motion is requested', () => {
        const scrollIntoView = vi.fn();
        window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));

        render(<SellerScrollyProcess steps={steps} />);
        fireEvent.click(screen.getByRole('button', { name: /launch the listing/i }));

        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    });

    it('keeps inactive scene copy at its authored contrast and dims only visual decoration', () => {
        const sceneRule = sellerScrollyCss.match(/\.stepScene\s*\{[^}]+}/)?.[0] ?? '';

        expect(sceneRule).not.toContain('opacity:');
        expect(sceneRule).not.toContain('transform:');
        expect(sellerScrollyCss).toMatch(
            /\.stepScene:not\(\[data-active='true'\]\) \.stepVisual\s*\{[^}]*border-color:/,
        );
        expect(sellerScrollyCss).toMatch(
            /\.stepScene\[data-active='true'\] \.photoFrame\s*\{[^}]*opacity: 1;/,
        );
    });

    it('keeps zoomed and short-viewport panel content reachable instead of clipping it', () => {
        const sectionRule = sellerScrollyCss.match(/\.scrollySection\s*\{[^}]+}/)?.[0] ?? '';
        const panelRule = sellerScrollyCss.match(/\.stickyPanel\s*\{[^}]+}/)?.[0] ?? '';

        expect(sectionRule).toContain('overflow: visible;');
        expect(sectionRule).not.toContain('overflow: clip;');
        expect(panelRule).toContain('overflow-y: auto;');
        expect(panelRule).toContain('overscroll-behavior: contain;');
        expect(panelRule).not.toContain('overflow: clip;');
    });
});
