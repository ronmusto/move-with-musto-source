import type { MlsListingDetail } from '@/lib/mls-public-listings';
import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode, type PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useListingDetail } from './useListingDetail';

const generation = '2026-10-06T12:00:00.000Z';
const emptyDetails = new Map<string, MlsListingDetail>();
const options = { detailBaseUrl: '/test/listings', generatedAt: generation, initialDetails: emptyDetails };

function detail(listingNumber: string, generatedAt = generation): MlsListingDetail {
    return {
        listingNumber, generatedAt, propertyType: 'Single family', listPrice: 500000, priceLabel: '$500,000',
        status: { code: 'ACT', label: 'Active', isActive: true, isContingent: false },
        address: { line: '1 Synthetic Test Street', town: 'Burlington', county: 'Middlesex', state: 'MA', zip: '01803' },
        facts: { beds: 2, fullBaths: 1, halfBaths: 0, bathsLabel: '1f', sqft: 1200, lotSize: null, acreage: null, yearBuilt: null, parking: null },
        attribution: { listingAgent: 'Test Agent', listingOffice: 'Test Office', listingOfficePhone: '781-555-0100' },
        source: { name: 'Test fixture', photoDate: '', listingAlert: 'N' },
        remarks: 'Synthetic listing for lifecycle tests.', photoCount: 0, openHouses: [], virtualTourUrl: '',
    };
}

function response(value: unknown): Response {
    return { ok: true, json: async () => value } as Response;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => { resolve = done; });
    return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

describe('listing detail request lifecycle', () => {
    it('keeps a delayed request alive through Strict Mode cleanup and unrelated rerenders', async () => {
        const pending = deferred<Response>();
        const fetch = vi.fn(() => pending.promise);
        vi.stubGlobal('fetch', fetch);
        const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
        const { result, rerender } = renderHook(() => useListingDetail({ ...options, listingNumber: 'TEST-A' }), { wrapper });
        rerender();
        rerender();
        expect(result.current.detailState).toBe('loading');
        await act(async () => pending.resolve(response(detail('TEST-A'))));
        await waitFor(() => expect(result.current.detailState).toBe('ready'));
        expect(result.current.detail?.listingNumber).toBe('TEST-A');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('reuses a pending response when the same listing is closed and reopened', async () => {
        const pending = deferred<Response>();
        const fetch = vi.fn(() => pending.promise);
        vi.stubGlobal('fetch', fetch);
        const { result, rerender } = renderHook(({ id }: { id: string | null }) => useListingDetail({ ...options, listingNumber: id }), { initialProps: { id: 'TEST-A' as string | null } });
        rerender({ id: null });
        rerender({ id: 'TEST-A' });
        await act(async () => pending.resolve(response(detail('TEST-A'))));
        await waitFor(() => expect(result.current.detailState).toBe('ready'));
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('ignores a late response from the previous selection', async () => {
        const first = deferred<Response>();
        const second = deferred<Response>();
        vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
        const { result, rerender } = renderHook(({ id }) => useListingDetail({ ...options, listingNumber: id }), { initialProps: { id: 'TEST-A' } });
        rerender({ id: 'TEST-B' });
        await act(async () => second.resolve(response(detail('TEST-B'))));
        await waitFor(() => expect(result.current.detail?.listingNumber).toBe('TEST-B'));
        await act(async () => first.resolve(response(detail('TEST-A'))));
        expect(result.current.detail?.listingNumber).toBe('TEST-B');
    });

    it('can retry after a parsed but invalid response is repaired', async () => {
        const fetch = vi.fn().mockResolvedValueOnce(response(detail('WRONG-ID'))).mockResolvedValueOnce(response(detail('TEST-A')));
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useListingDetail({ ...options, listingNumber: 'TEST-A' }));
        await waitFor(() => expect(result.current.detailState).toBe('error'));
        act(() => result.current.retryDetail());
        await waitFor(() => expect(result.current.detailState).toBe('ready'));
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[1][1]).toEqual({ cache: 'no-store' });
    });

    it.each([
        { listingNumber: 'TEST-A', generatedAt: generation, address: { state: 'MA' } },
        { ...detail('TEST-A'), facts: null },
        { ...detail('TEST-A'), openHouses: {} },
        { ...detail('TEST-A'), features: { rooms: [{ name: 123 }] } },
    ])('rejects malformed detail with matching identity and permits recovery', async (malformed) => {
        const fetch = vi.fn().mockResolvedValueOnce(response(malformed)).mockResolvedValueOnce(response(detail('TEST-A')));
        vi.stubGlobal('fetch', fetch);
        const { result } = renderHook(() => useListingDetail({ ...options, listingNumber: 'TEST-A' }));
        await waitFor(() => expect(result.current.detailState).toBe('error'));
        expect(result.current.detail).toBeUndefined();
        act(() => result.current.retryDetail());
        await waitFor(() => expect(result.current.detailState).toBe('ready'));
    });

    it('can retry a network failure without an automatic retry loop', async () => {
        const fetch = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(detail('TEST-A')));
        vi.stubGlobal('fetch', fetch);
        const { result, rerender } = renderHook(() => useListingDetail({ ...options, listingNumber: 'TEST-A' }));
        await waitFor(() => expect(result.current.detailState).toBe('error'));
        rerender();
        expect(fetch).toHaveBeenCalledTimes(1);
        act(() => result.current.retryDetail());
        await waitFor(() => expect(result.current.detailState).toBe('ready'));
    });

    it('does not reuse an older generation of the same listing', async () => {
        const nextGeneration = '2026-10-07T12:00:00.000Z';
        const pending = deferred<Response>();
        const fetch = vi.fn(() => pending.promise);
        vi.stubGlobal('fetch', fetch);
        const initialDetails = new Map([['TEST-A', detail('TEST-A')]]);
        const { result, rerender } = renderHook(({ generatedAt }) => useListingDetail({ ...options, initialDetails, generatedAt, listingNumber: 'TEST-A' }), { initialProps: { generatedAt: generation } });
        expect(result.current.detailState).toBe('ready');
        expect(fetch).not.toHaveBeenCalled();
        rerender({ generatedAt: nextGeneration });
        expect(result.current.detail).toBeUndefined();
        await act(async () => pending.resolve(response(detail('TEST-A', nextGeneration))));
        await waitFor(() => expect(result.current.detail?.generatedAt).toBe(nextGeneration));
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
