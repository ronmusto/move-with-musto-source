import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocalResponsiveImage } from './LocalResponsiveImage';

describe('LocalResponsiveImage', () => {
    it('delivers generated responsive candidates for configured local images', () => {
        render(
            <LocalResponsiveImage
                alt="Massachusetts harbor neighborhood"
                fill
                priority
                sizes="100vw"
                src="/images/areas/massachusetts-daytime-hero.webp"
                width={1847}
            />,
        );

        const image = screen.getByRole('img', { name: 'Massachusetts harbor neighborhood' });

        expect(image).toHaveAttribute(
            'srcset',
            '/images/areas/massachusetts-daytime-hero-640w.webp 640w, /images/areas/massachusetts-daytime-hero-768w.webp 768w, /images/areas/massachusetts-daytime-hero-960w.webp 960w, /images/areas/massachusetts-daytime-hero-1280w.webp 1280w, /images/areas/massachusetts-daytime-hero-1600w.webp 1600w, /images/areas/massachusetts-daytime-hero.webp 1847w',
        );
        expect(image).toHaveAttribute('sizes', '100vw');
        expect(image).toHaveAttribute('loading', 'eager');
        expect(image).toHaveAttribute('fetchpriority', 'high');
        expect(image).toHaveStyle({ position: 'absolute', width: '100%', height: '100%' });
    });

    it('delivers mobile-sized portrait candidates for configured agent images', () => {
        render(
            <LocalResponsiveImage
                alt="Mai-Ly Musto"
                height={1600}
                sizes="(max-width: 760px) 38vw, 18vw"
                src="/images/brand/agent/mai-ly-musto-couch-color-web.webp"
                width={960}
            />,
        );

        const image = screen.getByRole('img', { name: 'Mai-Ly Musto' });
        expect(image).toHaveAttribute(
            'srcset',
            '/images/brand/agent/mai-ly-musto-couch-color-web-192w.webp 192w, /images/brand/agent/mai-ly-musto-couch-color-web-384w.webp 384w, /images/brand/agent/mai-ly-musto-couch-color-web-640w.webp 640w, /images/brand/agent/mai-ly-musto-couch-color-web.webp 960w',
        );
    });

    it('falls back to the original source when no generated variants exist', () => {
        render(
            <LocalResponsiveImage
                alt="Unmapped local image"
                height={400}
                src="/images/general/unmapped.webp"
                width={600}
            />,
        );

        const image = screen.getByRole('img', { name: 'Unmapped local image' });
        expect(image).not.toHaveAttribute('srcset');
        expect(image).toHaveAttribute('src', '/images/general/unmapped.webp');
        expect(image).toHaveAttribute('loading', 'lazy');
        expect(image).toHaveAttribute('width', '600');
        expect(image).toHaveAttribute('height', '400');
    });
});
