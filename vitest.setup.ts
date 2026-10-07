import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
}

/* jsdom does not provide IntersectionObserver — mock it globally */
if (typeof window !== 'undefined' && typeof window.IntersectionObserver === 'undefined') {
    class MockIntersectionObserver implements IntersectionObserver {
        readonly root: Element | Document | null = null;
        readonly rootMargin: string = '';
        readonly thresholds: readonly number[] = [];
        private callback: IntersectionObserverCallback;

        constructor(callback: IntersectionObserverCallback) {
            this.callback = callback;
        }

        observe(target: Element) {
            /* Immediately report as intersecting so scroll-reveal content renders */
            this.callback(
                [{ isIntersecting: true, target } as IntersectionObserverEntry],
                this,
            );
        }

        unobserve() {}
        disconnect() {}
        takeRecords(): IntersectionObserverEntry[] {
            return [];
        }
    }
    Object.defineProperty(window, 'IntersectionObserver', {
        writable: true,
        value: MockIntersectionObserver,
    });
}

afterEach(() => {
    if (typeof document !== 'undefined') cleanup();
});
