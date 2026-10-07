import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sellCss = readFileSync(
    resolve(process.cwd(), 'src/app/sell/sell-page.module.css'),
    'utf8',
);

describe('seller page styles', () => {
    it('uses context-aware tokens for small gold text', () => {
        expect(sellCss).toContain(
            '--sell-gold-text: var(--color-gold-text, #7c4f2b);',
        );
        expect(sellCss).toContain('--sell-gold-on-dark: #cdb181;');
        expect(sellCss).toMatch(/\.eyebrow\s*{[\s\S]*?color: var\(--sell-gold-text\);/);
        expect(sellCss).toMatch(/\.hero \.eyebrow\s*{[\s\S]*?color: var\(--sell-gold-on-dark\);/);
        expect(sellCss).toMatch(/\.heroPlanCard dt\s*{[\s\S]*?color: var\(--sell-gold-on-dark\);/);
    });

    it('keeps the valuation target clear of the sticky site header', () => {
        expect(sellCss).toMatch(/\.valuationSection\s*{[\s\S]*?scroll-margin-top: 6rem;/);
    });
});
