import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultRealEstateProfile } from '@/lib/real-estate-profile';
import { SiteHeader } from './SiteHeader';

let currentPathname = '/';
const defaultIntersectionObserver = window.IntersectionObserver;

vi.mock('next/navigation', () => ({
    usePathname: () => currentPathname,
}));

describe('SiteHeader', () => {
    afterEach(() => {
        currentPathname = '/';
        window.IntersectionObserver = defaultIntersectionObserver;
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('tracks the scroll threshold with an observer instead of scroll-event work', async () => {
        let observerCallback: IntersectionObserverCallback | undefined;
        const observe = vi.fn();
        const disconnect = vi.fn();

        class CapturingIntersectionObserver implements IntersectionObserver {
            readonly root = null;
            readonly rootMargin = '';
            readonly thresholds = [0];

            constructor(callback: IntersectionObserverCallback) {
                observerCallback = callback;
            }

            observe(target: Element) {
                observe(target);
            }

            unobserve() {}
            disconnect() {
                disconnect();
            }
            takeRecords(): IntersectionObserverEntry[] {
                return [];
            }
        }

        window.IntersectionObserver = CapturingIntersectionObserver;
        const addEventListener = vi.spyOn(window, 'addEventListener');
        const { unmount } = render(<SiteHeader profile={defaultRealEstateProfile} />);
        const header = screen.getByRole('banner');
        const initialClassName = header.className;
        const sentinel = document.querySelector<HTMLElement>('span[aria-hidden="true"][style]');

        expect(sentinel).toHaveStyle({ top: '40px' });
        expect(observe).toHaveBeenCalledWith(sentinel);
        expect(addEventListener).not.toHaveBeenCalledWith(
            'scroll',
            expect.any(Function),
            expect.anything(),
        );

        await act(async () => {
            observerCallback?.(
                [{
                    isIntersecting: false,
                    target: sentinel,
                } as unknown as IntersectionObserverEntry],
                {} as IntersectionObserver,
            );
        });
        expect(header.className).not.toBe(initialClassName);

        unmount();
        expect(disconnect).toHaveBeenCalled();
    });

    it('does not render the brokerage image that is visually hidden at every breakpoint', () => {
        render(<SiteHeader profile={defaultRealEstateProfile} />);

        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.getByLabelText(defaultRealEstateProfile.brokerageName))
            .toHaveTextContent(defaultRealEstateProfile.brokerageName);
    });

    it('uses a neutral action label for direct email in the mobile navigation', () => {
        render(<SiteHeader profile={defaultRealEstateProfile} />);

        expect(screen.getByRole('link', { name: /send an email/i, hidden: true })).toHaveAttribute(
            'href',
            expect.stringMatching(/^mailto:maily@movewithmusto\.com\?subject=/),
        );
        expect(screen.queryByRole('link', { name: /email mai ly/i, hidden: true })).not.toBeInTheDocument();
    });

    it('preserves mobile-menu focus containment, Escape dismissal, and body locking', () => {
        const originalInnerWidth = window.innerWidth;
        const originalClientWidth = document.documentElement.clientWidth;
        document.body.style.paddingRight = '6px';
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: 980,
        });
        render(<SiteHeader profile={defaultRealEstateProfile} />);

        const toggle = screen.getByRole('button', { name: 'Open navigation menu' });
        const mobileNav = document.getElementById('mobile-nav') as HTMLElement;

        expect(mobileNav).toBeInstanceOf(HTMLElement);
        expect(mobileNav).toHaveAttribute('aria-hidden', 'true');
        expect(mobileNav).toHaveAttribute('inert');

        toggle.focus();
        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(mobileNav).not.toHaveAttribute('aria-hidden');
        expect(mobileNav).not.toHaveAttribute('inert');
        expect(document.body.style.overflow).toBe('hidden');
        expect(document.body.style.paddingRight).toBe('26px');

        const mobileLinks = within(mobileNav).getAllByRole('link');
        const lastLink = mobileLinks.at(-1);
        expect(lastLink).toBeDefined();

        toggle.focus();
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
        expect(lastLink).toHaveFocus();

        lastLink?.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(toggle).toHaveFocus();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveFocus();
        expect(mobileNav).toHaveAttribute('aria-hidden', 'true');
        expect(mobileNav).toHaveAttribute('inert');
        expect(document.body.style.overflow).toBe('');
        expect(document.body.style.paddingRight).toBe('6px');

        document.body.style.paddingRight = '';
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
        Object.defineProperty(document.documentElement, 'clientWidth', {
            configurable: true,
            value: originalClientWidth,
        });
    });

    it('keeps the Buy category highlighted without calling a different destination the current page', () => {
        currentPathname = '/buy/legacy-path/';

        render(<SiteHeader profile={defaultRealEstateProfile} />);

        screen.getAllByRole('link', { name: 'Buy' }).forEach((link) => {
            expect(link).not.toHaveAttribute('aria-current');
        });
    });

    it('marks the canonical and compatibility property-search destinations as the current page', () => {
        currentPathname = '/properties/';

        render(<SiteHeader profile={defaultRealEstateProfile} />);

        screen.getAllByRole('link', { name: 'Buy' }).forEach((link) => {
            expect(link).toHaveAttribute('aria-current', 'page');
        });
    });

    it('keeps the unfinished commercial destination out of both navigation modes by default', () => {
        currentPathname = '/commercial/';

        render(<SiteHeader profile={defaultRealEstateProfile} />);
        expect(screen.queryByRole('link', { name: 'Commercial' })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
        expect(screen.queryByRole('link', { name: 'Commercial' })).not.toBeInTheDocument();
    });

    it('links to and marks the commercial page as current when its launch gate is enabled', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        currentPathname = '/commercial/';

        render(<SiteHeader profile={defaultRealEstateProfile} />);
        const desktopNavigation = screen.getByRole('navigation', {
            name: /primary navigation/i,
        });
        const desktopLink = within(desktopNavigation).getByRole('link', {
            name: 'Commercial',
        });

        expect(desktopLink).toHaveAttribute('href', '/commercial');
        expect(desktopLink).toHaveAttribute('aria-current', 'page');

        fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
        const mobileNavigation = screen.getByRole('navigation', {
            name: /mobile navigation/i,
        });
        const mobileLink = within(mobileNavigation).getByRole('link', { name: 'Commercial' });

        expect(mobileLink).toHaveAttribute('href', '/commercial');
        expect(mobileLink).toHaveAttribute('aria-current', 'page');
    });

    it('keeps commercial property search under Commercial without activating Buy', () => {
        vi.stubEnv('NEXT_PUBLIC_COMMERCIAL_PUBLIC', 'true');
        currentPathname = '/commercial/properties/';

        render(<SiteHeader profile={defaultRealEstateProfile} />);
        const navigation = screen.getByRole('navigation', { name: /primary navigation/i });
        const commercialLink = within(navigation).getByRole('link', { name: 'Commercial' });
        const buyLink = within(navigation).getByRole('link', { name: 'Buy' });

        expect(commercialLink.className).not.toBe('');
        expect(buyLink.className).toBe('');
        expect(buyLink).not.toHaveAttribute('aria-current');
    });
});
