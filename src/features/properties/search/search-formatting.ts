import { mlsOpenHouseTimeZone, parseMlsOpenHouseTimestamp } from '@/lib/mls-open-house-time';
import {
    type MlsListingDetail,
    type MlsListingFacts,
    type MlsSearchListing,
} from '@/lib/mls-public-listings';
import {
    allLabel,
    defaultRegion,
    propertyAreaPresetForTowns,
    type PropertyFilterState,
} from '../property-search-utils';

export function searchAreaLabelFor(filters: PropertyFilterState) {
    const area = propertyAreaPresetForTowns(filters.includeTowns);
    if (area) {
        return area.label;
    }

    if (filters.includeTowns.length === 1) {
        return filters.includeTowns[0];
    }

    if (filters.includeTowns.length > 1) {
        return filters.includeTowns.join(', ');
    }

    if (filters.county !== allLabel) {
        return `${filters.county} County`;
    }

    return filters.region || filters.state || defaultRegion;
}

export function listingTitle(listing: MlsSearchListing | MlsListingDetail) {
    return `${listing.address.line}, ${listing.address.town}`;
}

export function formatNumber(value: number | null) {
    return value === null ? 'N/A' : new Intl.NumberFormat('en-US').format(value);
}

export function formatBaths(facts: Pick<MlsListingFacts, 'fullBaths' | 'halfBaths' | 'bathsLabel'>) {
    const fullBaths = facts.fullBaths ?? 0;
    const halfBaths = facts.halfBaths ?? 0;

    if (fullBaths > 0 && halfBaths > 0) {
        return `${formatNumber(fullBaths)}f | ${formatNumber(halfBaths)}h`;
    }

    if (fullBaths > 0) {
        return `${formatNumber(fullBaths)}f`;
    }

    if (halfBaths > 0) {
        return `${formatNumber(halfBaths)}h`;
    }

    return facts.bathsLabel.replace(/\s*;\s*/g, ' | ') || 'N/A';
}

export function formatPriceShort(value: number) {
    if (value >= 1_000_000) {
        return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
    }

    if (value >= 1_000) {
        return `$${Math.round(value / 1_000)}K`;
    }

    return `$${value}`;
}

function parsedDate(timestamp: string | null | undefined) {
    if (!timestamp) {
        return null;
    }

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatListingUpdatedAt(timestamp: string | null | undefined) {
    const date = parsedDate(timestamp);
    if (!date) {
        return 'Unavailable';
    }

    return new Intl.DateTimeFormat('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

export function formatOpenHouseRange(start: string, end: string) {
    const startTimestamp = parseMlsOpenHouseTimestamp(start);
    const endTimestamp = parseMlsOpenHouseTimestamp(end);
    const startDate = Number.isFinite(startTimestamp) ? new Date(startTimestamp) : null;
    const endDate = Number.isFinite(endTimestamp) ? new Date(endTimestamp) : null;
    if (!startDate || !endDate) {
        return `${start} to ${end}`;
    }

    const date = new Intl.DateTimeFormat('en-US', {
        timeZone: mlsOpenHouseTimeZone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    }).format(startDate);
    const time = new Intl.DateTimeFormat('en-US', {
        timeZone: mlsOpenHouseTimeZone,
        hour: 'numeric',
        minute: '2-digit',
    });
    return `${date}, ${time.format(startDate)}-${time.format(endDate)}`;
}

export function priceSummaryLabel(value: string, fallback: string) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }

    return formatPriceShort(parsed);
}

export function numericRangeSummary(label: string, minimum: string, maximum: string) {
    if (minimum && maximum) {
        return `${label}: ${minimum}–${maximum}`;
    }
    if (minimum) {
        return `${label}: ${minimum}+`;
    }
    return `${label}: up to ${maximum}`;
}
