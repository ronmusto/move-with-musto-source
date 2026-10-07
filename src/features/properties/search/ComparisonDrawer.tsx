'use client';

import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import { getMlsPhotoUrl, type MlsSearchListing } from '@/lib/mls-public-listings';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from '../PropertiesSearch.module.css';
import { formatBaths, formatNumber } from './search-formatting';
import { ComparisonView } from './search-types';
import { DockCheers } from './SearchDocks';

function comparisonValue(value: number | null | undefined) {
    return value === null || value === undefined ? '—' : formatNumber(value);
}

function pricePerSquareFoot(listing: MlsSearchListing) {
    if (!listing.listPrice || !listing.facts.sqft) {
        return '—';
    }

    return `$${Math.round(listing.listPrice / listing.facts.sqft).toLocaleString()}`;
}

export function ComparisonDrawer({
    celebrationKey,
    selectedListings,
    view,
    onViewChange,
    onOpenListing,
    onRemove,
    onSend,
}: Readonly<{
    celebrationKey: number;
    selectedListings: MlsSearchListing[];
    view: ComparisonView;
    onViewChange: (view: ComparisonView) => void;
    onOpenListing: (listing: MlsSearchListing) => void;
    onRemove: (id: string) => void;
    onSend: () => void;
}>) {
    const count = selectedListings.length;
    const fullDialogRef = useRef<HTMLElement>(null);
    const fullComparisonTriggerRef = useRef<HTMLButtonElement>(null);
    const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
    const previousViewRef = useRef(view);
    const [failedPhotoListingNumbers, setFailedPhotoListingNumbers] = useState<ReadonlySet<string>>(
        () => new Set(),
    );

    useAccessibleDialog({
        active: view === 'full',
        dialogRef: fullDialogRef,
        onClose: () => onViewChange('tray'),
    });

    useEffect(() => {
        if (count === 0 && view !== 'minimized') {
            onViewChange('minimized');
        }
        if (count < 2 && view === 'full') {
            onViewChange('tray');
        }
    }, [count, onViewChange, view]);

    useEffect(() => {
        const previousView = previousViewRef.current;
        previousViewRef.current = view;

        if (previousView === 'full' && view === 'tray') {
            if (count >= 2) {
                fullComparisonTriggerRef.current?.focus();
            } else {
                const remainingListingNumber = selectedListings[0]?.listingNumber;
                window.requestAnimationFrame(() => {
                    const remainingRemove = remainingListingNumber
                        ? removeButtonRefs.current.get(remainingListingNumber)
                        : null;
                    const resultsRegion = document.querySelector<HTMLElement>(
                        '[aria-label="Property search results"]',
                    );
                    (remainingRemove ?? resultsRegion)?.focus();
                });
            }
        }
    }, [count, selectedListings, view]);

    function removeListing(listingNumber: string) {
        const currentIndex = selectedListings.findIndex((listing) => listing.listingNumber === listingNumber);
        const remainingListings = selectedListings.filter((listing) => listing.listingNumber !== listingNumber);
        const focusTarget = remainingListings[Math.min(currentIndex, remainingListings.length - 1)] ?? null;

        onRemove(listingNumber);
        window.setTimeout(() => {
            if (focusTarget) {
                removeButtonRefs.current.get(focusTarget.listingNumber)?.focus();
            } else {
                const compareDock = document.querySelector<HTMLButtonElement>('[aria-label^="Compare homes,"]');
                const resultsRegion = document.querySelector<HTMLElement>('[aria-label="Property search results"]');
                (compareDock ?? resultsRegion)?.focus();
            }
        }, 0);
    }

    if (count === 0 || view === 'minimized') {
        return null;
    }

    const comparisonRows = [
        {
            label: 'Price',
            values: selectedListings.map((listing) => listing.priceLabel),
        },
        {
            label: 'Price / sqft',
            values: selectedListings.map(pricePerSquareFoot),
        },
        {
            label: 'Location',
            values: selectedListings.map((listing) => `${listing.address.town}, ${listing.address.state}`),
        },
        {
            label: 'Bedrooms',
            values: selectedListings.map((listing) => comparisonValue(listing.facts.beds)),
        },
        {
            label: 'Bathrooms',
            values: selectedListings.map((listing) => formatBaths(listing.facts)),
        },
        {
            label: 'Interior',
            values: selectedListings.map((listing) =>
                listing.facts.sqft ? `${formatNumber(listing.facts.sqft)} sqft` : '—',
            ),
        },
        {
            label: 'Home type',
            values: selectedListings.map((listing) => listing.propertyType || '—'),
        },
        {
            label: 'Open house',
            values: selectedListings.map((listing) =>
                listing.openHouseCount > 0
                    ? `${listing.openHouseCount} scheduled`
                    : '—',
            ),
        },
        {
            label: 'Virtual tour',
            values: selectedListings.map((listing) => listing.hasVirtualTour ? 'Available' : '—'),
        },
        {
            label: 'MLS number',
            values: selectedListings.map((listing) => listing.listingNumber),
        },
    ];

    return (
        <aside
            aria-label={view === 'full' ? undefined : 'Home comparison drawer'}
            aria-labelledby={view === 'full' ? 'home-comparison-title' : undefined}
            aria-modal={view === 'full' ? 'true' : undefined}
            className={`${styles.comparisonDrawer} ${view === 'full' ? styles.comparisonDrawerFull : ''}`}
            ref={fullDialogRef}
            role={view === 'full' ? 'dialog' : 'complementary'}
        >
            {celebrationKey > 0 && view === 'tray' ? (
                <span className={styles.comparisonDrawerCheers} key={celebrationKey} aria-hidden="true">
                    <DockCheers />
                </span>
            ) : null}
            <div className={styles.comparisonDrawerHeader}>
                <div>
                    <p className={styles.eyebrow}>Home comparison</p>
                    <h3 id="home-comparison-title">{view === 'full' ? 'Compare your homes' : `${count} ${count === 1 ? 'home' : 'homes'} selected`}</h3>
                </div>
                <div className={styles.comparisonDrawerControls}>
                    {view === 'tray' ? (
                        <button
                            className={styles.comparisonDetailsButton}
                            disabled={count < 2}
                            onClick={() => onViewChange('full')}
                            ref={fullComparisonTriggerRef}
                            type="button"
                        >
                            <span className={styles.comparisonDetailsLong}>Compare details</span>
                            <span className={styles.comparisonDetailsShort}>Details</span>
                        </button>
                    ) : (
                        <button onClick={() => onViewChange('tray')} type="button">
                            Back to selected homes
                        </button>
                    )}
                    <button
                        aria-label="Minimize comparison"
                        className={styles.comparisonMinimizeButton}
                        onClick={() => onViewChange('minimized')}
                        type="button"
                    >
                        <span aria-hidden="true">−</span>
                    </button>
                </div>
            </div>

            {view === 'tray' ? (
                <div className={styles.comparisonTrayBody}>
                    <div className={styles.comparisonTrayList}>
                        {selectedListings.map((listing) => {
                            const photoUrl = listing.photoCount > 0
                                ? getMlsPhotoUrl(listing.listingNumber, 0, 'thumbnail')
                                : null;

                            return (
                                <article className={styles.comparisonTrayCard} key={listing.listingNumber}>
                                    {photoUrl && !failedPhotoListingNumbers.has(listing.listingNumber) ? (
                                        // Native image preserves the reviewed listing photo URL.
                                        <img
                                            alt=""
                                            loading="lazy"
                                            onError={() => setFailedPhotoListingNumbers((current) => (
                                                new Set(current).add(listing.listingNumber)
                                            ))}
                                            src={photoUrl}
                                        />
                                    ) : <div className={styles.photoFallback}>Photo unavailable</div>}
                                    <div>
                                        <strong>{listing.priceLabel}</strong>
                                        <h4>{listing.address.line}</h4>
                                        <p>
                                            {comparisonValue(listing.facts.beds)} bd · {formatBaths(listing.facts)} ba ·{' '}
                                            {comparisonValue(listing.facts.sqft)} sqft
                                        </p>
                                        <button onClick={() => onOpenListing(listing)} type="button">
                                            View details
                                        </button>
                                    </div>
                                    <button
                                        aria-label={`Remove ${listing.address.line} from comparison`}
                                        className={styles.comparisonRemoveButton}
                                        onClick={() => removeListing(listing.listingNumber)}
                                        ref={(button) => {
                                            if (button) removeButtonRefs.current.set(listing.listingNumber, button);
                                            else removeButtonRefs.current.delete(listing.listingNumber);
                                        }}
                                        type="button"
                                    >
                                        ×
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                    <div className={styles.comparisonTrayActions}>
                        <p>Choose more homes from the results to compare side by side.</p>
                        <button onClick={onSend} type="button">
                            Send {count} selected {count === 1 ? 'home' : 'homes'} to Mai Ly
                        </button>
                    </div>
                </div>
            ) : (
                <div className={styles.fullComparisonBody}>
                    <div
                        aria-label="Selected home comparison"
                        className={styles.fullComparisonTable}
                        role="table"
                        style={{ '--comparison-count': count } as CSSProperties}
                    >
                        <div className={styles.fullComparisonHeader} role="row">
                            <div className={styles.fullComparisonCorner} role="columnheader">Compare</div>
                            {selectedListings.map((listing, index) => (
                                <article
                                    className={styles.fullComparisonHome}
                                    key={listing.listingNumber}
                                    role="columnheader"
                                    style={{ gridColumn: index + 2 }}
                                >
                                    <span>MLS #{listing.listingNumber}</span>
                                    <h4>{listing.address.line}</h4>
                                    <p>{listing.address.town}, {listing.address.state}</p>
                                    <div>
                                        <button onClick={() => onOpenListing(listing)} type="button">View details</button>
                                        <button
                                            aria-label={`Remove ${listing.address.line} from comparison`}
                                            onClick={() => removeListing(listing.listingNumber)}
                                            ref={(button) => {
                                                if (button) removeButtonRefs.current.set(listing.listingNumber, button);
                                                else removeButtonRefs.current.delete(listing.listingNumber);
                                            }}
                                            type="button"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </article>
                            ))}
                        </div>
                        {comparisonRows.map((row) => (
                            <div className={styles.fullComparisonRow} key={row.label} role="row">
                                <strong role="rowheader">{row.label}</strong>
                                {row.values.map((value, index) => (
                                    <span key={`${selectedListings[index].listingNumber}-${row.label}`} role="cell">
                                        {value}
                                    </span>
                                ))}
                            </div>
                        ))}
                    </div>
                    <div className={styles.comparisonContactCard}>
                        <div>
                            <p className={styles.eyebrow}>Want a second opinion?</p>
                            <h4>Get a second opinion on how these homes compare in real life.</h4>
                            <p>Talk through condition, location, timing, and the questions the listing data cannot answer.</p>
                        </div>
                        <button onClick={onSend} type="button">
                            Send {count} compared {count === 1 ? 'home' : 'homes'} to Mai Ly
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}
