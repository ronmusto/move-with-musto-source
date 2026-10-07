'use client';

import { useRef, useState } from 'react';
import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import type { CommercialSearchManifest } from '@/lib/commercial-public-listings';
import type { CommercialSearchFilters } from '@/lib/commercial-search-filters';
import { CommunityCombobox } from './CommunityCombobox';
import { formatNumber } from './commercial-presentation';
import buyerStyles from '../properties/PropertiesSearch.module.css';
import styles from './CommercialPropertiesSearch.module.css';

type Props = Readonly<{
    filters: CommercialSearchFilters;
    facets: CommercialSearchManifest['facets'];
    resultCount: number;
    updateFilter: <Key extends keyof CommercialSearchFilters>(key: Key, value: CommercialSearchFilters[Key]) => void;
    setTownRule: (town: string, rule: 'included' | 'excluded') => void;
    removeTownRule: (town: string, rule: 'included' | 'excluded') => void;
    onClearTownRules: () => void;
    onClearFilters: () => void;
    closeFilterSheet: () => void;
}>;

/** Owns transient community queries and keyboard focus while the modal is open. */
export function CommercialFilterSheet({
    filters, facets, resultCount, updateFilter, setTownRule, removeTownRule,
    onClearTownRules, onClearFilters, closeFilterSheet,
}: Props) {
    const filterSheetRef = useRef<HTMLElement>(null);
    const [includeTownQuery, setIncludeTownQuery] = useState('');
    const [excludeTownQuery, setExcludeTownQuery] = useState('');

    useAccessibleDialog({
        dialogRef: filterSheetRef,
        initialFocusRef: filterSheetRef,
        onClose: closeFilterSheet,
        // The workspace remembers the opener, including the mobile capsule.
        restoreFocus: false,
    });

    function clearQueries() {
        setIncludeTownQuery('');
        setExcludeTownQuery('');
    }

    function clearFilters() {
        clearQueries();
        onClearFilters();
    }

    function clearTownRules() {
        clearQueries();
        onClearTownRules();
    }

    return (
        <div className={buyerStyles.filterSheetBackdrop} onClick={closeFilterSheet}>
            <aside
                aria-labelledby="commercial-more-filters-title"
                aria-modal="true"
                className={buyerStyles.filterSheet}
                id="commercial-more-filters"
                onClick={(event) => event.stopPropagation()}
                ref={filterSheetRef}
                role="dialog"
                tabIndex={-1}
            >
                <div className={buyerStyles.filterSheetHeader}>
                    <div>
                        <p className={buyerStyles.eyebrow}>Search tools</p>
                        <h3 id="commercial-more-filters-title">More filters</h3>
                    </div>
                    <button
                        aria-label="Close more commercial filters"
                        className={buyerStyles.filterSheetCloseButton}
                        onClick={closeFilterSheet}
                        type="button"
                    >
                        Close
                    </button>
                </div>

                <div className={buyerStyles.filterSheetBody}>
                    <section
                        aria-labelledby="commercial-community-filters-title"
                        className={buyerStyles.filterSheetSection}
                    >
                        <h4 id="commercial-community-filters-title">Communities</h4>
                        <fieldset className={buyerStyles.townRuleGroup}>
                            <legend className={buyerStyles.visuallyHidden}>Communities</legend>
                            <div className={buyerStyles.townRuleColumns}>
                                <div className={buyerStyles.townRuleColumn}>
                                    <CommunityCombobox
                                        actionLabel="Include"
                                        label="Show listings in"
                                        onQueryChange={setIncludeTownQuery}
                                        onSelect={(town) => setTownRule(town, 'included')}
                                        query={includeTownQuery}
                                        totalTownCount={facets.towns.length}
                                        towns={facets.towns.filter((town) =>
                                            !filters.includeTowns.includes(town) &&
                                            !filters.excludeTowns.includes(town))}
                                    />
                                    <div
                                        aria-label="Included communities"
                                        className={buyerStyles.townRuleSelectedList}
                                    >
                                        {filters.includeTowns.length > 0 ? filters.includeTowns.map((town) => (
                                            <button
                                                aria-label={`Remove included town ${town}`}
                                                className={buyerStyles.townChipInclude}
                                                key={town}
                                                onClick={() => removeTownRule(town, 'included')}
                                                type="button"
                                            >
                                                {town}<span aria-hidden="true"> ×</span>
                                            </button>
                                        )) : (
                                            <span>All service-area communities are currently included.</span>
                                        )}
                                    </div>
                                </div>

                                <div className={buyerStyles.townRuleColumn}>
                                    <CommunityCombobox
                                        actionLabel="Exclude"
                                        label="Hide listings in"
                                        onQueryChange={setExcludeTownQuery}
                                        onSelect={(town) => setTownRule(town, 'excluded')}
                                        query={excludeTownQuery}
                                        totalTownCount={facets.towns.length}
                                        towns={facets.towns.filter((town) =>
                                            !filters.includeTowns.includes(town) &&
                                            !filters.excludeTowns.includes(town))}
                                    />
                                    <div
                                        aria-label="Excluded communities"
                                        className={buyerStyles.townRuleSelectedList}
                                    >
                                        {filters.excludeTowns.length > 0 ? filters.excludeTowns.map((town) => (
                                            <button
                                                aria-label={`Remove excluded town ${town}`}
                                                className={buyerStyles.townChipExclude}
                                                key={town}
                                                onClick={() => removeTownRule(town, 'excluded')}
                                                type="button"
                                            >
                                                {town}<span aria-hidden="true"> ×</span>
                                            </button>
                                        )) : <span>No communities are excluded.</span>}
                                    </div>
                                </div>
                            </div>
                            {filters.includeTowns.length > 0 || filters.excludeTowns.length > 0 ? (
                                <div className={buyerStyles.townRuleActions}>
                                    <button
                                        className={buyerStyles.townChipClear}
                                        onClick={clearTownRules}
                                        type="button"
                                    >
                                        Clear community choices
                                    </button>
                                </div>
                            ) : null}
                        </fieldset>
                    </section>

                    <section className={buyerStyles.filterSheetSection}>
                        <h4>Property type</h4>
                        <label>
                            <span>Listing type</span>
                            <select
                                onChange={(event) => updateFilter('listingType', event.currentTarget.value)}
                                value={filters.listingType}
                            >
                                <option value="all">All listing types</option>
                                {facets.listingTypes.map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </label>
                    </section>

                    <section className={buyerStyles.filterSheetSection}>
                        <h4>Sale price and size</h4>
                        <p className={styles.filterHelp}>
                            Price limits apply to sale and sale-or-lease offerings only. The export
                            does not provide a comparable lease-rate basis.
                        </p>
                        <div className={styles.sheetGrid}>
                            <label>
                                <span>Minimum sale price</span>
                                <input
                                    disabled={filters.availability === 'for-lease'}
                                    inputMode="numeric"
                                    min="0"
                                    onChange={(event) => updateFilter('minPrice', event.currentTarget.value)}
                                    placeholder="No minimum"
                                    type="number"
                                    value={filters.minPrice}
                                />
                            </label>
                            <label>
                                <span>Maximum sale price</span>
                                <input
                                    disabled={filters.availability === 'for-lease'}
                                    inputMode="numeric"
                                    min="0"
                                    onChange={(event) => updateFilter('maxPrice', event.currentTarget.value)}
                                    placeholder="No maximum"
                                    type="number"
                                    value={filters.maxPrice}
                                />
                            </label>
                            <label>
                                <span>Minimum building square feet</span>
                                <input
                                    inputMode="numeric"
                                    min="0"
                                    onChange={(event) => updateFilter('minSquareFeet', event.currentTarget.value)}
                                    placeholder="Any size"
                                    type="number"
                                    value={filters.minSquareFeet}
                                />
                            </label>
                            <label>
                                <span>Minimum acreage</span>
                                <input
                                    inputMode="decimal"
                                    min="0"
                                    onChange={(event) => updateFilter('minAcreage', event.currentTarget.value)}
                                    placeholder="Any acreage"
                                    step="0.1"
                                    type="number"
                                    value={filters.minAcreage}
                                />
                            </label>
                        </div>
                    </section>

                    <section className={buyerStyles.filterSheetSection}>
                        <h4>Business opportunities</h4>
                        <label>
                            <span>Real estate included</span>
                            <select
                                disabled={filters.category !== 'all' &&
                                    filters.category !== 'business-opportunity'}
                                onChange={(event) => updateFilter(
                                    'realEstateIncluded',
                                    event.currentTarget.value as CommercialSearchFilters['realEstateIncluded'],
                                )}
                                value={filters.realEstateIncluded}
                            >
                                <option value="all">Any / not applicable</option>
                                <option value="yes">Yes</option>
                                <option value="no">No</option>
                                <option value="unknown">Unknown</option>
                            </select>
                        </label>
                        <p className={styles.filterHelp}>
                            This filter applies only to business-opportunity records.
                        </p>
                    </section>
                </div>

                <div className={buyerStyles.filterSheetFooter}>
                    <button className={buyerStyles.filterSheetSecondaryButton} onClick={clearFilters} type="button">
                        Reset filters
                    </button>
                    <button onClick={closeFilterSheet} type="button">
                        Show {formatNumber(resultCount)} listings
                    </button>
                </div>
            </aside>
        </div>
    );
}
