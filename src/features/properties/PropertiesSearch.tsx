'use client';

import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import { type SearchConsultLeadSearchContext } from '@/lib/lead-capture';
import { townMatchesPreferredServiceArea } from '@/lib/market-regions';
import { parseMlsOpenHouseTimestamp, withCurrentOpenHouseCount } from '@/lib/mls-open-house-time';
import {
    defaultMlsBundleUrl,
    defaultMlsDetailBaseUrl,
    defaultMlsSearchManifestUrl,
    type MlsPublicBundle,
    type MlsSearchIndexBundle,
    type MlsSearchListing,
} from '@/lib/mls-public-listings';
import type { RealEstateContact, RealEstateCta, RealEstateInquiry } from '@/lib/real-estate-profile';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import styles from './PropertiesSearch.module.css';
import {
    buildPropertySearchUrl,
    readPropertySearchUrl,
    type PropertySearchMapCamera,
    type PropertySearchMapGeometry,
} from './property-search-url-state';
import {
    allLabel,
    allRegionsLabel,
    defaultFilters as defaultPropertyFilters,
    defaultRegion,
    defaultSort,
    filterListings,
    filterOptionsFor,
    normalizeServiceAreaFilters,
    paginateListings,
    propertyAreaPresetForTowns,
    sortListings,
    uniqueSorted,
    type PropertyFilterState,
    type PropertySortDirection,
    type PropertySortKey,
    type PropertySortState,
    type PropertyViewMode,
} from './property-search-utils';
import type { MapAreaSelection, MapSearchContext } from './PropertyMapView';
import { AdvancedFilterSheet } from './search/AdvancedFilterSheet';
import { ComparisonDrawer } from './search/ComparisonDrawer';
import { CompliancePanel } from './search/CompliancePanel';
import { LeadDrawer, leadFilterSnapshot } from './search/LeadDrawer';
import { ListingCard } from './search/ListingCard';
import { PhotoGalleryDialog } from './search/PhotoGalleryDialog';
import { priceBoundsFor, priceSliderDomainForInputs } from './search/price-domain';
import { PropertyLoadingMark } from './search/PropertyLoadingMark';
import {
    formatNumber,
    numericRangeSummary,
    priceSummaryLabel,
    searchAreaLabelFor,
} from './search/search-formatting';
import {
    PropertyListingHistoryMarker,
    PropertySavedOnlyHistoryMarker,
    historyStateRecord,
    mapGeometryForSelection,
    propertyListingHistoryKey,
    propertyListingHistoryMarker,
    propertySavedOnlyHistoryKey,
    propertySavedOnlyHistoryMarker,
    searchCriteriaSignature,
} from './search/search-history';
import {
    combinedSortOptions,
    defaultFilters,
    pricePresets,
    quickBathOptions,
    quickBedOptions,
    resultPageSizes,
    savedHomesEmailLimit,
    splitResultsBatchSize,
} from './search/search-options';
import {
    currentSortStorageVersion,
    readSavedFilterOverrides,
    readSavedListingIds,
    readSavedSortState,
    storageKeys,
    writeJsonStorage,
    writeStorage,
} from './search/search-persistence';
import {
    ActiveFilterChip,
    ComparisonView,
    LeadAction,
    LeadDrawerState,
    PhotoGalleryState,
    ResultPageSize,
    ResultsViewMode,
    TownRuleState,
} from './search/search-types';
import { MobileSearchCommandBar, SavedHomesDock } from './search/SearchDocks';
import { useListingDetail } from './search/useListingDetail';
import { usePriceSlider } from './search/usePriceSlider';
import { usePropertySearchDelivery } from './search/usePropertySearchDelivery';

const PropertyMapView = dynamic(
    () => import('./PropertyMapView').then((module) => module.PropertyMapView),
    {
        ssr: false,
        loading: () => (
            <div className={styles.loadingPanel}>
                <PropertyLoadingMark label="Loading map" />
            </div>
        ),
    },
);

export type PropertiesSearchProps = Readonly<{
    contact: RealEstateContact;
    inquiry: RealEstateInquiry;
    appointmentCta?: RealEstateCta;
    privacyVersion: string;
    termsVersion: string;
    bundleUrl?: string;
    currentPointerUrl?: string | null;
    manifestUrl?: string;
    detailBaseUrl?: string;
    className?: string;
    initialBundle?: MlsPublicBundle | null;
    initialMapArea?: MapAreaSelection | null;
    initialSearchBundle?: MlsSearchIndexBundle | null;
    onMapAreaChange?: (selection: MapAreaSelection | null) => void;
    sourcePage?: string;
}>;

