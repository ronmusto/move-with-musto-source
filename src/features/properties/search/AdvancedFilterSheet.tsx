'use client';

import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import type { MlsSearchListing } from '@/lib/mls-public-listings';
import { useMemo, useState } from 'react';
import styles from '../PropertiesSearch.module.css';
import { allLabel, townRuleOptionsFor, type PropertyFilterState } from '../property-search-utils';
import { TownRuleCombobox } from './TownRuleCombobox';
import { formatNumber, formatPriceShort, priceSummaryLabel } from './search-formatting';
import { buyerPriceSlider, pricePresets } from './search-options';
import type { TownRuleState } from './search-types';
import type { usePriceSlider } from './usePriceSlider';

type AdvancedFilterSheetProps = Readonly<{
    open: boolean;
    onClose: () => void;
    filters: PropertyFilterState;
    listings: MlsSearchListing[];
    towns: readonly string[];
    propertyTypes: readonly string[];
    resultCount: number;
    priceSlider: ReturnType<typeof usePriceSlider>;
    updateFilter: <Key extends keyof PropertyFilterState>(key: Key, value: PropertyFilterState[Key]) => void;
    updateNumericRange: (
        minimumKey: 'minBeds' | 'minBaths' | 'minPrice',
        maximumKey: 'maxBeds' | 'maxBaths' | 'maxPrice',
        changedEnd: 'minimum' | 'maximum',
        value: string,
    ) => void;
    onTownRuleChange: (town: string, state: TownRuleState) => void;
    removeTownRule: (kind: 'includeTowns' | 'excludeTowns', town: string) => void;
    clearTownRules: () => void;
    clearFilters: () => void;
    applyPricePreset: (preset: typeof pricePresets[number]) => void;
    syncPriceSliderToInputs: () => void;
}>;

