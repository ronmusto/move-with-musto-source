'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CommercialSearchListing } from '@/lib/commercial-public-listings';
import {
    loadCommercialSearchDelivery,
    type CommercialSearchDelivery,
} from '@/lib/commercial-search-client';
import {
    commercialAvailabilityLabels,
    commercialCategoryLabels,
    defaultCommercialSearchFilters,
    filterCommercialListings,
    type CommercialSearchFilters,
} from '@/lib/commercial-search-filters';
import type { RealEstateContact } from '@/lib/real-estate-profile';
import buyerStyles from '../properties/PropertiesSearch.module.css';
import { CommercialListingCard } from './CommercialListingCard';
import { CommercialFilterSheet } from './CommercialFilterSheet';
import { formattedDataDate, formatNumber, marketAreaCommunities } from './commercial-presentation';
import styles from './CommercialPropertiesSearch.module.css';

const pageSizeOptions = [10, 50] as const;
const pricePresets = [
    { value: 'any', range: ['', ''] },
    { value: 'under-500', range: ['', '500000'] },
    { value: '500-1m', range: ['500000', '1000000'] },
    { value: '1-2m', range: ['1000000', '2000000'] },
    { value: '2m-plus', range: ['2000000', ''] },
] as const;

type SearchState =
    | { kind: 'loading' }
    | { kind: 'unavailable' }
    | { kind: 'ready'; delivery: CommercialSearchDelivery };

type CommercialSort = 'address' | 'building-desc' | 'acreage-desc';

export type CommercialPropertiesSearchProps = Readonly<{
    className?: string;
    contact: RealEstateContact;
    loadDelivery?: () => Promise<CommercialSearchDelivery>;
}>;

function pricePreset(filters: CommercialSearchFilters) {
    return pricePresets.find(({ range }) => (
        range[0] === filters.minPrice && range[1] === filters.maxPrice
    ))?.value ?? 'custom';
}

function sortCommercialListings(listings: readonly CommercialSearchListing[], sort: CommercialSort) {
    return [...listings].sort((left, right) => {
        if (sort === 'building-desc') {
            return (right.facts.buildingSqft ?? -1) - (left.facts.buildingSqft ?? -1) ||
                left.address.line.localeCompare(right.address.line);
        }
        if (sort === 'acreage-desc') {
            return (right.facts.acreage ?? -1) - (left.facts.acreage ?? -1) ||
                left.address.line.localeCompare(right.address.line);
        }
        return left.address.town.localeCompare(right.address.town) ||
            left.address.line.localeCompare(right.address.line);
    });
}

