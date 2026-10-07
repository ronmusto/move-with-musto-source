import { type PropertySearchMapGeometry } from '../property-search-url-state';
import { type PropertyFilterState, type PropertySortState } from '../property-search-utils';
import type { MapAreaSelection } from '../PropertyMapView';
import { ResultPageSize } from './search-types';

export function mapGeometryForSelection(selection: MapAreaSelection | null): PropertySearchMapGeometry | null {
    if (!selection) {
        return null;
    }

    const geometry = (selection as MapAreaSelection & {
        geometry?: PropertySearchMapGeometry;
    }).geometry;
    return geometry ?? { kind: 'bounds', bounds: selection.bounds };
}

export const propertyListingHistoryKey = 'moveWithMustoPropertyListing';

export const propertySavedOnlyHistoryKey = 'moveWithMustoSavedOnly';

export type PropertyListingHistoryMarker = Readonly<{
    entryId: number;
    listingNumber: string;
    pushed: true;
}>;

export type PropertySavedOnlyHistoryMarker = Readonly<{
    pushed: true;
}>;

export function searchCriteriaSignature(
    filters: PropertyFilterState,
    sort: PropertySortState,
    pageSize: ResultPageSize,
) {
    return JSON.stringify([filters, sort, pageSize]);
}

export function historyStateRecord() {
    return window.history.state && typeof window.history.state === 'object'
        ? { ...window.history.state as Record<string, unknown> }
        : {};
}

export function propertyListingHistoryMarker(state: Record<string, unknown>) {
    const value = state[propertyListingHistoryKey];
    if (!value || typeof value !== 'object') {
        return null;
    }

    const marker = value as Partial<PropertyListingHistoryMarker>;
    return marker.pushed === true &&
        Number.isInteger(marker.entryId) &&
        typeof marker.listingNumber === 'string'
        ? marker as PropertyListingHistoryMarker
        : null;
}

export function propertySavedOnlyHistoryMarker(state: Record<string, unknown>) {
    const value = state[propertySavedOnlyHistoryKey];
    if (!value || typeof value !== 'object') {
        return null;
    }

    return (value as Partial<PropertySavedOnlyHistoryMarker>).pushed === true
        ? value as PropertySavedOnlyHistoryMarker
        : null;
}
