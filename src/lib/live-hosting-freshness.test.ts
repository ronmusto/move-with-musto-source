import { describe, expect, it } from 'vitest';
import {
    assertFreshMlsCurrentPointer,
    MLS_PIN_MAX_PUBLIC_AGE_MS as HOSTING_MAX_PUBLIC_AGE_MS,
} from '../../scripts/check-live-hosting-lib.mjs';
import {
    isMlsBundleFresh,
    MLS_PIN_MAX_PUBLIC_AGE_MS as BROWSER_MAX_PUBLIC_AGE_MS,
} from './mls-public-listings';

const now = Date.parse('2026-08-04T18:00:00.000Z');

describe('live hosting MLS freshness guard', () => {
    it('uses the same three-day limit as the browser guard', () => {
        expect(HOSTING_MAX_PUBLIC_AGE_MS).toBe(BROWSER_MAX_PUBLIC_AGE_MS);
    });

    it('accepts the exact three-day boundary and rejects data one millisecond older', () => {
        const exactBoundary = new Date(now - BROWSER_MAX_PUBLIC_AGE_MS).toISOString();
        const justExpired = new Date(now - BROWSER_MAX_PUBLIC_AGE_MS - 1).toISOString();

        expect(() => assertFreshMlsCurrentPointer({ generatedAt: exactBoundary }, now))
            .not.toThrow();
        expect(isMlsBundleFresh(exactBoundary, now)).toBe(true);
        expect(() => assertFreshMlsCurrentPointer({ generatedAt: justExpired }, now))
            .toThrow(/three-day refresh limit/i);
        expect(isMlsBundleFresh(justExpired, now)).toBe(false);
    });

    it('fails closed for invalid timestamps and matches the browser future-clock tolerance', () => {
        const toleratedFuture = new Date(now + (5 * 60 * 1000)).toISOString();
        const excessiveFuture = new Date(now + (5 * 60 * 1000) + 1).toISOString();

        expect(() => assertFreshMlsCurrentPointer({}, now))
            .toThrow(/valid generatedAt timestamp/i);
        expect(() => assertFreshMlsCurrentPointer({ generatedAt: 123 }, now))
            .toThrow(/valid generatedAt timestamp/i);
        expect(() => assertFreshMlsCurrentPointer({ generatedAt: 'not-a-date' }, now))
            .toThrow(/invalid generatedAt timestamp/i);
        expect(() => assertFreshMlsCurrentPointer({ generatedAt: toleratedFuture }, now))
            .not.toThrow();
        expect(isMlsBundleFresh(toleratedFuture, now)).toBe(true);
        expect(() => assertFreshMlsCurrentPointer({ generatedAt: excessiveFuture }, now))
            .toThrow(/unexpectedly in the future/i);
        expect(isMlsBundleFresh(excessiveFuture, now)).toBe(false);
    });
});
