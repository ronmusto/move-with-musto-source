import { describe, expect, it } from 'vitest';
import { sanitizePublicHttpsUrl as sanitizeIngestionUrl } from '../../scripts/public-url-safety.mjs';
import { sanitizePublicHttpsUrl as sanitizeBrowserUrl } from './safe-external-url';

const sanitizers = [sanitizeIngestionUrl, sanitizeBrowserUrl];

describe.each(sanitizers)('public HTTPS URL sanitizer', (sanitizeUrl) => {
    it('retains a public HTTPS tour URL', () => {
        expect(sanitizeUrl(' https://example.com/tour?id=12 ')).toBe('https://example.com/tour?id=12');
    });

    it.each([
        '',
        'NULL',
        'not a URL',
        'http://example.com/tour',
        'javascript:alert(1)',
        'https://user:password@example.com/tour',
        'https://localhost/tour',
        'https://127.0.0.1/tour',
        'https://192.168.1.10/tour',
        'https://[::1]/tour',
    ])('rejects unsafe value %s', (value) => {
        expect(sanitizeUrl(value)).toBe('');
    });
});
