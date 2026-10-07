import {
    defaultFilters as defaultPropertyFilters,
    type PropertyFilterState,
    type PropertySortDirection,
    type PropertySortKey,
} from '../property-search-utils';
import { LeadAction, ResultPageSize } from './search-types';

export const splitResultsBatchSize = 50;

export const savedHomesEmailLimit = 20;

export const buyerPriceSlider = {
    min: 0,
    max: 3_000_000,
    extendedMax: 20_000_000,
    minimumUsefulMax: 1_500_000,
    step: 25_000,
};

export const pricePresets = [
    { label: 'Any', minPrice: '', maxPrice: '', sliderMin: 0, sliderMax: null },
    { label: 'Up to $750K', minPrice: '', maxPrice: '750000', sliderMin: 0, sliderMax: 750_000 },
    {
        label: '$750K-$1.5M',
        minPrice: '750000',
        maxPrice: '1500000',
        sliderMin: 750_000,
        sliderMax: 1_500_000,
    },
    {
        label: '$1.5M-$3M',
        minPrice: '1500000',
        maxPrice: '3000000',
        sliderMin: 1_500_000,
        sliderMax: 3_000_000,
    },
    {
        label: '$3M+',
        minPrice: '3000000',
        maxPrice: '',
        sliderMin: 3_000_000,
        sliderMax: 20_000_000,
    },
];

export const quickBedOptions = [
    { label: 'Any beds', value: '' },
    { label: '1+ beds', value: '1' },
    { label: '2+ beds', value: '2' },
    { label: '3+ beds', value: '3' },
    { label: '4+ beds', value: '4' },
    { label: '5+ beds', value: '5' },
] as const;

export const quickBathOptions = [
    { label: 'Any baths', value: '' },
    { label: '1+ baths', value: '1' },
    { label: '1.5+ baths', value: '1.5' },
    { label: '2+ baths', value: '2' },
    { label: '3+ baths', value: '3' },
    { label: '4+ baths', value: '4' },
] as const;

export const defaultFilters: PropertyFilterState = defaultPropertyFilters;

export const sortKeyOptions: Array<{ value: PropertySortKey; label: string }> = [
    { value: 'recommended', label: 'Recommended' },
    { value: 'price', label: 'Price' },
    { value: 'sqft', label: 'Square feet' },
];

export const sortDirectionOptions: Array<{ value: PropertySortDirection; label: string }> = [
    { value: 'desc', label: 'High to low' },
    { value: 'asc', label: 'Low to high' },
];

export const combinedSortOptions: Array<{
    value: `${PropertySortKey}:${PropertySortDirection}`;
    label: string;
}> = [
        { value: 'recommended:desc', label: 'Recommended' },
        { value: 'price:desc', label: 'Price: high to low' },
        { value: 'price:asc', label: 'Price: low to high' },
        { value: 'sqft:desc', label: 'Square feet: high to low' },
        { value: 'sqft:asc', label: 'Square feet: low to high' },
    ];

export const actionLabels: Record<LeadAction, string> = {
    get_matching_homes: 'Help me find homes',
    request_details: 'Ask about a home',
    request_showing: 'Plan a showing',
    send_selected_homes: 'Send these homes to Mai Ly',
    ask_about_home: 'Ask about this home',
};

export const propertyRequestOptions = [
    { value: 'get_matching_homes', label: 'Help me find homes' },
    { value: 'request_details', label: 'Ask about a home' },
    { value: 'request_showing', label: 'Plan a showing' },
    { value: 'send_selected_homes', label: 'Send these homes' },
    { value: 'ask_about_home', label: 'Ask a question' },
] satisfies Array<{ value: LeadAction; label: string }>;

export const resultPageSizes = [10, 50] as const satisfies readonly ResultPageSize[];
