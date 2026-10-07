import {
    defaultSort,
    type PropertyFilterState,
    type PropertySortDirection,
    type PropertySortKey,
    type PropertySortState,
} from '../property-search-utils';
import { defaultFilters, sortDirectionOptions, sortKeyOptions } from './search-options';

export const storageKeys = {
    saved: 'move-with-musto.properties.saved',
    selected: 'move-with-musto.properties.selected',
    filters: 'move-with-musto.properties.filters',
    sort: 'move-with-musto.properties.sort',
    sortVersion: 'move-with-musto.properties.sort-version',
};
export const currentSortStorageVersion = 'recommended-v1';

function readStorage(key: string): string | null {
    try {
        return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function readJsonStorage(key: string): unknown {
    try {
        const value = readStorage(key);
        return value === null ? null : JSON.parse(value);
    } catch {
        return null;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Browser preferences are optional and untrusted; malformed values never enter UI state. */
export function readSavedListingIds(key: string): string[] {
    const value = readJsonStorage(key);
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
}

export function readSavedFilterOverrides(): Partial<PropertyFilterState> {
    const value = readJsonStorage(storageKeys.filters);
    if (!isRecord(value)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, fallback] of Object.entries(defaultFilters)) {
        // Geography follows the current service area, never legacy stored regions.
        if (key === 'region' || key === 'county') continue;
        const saved = value[key];
        if (Array.isArray(fallback)) {
            if (Array.isArray(saved)) result[key] = saved.filter((item): item is string => typeof item === 'string');
        } else if (typeof saved === typeof fallback) {
            result[key] = saved;
        }
    }
    return result as Partial<PropertyFilterState>;
}

function isPropertySortKey(value: unknown): value is PropertySortKey {
    return sortKeyOptions.some((option) => option.value === value);
}

function isPropertySortDirection(value: unknown): value is PropertySortDirection {
    return sortDirectionOptions.some((option) => option.value === value);
}

export function readSavedSortState(): PropertySortState {
    const value = readJsonStorage(storageKeys.sort);
    const savedSort = isRecord(value) ? value : {};
    const isLegacyDefault = readStorage(storageKeys.sortVersion) !== currentSortStorageVersion &&
        savedSort.key === 'price' && savedSort.direction === 'desc';
    if (isLegacyDefault) return defaultSort;
    return {
        key: isPropertySortKey(savedSort.key) ? savedSort.key : defaultSort.key,
        direction: isPropertySortDirection(savedSort.direction) ? savedSort.direction : defaultSort.direction,
    };
}

export function writeStorage(key: string, value: string) {
    try {
        if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    } catch {
        // Private browsing, blocked storage, and full quotas must not break search.
    }
}

export function writeJsonStorage(key: string, value: unknown) {
    writeStorage(key, JSON.stringify(value));
}
