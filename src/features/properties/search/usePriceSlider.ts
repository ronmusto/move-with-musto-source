import { useEffect, useEffectEvent, useState, type CSSProperties } from 'react';
import { priceControlValue, priceSliderDomainForInputs } from './price-domain';
import { buyerPriceSlider, pricePresets } from './search-options';

type PriceOptions = Readonly<{
    filters: Readonly<{ minPrice: string; maxPrice: string }>;
    priceBounds: Readonly<{ min: number; max: number }>;
    hasRestoredStorage: boolean;
    priceRestoreVersion: number;
}>;

/** Selected thumb values and the track domain have different lifetimes.
 * A restore or inventory-bound change resets the track; dragging a thumb does not.
 */
export function usePriceSlider({ filters, priceBounds, hasRestoredStorage, priceRestoreVersion }: PriceOptions) {
    const [priceSliderDomain, setPriceSliderDomain] = useState({
        min: buyerPriceSlider.min,
        max: buyerPriceSlider.max,
    });
    const minimumPriceValue = priceControlValue(filters.minPrice, priceSliderDomain.min, priceSliderDomain);
    const maximumPriceValue = priceControlValue(filters.maxPrice, priceSliderDomain.max, priceSliderDomain);
    const sliderSpan = Math.max(priceSliderDomain.max - priceSliderDomain.min, buyerPriceSlider.step);
    const sliderStart = ((Math.min(minimumPriceValue, maximumPriceValue) - priceSliderDomain.min) / sliderSpan) * 100;
    const sliderEnd = ((Math.max(minimumPriceValue, maximumPriceValue) - priceSliderDomain.min) / sliderSpan) * 100;
    const priceSliderStyle = {
        '--price-range-start': `${sliderStart}%`,
        '--price-range-end': `${sliderEnd}%`,
    } as CSSProperties;
    useEffect(() => {
        if (filters.minPrice === '' && filters.maxPrice === '') {
            setPriceSliderDomain({ min: priceBounds.min, max: priceBounds.max });
        }
    }, [filters.maxPrice, filters.minPrice, priceBounds.max, priceBounds.min]);

    const restoreDomain = useEffectEvent(() => {
        if (!hasRestoredStorage) {
            return;
        }

        const matchingPreset = pricePresets.find((preset) =>
            preset.minPrice === filters.minPrice && preset.maxPrice === filters.maxPrice,
        );

        if (matchingPreset) {
            setPriceSliderDomain({
                min: matchingPreset.sliderMin,
                max: matchingPreset.sliderMax ?? priceBounds.max,
            });
            return;
        }

        setPriceSliderDomain(priceSliderDomainForInputs(filters.minPrice, filters.maxPrice, priceBounds));
        // Rebuild the domain after URL restoration, not each thumb movement:
        // changing the selected price alone must not shrink the slider's track.
    });

    useEffect(() => {
        restoreDomain();
    }, [hasRestoredStorage, priceBounds.max, priceBounds.min, priceRestoreVersion]);

    return { priceSliderDomain, setPriceSliderDomain, minimumPriceValue, maximumPriceValue, priceSliderStyle };
}
