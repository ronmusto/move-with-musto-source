import { describe, expect, it, vi } from 'vitest';
import { loadCommercialSearchDelivery } from './commercial-search-client';

function response(value: unknown) {
    return new Response(JSON.stringify(value), {
        status: 200,
        headers: { 'content-type': 'application/json' },
    });
}

describe('loadCommercialSearchDelivery', () => {
    it('rejects a stale current pointer before requesting a generation', async () => {
        const staleDate = new Date(Date.now() - (4 * 24 * 60 * 60 * 1000)).toISOString();
        const fetcher = vi.fn().mockResolvedValue(response({
            schemaVersion: 2,
            generation: 'synthetic-generation',
            generatedAt: staleDate,
            manifestFile: 'commercial-search-manifest.json',
        }));

        await expect(loadCommercialSearchDelivery({
            currentPointerUrl: 'https://data.example.test/commercial/current.json',
            fetcher,
        })).rejects.toThrow('current pointer failed validation');
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('rejects a malformed manifest before requesting a search index', async () => {
        const freshDate = new Date().toISOString();
        const fetcher = vi.fn()
            .mockResolvedValueOnce(response({
                schemaVersion: 2,
                generation: 'synthetic-generation',
                generatedAt: freshDate,
                manifestFile: 'commercial-search-manifest.json',
            }))
            .mockResolvedValueOnce(response({
                schemaVersion: 2,
                generatedAt: freshDate,
                source: 'Synthetic source',
            }));

        await expect(loadCommercialSearchDelivery({
            currentPointerUrl: 'https://data.example.test/commercial/current.json',
            fetcher,
        })).rejects.toThrow('manifest failed validation');
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[1]?.[0]).toBe(
            'https://data.example.test/commercial/generations/synthetic-generation/commercial-search-manifest.json',
        );
    });
});