/** Controlled filters with local combobox interaction and dialog focus ownership. */
export function AdvancedFilterSheet({
    open, onClose, filters, listings, towns, propertyTypes, resultCount, priceSlider,
    updateFilter, updateNumericRange, onTownRuleChange, removeTownRule, clearTownRules,
    clearFilters, applyPricePreset, syncPriceSliderToInputs,
}: AdvancedFilterSheetProps) {
    const filterSheetRef = useAccessibleDialog<HTMLElement>({ active: open, onClose });
    const [includeTownQuery, setIncludeTownQuery] = useState('');
    const [excludeTownQuery, setExcludeTownQuery] = useState('');
    const includeTownOptions = useMemo(() => townRuleOptionsFor(listings, filters, includeTownQuery, towns)
        .filter((town) => !filters.includeTowns.includes(town)), [filters, includeTownQuery, listings, towns]);
    const excludeTownOptions = useMemo(() => townRuleOptionsFor(listings, filters, excludeTownQuery, towns)
        .filter((town) => !filters.excludeTowns.includes(town)), [excludeTownQuery, filters, listings, towns]);
    const { priceSliderDomain, minimumPriceValue, maximumPriceValue, priceSliderStyle } = priceSlider;

    function setTownRuleState(town: string, state: TownRuleState) {
        onTownRuleChange(town, state);
        if (state === 'included') setIncludeTownQuery('');
        else setExcludeTownQuery('');
    }

    // Stay mounted between openings so unfinished community queries are retained.
    if (!open) return null;

    return (
        <div className={styles.filterSheetBackdrop} onClick={onClose}>
            <aside
                aria-labelledby="advanced-property-filters-title"
                aria-modal="true"
                className={styles.filterSheet}
                id="property-search-more-filters"
                onClick={(event) => event.stopPropagation()}
                ref={filterSheetRef}
                role="dialog"
            >
                <div className={styles.filterSheetHeader}>
                    <div>
                        <p className={styles.eyebrow}>Search tools</p>
                        <h3 id="advanced-property-filters-title">More filters</h3>
                    </div>
                    <button
                        aria-label="Close more filters"
                        className={styles.filterSheetCloseButton}
                        onClick={onClose}
                        type="button"
                    >
                        Close
                    </button>
                </div>

                <div className={styles.filterSheetBody}>
                    <section className={styles.filterSheetSection} aria-labelledby="community-filters-title">
                        <h4 id="community-filters-title">Communities</h4>
                        <fieldset className={styles.townRuleGroup}>
                            <legend className={styles.visuallyHidden}>Communities</legend>
                            <div className={styles.townRuleColumns}>
                                <div className={styles.townRuleColumn}>
                                    <TownRuleCombobox
                                        actionLabel="Include"
                                        label="Show homes in"
                                        onQueryChange={setIncludeTownQuery}
                                        onSelect={(town) => setTownRuleState(town, 'included')}
                                        options={includeTownOptions}
                                        query={includeTownQuery}
                                    />

                                    <div className={styles.townRuleSelectedList} aria-label="Included towns">
                                        {filters.includeTowns.length > 0 ? (
                                            filters.includeTowns.map((town) => (
                                                <button
                                                    aria-label={`Remove included town ${town}`}
                                                    className={styles.townChipInclude}
                                                    key={`include-${town}`}
                                                    onClick={() => removeTownRule('includeTowns', town)}
                                                    type="button"
                                                >
                                                    Include {town}
                                                </button>
                                            ))
                                        ) : (
                                            <span>All service-area communities are currently included.</span>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.townRuleColumn}>
                                    <TownRuleCombobox
                                        actionLabel="Exclude"
                                        label="Leave out"
                                        onQueryChange={setExcludeTownQuery}
                                        onSelect={(town) => setTownRuleState(town, 'excluded')}
                                        options={excludeTownOptions}
                                        query={excludeTownQuery}
                                    />

                                    <div className={styles.townRuleSelectedList} aria-label="Excluded towns">
                                        {filters.excludeTowns.length > 0 ? (
                                            filters.excludeTowns.map((town) => (
                                                <button
                                                    aria-label={`Remove excluded town ${town}`}
                                                    className={styles.townChipExclude}
                                                    key={`exclude-${town}`}
                                                    onClick={() => removeTownRule('excludeTowns', town)}
                                                    type="button"
                                                >
                                                    Exclude {town}
                                                </button>
                                            ))
                                        ) : (
                                            <span>No communities are excluded.</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {filters.includeTowns.length > 0 || filters.excludeTowns.length > 0 ? (
                                <div className={styles.townRuleActions}>
                                    <button
                                        aria-label="Clear community choices"
                                        className={styles.townChipClear}
                                        onClick={clearTownRules}
                                        type="button"
                                    >
                                        Clear community choices
                                    </button>
                                </div>
                            ) : null}
                        </fieldset>
                    </section>

                    <section className={styles.filterSheetSection} aria-labelledby="home-basics-title">
                        <h4 id="home-basics-title">Home basics</h4>
                        <div className={styles.sheetFieldGrid}>
                            <label>
                                <span>Property type</span>
                                <select
                                    aria-label="Home basics property type"
                                    value={filters.propertyType}
                                    onChange={(event) => updateFilter('propertyType', event.currentTarget.value)}
                                >
                                    <option value={allLabel}>Any type</option>
                                    {propertyTypes.map((type) => <option key={type}>{type}</option>)}
                                </select>
                            </label>
                        </div>
                        <div className={styles.rangePair}>
                            <label>
                                <span>Minimum beds</span>
                                <input
                                    aria-label="Home basics minimum beds"
                                    inputMode="numeric"
                                    min="0"
                                    type="number"
                                    value={filters.minBeds}
                                    onChange={(event) => updateNumericRange(
                                        'minBeds',
                                        'maxBeds',
                                        'minimum',
                                        event.currentTarget.value,
                                    )}
                                />
                            </label>
                            <label>
                                <span>Maximum beds</span>
                                <input
                                    aria-label="Home basics maximum beds"
                                    inputMode="numeric"
                                    min="0"
                                    type="number"
                                    value={filters.maxBeds}
                                    onChange={(event) => updateNumericRange(
                                        'minBeds',
                                        'maxBeds',
                                        'maximum',
                                        event.currentTarget.value,
                                    )}
                                />
                            </label>
                        </div>
                        <div className={styles.rangePair}>
                            <label>
                                <span>Minimum baths</span>
                                <input
                                    aria-label="Home basics minimum baths"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.5"
                                    type="number"
                                    value={filters.minBaths}
                                    onChange={(event) => updateNumericRange(
                                        'minBaths',
                                        'maxBaths',
                                        'minimum',
                                        event.currentTarget.value,
                                    )}
                                />
                            </label>
                            <label>
                                <span>Maximum baths</span>
                                <input
                                    aria-label="Home basics maximum baths"
                                    inputMode="decimal"
                                    min="0"
                                    step="0.5"
                                    type="number"
                                    value={filters.maxBaths}
                                    onChange={(event) => updateNumericRange(
                                        'minBaths',
                                        'maxBaths',
                                        'maximum',
                                        event.currentTarget.value,
                                    )}
                                />
                            </label>
                        </div>
                    </section>

                    <section className={styles.filterSheetSection} aria-labelledby="media-filters-title">
                        <h4 id="media-filters-title">Open houses &amp; tours</h4>
                        <div className={styles.filterToggleGroup}>
                            <label className={styles.filterToggle}>
                                <input
                                    checked={filters.openHouseOnly}
                                    onChange={(event) => updateFilter('openHouseOnly', event.currentTarget.checked)}
                                    type="checkbox"
                                />
                                <span>Only homes with open houses</span>
                            </label>
                            <label className={styles.filterToggle}>
                                <input
                                    checked={filters.virtualTourOnly}
                                    onChange={(event) => updateFilter('virtualTourOnly', event.currentTarget.checked)}
                                    type="checkbox"
                                />
                                <span>Only homes with virtual tours</span>
                            </label>
                        </div>
                    </section>

                    <section className={styles.filterSheetSection} aria-labelledby="advanced-price-title">
                        <h4 id="advanced-price-title">Price range</h4>
                        <div
                            aria-label="Price range"
                            className={styles.priceRangeGroup}
                            role="group"
                        >
                            <div className={styles.priceRangeSummary}>
                                <span>{priceSummaryLabel(filters.minPrice, 'Any min')}</span>
                                <strong>{priceSummaryLabel(filters.maxPrice, 'Any max')}</strong>
                            </div>
                            <div className={styles.pricePresetRow} aria-label="Price shortcuts" role="group">
                                {pricePresets.map((preset) => {
                                    const isActive = filters.minPrice === preset.minPrice && filters.maxPrice === preset.maxPrice;

                                    return (
                                        <button
                                            aria-pressed={isActive}
                                            className={isActive ? styles.pricePresetActive : ''}
                                            key={preset.label}
                                            onClick={() => applyPricePreset(preset)}
                                            type="button"
                                        >
                                            {preset.label === 'Any' ? 'Any price' : preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className={styles.sliderStack} style={priceSliderStyle}>
                                <span aria-hidden="true" className={styles.sliderTrack} />
                                <input
                                    aria-label="Minimum price"
                                    className={styles.minimumPriceSlider}
                                    max={priceSliderDomain.max}
                                    min={priceSliderDomain.min}
                                    onChange={(event) => {
                                        const nextValue = Math.min(Number(event.currentTarget.value), maximumPriceValue);
                                        updateFilter('minPrice', String(nextValue));
                                    }}
                                    step={buyerPriceSlider.step}
                                    type="range"
                                    value={Math.min(minimumPriceValue, maximumPriceValue)}
                                />
                                <input
                                    aria-label="Maximum price"
                                    className={styles.maximumPriceSlider}
                                    max={priceSliderDomain.max}
                                    min={priceSliderDomain.min}
                                    onChange={(event) => {
                                        const nextValue = Math.max(Number(event.currentTarget.value), minimumPriceValue);
                                        updateFilter('maxPrice', String(nextValue));
                                    }}
                                    step={buyerPriceSlider.step}
                                    type="range"
                                    value={Math.max(minimumPriceValue, maximumPriceValue)}
                                />
                            </div>
                            <div aria-hidden="true" className={styles.sliderScale}>
                                <span>{formatPriceShort(priceSliderDomain.min)}</span>
                                <span>{formatPriceShort(priceSliderDomain.max)}</span>
                            </div>
                            <div className={styles.rangePair}>
                                <label>
                                    <span>Minimum price</span>
                                    <input
                                        inputMode="numeric"
                                        min={0}
                                        onBlur={syncPriceSliderToInputs}
                                        type="number"
                                        value={filters.minPrice}
                                        onChange={(event) => updateNumericRange(
                                            'minPrice',
                                            'maxPrice',
                                            'minimum',
                                            event.currentTarget.value,
                                        )}
                                    />
                                </label>
                                <label>
                                    <span>Maximum price</span>
                                    <input
                                        inputMode="numeric"
                                        min={0}
                                        onBlur={syncPriceSliderToInputs}
                                        type="number"
                                        value={filters.maxPrice}
                                        onChange={(event) => updateNumericRange(
                                            'minPrice',
                                            'maxPrice',
                                            'maximum',
                                            event.currentTarget.value,
                                        )}
                                    />
                                </label>
                            </div>
                        </div>
                    </section>
                </div>

                <div className={styles.filterSheetFooter}>
                    <span aria-atomic="true" aria-live="polite" className={styles.visuallyHidden}>
                        {formatNumber(resultCount)} {resultCount === 1 ? 'home matches' : 'homes match'}
                    </span>
                    <button
                        className={styles.filterSheetSecondaryButton}
                        onClick={clearFilters}
                        type="button"
                    >
                        Reset filters
                    </button>
                    <button onClick={onClose} type="button">
                        View {formatNumber(resultCount)} {resultCount === 1 ? 'home' : 'homes'}
                    </button>
                </div>
            </aside>
        </div>
    );
}