export function PropertiesSearch({
    contact,
    inquiry,
    appointmentCta,
    privacyVersion,
    termsVersion,
    bundleUrl = defaultMlsBundleUrl,
    currentPointerUrl,
    manifestUrl = defaultMlsSearchManifestUrl,
    detailBaseUrl = defaultMlsDetailBaseUrl,
    className,
    initialBundle = null,
    initialMapArea = null,
    initialSearchBundle = null,
    onMapAreaChange,
    sourcePage = '/properties/',
}: PropertiesSearchProps) {
    const {
        bundle,
        bundleState,
        searchManifest,
        activeDetailBaseUrl,
        initialDetails,
        coordinateIndexUrl,
        retryBundle,
    } = usePropertySearchDelivery({
        bundleUrl,
        currentPointerUrl,
        manifestUrl,
        detailBaseUrl,
        initialBundle,
        initialSearchBundle,
    });
    const [filters, setFilters] = useState<PropertyFilterState>(() => defaultFilters);
    const [queryDraft, setQueryDraft] = useState('');
    const [sort, setSort] = useState<PropertySortState>(defaultSort);
    const [viewMode, setViewMode] = useState<ResultsViewMode>('list');
    const [isMapDrawerOpen, setIsMapDrawerOpen] = useState(false);
    const [isDesktopWorkspace, setIsDesktopWorkspace] = useState(false);
    const [isMobileWorkspace, setIsMobileWorkspace] = useState(false);
    const [hasMountedMap, setHasMountedMap] = useState(Boolean(initialMapArea));
    const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(() => new Set());
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
    const [hasRestoredStorage, setHasRestoredStorage] = useState(false);
    const [priceRestoreVersion, setPriceRestoreVersion] = useState(0);
    const [gallery, setGallery] = useState<PhotoGalleryState>(null);
    const { detail: galleryDetail, detailState, retryDetail } = useListingDetail({
        listingNumber: gallery?.listing.listingNumber ?? null,
        generatedAt: bundle?.generatedAt ?? '',
        detailBaseUrl: activeDetailBaseUrl,
        initialDetails,
    });
    const [activeMapListingNumber, setActiveMapListingNumber] = useState<string | null>(null);
    const [mapCamera, setMapCamera] = useState<PropertySearchMapCamera | null>(null);
    const [mapArea, setMapArea] = useState<MapAreaSelection | null>(initialMapArea);
    const [pendingMapRestore, setPendingMapRestore] = useState<PropertySearchMapGeometry | null>(null);
    const [pendingListingNumber, setPendingListingNumber] = useState<string | null>(null);
    const [urlRestoreMessage, setUrlRestoreMessage] = useState('');
    const [comparisonView, setComparisonView] = useState<ComparisonView>('minimized');
    const [savedCelebrationKey, setSavedCelebrationKey] = useState(0);
    const [comparisonCelebrationKey, setComparisonCelebrationKey] = useState(0);
    const [comparisonLimitMessage, setComparisonLimitMessage] = useState('');
    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
    const [isFilterCapsuleCompact, setIsFilterCapsuleCompact] = useState(false);
    const [isFilterCapsuleExpanded, setIsFilterCapsuleExpanded] = useState(false);
    const [leadDrawer, setLeadDrawer] = useState<LeadDrawerState>(null);
    const [pageSize, setPageSize] = useState<ResultPageSize>(10);
    const [currentPage, setCurrentPage] = useState(1);
    const [splitVisibleCount, setSplitVisibleCount] = useState(splitResultsBatchSize);
    const [openHouseClock, setOpenHouseClock] = useState(() => Date.now());
    const resultsAreaRef = useRef<HTMLDivElement>(null);
    const splitLoadMoreRef = useRef<HTMLDivElement>(null);
    const desktopDetailRef = useRef<HTMLDivElement>(null);
    const detailReturnFocusRef = useRef<HTMLElement | null>(null);
    const savedButtonRefs = useRef(new Map<string, HTMLButtonElement>());
    const emptySavedReturnButtonRef = useRef<HTMLButtonElement>(null);
    const wasDesktopMapDetailRef = useRef(false);
    const filterCapsuleRef = useRef<HTMLDivElement>(null);
    const filterCapsuleSentinelRef = useRef<HTMLDivElement>(null);
    const filterCapsuleToggleRef = useRef<HTMLButtonElement>(null);
    const mapDrawerRef = useRef<HTMLElement>(null);
    const mapPreviewButtonRef = useRef<HTMLButtonElement>(null);
    const mobileMapButtonRef = useRef<HTMLButtonElement>(null);
    const mobileListScrollYRef = useRef(0);
    const previousResultCountRef = useRef<number | null>(null);
    const restoredCriteriaSignatureRef = useRef<string | null>(null);
    const initialMapAreaRef = useRef(initialMapArea);
    const onMapAreaChangeRef = useRef(onMapAreaChange);
    const listingHistoryEntryIdRef = useRef(0);
    const leadDrawerInstanceIdRef = useRef(0);
    const pendingCloseMapAfterPopRef = useRef(false);
    const pendingFocusResultsAfterPopRef = useRef(false);
    const pendingListingHistoryPopRef = useRef(false);
    const pendingLeadAfterPopRef = useRef<NonNullable<LeadDrawerState> | null>(null);
    const detailOpenedFromComparisonRef = useRef(false);
    onMapAreaChangeRef.current = onMapAreaChange;

    useAccessibleDialog({
        active: isMapDrawerOpen && !isDesktopWorkspace,
        dialogRef: mapDrawerRef,
        onClose: closeMapDrawer,
    });

    useEffect(() => {
        const media = window.matchMedia?.('(min-width: 1024px)');
        if (!media) {
            return undefined;
        }

        const updateDesktopWorkspace = () => {
            setIsDesktopWorkspace(media.matches);
            if (!media.matches) {
                setIsFilterCapsuleExpanded(false);
            }
        };
        updateDesktopWorkspace();
        media.addEventListener?.('change', updateDesktopWorkspace);
        return () => media.removeEventListener?.('change', updateDesktopWorkspace);
    }, []);

    useEffect(() => {
        const media = window.matchMedia?.('(max-width: 640px)');
        if (!media) {
            return undefined;
        }

        const updateMobileWorkspace = () => setIsMobileWorkspace(media.matches);
        updateMobileWorkspace();
        media.addEventListener?.('change', updateMobileWorkspace);
        return () => media.removeEventListener?.('change', updateMobileWorkspace);
    }, []);

    useEffect(() => {
        if (isMobileWorkspace && viewMode !== 'list') {
            setViewMode('list');
        }
    }, [isMobileWorkspace, viewMode]);

    useEffect(() => {
        const sentinel = filterCapsuleSentinelRef.current;
        if (!sentinel || typeof window.IntersectionObserver === 'undefined') {
            return undefined;
        }

        const observer = new window.IntersectionObserver(([entry]) => {
            const sentinelTop = entry?.boundingClientRect?.top ?? 0;
            const nextCompact = Boolean(entry && !entry.isIntersecting && sentinelTop <= 96);

            setIsFilterCapsuleCompact(nextCompact);
            if (!nextCompact) {
                setIsFilterCapsuleExpanded(false);
            }
        }, {
            root: null,
            rootMargin: '-96px 0px 0px',
            threshold: 0,
        });

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [bundleState]);

    useEffect(() => {
        if (!isFilterCapsuleExpanded) {
            return undefined;
        }

        const closeOnOutsidePress = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && !filterCapsuleRef.current?.contains(target)) {
                setIsFilterCapsuleExpanded(false);
            }
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }

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

    useEffect(() => {
        const now = Date.now();
        const nextEnd = (bundle?.listings ?? [])
            .flatMap((listing) => listing.openHouseEndTimes ?? [])
            .map(parseMlsOpenHouseTimestamp)
            .filter((timestamp) => Number.isFinite(timestamp) && timestamp > now)
            .reduce((earliest, timestamp) => Math.min(earliest, timestamp), Number.POSITIVE_INFINITY);
        const delay = Number.isFinite(nextEnd)
            ? Math.min(60_000, Math.max(0, nextEnd - now + 25))
            : 60_000;
        const timeoutId = window.setTimeout(() => setOpenHouseClock(Date.now()), delay);
        return () => window.clearTimeout(timeoutId);
    }, [bundle, openHouseClock]);

    const closeDesktopMap = useEffectEvent(() => closeMapDrawer());

    useEffect(() => {
        if (!isDesktopWorkspace || !isMapDrawerOpen) {
            return undefined;
        }

        const handleDesktopMapEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            event.preventDefault();
            closeDesktopMap();
        };

        // Drawing/editing owns Escape in a capture listener and stops it before
        // this bubble listener. At idle, Escape closes the desktop map workspace.
        document.addEventListener('keydown', handleDesktopMapEscape);
        return () => document.removeEventListener('keydown', handleDesktopMapEscape);
    }, [isDesktopWorkspace, isMapDrawerOpen]);

    useEffect(() => {
        function restoreFromLocation(useSavedState: boolean, isInitialRestore: boolean) {
            const urlState = readPropertySearchUrl(new URL(window.location.href));
            const nextFilters = normalizeServiceAreaFilters({
                ...defaultFilters,
                ...(useSavedState && !urlState.hasSearchState ? readSavedFilterOverrides() : {}),
                ...urlState.filters,
            });
            const nextSort = urlState.hasSearchState
                ? urlState.sort ?? defaultSort
                : useSavedState
                    ? readSavedSortState()
                    : defaultSort;
            const nextPageSize = urlState.pageSize ?? 10;
            const restoredGeometry = urlState.mapGeometry ?? null;

            restoredCriteriaSignatureRef.current = searchCriteriaSignature(nextFilters, nextSort, nextPageSize);
            setFilters(nextFilters);
            setPriceRestoreVersion((current) => current + 1);
            setQueryDraft(nextFilters.query);
            setSort(nextSort);
            setViewMode(urlState.view ?? 'list');
            setPageSize(nextPageSize);
            setCurrentPage(urlState.page ?? 1);
            setIsMapDrawerOpen(Boolean(urlState.isMapOpen || restoredGeometry));
            setHasMountedMap((current) => current || Boolean(urlState.isMapOpen || restoredGeometry));
            setGallery(null);
            setActiveMapListingNumber(urlState.mapListingNumber ?? null);
            setMapCamera(urlState.mapCamera ?? null);
            setLeadDrawer(null);
            setIsFilterSheetOpen(false);
            setPendingListingNumber(urlState.listingNumber ?? null);
            const restoredMapArea = restoredGeometry
                ? null
                : isInitialRestore
                    ? initialMapAreaRef.current
                    : null;
            setMapArea(restoredMapArea);
            setPendingMapRestore(restoredGeometry);
            if (!isInitialRestore) {
                onMapAreaChangeRef.current?.(null);
            }
            setUrlRestoreMessage('');
        }

        restoreFromLocation(true, true);
        setSavedIds(new Set(readSavedListingIds(storageKeys.saved)));
        setSelectedIds(new Set(readSavedListingIds(storageKeys.selected).slice(0, 4)));
        setHasRestoredStorage(true);

        function handlePopState() {
            restoreFromLocation(false, false);
            pendingListingHistoryPopRef.current = false;
            if (pendingCloseMapAfterPopRef.current) {
                pendingCloseMapAfterPopRef.current = false;
                setGallery(null);
                setPendingListingNumber(null);
                setIsMapDrawerOpen(false);
            }
            if (pendingFocusResultsAfterPopRef.current) {
                pendingFocusResultsAfterPopRef.current = false;
                focusResults();
            }
            const pendingLead = pendingLeadAfterPopRef.current;
            if (pendingLead) {
                pendingLeadAfterPopRef.current = null;
                setLeadDrawer(pendingLead);
            }
        }

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        if (hasRestoredStorage) {
            writeJsonStorage(storageKeys.saved, Array.from(savedIds));
        }
    }, [hasRestoredStorage, savedIds]);

    useEffect(() => {
        if (hasRestoredStorage) {
            writeJsonStorage(storageKeys.selected, Array.from(selectedIds));
        }
    }, [hasRestoredStorage, selectedIds]);

    useEffect(() => {
        if (hasRestoredStorage) {
            writeJsonStorage(storageKeys.filters, filters);
        }
    }, [filters, hasRestoredStorage]);

    useEffect(() => {
        if (hasRestoredStorage) {
            writeJsonStorage(storageKeys.sort, sort);
            writeStorage(storageKeys.sortVersion, currentSortStorageVersion);
        }
    }, [hasRestoredStorage, sort]);

    const sourceListings = bundle?.listings;
    const listings = useMemo(
        () => (sourceListings ?? []).map((listing) => withCurrentOpenHouseCount(listing, openHouseClock)),
        [openHouseClock, sourceListings],
    );
    const listingByNumber = useMemo(
        () => new Map(listings.map((listing) => [listing.listingNumber, listing])),
        [listings],
    );
    useEffect(() => {
        if (!hasRestoredStorage || bundleState !== 'ready') {
            return;
        }

        const retainLoadedServiceIds = (current: ReadonlySet<string>) => {
            const next = new Set([...current].filter((listingNumber) => listingByNumber.has(listingNumber)));
            return next.size === current.size ? current : next;
        };
        setSavedIds(retainLoadedServiceIds);
        setSelectedIds(retainLoadedServiceIds);
        setActiveMapListingNumber((current) => (
            current && !listingByNumber.has(current) ? null : current
        ));
    }, [bundleState, hasRestoredStorage, listingByNumber]);
    const selectedListings = useMemo(
        () => Array.from(selectedIds)
            .map((listingNumber) => listingByNumber.get(listingNumber))
            .filter((listing): listing is MlsSearchListing => Boolean(listing)),
        [listingByNumber, selectedIds],
    );
    const savedListings = useMemo(
        () => Array.from(savedIds)
            .map((listingNumber) => listingByNumber.get(listingNumber))
            .filter((listing): listing is MlsSearchListing => Boolean(listing)),
        [listingByNumber, savedIds],
    );
    const filterOptions = useMemo(
        () => filterOptionsFor(listings),
        [listings],
    );
    const priceBounds = useMemo(() => priceBoundsFor(listings), [listings]);
    const priceSlider = usePriceSlider({ filters, priceBounds, hasRestoredStorage, priceRestoreVersion });
    const { setPriceSliderDomain } = priceSlider;
    const selectedPricePresetLabel = pricePresets.find((preset) =>
        preset.minPrice === filters.minPrice && preset.maxPrice === filters.maxPrice,
    )?.label ?? 'Custom';
    const sourceUpdatedAt = bundle
        ? new Date(bundle.generatedAt).toLocaleString()
        : null;
    const activeAreaPreset = propertyAreaPresetForTowns(filters.includeTowns);
    const advancedFilterChips: ActiveFilterChip[] = [];

    if (filters.query.trim()) {
        advancedFilterChips.push({
            key: 'query',
            label: `Search: ${filters.query.trim()}`,
            onRemove: clearLocationSearch,
        });
    }

    if (filters.propertyType !== allLabel) {
        advancedFilterChips.push({
            key: 'property-type',
            label: filters.propertyType,
            onRemove: () => updateFilter('propertyType', allLabel),
        });
    }

    if (filters.minPrice || filters.maxPrice) {
        advancedFilterChips.push({
            key: 'price',
            label: selectedPricePresetLabel === 'Custom'
                ? `Price: ${priceSummaryLabel(filters.minPrice, 'Any min')} – ${priceSummaryLabel(filters.maxPrice, 'Any max')}`
                : `Price: ${selectedPricePresetLabel}`,
            onRemove: () => applyPricePreset(pricePresets[0]),
        });
    }

    if (filters.minBeds || filters.maxBeds) {
        advancedFilterChips.push({
            key: 'beds',
            label: numericRangeSummary('Beds', filters.minBeds, filters.maxBeds),
            onRemove: () => setFilters((current) => ({ ...current, minBeds: '', maxBeds: '' })),
        });
    }

    if (filters.minBaths || filters.maxBaths) {
        advancedFilterChips.push({
            key: 'baths',
            label: numericRangeSummary('Baths', filters.minBaths, filters.maxBaths),
            onRemove: () => setFilters((current) => ({ ...current, minBaths: '', maxBaths: '' })),
        });
    }

    if (activeAreaPreset) {
        advancedFilterChips.push({
            key: `area-${activeAreaPreset.slug}`,
            label: `Area: ${activeAreaPreset.label}`,
            onRemove: clearAreaFilter,
        });
    } else {
        filters.includeTowns.forEach((town) => {
            advancedFilterChips.push({
                key: `include-${town}`,
                label: `Include ${town}`,
                onRemove: () => removeTownRule('includeTowns', town),
            });
        });
    }

    filters.excludeTowns.forEach((town) => {
        advancedFilterChips.push({
            key: `exclude-${town}`,
            label: `Exclude ${town}`,
            onRemove: () => removeTownRule('excludeTowns', town),
        });
    });

    if (mapArea) {
        advancedFilterChips.push({
            key: 'map-area',
            label: `Map area: ${mapArea.resultCount} ${mapArea.resultCount === 1 ? 'home' : 'homes'}`,
            onRemove: clearMapArea,
        });
    }

    if (filters.openHouseOnly) {
        advancedFilterChips.push({
            key: 'open-house',
            label: 'Only homes with open houses',
            onRemove: () => updateFilter('openHouseOnly', false),
        });
    }

    if (filters.virtualTourOnly) {
        advancedFilterChips.push({
            key: 'virtual-tour',
            label: 'Only homes with virtual tours',
            onRemove: () => updateFilter('virtualTourOnly', false),
        });
    }

    if (filters.savedOnly) {
        advancedFilterChips.push({
            key: 'saved-only',
            label: 'Saved only',
            onRemove: exitSavedHomes,
        });
    }

    const advancedFilterCount = advancedFilterChips.filter((chip) => (
        chip.key !== 'query' && chip.key !== 'map-area' && chip.key !== 'saved-only'
    )).length;
    const hasActiveSearchCriteria = advancedFilterChips.length > 0 || queryDraft.trim() !== filters.query.trim();

    const listingsInScope = useMemo(() => listings.filter((listing) => townMatchesPreferredServiceArea(
        listing.address.town,
        listing.address.state,
    )), [listings]);
    const filteredListings = useMemo(() => {
        return sortListings(filterListings(listingsInScope, filters, savedIds), sort);
    }, [filters, listingsInScope, savedIds, sort]);
    const pendingMapSelection = useMemo<MapAreaSelection | null>(() => {
        if (!pendingMapRestore || bundleState !== 'ready') {
            return null;
        }

        return {
            label: 'Shared map area',
            bounds: pendingMapRestore.bounds,
            geometry: pendingMapRestore,
            listingNumbers: [],
            resultCount: 0,
            coverage: {
                eligibleCount: filteredListings.length,
                attemptedCount: filteredListings.length,
                mappedCount: 0,
                isLimited: false,
            },
        };
    }, [bundleState, filteredListings.length, pendingMapRestore]);
    const resultListings = useMemo(() => {
        if (!mapArea) {
            return filteredListings;
        }

        const mapListingNumbers = new Set(mapArea.listingNumbers);
        return filteredListings.filter((listing) => mapListingNumbers.has(listing.listingNumber));
    }, [filteredListings, mapArea]);
    const filterCapsulePrice = filters.minPrice && filters.maxPrice
        ? `${priceSummaryLabel(filters.minPrice, '')}–${priceSummaryLabel(filters.maxPrice, '')}`
        : filters.minPrice
            ? `${priceSummaryLabel(filters.minPrice, '')}+`
            : filters.maxPrice
                ? `Up to ${priceSummaryLabel(filters.maxPrice, '')}`
                : 'Any price';
    const filterCapsuleCriteria = [
        filters.query.trim() || activeAreaPreset?.label || (mapArea ? mapArea.label : 'Any location'),
        filterCapsulePrice,
        filters.minBeds && filters.maxBeds
            ? `${filters.minBeds}–${filters.maxBeds} beds`
            : filters.minBeds
                ? `${filters.minBeds}+ beds`
                : filters.maxBeds
                    ? `Up to ${filters.maxBeds} beds`
                    : '',
        filters.minBaths && filters.maxBaths
            ? `${filters.minBaths}–${filters.maxBaths} baths`
            : filters.minBaths
                ? `${filters.minBaths}+ baths`
                : filters.maxBaths
                    ? `Up to ${filters.maxBaths} baths`
                    : '',
    ].filter(Boolean);
    const filterCapsuleSummary = filterCapsuleCriteria.join(' · ');
    const useCompactFilterCapsule = isMobileWorkspace || isFilterCapsuleCompact;
    const {
        totalPages,
        effectivePage,
        pageStartIndex,
        pageEndIndex,
        pagedListings,
    } = useMemo(() => paginateListings(resultListings, currentPage, pageSize), [currentPage, pageSize, resultListings]);
    const leadViewMode: PropertyViewMode = isMapDrawerOpen ? 'map' : viewMode;
    const criteriaSignature = searchCriteriaSignature(filters, sort, pageSize);
    const isProgressiveSplit = isDesktopWorkspace && isMapDrawerOpen && !gallery;
    const splitShownCount = Math.min(resultListings.length, splitVisibleCount);
    const displayedListings = isProgressiveSplit
        ? resultListings.slice(0, splitShownCount)
        : pagedListings;
    const hasMoreSplitListings = isProgressiveSplit && splitShownCount < resultListings.length;
    const splitNextBatchCount = Math.min(
        splitResultsBatchSize,
        Math.max(0, resultListings.length - splitShownCount),
    );

    useEffect(() => {
        setSplitVisibleCount(splitResultsBatchSize);
    }, [bundle?.generatedAt, criteriaSignature, mapArea]);

    useEffect(() => {
        const target = splitLoadMoreRef.current;
        if (
            !target ||
            !hasMoreSplitListings ||
            typeof window.IntersectionObserver === 'undefined'
        ) {
            return undefined;
        }

        const observer = new window.IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) {
                return;
            }

            observer.unobserve(target);
            setSplitVisibleCount((current) => Math.min(
                resultListings.length,
                current + splitResultsBatchSize,
            ));
        }, {
            root: null,
            rootMargin: '800px 0px',
            threshold: 0,
        });

        observer.observe(target);
        return () => observer.disconnect();
    }, [hasMoreSplitListings, resultListings.length, splitShownCount]);

    useEffect(() => {
        if (!hasRestoredStorage) {
            return;
        }

        if (restoredCriteriaSignatureRef.current === criteriaSignature) {
            restoredCriteriaSignatureRef.current = null;
            return;
        }

        restoredCriteriaSignatureRef.current = null;
        setCurrentPage(1);
    }, [criteriaSignature, hasRestoredStorage]);

    useEffect(() => {
        if (bundleState !== 'ready') {
            return;
        }

        setCurrentPage((page) => Math.min(page, totalPages));
    }, [bundleState, totalPages]);

    useEffect(() => {
        if (bundleState !== 'ready' || !pendingMapRestore) {
            return;
        }

        const hasMapConfiguration = Boolean(
            process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() &&
            process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID?.trim(),
        );
        if (!hasMapConfiguration) {
            setPendingMapRestore(null);
            setMapArea(null);
            setActiveMapListingNumber(null);
            setMapCamera(null);
            setIsMapDrawerOpen(false);
            setUrlRestoreMessage('That shared map area is not available right now. Your other search choices are still here.');
            onMapAreaChangeRef.current?.(null);
        }
    }, [bundleState, pendingMapRestore]);

    useEffect(() => {
        if (bundleState !== 'ready' || !pendingListingNumber) {
            return;
        }

        const listing = listings.find((item) => item.listingNumber === pendingListingNumber);
        if (listing) {
            setGallery({ listing, initialIndex: 0 });
        } else {
            setGallery(null);
            setUrlRestoreMessage('That home is not available in the current search. Here are the latest homes in the service area.');
        }
        setPendingListingNumber(null);
    }, [bundleState, listings, pendingListingNumber]);

    useEffect(() => {
        if (
            !hasRestoredStorage ||
            bundleState !== 'ready' ||
            pendingMapRestore ||
            pendingListingNumber ||
            pendingListingHistoryPopRef.current
        ) {
            return;
        }

        const nextUrl = buildPropertySearchUrl(new URL(window.location.href), {
            filters,
            sort,
            view: viewMode,
            page: effectivePage,
            pageSize,
            scope: 'service',
            isMapOpen: isMapDrawerOpen,
            listingNumber: gallery?.listing.listingNumber ?? null,
            mapListingNumber: activeMapListingNumber,
            mapCamera,
            mapBounds: mapArea?.bounds,
            mapGeometry: mapGeometryForSelection(mapArea),
        });
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const nextHistoryState = historyStateRecord();
        const currentMarker = propertyListingHistoryMarker(nextHistoryState);
        const currentListingNumber = gallery?.listing.listingNumber ?? null;

        if (!currentListingNumber || currentMarker?.listingNumber !== currentListingNumber) {
            delete nextHistoryState[propertyListingHistoryKey];
        }
        if (!filters.savedOnly) {
            delete nextHistoryState[propertySavedOnlyHistoryKey];
        }

        const historyStateChanged = JSON.stringify(nextHistoryState) !== JSON.stringify(window.history.state ?? {});
        if (nextUrl !== currentUrl || historyStateChanged) {
            window.history.replaceState(nextHistoryState, '', nextUrl);
        }
    }, [
        bundleState,
        activeMapListingNumber,
        effectivePage,
        filters,
        gallery?.listing.listingNumber,
        hasRestoredStorage,
        isMapDrawerOpen,
        mapArea,
        mapCamera,
        pageSize,
        pendingListingNumber,
        pendingMapRestore,
        sort,
        viewMode,
    ]);

    useEffect(() => {
        const previousResultCount = previousResultCountRef.current;

        if (previousResultCount !== null && previousResultCount > 0 && resultListings.length === 0) {
            resultsAreaRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'start' });
        }

        previousResultCountRef.current = resultListings.length;
    }, [resultListings.length]);

    function updateFilter<Key extends keyof PropertyFilterState>(key: Key, value: PropertyFilterState[Key]) {
        if (key === 'query') {
            clearMapArea();
        }
        setFilters((current) => ({ ...current, [key]: value }));
    }

    function updateNumericRange(
        minimumKey: 'minBeds' | 'minBaths' | 'minPrice',
        maximumKey: 'maxBeds' | 'maxBaths' | 'maxPrice',
        changedEnd: 'minimum' | 'maximum',
        value: string,
    ) {
        setFilters((current) => {
            let minimum = changedEnd === 'minimum' ? value : current[minimumKey];
            let maximum = changedEnd === 'maximum' ? value : current[maximumKey];

            if (minimum && maximum && Number(minimum) > Number(maximum)) {
                if (changedEnd === 'minimum') {
                    maximum = minimum;
                } else {
                    minimum = maximum;
                }
            }

            return {
                ...current,
                [minimumKey]: minimum,
                [maximumKey]: maximum,
            };
        });
    }

    function submitLocationSearch(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        const nextQuery = queryDraft.trim();
        setIsFilterCapsuleExpanded(false);
        clearMapArea();
        setMapCamera(null);
        setActiveMapListingNumber(null);
        setFilters((current) => ({ ...current, query: nextQuery }));
        setCurrentPage(1);

        focusResults();
    }

    function toggleFilterCapsule() {
        if (!isFilterCapsuleCompact && !isMobileWorkspace) {
            return;
        }

        if (!isDesktopWorkspace) {
            setIsFilterSheetOpen(true);
            return;
        }

        setIsFilterCapsuleExpanded((current) => !current);
    }

    function openFilterSheetFromCapsule() {
        setIsFilterCapsuleExpanded(false);
        setIsFilterSheetOpen(true);
    }

    function clearLocationSearch() {
        setQueryDraft('');
        updateFilter('query', '');
    }

    function updateMapArea(selection: MapAreaSelection | null) {
        setPendingMapRestore(null);

        setMapArea(selection);
        onMapAreaChange?.(selection);
        setCurrentPage(1);
        if (selection) {
            setUrlRestoreMessage('');
        }
    }

    function handleMapUnavailable() {
        if (!pendingMapRestore) {
            return;
        }

        setPendingMapRestore(null);
        setMapArea(null);
        setActiveMapListingNumber(null);
        setMapCamera(null);
        setIsMapDrawerOpen(false);
        setUrlRestoreMessage('That shared map area is not available right now. Your other search choices are still here.');
        onMapAreaChange?.(null);
    }

    function clearMapArea() {
        if (pendingMapRestore) {
            setPendingMapRestore(null);
            setUrlRestoreMessage('');
            onMapAreaChange?.(null);
            return;
        }

        if (mapArea) {
            updateMapArea(null);
        }
    }

    function setTownRuleState(town: string, state: TownRuleState) {
        if (!townMatchesPreferredServiceArea(town, 'MA')) {
            return;
        }
        clearMapArea();
        setFilters((current) => {
            const includeTowns = current.includeTowns.filter((currentTown) => currentTown !== town);
            const excludeTowns = current.excludeTowns.filter((currentTown) => currentTown !== town);

            return {
                ...current,
                ...(state === 'included' ? {
                    state: defaultPropertyFilters.state,
                    region: allRegionsLabel,
                    county: allLabel,
                } : {}),
                includeTowns: state === 'included' ? uniqueSorted([...includeTowns, town]) : includeTowns,
                excludeTowns: state === 'excluded' ? uniqueSorted([...excludeTowns, town]) : excludeTowns,
            };
        });

    }

    function clearTownRules() {
        clearMapArea();
        setFilters((current) => ({
            ...current,
            includeTowns: [],
            excludeTowns: [],
        }));
    }

    function removeTownRule(kind: 'includeTowns' | 'excludeTowns', town: string) {
        clearMapArea();
        setFilters((current) => ({
            ...current,
            [kind]: current[kind].filter((currentTown) => currentTown !== town),
        }));
    }

    function clearAreaFilter() {
        clearMapArea();
        setFilters((current) => ({
            ...current,
            region: defaultRegion,
            includeTowns: [],
        }));
    }

    function applyPricePreset(preset: (typeof pricePresets)[number]) {
        const sliderMax = preset.sliderMax ?? priceBounds.max;

        setFilters((current) => ({
            ...current,
            minPrice: preset.minPrice,
            maxPrice: preset.maxPrice,
        }));
        setPriceSliderDomain({ min: preset.sliderMin, max: sliderMax });
    }

    function syncPriceSliderToInputs() {
        setPriceSliderDomain(priceSliderDomainForInputs(filters.minPrice, filters.maxPrice, priceBounds));
    }

    function clearFilters() {
        clearMapArea();
        setMapCamera(null);
        setActiveMapListingNumber(null);
        setFilters(defaultFilters);
        setQueryDraft('');
    }

    function currentSearchContext(
        actionListings: MlsSearchListing[] = [],
        map?: MapSearchContext,
        exactActionListings = false,
    ): SearchConsultLeadSearchContext {
        const mapContext: MapSearchContext | undefined = map ?? mapArea ?? undefined;
        const selectedMlsNumbers = exactActionListings
            ? actionListings.map((listing) => listing.listingNumber)
            : Array.from(new Set([
                ...Array.from(selectedIds),
                ...actionListings.map((listing) => listing.listingNumber),
                ...(mapContext?.listingNumbers ?? []),
            ])).slice(0, savedHomesEmailLimit);

        return {
            activeRegion: filters.region,
            searchAreaLabel: mapContext?.label ?? searchAreaLabelFor(filters),
            searchAreaBounds: mapContext?.bounds ?? null,
            searchAreaGeometry: mapContext?.geometry ?? (mapContext?.bounds
                ? { kind: 'bounds', bounds: mapContext.bounds }
                : null),
            filters: leadFilterSnapshot(filters, mapContext ? 'map' : leadViewMode, sort),
            selectedMlsNumbers,
        };
    }

    function openComparisonTray() {
        setComparisonView('tray');
    }

    function changeComparisonView(view: ComparisonView) {
        setComparisonView(view);
        if (view === 'minimized' && !detailOpenedFromComparisonRef.current) {
            window.requestAnimationFrame(() => {
                document.querySelector<HTMLButtonElement>('[aria-label^="Compare homes,"]')?.focus();
            });
        }
    }

    function toggleSaved(id: string) {
        const isAdding = !savedIds.has(id);
        const isRemovingLastSaved = filters.savedOnly && !isAdding && savedIds.size === 1;
        const shouldRestoreSavedCardFocus = filters.savedOnly &&
            !isAdding &&
            savedButtonRefs.current.get(id) === document.activeElement;
        const currentIndex = shouldRestoreSavedCardFocus
            ? resultListings.findIndex((listing) => listing.listingNumber === id)
            : -1;
        const focusTarget = currentIndex >= 0
            ? resultListings[currentIndex + 1] ?? resultListings[currentIndex - 1] ?? null
            : null;

        setSavedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });

        if (isAdding) {
            setSavedCelebrationKey((current) => current + 1);
        } else if (shouldRestoreSavedCardFocus) {
            window.requestAnimationFrame(() => {
                const nextSavedButton = focusTarget
                    ? savedButtonRefs.current.get(focusTarget.listingNumber)
                    : null;
                const nextFocusTarget = nextSavedButton
                    ?? (isRemovingLastSaved ? emptySavedReturnButtonRef.current : null)
                    ?? resultsAreaRef.current;
                nextFocusTarget?.focus({ preventScroll: true });
            });
        }
    }

    function toggleCompared(id: string) {
        const isAdding = !selectedIds.has(id);

        setSelectedIds((current) => {
            const next = new Set(current);
            if (next.has(id)) {
                next.delete(id);
                setComparisonLimitMessage('');
            } else if (next.size >= 4) {
                setComparisonLimitMessage('You have selected four homes. Remove one to compare another.');
                return current;
            } else {
                next.add(id);
                setComparisonLimitMessage('');
            }
            return next;
        });

        if (isAdding && selectedIds.size < 4) {
            setComparisonCelebrationKey((current) => current + 1);
        }
    }

    function openLeadDrawer(
        action: LeadAction,
        actionListings: MlsSearchListing[],
        searchContext: SearchConsultLeadSearchContext = currentSearchContext(
            actionListings,
            undefined,
            action === 'send_selected_homes',
        ),
    ) {
        leadDrawerInstanceIdRef.current += 1;
        setLeadDrawer({
            instanceId: leadDrawerInstanceIdRef.current,
            action,
            listings: actionListings,
            searchContext,
        });
    }

    function openSearchConsultFromMap(_actionListings: MlsSearchListing[], map: MapSearchContext) {
        openLeadDrawer('get_matching_homes', [], currentSearchContext([], map));
    }

    function showResultsView(mode: ResultsViewMode) {
        setViewMode(mode);
        if (!isDesktopWorkspace) {
            setIsMapDrawerOpen(false);
        }
    }

    function openMapDrawer() {
        if (isMobileWorkspace) {
            mobileListScrollYRef.current = window.scrollY;
        }
        if (comparisonView !== 'minimized') {
            setComparisonView('minimized');
        }
        setHasMountedMap(true);
        setIsMapDrawerOpen(true);
    }

    function showListFromMobileBar() {
        if (isMapDrawerOpen) {
            setIsMapDrawerOpen(false);
        }
        if (comparisonView !== 'minimized') {
            setComparisonView('minimized');
        }
        if (filters.savedOnly) {
            exitSavedHomes();
            return;
        }
        focusResults();
    }

    function openCommunityFiltersFromMap() {
        if (!isDesktopWorkspace) {
            setIsMapDrawerOpen(false);
        }
        setIsFilterSheetOpen(true);
    }

    function closeMapDrawer() {
        const shouldRestoreMapTrigger = !gallery;
        if (isDesktopWorkspace && gallery) {
            const historyState = historyStateRecord();
            const marker = propertyListingHistoryMarker(historyState);
            const currentUrlListing = new URL(window.location.href).searchParams.get('listing');

            if (
                marker?.listingNumber === gallery.listing.listingNumber &&
                currentUrlListing === gallery.listing.listingNumber
            ) {
                pendingCloseMapAfterPopRef.current = true;
            }
            closeGallery();
        }
        setIsMapDrawerOpen(false);
        if (shouldRestoreMapTrigger) {
            window.requestAnimationFrame(() => {
                const returnTarget = isMobileWorkspace
                    ? mobileMapButtonRef.current
                    : mapPreviewButtonRef.current;
                (returnTarget ?? resultsAreaRef.current)?.focus({ preventScroll: true });
                if (isMobileWorkspace) {
                    window.scrollTo({
                        top: mobileListScrollYRef.current,
                        left: 0,
                        behavior: 'auto',
                    });
                }
            });
        }
    }

    function showSavedFromMobileBar() {
        if (isMapDrawerOpen) {
            setIsMapDrawerOpen(false);
        }
        if (comparisonView !== 'minimized') {
            setComparisonView('minimized');
        }
        showSavedHomes();
    }

    function showComparisonFromMobileBar() {
        if (selectedIds.size === 0) {
            return;
        }
        if (isMapDrawerOpen) {
            setIsMapDrawerOpen(false);
        }
        openComparisonTray();
    }

    function contactFromMobileBar() {
        if (isMapDrawerOpen) {
            setIsMapDrawerOpen(false);
        }
        if (comparisonView !== 'minimized') {
            setComparisonView('minimized');
        }
        openLeadDrawer(
            'get_matching_homes',
            (savedListings.length > 0 ? savedListings : resultListings).slice(0, 5),
        );
    }

    function returnFromLeadDrawer() {
        const shouldShowSavedHomes = savedIds.size > 0;
        setLeadDrawer(null);
        window.requestAnimationFrame(() => {
            if (shouldShowSavedHomes) {
                showSavedHomes();
                return;
            }
            focusResults();
        });
    }

    function searchUrlWithListing(listingNumber: string | null) {
        return buildPropertySearchUrl(new URL(window.location.href), {
            filters,
            sort,
            view: viewMode,
            page: effectivePage,
            pageSize,
            scope: 'service',
            isMapOpen: isMapDrawerOpen,
            listingNumber,
            mapListingNumber: activeMapListingNumber,
            mapCamera,
            mapBounds: mapArea?.bounds,
            mapGeometry: mapGeometryForSelection(mapArea),
        });
    }

    function replaceListingUrl(listingNumber: string | null) {
        const nextHistoryState = historyStateRecord();
        const currentMarker = propertyListingHistoryMarker(nextHistoryState);

        if (listingNumber && currentMarker?.listingNumber === listingNumber) {
            nextHistoryState[propertyListingHistoryKey] = currentMarker;
        } else {
            delete nextHistoryState[propertyListingHistoryKey];
        }
        if (!filters.savedOnly) {
            delete nextHistoryState[propertySavedOnlyHistoryKey];
        }

        window.history.replaceState(nextHistoryState, '', searchUrlWithListing(listingNumber));
    }

    function openGallery(
        listing: MlsSearchListing,
        index: number,
        origin: 'results' | 'comparison' = 'results',
    ) {
        detailOpenedFromComparisonRef.current = origin === 'comparison';
        if (document.activeElement instanceof HTMLElement) {
            detailReturnFocusRef.current = document.activeElement;
        }
        const currentHistoryState = historyStateRecord();
        const currentMarker = propertyListingHistoryMarker(currentHistoryState);
        const currentUrlListing = new URL(window.location.href).searchParams.get('listing');
        const isCurrentPushedEntry = Boolean(
            currentMarker && currentMarker.listingNumber === currentUrlListing,
        );
        const nextMarker: PropertyListingHistoryMarker = isCurrentPushedEntry && currentMarker
            ? { ...currentMarker, listingNumber: listing.listingNumber }
            : {
                entryId: listingHistoryEntryIdRef.current += 1,
                listingNumber: listing.listingNumber,
                pushed: true,
            };
        const nextHistoryState: Record<string, unknown> = {
            ...currentHistoryState,
            [propertyListingHistoryKey]: nextMarker,
        };
        if (!filters.savedOnly) {
            delete nextHistoryState[propertySavedOnlyHistoryKey];
        }
        const nextUrl = searchUrlWithListing(listing.listingNumber);

        if (gallery && isCurrentPushedEntry) {
            window.history.replaceState(nextHistoryState, '', nextUrl);
        } else {
            window.history.pushState(nextHistoryState, '', nextUrl);
        }
        setUrlRestoreMessage('');
        setGallery({ listing, initialIndex: index });
    }

    function openListingFromComparison(listing: MlsSearchListing) {
        setComparisonView('minimized');
        openGallery(listing, 0, 'comparison');
    }

    function emailSavedHomes() {
        if (savedListings.length === 0 || savedListings.length > savedHomesEmailLimit) {
            return;
        }
        openLeadDrawer('send_selected_homes', savedListings);
    }

    function closeGallery() {
        if (!gallery) {
            return;
        }

        const historyState = historyStateRecord();
        const marker = propertyListingHistoryMarker(historyState);
        const currentUrlListing = new URL(window.location.href).searchParams.get('listing');

        if (
            marker?.listingNumber === gallery.listing.listingNumber &&
            currentUrlListing === gallery.listing.listingNumber
        ) {
            pendingListingHistoryPopRef.current = true;
            setGallery(null);
            window.history.back();
            return;
        }

        setGallery(null);
        replaceListingUrl(null);
    }

    function transitionFromGallery(action: LeadAction) {
        if (!gallery) {
            return;
        }

        detailOpenedFromComparisonRef.current = false;
        const listing = gallery.listing;
        const historyState = historyStateRecord();
        const marker = propertyListingHistoryMarker(historyState);
        const currentUrlListing = new URL(window.location.href).searchParams.get('listing');

        if (marker?.listingNumber === listing.listingNumber && currentUrlListing === listing.listingNumber) {
            leadDrawerInstanceIdRef.current += 1;
            pendingLeadAfterPopRef.current = {
                instanceId: leadDrawerInstanceIdRef.current,
                action,
                listings: [listing],
                searchContext: currentSearchContext([listing]),
            };
            window.history.back();
            return;
        }

        setGallery(null);
        replaceListingUrl(null);
        openLeadDrawer(action, [listing]);
    }

    function showSavedHomes() {
        if (filters.savedOnly) {
            focusResults();
            return;
        }

        const nextFilters = { ...filters, savedOnly: true };
        const nextHistoryState: Record<string, unknown> = {
            ...historyStateRecord(),
            [propertySavedOnlyHistoryKey]: { pushed: true } satisfies PropertySavedOnlyHistoryMarker,
        };
        delete nextHistoryState[propertyListingHistoryKey];
        const nextUrl = buildPropertySearchUrl(new URL(window.location.href), {
            filters: nextFilters,
            sort,
            view: viewMode,
            page: 1,
            pageSize,
            scope: 'service',
            isMapOpen: isMapDrawerOpen,
            listingNumber: null,
            mapListingNumber: activeMapListingNumber,
            mapCamera,
            mapBounds: mapArea?.bounds,
            mapGeometry: mapGeometryForSelection(mapArea),
        });

        window.history.pushState(nextHistoryState, '', nextUrl);
        setFilters(nextFilters);
        setCurrentPage(1);
        focusResults();
    }

    function exitSavedHomes() {
        const historyState = historyStateRecord();
        if (
            propertySavedOnlyHistoryMarker(historyState) &&
            new URL(window.location.href).searchParams.get('saved') === '1'
        ) {
            pendingFocusResultsAfterPopRef.current = true;
            window.history.back();
            return;
        }

        setFilters((current) => ({ ...current, savedOnly: false }));
        focusResults();
    }

    function focusResults() {
        window.requestAnimationFrame(() => {
            const results = resultsAreaRef.current;
            if (!results) {
                return;
            }

            results.focus({ preventScroll: true });
            const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
            results.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        });
    }

    function showResultsPage(page: number) {
        setCurrentPage(Math.min(Math.max(1, page), totalPages));
        focusResults();
    }

    const isDesktopMapDetail = Boolean(gallery && isMapDrawerOpen && isDesktopWorkspace);

    useEffect(() => {
        const wasDesktopMapDetail = wasDesktopMapDetailRef.current;
        wasDesktopMapDetailRef.current = isDesktopMapDetail;

        if (isDesktopMapDetail) {
            window.requestAnimationFrame(() => {
                const detailRegion = desktopDetailRef.current?.querySelector<HTMLElement>(
                    '[aria-label^="Listing details"]',
                );
                (detailRegion ?? desktopDetailRef.current)?.focus({ preventScroll: true });
            });
        } else if (wasDesktopMapDetail && !gallery) {
            window.requestAnimationFrame(() => {
                const returnTarget = detailReturnFocusRef.current;
                const targetIsAvailable = Boolean(
                    returnTarget?.isConnected &&
                    !returnTarget.closest('[hidden], [inert], [aria-hidden="true"]'),
                );
                const fallback = mapPreviewButtonRef.current ?? resultsAreaRef.current;
                (targetIsAvailable ? returnTarget : fallback)?.focus({ preventScroll: true });
            });
        }
    }, [gallery, isDesktopMapDetail]);

    useEffect(() => {
        if (gallery || !detailOpenedFromComparisonRef.current) {
            return;
        }

        detailOpenedFromComparisonRef.current = false;
        window.requestAnimationFrame(() => {
            document.querySelector<HTMLButtonElement>('[aria-label^="Compare homes,"]')
                ?.focus({ preventScroll: true });
        });
    }, [gallery]);

    function renderPhotoGallery(
        presentation: 'dialog' | 'workspace',
        closeLabel: string,
    ) {
        const currentGallery = gallery;
        if (!currentGallery) {
            return null;
        }

        return (
            <PhotoGalleryDialog
                key={`${currentGallery.listing.listingNumber}-${presentation}`}
                closeLabel={closeLabel}
                dataUpdatedAt={bundle?.generatedAt ?? null}
                detail={galleryDetail}
                detailState={detailState}
                initialIndex={currentGallery.initialIndex}
                isSaved={savedIds.has(currentGallery.listing.listingNumber)}
                isCompared={selectedIds.has(currentGallery.listing.listingNumber)}
                listing={currentGallery.listing}
                onClose={closeGallery}
                onContact={() => transitionFromGallery('ask_about_home')}
                onRequestShowing={() => transitionFromGallery('request_showing')}
                onRetryDetail={retryDetail}
                onToggleCompared={() => toggleCompared(currentGallery.listing.listingNumber)}
                onToggleSaved={() => toggleSaved(currentGallery.listing.listingNumber)}
                presentation={presentation}
            />
        );
    }

    if (bundleState === 'missing') {
        return (
            <section
                className={[styles.searchSection, styles.searchMaintenance, className].filter(Boolean).join(' ')}
                aria-labelledby="properties-maintenance-title"
            >
                <div className={styles.maintenancePanel}>
                    <p className={styles.eyebrow}>Home search</p>
                    <h2 id="properties-maintenance-title">Home search is temporarily unavailable.</h2>
                    <p>
                        Please check back shortly, or get in touch for help with your search.
                    </p>
                    <div className={styles.maintenanceActions}>
                        <button
                            onClick={retryBundle}
                            type="button"
                        >
                            Try again
                        </button>
                        <a href={`mailto:${contact.email}`}>Send an email</a>
                        {contact.phone ? <a href={contact.phoneHref}>Call {contact.phone}</a> : null}
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section
            className={[styles.searchSection, 'property-search-shell', className].filter(Boolean).join(' ')}
            aria-labelledby="properties-search-title"
        >
            <div className={styles.toolbar}>
                <div>
                    <p className={styles.eyebrow}>Home search</p>
                    <h2 id="properties-search-title">Homes for sale</h2>
                    <p>
                        Explore homes for sale across the Burlington-centered service area.
                        Save favorites, compare options, and reach out whenever you would like help.
                    </p>
                </div>
            </div>

            {urlRestoreMessage ? (
                <p className={styles.urlRestoreNotice} role="status">{urlRestoreMessage}</p>
            ) : null}

            <div className={`${styles.workspace} property-search-workspace`}>
                <div className={`${styles.searchMainColumn} property-search-results-pane`}>
                    {isDesktopMapDetail ? (
                        <div className={styles.desktopDetailPane} ref={desktopDetailRef} tabIndex={-1}>
                            {renderPhotoGallery('workspace', 'Back to results')}
                        </div>
                    ) : null}
                    <div
                        aria-hidden="true"
                        className={styles.filterCapsuleSentinel}
                        data-testid="property-filter-capsule-sentinel"
                        ref={filterCapsuleSentinelRef}
                    />
                    <div
                        className={[
                            styles.filterCapsuleShell,
                            useCompactFilterCapsule ? styles.filterCapsuleCompact : '',
                            isFilterCapsuleExpanded ? styles.filterCapsuleExpanded : '',
                        ].filter(Boolean).join(' ')}
                        data-compact={useCompactFilterCapsule}
                        data-expanded={isFilterCapsuleExpanded}
                        ref={filterCapsuleRef}
                    >
                        <div
                            className={styles.filterCapsuleSummary}
                            hidden={!useCompactFilterCapsule}
                        >
                            <button
                                aria-controls={isDesktopWorkspace
                                    ? 'property-search-quick-filters'
                                    : 'property-search-more-filters'}
                                aria-expanded={isDesktopWorkspace
                                    ? isFilterCapsuleExpanded
                                    : isFilterSheetOpen}
                                aria-haspopup={isDesktopWorkspace ? undefined : 'dialog'}
                                aria-label={`Edit search filters: ${filterCapsuleSummary}`}
                                className={styles.filterCapsuleToggle}
                                onClick={toggleFilterCapsule}
                                ref={filterCapsuleToggleRef}
                                type="button"
                            >
                                <span aria-hidden="true" className={styles.filterCapsuleIcon}>
                                    <svg viewBox="0 0 24 24">
                                        <circle cx="10.5" cy="10.5" r="5.75" />
                                        <path d="m15 15 4.25 4.25" />
                                    </svg>
                                </span>
                                <span className={styles.filterCapsuleCopy}>
                                    <span>Search homes</span>
                                    <strong>{filterCapsuleSummary}</strong>
                                </span>
                                <span aria-hidden="true" className={styles.filterCapsuleChevron}>
                                    {isFilterCapsuleExpanded ? '−' : '+'}
                                </span>
                            </button>

                            <span className={styles.filterCapsuleResult}>
                                <strong>{formatNumber(resultListings.length)}</strong>
                                <span>{resultListings.length === 1 ? 'home' : 'homes'}</span>
                            </span>

                            <button
                                aria-label={advancedFilterChips.length > 0
                                    ? `${isMobileWorkspace ? 'Filters' : 'All filters'}, ${advancedFilterChips.length} active`
                                    : isMobileWorkspace ? 'Filters' : 'All filters'}
                                aria-haspopup="dialog"
                                className={styles.filterCapsuleFiltersButton}
                                onClick={openFilterSheetFromCapsule}
                                type="button"
                            >
                                {isMobileWorkspace ? 'Filters' : 'All filters'}
                                {advancedFilterChips.length > 0 ? (
                                    <strong>{advancedFilterChips.length}</strong>
                                ) : null}
                            </button>
                        </div>

                        <div
                            aria-label="Property search filters"
                            className={styles.filters}
                            hidden={isMobileWorkspace || (isFilterCapsuleCompact && !isFilterCapsuleExpanded)}
                            id="property-search-quick-filters"
                            role="search"
                        >
                            <div className={styles.filterHeader}>
                                <div>
                                    <h3>Refine your search</h3>
                                    <p>Start with a location or narrow the details.</p>
                                </div>
                                {hasActiveSearchCriteria ? (
                                    <button
                                        className={styles.resetFiltersButton}
                                        onClick={clearFilters}
                                        type="button"
                                    >
                                        Reset all
                                    </button>
                                ) : null}
                            </div>

                            <form className={styles.locationFilter} onSubmit={submitLocationSearch}>
                                <label>
                                    <span>Location</span>
                                    <div className={styles.locationSearchControl}>
                                        <input
                                            aria-label="Address search"
                                            placeholder="Town, ZIP, or address"
                                            type="search"
                                            value={queryDraft}
                                            onChange={(event) => setQueryDraft(event.currentTarget.value)}
                                        />
                                        <button
                                            aria-label="Search location"
                                            className={styles.findHomesButton}
                                            type="submit"
                                        >
                                            Search
                                        </button>
                                    </div>
                                </label>
                            </form>

                            <label className="property-search-secondary-quick-filter">
                                <span>Home type</span>
                                <select
                                    aria-label="Property type"
                                    value={filters.propertyType}
                                    onChange={(event) => updateFilter('propertyType', event.currentTarget.value)}
                                >
                                    <option value={allLabel}>Any type</option>
                                    {filterOptions.propertyTypes.map((type) => <option key={type}>{type}</option>)}
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Price</span>
                                <select
                                    aria-label="Price range shortcut"
                                    value={selectedPricePresetLabel}
                                    onChange={(event) => {
                                        const preset = pricePresets.find((item) => item.label === event.currentTarget.value);
                                        if (preset) applyPricePreset(preset);
                                    }}
                                >
                                    {selectedPricePresetLabel === 'Custom' ? <option value="Custom">Custom price</option> : null}
                                    {pricePresets.map((preset) => (
                                        <option key={preset.label} value={preset.label}>
                                            {preset.label === 'Any' ? 'Any price' : preset.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Bedrooms</span>
                                <select
                                    aria-label="Minimum beds"
                                    value={filters.minBeds}
                                    onChange={(event) => updateNumericRange(
                                        'minBeds',
                                        'maxBeds',
                                        'minimum',
                                        event.currentTarget.value,
                                    )}
                                >
                                    {filters.minBeds && !quickBedOptions.some((option) => option.value === filters.minBeds) ? (
                                        <option value={filters.minBeds}>{filters.minBeds}+ beds</option>
                                    ) : null}
                                    {quickBedOptions.map((option) => (
                                        <option key={option.label} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>

                            <label className="property-search-secondary-quick-filter">
                                <span>Bathrooms</span>
                                <select
                                    aria-label="Minimum baths"
                                    value={filters.minBaths}
                                    onChange={(event) => updateNumericRange(
                                        'minBaths',
                                        'maxBaths',
                                        'minimum',
                                        event.currentTarget.value,
                                    )}
                                >
                                    {filters.minBaths && !quickBathOptions.some((option) => option.value === filters.minBaths) ? (
                                        <option value={filters.minBaths}>{filters.minBaths}+ baths</option>
                                    ) : null}
                                    {quickBathOptions.map((option) => (
                                        <option key={option.label} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </label>

                            <div className={styles.moreFiltersField}>
                                <span>More options</span>
                                <button
                                    aria-label={advancedFilterCount > 0
                                        ? `More filters, ${advancedFilterCount} active`
                                        : 'More filters'}
                                    aria-expanded={isFilterSheetOpen}
                                    aria-haspopup="dialog"
                                    className={styles.moreFiltersButton}
                                    onClick={() => setIsFilterSheetOpen(true)}
                                    type="button"
                                >
                                    Filters
                                    {advancedFilterCount > 0 ? <strong>{advancedFilterCount}</strong> : null}
                                </button>
                            </div>

                            {advancedFilterChips.length > 0 ? (
                                <div className={styles.advancedFilterBar}>
                                    <div
                                        className={styles.activeFilterChips}
                                        aria-label="Active advanced filters"
                                        role="group"
                                    >
                                        {advancedFilterChips.map((chip) => (
                                            <button
                                                aria-label={`Remove ${chip.label}`}
                                                key={chip.key}
                                                onClick={chip.onRemove}
                                                type="button"
                                            >
                                                {chip.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <AdvancedFilterSheet
                        open={isFilterSheetOpen}
                        onClose={() => setIsFilterSheetOpen(false)}
                        filters={filters}
                        listings={listings}
                        towns={filterOptions.towns}
                        propertyTypes={filterOptions.propertyTypes}
                        resultCount={resultListings.length}
                        priceSlider={priceSlider}
                        updateFilter={updateFilter}
                        updateNumericRange={updateNumericRange}
                        onTownRuleChange={setTownRuleState}
                        removeTownRule={removeTownRule}
                        clearTownRules={clearTownRules}
                        clearFilters={clearFilters}
                        applyPricePreset={applyPricePreset}
                        syncPriceSliderToInputs={syncPriceSliderToInputs}
                    />

                    <div
                        aria-label="Property search results"
                        aria-busy={bundleState === 'loading'}
                        className={styles.resultsArea}
                        ref={resultsAreaRef}
                        role="region"
                        tabIndex={0}
                    >
                        {pendingMapRestore ? (
                            <div className={styles.loadingPanel}>
                                <PropertyLoadingMark label="Restoring shared map area" />
                            </div>
                        ) : (
                            <>
                                <div className={styles.resultMeta}>
                                    <div className={styles.resultSummary}>
                                        <span aria-live="polite" className={styles.visuallyHidden}>
                                            {isProgressiveSplit
                                                ? `${formatNumber(resultListings.length)} homes found. ${formatNumber(splitShownCount)} currently shown. More homes load as you scroll.`
                                                : `${formatNumber(resultListings.length)} homes found. Page ${effectivePage} of ${totalPages}.`}
                                        </span>
                                        <span><strong>{formatNumber(resultListings.length)}</strong> homes</span>
                                        <span className={styles.pageRange}>
                                            {resultListings.length > 0
                                                ? isProgressiveSplit
                                                    ? `${formatNumber(splitShownCount)} loaded`
                                                    : `${pageStartIndex + 1}–${pageEndIndex} shown`
                                                : 'No results'}
                                        </span>
                                        {selectedListings.length > 0 ? (
                                            <span className={styles.comparingCount}>{selectedListings.length} comparing</span>
                                        ) : null}
                                    </div>
                                    <div className={styles.resultControls}>
                                        <div className={styles.sortControls}>
                                            <label>
                                                <span>Sort</span>
                                                <select
                                                    aria-label="Sort results"
                                                    value={`${sort.key}:${sort.direction}`}
                                                    onChange={(event) => {
                                                        const [key, direction] = event.currentTarget.value.split(':') as [
                                                            PropertySortKey,
                                                            PropertySortDirection,
                                                        ];
                                                        setSort({ key, direction });
                                                    }}
                                                >
                                                    {combinedSortOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        </div>
                                        {!isMobileWorkspace && !isProgressiveSplit ? (
                                            <label className={styles.pageSizeControl}>
                                                <span>Show</span>
                                                <select
                                                    aria-label="Results per page"
                                                    value={pageSize}
                                                    onChange={(event) => {
                                                        setPageSize(Number(event.currentTarget.value) as ResultPageSize);
                                                    }}
                                                >
                                                    {resultPageSizes.map((size) => (
                                                        <option key={size} value={size}>
                                                            {size}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        ) : null}
                                        {!isMobileWorkspace ? (
                                            <div className={styles.modeSwitch} role="group" aria-label="View mode">
                                                <button
                                                    aria-pressed={viewMode === 'list'}
                                                    className={viewMode === 'list' ? styles.activeMode : ''}
                                                    onClick={() => showResultsView('list')}
                                                    type="button"
                                                >
                                                    List
                                                </button>
                                                <button
                                                    aria-pressed={viewMode === 'gallery'}
                                                    className={viewMode === 'gallery' ? styles.activeMode : ''}
                                                    onClick={() => showResultsView('gallery')}
                                                    type="button"
                                                >
                                                    Grid
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>

                                <div className={styles.resultsScroller}>
                                    {filters.savedOnly ? (
                                        <div className="property-search-saved-view-header">
                                            <div>
                                                <h3>Saved homes</h3>
                                                {savedListings.length > savedHomesEmailLimit ? (
                                                    <p className={styles.savedEmailLimit} role="status">
                                                        Remove {savedListings.length - savedHomesEmailLimit}{' '}
                                                        {savedListings.length - savedHomesEmailLimit === 1 ? 'home' : 'homes'} to send the full list,
                                                        or compare up to four homes instead.
                                                    </p>
                                                ) : null}
                                            </div>
                                            <div className={styles.savedViewActions}>
                                                {savedListings.length > 0 && savedListings.length <= savedHomesEmailLimit ? (
                                                    <button
                                                        className={styles.savedSendButton}
                                                        onClick={emailSavedHomes}
                                                        type="button"
                                                    >
                                                        <span>
                                                            Send {savedListings.length} saved {savedListings.length === 1 ? 'home' : 'homes'} to Mai Ly
                                                        </span>
                                                        <small>Add your details, then send securely</small>
                                                    </button>
                                                ) : null}
                                                <button
                                                    className={styles.savedBackButton}
                                                    onClick={exitSavedHomes}
                                                    type="button"
                                                >
                                                    Back to search
                                                </button>
                                            </div>
                                        </div>
                                    ) : null}
                                    {bundleState === 'loading' ? (
                                        <div className={styles.loadingPanel}>
                                            <PropertyLoadingMark label="Loading homes" />
                                        </div>
                                    ) : resultListings.length === 0 ? (
                                        <div className={styles.emptyResults}>
                                            <h3>
                                                {filters.savedOnly
                                                    ? savedIds.size === 0
                                                        ? 'Ready to look again?'
                                                        : 'No matching saved homes.'
                                                    : mapArea
                                                        ? 'No matching homes inside this map area.'
                                                        : 'No matching homes.'}
                                            </h3>
                                            <p>
                                                {filters.savedOnly
                                                    ? savedIds.size === 0
                                                        ? 'Your saved list is clear. Return to the home search whenever you are ready to keep exploring.'
                                                        : 'Your saved homes are still available. Adjust the filters to see them.'
                                                    : mapArea
                                                        ? 'Try widening or reshaping the area, or clear it to return to all service-area homes.'
                                                        : filters.query.trim()
                                                            ? 'This search covers Burlington and nearby service-area communities. Try another community or get help with your search.'
                                                            : 'Adjust the filters or ask about a specific home.'}
                                            </p>
                                            <div className={styles.emptyResultsActions}>
                                                {filters.savedOnly ? (
                                                    <button
                                                        ref={savedIds.size === 0 ? emptySavedReturnButtonRef : undefined}
                                                        type="button"
                                                        onClick={exitSavedHomes}
                                                    >
                                                        {savedIds.size === 0 ? 'Return to home search' : 'Back to search'}
                                                    </button>
                                                ) : mapArea ? (
                                                    <button type="button" onClick={clearMapArea}>Clear map area</button>
                                                ) : (
                                                    <button type="button" onClick={clearFilters}>Clear filters</button>
                                                )}
                                                {filters.savedOnly && savedIds.size === 0 ? null : (
                                                    <button type="button" onClick={() => openLeadDrawer('get_matching_homes', [])}>
                                                        Get search help
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div className={viewMode === 'gallery' ? styles.galleryList : styles.resultsList}>
                                                {displayedListings.map((listing) => (
                                                    <ListingCard
                                                        key={listing.listingNumber}
                                                        listing={listing}
                                                        isSaved={savedIds.has(listing.listingNumber)}
                                                        isCompared={selectedIds.has(listing.listingNumber)}
                                                        onToggleSaved={toggleSaved}
                                                        onToggleCompared={toggleCompared}
                                                        onOpenGallery={openGallery}
                                                        savedButtonRef={(id, button) => {
                                                            if (button) savedButtonRefs.current.set(id, button);
                                                            else savedButtonRefs.current.delete(id);
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                            {isProgressiveSplit && resultListings.length > splitResultsBatchSize ? (
                                                <div className={styles.continuousResultsFooter} ref={splitLoadMoreRef}>
                                                    {hasMoreSplitListings ? (
                                                        <>
                                                            <p>
                                                                Showing {formatNumber(splitShownCount)} of {formatNumber(resultListings.length)} homes.
                                                                More homes load as you scroll.
                                                            </p>
                                                            <button
                                                                onClick={() => setSplitVisibleCount((current) => Math.min(
                                                                    resultListings.length,
                                                                    current + splitResultsBatchSize,
                                                                ))}
                                                                type="button"
                                                            >
                                                                Load {formatNumber(splitNextBatchCount)} more {splitNextBatchCount === 1 ? 'home' : 'homes'}
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <p>All {formatNumber(resultListings.length)} homes are loaded.</p>
                                                    )}
                                                </div>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                                {!isProgressiveSplit && totalPages > 1 ? <div className={styles.paginationControls} aria-label="Result pages">
                                    <button
                                        disabled={effectivePage <= 1}
                                        onClick={() => showResultsPage(effectivePage - 1)}
                                        type="button"
                                    >
                                        Previous
                                    </button>
                                    <span>
                                        Page {effectivePage} of {totalPages}
                                    </span>
                                    <button
                                        disabled={effectivePage >= totalPages}
                                        onClick={() => showResultsPage(effectivePage + 1)}
                                        type="button"
                                    >
                                        Next
                                    </button>
                                </div> : null}
                            </>
                        )}
                    </div>
                </div>

                {hasMountedMap ? (
                    <div
                        className={`${styles.mapDrawerBackdrop} property-search-map-pane`}
                        data-map-open={isMapDrawerOpen ? 'true' : 'false'}
                        hidden={!isMapDrawerOpen}
                        onClick={closeMapDrawer}
                    >
                        <aside
                            aria-labelledby="property-map-drawer-title"
                            aria-modal={isDesktopWorkspace ? undefined : 'true'}
                            className={`${styles.mapDrawer} ${isDesktopWorkspace
                                ? styles.mapDrawerWithDock
                                : ''
                                } property-search-map-surface`}
                            id="property-map-drawer"
                            onClick={(event) => event.stopPropagation()}
                            ref={mapDrawerRef}
                            role={isDesktopWorkspace ? 'region' : 'dialog'}
                        >
                            <div className={styles.mapDrawerHeader}>
                                <div>
                                    <p className={styles.eyebrow}>Map search</p>
                                    <h3 id="property-map-drawer-title">Explore homes on the map</h3>
                                </div>
                                <div className={styles.mapDrawerHeaderActions}>
                                    <button type="button" onClick={openCommunityFiltersFromMap}>
                                        Community filters
                                    </button>
                                    <button
                                        className={styles.mapDrawerCloseButton}
                                        type="button"
                                        onClick={closeMapDrawer}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                            <div className={styles.mapDrawerBody}>
                                <PropertyMapView
                                    activeListingNumber={activeMapListingNumber}
                                    camera={mapCamera}
                                    comparedListingNumbers={[...selectedIds]}
                                    coordinateIndexManifest={searchManifest}
                                    coordinateIndexUrl={coordinateIndexUrl}
                                    isActive={isMapDrawerOpen}
                                    listings={filteredListings}
                                    onActiveListingChange={setActiveMapListingNumber}
                                    onCameraChange={setMapCamera}
                                    onMapAreaChange={updateMapArea}
                                    onMapUnavailable={handleMapUnavailable}
                                    onAskAboutArea={openSearchConsultFromMap}
                                    onToggleCompared={toggleCompared}
                                    onToggleSaved={toggleSaved}
                                    onOpenListing={(listing) => {
                                        openGallery(listing, 0);
                                    }}
                                    savedListingNumbers={[...savedIds]}
                                    selectedArea={mapArea ?? pendingMapSelection}
                                />
                            </div>
                            {isMapDrawerOpen && isMobileWorkspace && !gallery && !leadDrawer &&
                                comparisonView !== 'full' ? (
                                <MobileSearchCommandBar
                                    activeView={isMapDrawerOpen ? 'map' : 'list'}
                                    comparedCount={selectedListings.length}
                                    isMapOpen
                                    mapDisabled={false}
                                    onContact={contactFromMobileBar}
                                    onShowComparison={showComparisonFromMobileBar}
                                    onShowList={showListFromMobileBar}
                                    onShowMap={openMapDrawer}
                                    onShowSaved={showSavedFromMobileBar}
                                    savedCount={savedIds.size}
                                />
                            ) : null}
                            {isDesktopWorkspace ? (
                                <div className={styles.mapDrawerDock}>
                                    <SavedHomesDock
                                        comparisonCelebrationKey={comparisonCelebrationKey}
                                        comparedCount={selectedListings.length}
                                        contactAction={{
                                            disabled: Boolean(pendingMapRestore),
                                            label: 'Contact Mai Ly',
                                            onClick: () => openLeadDrawer(
                                                'get_matching_homes',
                                                (savedListings.length > 0 ? savedListings : resultListings).slice(0, 5),
                                            ),
                                        }}
                                        count={savedIds.size}
                                        hasComparisonTray={comparisonView === 'tray'}
                                        isComparisonMinimized={comparisonView === 'minimized'}
                                        isMapDock
                                        onShowComparison={openComparisonTray}
                                        onShowSaved={showSavedHomes}
                                        savedCelebrationKey={savedCelebrationKey}
                                    />
                                </div>
                            ) : null}
                        </aside>
                    </div>
                ) : null}

                {!isMapDrawerOpen && !isMobileWorkspace ? (
                    <aside
                        className={`${styles.searchRail} property-search-summary-rail`}
                        aria-label="Map and listing status"
                    >
                        <div className={styles.mapPreviewCard}>
                            <span className={styles.mapPreviewLabel}>Map search</span>
                            {!hasRestoredStorage || bundleState !== 'ready' || pendingMapRestore ? (
                                <div className={styles.loadingPanel}>
                                    <PropertyLoadingMark label={pendingMapRestore ? 'Restoring shared map area' : 'Loading map'} />
                                </div>
                            ) : (
                                <button
                                    aria-label={`Open interactive map for ${formatNumber(resultListings.length)} matching homes`}
                                    className={styles.mapPreviewLaunch}
                                    onClick={openMapDrawer}
                                    ref={mapPreviewButtonRef}
                                    type="button"
                                >
                                    <Image
                                        alt=""
                                        className={styles.mapPreviewImage}
                                        height={715}
                                        sizes="18rem"
                                        src="/images/maps/massachusetts-search-overview.webp"
                                        width={672}
                                    />
                                    <span className={styles.mapPreviewCount}>
                                        {formatNumber(resultListings.length)} matching homes
                                    </span>
                                    <span className={styles.mapPreviewAction}>
                                        <strong>Open interactive map</strong>
                                        <small>Explore matching homes by location.</small>
                                    </span>
                                </button>
                            )}
                        </div>
                        <SavedHomesDock
                            comparisonCelebrationKey={comparisonCelebrationKey}
                            comparedCount={selectedListings.length}
                            contactAction={{
                                disabled: Boolean(pendingMapRestore),
                                label: 'Contact Mai Ly',
                                onClick: () => openLeadDrawer(
                                    'get_matching_homes',
                                    (savedListings.length > 0 ? savedListings : resultListings).slice(0, 5),
                                ),
                            }}
                            count={savedIds.size}
                            hasComparisonTray={comparisonView === 'tray'}
                            isComparisonMinimized={comparisonView === 'minimized'}
                            onShowComparison={openComparisonTray}
                            onShowSaved={showSavedHomes}
                            savedCelebrationKey={savedCelebrationKey}
                        />
                    </aside>
                ) : null}
            </div>

            {isMobileWorkspace && !isMapDrawerOpen && !gallery && !leadDrawer &&
                comparisonView !== 'full' && !isFilterSheetOpen ? (
                <MobileSearchCommandBar
                    activeView={comparisonView === 'tray'
                        ? 'compare'
                        : filters.savedOnly
                            ? 'saved'
                            : 'list'}
                    comparedCount={selectedListings.length}
                    mapButtonRef={mobileMapButtonRef}
                    mapDisabled={!hasRestoredStorage || bundleState !== 'ready' || Boolean(pendingMapRestore)}
                    onContact={contactFromMobileBar}
                    onShowComparison={showComparisonFromMobileBar}
                    onShowList={showListFromMobileBar}
                    onShowMap={openMapDrawer}
                    onShowSaved={showSavedFromMobileBar}
                    savedCount={savedIds.size}
                />
            ) : null}

            <div className={styles.sourceBar} aria-label="Listing source details">
                <span>Source: {bundle?.source ?? 'MLS Property Information Network, Inc.'}</span>
                {sourceUpdatedAt ? <span>Updated: {sourceUpdatedAt}</span> : null}
                <span>Homes for sale</span>
            </div>

            {bundle ? (
                <CompliancePanel bundle={bundle} />
            ) : null}

            {comparisonLimitMessage ? (
                <div className="property-search-comparison-limit" role="status">
                    <span>{comparisonLimitMessage}</span>
                    <button onClick={() => setComparisonLimitMessage('')} type="button">Dismiss</button>
                </div>
            ) : null}

            <ComparisonDrawer
                celebrationKey={comparisonCelebrationKey}
                onOpenListing={openListingFromComparison}
                onRemove={toggleCompared}
                onSend={() => openLeadDrawer('send_selected_homes', selectedListings)}
                selectedListings={selectedListings}
                view={comparisonView}
                onViewChange={changeComparisonView}
            />

            {gallery && !isDesktopMapDetail
                ? renderPhotoGallery('dialog', isMapDrawerOpen ? 'Back to map' : 'Close details')
                : null}

            {leadDrawer ? (
                <LeadDrawer
                    key={leadDrawer.instanceId}
                    action={leadDrawer.action}
                    bundle={bundle}
                    listings={leadDrawer.listings}
                    appointmentCta={appointmentCta}
                    contact={contact}
                    inquiry={inquiry}
                    privacyVersion={privacyVersion}
                    searchContext={leadDrawer.searchContext}
                    sourcePage={sourcePage}
                    termsVersion={termsVersion}
                    backLabel={savedIds.size > 0 ? 'Back to saved homes' : 'Back to search results'}
                    onClose={() => setLeadDrawer(null)}
                    onReturnToListings={returnFromLeadDrawer}
                    onStartAnother={() => openLeadDrawer(
                        'get_matching_homes',
                        [],
                        leadDrawer.searchContext,
                    )}
                />
            ) : null}
        </section>
    );
}
