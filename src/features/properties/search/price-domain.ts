import { type MlsSearchListing } from '@/lib/mls-public-listings';
import { buyerPriceSlider } from './search-options';

export function priceBoundsFor(listings: MlsSearchListing[]) {
    let highestPrice = 0;

    listings.forEach((listing) => {
        const price = listing.listPrice;
        if (typeof price === 'number' && price > highestPrice) {
            highestPrice = price;
        }
    });

    if (highestPrice === 0) {
        return {
            min: buyerPriceSlider.min,
            max: buyerPriceSlider.max,
            step: buyerPriceSlider.step,
        };
    }

    const roundedMax = Math.ceil(highestPrice / 50_000) * 50_000;

    return {
        min: buyerPriceSlider.min,
        max: Math.min(
            buyerPriceSlider.max,
            Math.max(buyerPriceSlider.minimumUsefulMax, roundedMax),
        ),
        step: buyerPriceSlider.step,
    };
}

export function priceControlValue(value: string, fallback: number, bounds: Readonly<{ min: number; max: number }>) {
    if (value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, bounds.min), bounds.max);
}

export function priceSliderDomainForInputs(
    minPrice: string,
    maxPrice: string,
    priceBounds: Readonly<{ min: number; max: number }>,
) {
    const enteredMin = Number(minPrice);
    const enteredMax = Number(maxPrice);
    const min = Number.isFinite(enteredMin) && enteredMin > 0
        ? Math.min(enteredMin, buyerPriceSlider.extendedMax - buyerPriceSlider.step)
        : buyerPriceSlider.min;
    const fallbackMax = min >= buyerPriceSlider.max
        ? buyerPriceSlider.extendedMax
        : Math.max(priceBounds.max, min + buyerPriceSlider.step);
    const max = Number.isFinite(enteredMax) && enteredMax > min
        ? Math.min(enteredMax, buyerPriceSlider.extendedMax)
        : fallbackMax;

    return {
        min,
        max: Math.max(max, min + buyerPriceSlider.step),
    };
}
