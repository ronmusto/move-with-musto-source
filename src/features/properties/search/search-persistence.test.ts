import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSort } from '../property-search-utils';
import {
    currentSortStorageVersion,
    readSavedFilterOverrides,
    readSavedListingIds,
    readSavedSortState,
    storageKeys,
    writeJsonStorage,
    writeStorage,
} from './search-persistence';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('optional search preferences', () => {
    it('accepts valid saved IDs while dropping malformed and duplicate entries', () => {
        localStorage.setItem(storageKeys.saved, JSON.stringify(['TEST-A', null, {}, 'TEST-A', 'TEST-B', '']));
        expect(readSavedListingIds(storageKeys.saved)).toEqual(['TEST-A', 'TEST-B']);
        localStorage.setItem(storageKeys.saved, '{"not":"an array"}');
        expect(readSavedListingIds(storageKeys.saved)).toEqual([]);
    });

    it('keeps valid filter types without reviving obsolete geography', () => {
        localStorage.setItem(storageKeys.filters, JSON.stringify({ query: {}, minPrice: '700000', savedOnly: 'yes', includeTowns: ['Burlington', 1], region: 'stale', county: 'stale' }));
        expect(readSavedFilterOverrides()).toEqual({ minPrice: '700000', includeTowns: ['Burlington'] });
    });

    it('falls back safely for null, malformed, or primitive sort/filter storage', () => {
        for (const value of ['null', '{broken', '42', '"bad"']) {
            localStorage.setItem(storageKeys.filters, value);
            localStorage.setItem(storageKeys.sort, value);
            expect(readSavedFilterOverrides()).toEqual({});
            expect(readSavedSortState()).toEqual(defaultSort);
        }
    });

    it('preserves explicit sorting after migrating the former default', () => {
        localStorage.setItem(storageKeys.sort, JSON.stringify({ key: 'price', direction: 'desc' }));
        expect(readSavedSortState()).toEqual(defaultSort);
        writeStorage(storageKeys.sortVersion, currentSortStorageVersion);
        expect(readSavedSortState()).toEqual({ key: 'price', direction: 'desc' });
    });

    it('does not break search when reads are blocked or the storage quota is full', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
        expect(readSavedListingIds(storageKeys.saved)).toEqual([]);
        expect(readSavedFilterOverrides()).toEqual({});
        expect(readSavedSortState()).toEqual(defaultSort);
        expect(() => writeJsonStorage(storageKeys.saved, ['TEST-A'])).not.toThrow();
        expect(() => writeStorage(storageKeys.sortVersion, currentSortStorageVersion)).not.toThrow();
    });
});