export function CommercialPropertiesSearch({
    className,
    contact,
    loadDelivery = loadCommercialSearchDelivery,
}: CommercialPropertiesSearchProps) {
    const [state, setState] = useState<SearchState>({ kind: 'loading' });
    const [filters, setFilters] = useState<CommercialSearchFilters>(defaultCommercialSearchFilters);
    const [queryDraft, setQueryDraft] = useState('');
    const [view, setView] = useState<'gallery' | 'list'>('list');
    const [sort, setSort] = useState<CommercialSort>('address');
    const [pageSize, setPageSize] = useState<(typeof pageSizeOptions)[number]>(10);
    const [page, setPage] = useState(1);
    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
    const [isFilterCapsuleCompact, setIsFilterCapsuleCompact] = useState(false);
    const [isFilterCapsuleExpanded, setIsFilterCapsuleExpanded] = useState(false);
    const [isMobileWorkspace, setIsMobileWorkspace] = useState(false);
    const filterCapsuleRef = useRef<HTMLDivElement>(null);
    const filterCapsuleSentinelRef = useRef<HTMLDivElement>(null);
    const filterCapsuleToggleRef = useRef<HTMLButtonElement>(null);
    const filterSheetReturnRef = useRef<HTMLButtonElement | null>(null);
    const resultsRef = useRef<HTMLElement>(null);

    useEffect(() => {
        let cancelled = false;
        loadDelivery()
            .then((delivery) => {
                if (!cancelled) setState({ kind: 'ready', delivery });
            })
            .catch(() => {
                if (!cancelled) setState({ kind: 'unavailable' });
            });
        return () => {
            cancelled = true;
        };
    }, [loadDelivery]);

    useEffect(() => {
        const media = window.matchMedia?.('(max-width: 896px)');
        if (!media) return undefined;

        const updateMobileWorkspace = () => {
            setIsMobileWorkspace(media.matches);
            if (media.matches) setIsFilterCapsuleExpanded(false);
        };
        updateMobileWorkspace();
        media.addEventListener?.('change', updateMobileWorkspace);
        return () => media.removeEventListener?.('change', updateMobileWorkspace);
    }, []);

    useEffect(() => {
        if (state.kind !== 'ready') return undefined;
        const sentinel = filterCapsuleSentinelRef.current;
        if (!sentinel || typeof window.IntersectionObserver === 'undefined') return undefined;

        const observer = new window.IntersectionObserver(([entry]) => {
            const sentinelTop = entry?.boundingClientRect?.top ?? 0;
            const nextCompact = Boolean(entry && !entry.isIntersecting && sentinelTop <= 96);
            setIsFilterCapsuleCompact(nextCompact);
            if (!nextCompact) setIsFilterCapsuleExpanded(false);
        }, {
            root: null,
            rootMargin: '-96px 0px 0px',
            threshold: 0,
        });

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [state.kind]);

    useEffect(() => {
        if (!isFilterCapsuleExpanded) return undefined;

        const closeOnOutsidePress = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && !filterCapsuleRef.current?.contains(target)) {
                setIsFilterCapsuleExpanded(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setIsFilterCapsuleExpanded(false);
            filterCapsuleToggleRef.current?.focus({ preventScroll: true });
        };

        document.addEventListener('pointerdown', closeOnOutsidePress);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsidePress);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [isFilterCapsuleExpanded]);

    const listings = useMemo(
        () => state.kind === 'ready' ? state.delivery.index.listings : [],
        [state],
    );
    const filteredListings = useMemo(
        () => filterCommercialListings(listings, filters),
        [filters, listings],
    );
    const sortedListings = useMemo(
        () => sortCommercialListings(filteredListings, sort),
        [filteredListings, sort],
    );
    const totalPages = Math.max(1, Math.ceil(sortedListings.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const firstResult = sortedListings.length === 0 ? 0 : ((safePage - 1) * pageSize) + 1;
    const lastResult = Math.min(safePage * pageSize, sortedListings.length);
    const visibleListings = sortedListings.slice(firstResult === 0 ? 0 : firstResult - 1, lastResult);

    function updateFilter<Key extends keyof CommercialSearchFilters>(
        key: Key,
        value: CommercialSearchFilters[Key],
    ) {
        setFilters((current) => ({ ...current, [key]: value }));
        setPage(1);
    }

    function updateCategory(value: CommercialSearchFilters['category']) {
        setFilters((current) => ({
            ...current,
            category: value,
            listingType: 'all',
            availability: value === 'all' || value === 'commercial-industrial'
                ? current.availability
                : 'all',
            realEstateIncluded: value === 'all' || value === 'business-opportunity'
                ? current.realEstateIncluded
                : 'all',
        }));
        setPage(1);
    }

    function updateAvailability(value: CommercialSearchFilters['availability']) {
        setFilters((current) => ({
            ...current,
            availability: value,
            minPrice: value === 'for-lease' ? '' : current.minPrice,
            maxPrice: value === 'for-lease' ? '' : current.maxPrice,
        }));
        setPage(1);
    }

    function applyPricePreset(value: string) {
        const range = pricePresets.find((preset) => preset.value === value)?.range;
        if (!range) return;
        setFilters((current) => ({ ...current, minPrice: range[0], maxPrice: range[1] }));
        setPage(1);
    }

    function submitLocationSearch(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        updateFilter('query', queryDraft.trim());
        setIsFilterCapsuleExpanded(false);
    }

    function clearFilters() {
        setFilters(defaultCommercialSearchFilters);
        setQueryDraft('');
        setIsFilterCapsuleExpanded(false);
        setPage(1);
    }

    function setTownRule(town: string, rule: 'included' | 'excluded') {
        setFilters((current) => ({
            ...current,
            includeTowns: rule === 'included'
                ? [...current.includeTowns.filter((candidate) => candidate !== town), town]
                : current.includeTowns.filter((candidate) => candidate !== town),
            excludeTowns: rule === 'excluded'
                ? [...current.excludeTowns.filter((candidate) => candidate !== town), town]
                : current.excludeTowns.filter((candidate) => candidate !== town),
        }));
        setPage(1);
    }

    function removeTownRule(town: string, rule: 'included' | 'excluded') {
        setFilters((current) => ({
            ...current,
            includeTowns: rule === 'included'
                ? current.includeTowns.filter((candidate) => candidate !== town)
                : current.includeTowns,
            excludeTowns: rule === 'excluded'
                ? current.excludeTowns.filter((candidate) => candidate !== town)
                : current.excludeTowns,
        }));
        setPage(1);
    }

    function clearTownRules() {
        setFilters((current) => ({ ...current, includeTowns: [], excludeTowns: [] }));
        setPage(1);
    }

    function openFilterSheet(returnFocus: HTMLButtonElement) {
        filterSheetReturnRef.current = returnFocus;
        setIsFilterCapsuleExpanded(false);
        setIsFilterSheetOpen(true);
    }

    function toggleFilterCapsule() {
        if (isMobileWorkspace) {
            if (filterCapsuleToggleRef.current) openFilterSheet(filterCapsuleToggleRef.current);
            return;
        }
        setIsFilterCapsuleExpanded((current) => !current);
    }

    function closeFilterSheet() {
        setIsFilterSheetOpen(false);
        requestAnimationFrame(() => filterSheetReturnRef.current?.focus());
    }

    function changePage(nextPage: number) {
        setPage(Math.max(1, Math.min(totalPages, nextPage)));
        requestAnimationFrame(() => {
            resultsRef.current?.focus({ preventScroll: true });
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    const activeFilterCount = Object.entries(filters).filter(([key, value]) => {
        if (key === 'includeTowns' || key === 'excludeTowns') return value.length > 0;
        if (key === 'category' || key === 'listingType' || key === 'availability' ||
            key === 'realEstateIncluded') return value !== 'all';
        return Boolean(value);
    }).length;

    const filterSummary = filters.query ||
        (filters.includeTowns.length > 0 ? `${filters.includeTowns.length} included ${
            filters.includeTowns.length === 1 ? 'community' : 'communities'}` : '') ||
        (filters.excludeTowns.length > 0 ? `${filters.excludeTowns.length} excluded ${
            filters.excludeTowns.length === 1 ? 'community' : 'communities'}` : '') ||
        (filters.category !== 'all' ? commercialCategoryLabels[filters.category] : '') ||
        'Any location · Any commercial type';

    if (state.kind === 'loading') {
        return (
            <section className={[buyerStyles.searchSection, className].filter(Boolean).join(' ')}>
                <div className={buyerStyles.toolbar}>
                    <div>
                        <p className={buyerStyles.eyebrow}>Commercial property search</p>
                        <h2>Commercial listings</h2>
                    </div>
                </div>
                <div className={`${buyerStyles.workspace} ${styles.workspaceSingle}`}>
                    <div className={buyerStyles.searchMainColumn}>
                        <div className={buyerStyles.loadingPanel}>
                            <p className={buyerStyles.loadingState} role="status">
                                <span aria-hidden="true" className={buyerStyles.loadingSpinner} />
                                Loading commercial listings
                            </p>
                        </div>
                    </div>
                </div>
            </section>
        );
    }

    if (state.kind === 'unavailable') {
        return (
            <section className={[buyerStyles.searchSection, buyerStyles.searchMaintenance, className]
                .filter(Boolean).join(' ')} aria-labelledby="commercial-unavailable-title">
                <div className={buyerStyles.maintenancePanel}>
                    <p className={buyerStyles.eyebrow}>Commercial property search</p>
                    <h2 id="commercial-unavailable-title">Commercial listings are temporarily unavailable.</h2>
                    <p>
                        The search remains closed when its reviewed MLS data is missing or out of date.
                        Contact Mai Ly for help with a current commercial need.
                    </p>
                    <div className={styles.unavailableActions}>
                        <a href={`mailto:${contact.email}?subject=Commercial%20property%20search`}>
                            Ask about commercial property
                        </a>
                    </div>
                </div>
            </section>
        );
    }

    const { manifest } = state.delivery;
    const sourceName = manifest.source.replace(/[.\s]+$/u, '');
    const selectedPricePreset = pricePreset(filters);
    const serviceAreaCommunities = marketAreaCommunities(manifest.compliance.marketArea);
    const useCompactFilterCapsule = isMobileWorkspace || isFilterCapsuleCompact;

    return (
        <section
            aria-labelledby="commercial-search-title"
            className={[buyerStyles.searchSection, 'property-search-shell', className]
                .filter(Boolean).join(' ')}
        >
            <div className={buyerStyles.toolbar}>
                <div>
                    <p className={buyerStyles.eyebrow}>Commercial property search</p>
                    <h2 id="commercial-search-title">Commercial listings</h2>
                    <p>
                        Search commercial, land, and business-opportunity listings in Mai Ly&apos;s
                        service area using the same workspace as the home search.
                    </p>
                </div>
            </div>

            <div className={buyerStyles.workspace}>
                <div className={`${buyerStyles.searchMainColumn} property-search-results-pane`}>
                    <div
                        aria-hidden="true"
                        className={buyerStyles.filterCapsuleSentinel}
                        data-testid="commercial-filter-capsule-sentinel"
                        ref={filterCapsuleSentinelRef}
                    />
                    <div
                        className={[
                            buyerStyles.filterCapsuleShell,
                            styles.filterShell,
                            useCompactFilterCapsule ? buyerStyles.filterCapsuleCompact : '',
                            isFilterCapsuleExpanded ? buyerStyles.filterCapsuleExpanded : '',
                        ].filter(Boolean).join(' ')}
                        data-compact={useCompactFilterCapsule}
                        data-expanded={isFilterCapsuleExpanded}
                        ref={filterCapsuleRef}
                    >
                        <div
                            className={`${buyerStyles.filterCapsuleSummary} ${styles.mobileFilterSummary}`}
                            hidden={!useCompactFilterCapsule}
                        >
                            <button
                                aria-controls={isMobileWorkspace
                                    ? 'commercial-more-filters'
                                    : 'commercial-search-quick-filters'}
                                aria-expanded={isMobileWorkspace ? isFilterSheetOpen : isFilterCapsuleExpanded}
                                aria-label={`Edit commercial search filters: ${filterSummary}`}
                                className={buyerStyles.filterCapsuleToggle}
                                onClick={toggleFilterCapsule}
                                ref={filterCapsuleToggleRef}
                                type="button"
                            >
                                <span aria-hidden="true" className={buyerStyles.filterCapsuleIcon}>
                                    <svg viewBox="0 0 24 24">
                                        <circle cx="10.5" cy="10.5" r="5.75" />
                                        <path d="m15 15 4.25 4.25" />
                                    </svg>
                                </span>
                                <span className={buyerStyles.filterCapsuleCopy}>
                                    <span>Search commercial</span>
                                    <strong>{filterSummary}</strong>
                                </span>
                                <span aria-hidden="true" className={buyerStyles.filterCapsuleChevron}>
                                    {isFilterCapsuleExpanded ? '−' : '+'}
                                </span>
                            </button>
                            <span className={buyerStyles.filterCapsuleResult}>
                                <strong>{formatNumber(filteredListings.length)}</strong>
                                <span>listings</span>
                            </span>
                            <button
                                className={buyerStyles.filterCapsuleFiltersButton}
                                onClick={(event) => openFilterSheet(event.currentTarget)}
                                type="button"
                            >
                                Filters
                                {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
                            </button>
                        </div>

                        <div
                            aria-label="Commercial property search filters"
                            className={`${buyerStyles.filters} ${styles.quickFilters}`}
                            hidden={isMobileWorkspace || (isFilterCapsuleCompact && !isFilterCapsuleExpanded)}
                            id="commercial-search-quick-filters"
                            role="search"
                        >
                            <div className={buyerStyles.filterHeader}>
                                <div>
                                    <h3>Refine your search</h3>
                                    <p>Start with a location, category, or offering.</p>
                                </div>
                                {activeFilterCount > 0 ? (
                                    <button
                                        className={buyerStyles.resetFiltersButton}
                                        onClick={clearFilters}
                                        type="button"
                                    >
                                        Reset all
                                    </button>
                                ) : null}
                            </div>

                            <form className={buyerStyles.locationFilter} onSubmit={submitLocationSearch}>
                                <label>
                                    <span>Location</span>
                                    <div className={buyerStyles.locationSearchControl}>
                                        <input
                                            aria-label="Commercial location search"
                                            onChange={(event) => setQueryDraft(event.currentTarget.value)}
                                            placeholder="Town, ZIP, address, or MLS #"
                                            type="search"
                                            value={queryDraft}
                                        />
                                        <button
                                            aria-label="Search commercial location"
                                            className={buyerStyles.findHomesButton}
                                            type="submit"
                                        >
                                            Search
                                        </button>
                                    </div>
                                </label>
                            </form>

                            <label className="property-search-secondary-quick-filter">
                                <span>Category</span>
                                <select
                                    aria-label="Commercial category"
                                    onChange={(event) => updateCategory(
                                        event.currentTarget.value as CommercialSearchFilters['category'],
                                    )}
                                    value={filters.category}
                                >
                                    <option value="all">Any category</option>
                                    {Object.entries(commercialCategoryLabels).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Offering</span>
                                <select
                                    aria-label="Commercial offering"
                                    onChange={(event) => updateAvailability(
                                        event.currentTarget.value as CommercialSearchFilters['availability'],
                                    )}
                                    value={filters.availability}
                                >
                                    <option value="all">Any offering</option>
                                    {Object.entries(commercialAvailabilityLabels).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Sale price</span>
                                <select
                                    aria-label="Sale price shortcut"
                                    disabled={filters.availability === 'for-lease'}
                                    onChange={(event) => applyPricePreset(event.currentTarget.value)}
                                    value={selectedPricePreset}
                                >
                                    {selectedPricePreset === 'custom' ? <option value="custom">Custom range</option> : null}
                                    <option value="any">Any sale price</option>
                                    <option value="under-500">Under $500K</option>
                                    <option value="500-1m">$500K–$1M</option>
                                    <option value="1-2m">$1M–$2M</option>
                                    <option value="2m-plus">$2M+</option>
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Minimum building size</span>
                                <select
                                    aria-label="Minimum building square feet"
                                    onChange={(event) => updateFilter('minSquareFeet', event.currentTarget.value)}
                                    value={filters.minSquareFeet}
                                >
                                    <option value="">Any size</option>
                                    <option value="1000">1,000+ sq ft</option>
                                    <option value="2500">2,500+ sq ft</option>
                                    <option value="5000">5,000+ sq ft</option>
                                    <option value="10000">10,000+ sq ft</option>
                                    <option value="25000">25,000+ sq ft</option>
                                </select>
                            </label>

                            <div className={buyerStyles.moreFiltersField}>
                                <span>More options</span>
                                <button
                                    aria-label={activeFilterCount > 0
                                        ? `More commercial filters, ${activeFilterCount} active`
                                        : 'More commercial filters'}
                                    aria-expanded={isFilterSheetOpen}
                                    aria-haspopup="dialog"
                                    className={buyerStyles.moreFiltersButton}
                                    onClick={(event) => openFilterSheet(event.currentTarget)}
                                    type="button"
                                >
                                    Filters
                                    {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
                                </button>
                            </div>
                        </div>
                    </div>

                    {isFilterSheetOpen ? (
                        <CommercialFilterSheet
                            filters={filters}
                            facets={manifest.facets}
                            resultCount={filteredListings.length}
                            updateFilter={updateFilter}
                            setTownRule={setTownRule}
                            removeTownRule={removeTownRule}
                            onClearTownRules={clearTownRules}
                            onClearFilters={clearFilters}
                            closeFilterSheet={closeFilterSheet}
                        />
                    ) : null}

                    <section
                        aria-label="Commercial property search results"
                        className={buyerStyles.resultsArea}
                        ref={resultsRef}
                        tabIndex={-1}
                    >
                        <div className={buyerStyles.resultMeta}>
                            <div className={buyerStyles.resultSummary} aria-live="polite">
                                <strong>{formatNumber(filteredListings.length)}</strong>
                                <span>{filteredListings.length === 1 ? 'listing' : 'listings'}</span>
                                <span className={buyerStyles.pageRange}>
                                    {filteredListings.length === 0 ? 'No results' : `Showing ${firstResult}–${lastResult}`}
                                </span>
                            </div>

                            <div className={buyerStyles.resultControls}>
                                <div className={buyerStyles.sortControls}>
                                    <label>
                                        <span>Sort</span>
                                        <select
                                            aria-label="Sort commercial results"
                                            onChange={(event) => {
                                                setSort(event.currentTarget.value as CommercialSort);
                                                setPage(1);
                                            }}
                                            value={sort}
                                        >
                                            <option value="address">Town and address</option>
                                            <option value="building-desc">Largest building</option>
                                            <option value="acreage-desc">Most acreage</option>
                                        </select>
                                    </label>
                                </div>

                                <label className={`${buyerStyles.pageSizeControl} ${styles.pageSizeControl}`}>
                                    <span>Show</span>
                                    <select
                                        aria-label="Results per page"
                                        value={pageSize}
                                        onChange={(event) => {
                                            setPageSize(
                                                Number(event.currentTarget.value) as (typeof pageSizeOptions)[number],
                                            );
                                            setPage(1);
                                        }}
                                    >
                                        {pageSizeOptions.map((size) => (
                                            <option key={size} value={size}>
                                                {size}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <div aria-label="View mode" className={buyerStyles.modeSwitch} role="group">
                                    <button
                                        aria-pressed={view === 'list'}
                                        className={view === 'list' ? buyerStyles.activeMode : undefined}
                                        onClick={() => setView('list')}
                                        type="button"
                                    >
                                        List
                                    </button>
                                    <button
                                        aria-pressed={view === 'gallery'}
                                        className={view === 'gallery' ? buyerStyles.activeMode : undefined}
                                        onClick={() => setView('gallery')}
                                        type="button"
                                    >
                                        Grid
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className={buyerStyles.resultsScroller}>
                            {visibleListings.length > 0 ? (
                                <div className={view === 'gallery' ? buyerStyles.galleryList : buyerStyles.resultsList}>
                                    {visibleListings.map((listing) => (
                                        <CommercialListingCard contact={contact} key={listing.listingNumber} listing={listing} />
                                    ))}
                                </div>
                            ) : (
                                <div className={buyerStyles.emptyResults}>
                                    <h3>No listings match these filters.</h3>
                                    <p>Reset the filters or contact Mai Ly to discuss a more specific search.</p>
                                    <div className={buyerStyles.emptyResultsActions}>
                                        <button onClick={clearFilters} type="button">Clear filters</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {totalPages > 1 ? (
                            <nav className={styles.bottomPagination} aria-label="Commercial listing pages">
                                <div className={buyerStyles.paginationControls}>
                                    <button
                                        disabled={safePage === 1}
                                        onClick={() => changePage(safePage - 1)}
                                        type="button"
                                    >
                                        Previous
                                    </button>
                                    <span>Page {safePage} of {totalPages}</span>
                                    <button
                                        disabled={safePage === totalPages}
                                        onClick={() => changePage(safePage + 1)}
                                        type="button"
                                    >
                                        Next
                                    </button>
                                </div>
                            </nav>
                        ) : null}
                    </section>
                </div>

                <aside
                    aria-label="Commercial search summary"
                    className={`${buyerStyles.searchRail} ${styles.commercialRail}`}
                >
                    <div className={`${buyerStyles.mapPreviewCard} ${styles.commercialRailCard}`}>
                        <span className={buyerStyles.mapPreviewLabel}>Commercial search</span>
                        <div className={styles.commercialRailBody}>
                            <strong>{formatNumber(filteredListings.length)} matching listings</strong>
                            <p>
                                Commercial/industrial, land, and business opportunities across
                                Mai Ly&apos;s approved service area.
                            </p>
                            <dl>
                                <div>
                                    <dt>Service area</dt>
                                    <dd>{formatNumber(serviceAreaCommunities.length)} communities</dd>
                                </div>
                                <div>
                                    <dt>Data updated</dt>
                                    <dd>{formattedDataDate(manifest.sourceUpdatedAt)}</dd>
                                </div>
                            </dl>
                        </div>
                    </div>
                    <a
                        className={styles.commercialContactButton}
                        href={`mailto:${contact.email}?subject=Commercial%20property%20search`}
                    >
                        Contact Mai Ly
                    </a>
                </aside>
            </div>

            <div className={buyerStyles.sourceBar} aria-label="Commercial listing source details">
                <span>Source: {sourceName}</span>
                <span>Updated {formattedDataDate(manifest.sourceUpdatedAt)}</span>
                <span>{formatNumber(manifest.totalListingCount)} active listings</span>
            </div>

            <aside
                className={`${buyerStyles.compliancePanel} ${styles.commercialCompliancePanel}`}
                aria-label="MLS listing information"
            >
                <div
                    className={`${buyerStyles.screenDisclosure} ${styles.commercialScreenDisclosure}`}
                >
                    <div>
                        <p>{manifest.disclaimer}</p>
                    </div>
                    <dl>
                        <div>
                            <dt>Participant</dt>
                            <dd>{manifest.compliance.participantFirmName}</dd>
                        </div>
                        <div>
                            <dt>Office</dt>
                            <dd>{manifest.compliance.officeAddress}</dd>
                        </div>
                        <div>
                            <dt>Phone</dt>
                            <dd>{manifest.compliance.phone}</dd>
                        </div>
                        <div>
                            <dt>Market area</dt>
                            <dd>
                                <details className={styles.serviceAreaDisclosure}>
                                    <summary>
                                        {formatNumber(serviceAreaCommunities.length)} service-area communities
                                    </summary>
                                    <div
                                        aria-label="Commercial service-area communities"
                                        className={styles.serviceAreaList}
                                    >
                                        <ul>
                                            {serviceAreaCommunities.map((community) => (
                                                <li key={community}>{community}</li>
                                            ))}
                                        </ul>
                                    </div>
                                </details>
                            </dd>
                        </div>
                    </dl>
                </div>
            </aside>
        </section>
    );
}
