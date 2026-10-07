import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePriceSlider } from './usePriceSlider';

describe('price track lifecycle', () => {
    it('restores the selected preset, then keeps its track stable while the buyer drags', () => {
        const { result, rerender } = renderHook(({ filters, revision }) => usePriceSlider({
            filters, priceBounds: { min: 0, max: 3000000 }, hasRestoredStorage: true, priceRestoreVersion: revision,
        }), { initialProps: { filters: { minPrice: '750000', maxPrice: '1500000' }, revision: 1 } });
        expect(result.current.priceSliderDomain).toEqual({ min: 750000, max: 1500000 });
        rerender({ filters: { minPrice: '900000', maxPrice: '1200000' }, revision: 1 });
        expect(result.current.priceSliderDomain).toEqual({ min: 750000, max: 1500000 });
        expect(result.current.minimumPriceValue).toBe(900000);
        rerender({ filters: { minPrice: '3000000', maxPrice: '' }, revision: 2 });
        expect(result.current.priceSliderDomain).toEqual({ min: 3000000, max: 20000000 });
    });

    it('uses current selection when inventory bounds change after a drag', () => {
        const { result, rerender } = renderHook(({ filters, max }) => usePriceSlider({
            filters, priceBounds: { min: 0, max }, hasRestoredStorage: true, priceRestoreVersion: 1,
        }), { initialProps: { filters: { minPrice: '750000', maxPrice: '1500000' }, max: 3000000 } });
        rerender({ filters: { minPrice: '900000', maxPrice: '1200000' }, max: 3000000 });
        rerender({ filters: { minPrice: '900000', maxPrice: '1200000' }, max: 2000000 });
        expect(result.current.priceSliderDomain).toEqual({ min: 900000, max: 1200000 });
    });

    it('resets a custom track when all prices are cleared', () => {
        const { result, rerender } = renderHook(({ minPrice, maxPrice }) => usePriceSlider({
            filters: { minPrice, maxPrice }, priceBounds: { min: 0, max: 2000000 }, hasRestoredStorage: true, priceRestoreVersion: 1,
        }), { initialProps: { minPrice: '900000', maxPrice: '1200000' } });
        act(() => result.current.setPriceSliderDomain({ min: 500000, max: 1500000 }));
        rerender({ minPrice: '', maxPrice: '' });
        expect(result.current.priceSliderDomain).toEqual({ min: 0, max: 2000000 });
    });
});
