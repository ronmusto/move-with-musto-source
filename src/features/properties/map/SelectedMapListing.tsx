'use client';

import type { CSSProperties, Ref } from 'react';
import { getMlsPhotoUrl, type MlsSearchListing } from '@/lib/mls-public-listings';
import { listingAddress } from './listing-presentation';
import styles from '../PropertiesSearch.module.css';

export type MapCardAnchor = Readonly<{ left: number; side: 'left' | 'right'; top: number }>;

type Props = Readonly<{
    activeListing: MlsSearchListing;
    selectedCardRef: Ref<HTMLElement>;
    selectedCardAnchor: MapCardAnchor | null;
    isPhotoFailed: boolean;
    isActiveListingSaved: boolean;
    isActiveListingCompared: boolean;
    onPhotoError: () => void;
    dismissSelectedListing: () => void;
    onToggleSaved?: (listingNumber: string) => void;
    onToggleCompared?: (listingNumber: string) => void;
    onOpenListing?: (listing: MlsSearchListing) => void;
}>;

function formatFact(value: number | null, suffix: string) {
    return value === null ? null : `${value.toLocaleString('en-US')} ${suffix}`;
}

export function SelectedMapListing({
    activeListing, selectedCardRef, selectedCardAnchor, isPhotoFailed,
    isActiveListingSaved, isActiveListingCompared, onPhotoError,
    dismissSelectedListing, onToggleSaved, onToggleCompared, onOpenListing,
}: Props) {
    const activePhotoUrl = activeListing.photoCount > 0 &&
        !isPhotoFailed
        ? getMlsPhotoUrl(activeListing.listingNumber, 0, 'card')
        : null;
    const activeFacts = [
        formatFact(activeListing.facts.beds, activeListing.facts.beds === 1 ? 'bed' : 'beds'),
        activeListing.facts.bathsLabel ? `${activeListing.facts.bathsLabel} baths` : null,
        formatFact(activeListing.facts.sqft, 'sq ft'),
    ].filter((fact): fact is string => Boolean(fact));
    return (
        <article
            aria-label={`Selected home: ${listingAddress(activeListing)}`}
            aria-live="polite"
            className={styles.mapSelectedCard}
            data-anchor-side={selectedCardAnchor?.side}
            ref={selectedCardRef}
            style={selectedCardAnchor ? {
                '--map-card-left': `${selectedCardAnchor.left}px`,
                '--map-card-top': `${selectedCardAnchor.top}px`,
            } as CSSProperties : undefined}
            tabIndex={-1}
        >
            <div className={styles.mapSelectedPhoto}>
                {activePhotoUrl ? (
                    // Native image preserves the reviewed listing photo URL.
                    <img
                        alt={`${listingAddress(activeListing)} property`}
                        decoding="async"
                        onError={onPhotoError}
                        src={activePhotoUrl}
                    />
                ) : (
                    <span className={styles.mapSelectedPhotoFallback}>Photo unavailable</span>
                )}
            </div>
            <div className={styles.mapSelectedBody}>
                <div className={styles.mapSelectedHeading}>
                    <div>
                        <span className={styles.mapSelectedStatus}>{activeListing.status.label}</span>
                        <strong>{activeListing.priceLabel}</strong>
                    </div>
                    <button
                        aria-label="Dismiss selected home"
                        className={styles.mapSelectedDismiss}
                        onClick={dismissSelectedListing}
                        type="button"
                    >
                        &times;
                    </button>
                </div>
                <p className={styles.mapSelectedAddress}>{listingAddress(activeListing)}</p>
                {activeFacts.length > 0 ? (
                    <p className={styles.mapSelectedFacts}>{activeFacts.join(' \u00b7 ')}</p>
                ) : null}
                <p className={styles.mapSelectedSignals}>
                    {activeListing.photoCount} {activeListing.photoCount === 1 ? 'photo' : 'photos'}
                    {activeListing.openHouseCount > 0
                        ? ` \u00b7 ${activeListing.openHouseCount} open ${activeListing.openHouseCount === 1 ? 'house' : 'houses'}`
                        : ''}
                </p>
                <p className={styles.mapSelectedAttribution}>
                    Listed by {activeListing.attribution.listingAgent}
                    {' \u00b7 '}{activeListing.attribution.listingOffice}
                    {' \u00b7 '}{activeListing.source.name}
                </p>
                <div className={styles.mapSelectedActions}>
                    {onToggleSaved ? (
                        <button
                            aria-pressed={isActiveListingSaved}
                            className={styles.mapSelectedSave}
                            onClick={() => onToggleSaved(activeListing.listingNumber)}
                            type="button"
                        >
                            {isActiveListingSaved ? 'Saved' : 'Save'}
                        </button>
                    ) : null}
                    {onToggleCompared ? (
                        <button
                            aria-pressed={isActiveListingCompared}
                            className={styles.mapSelectedCompare}
                            onClick={() => onToggleCompared(activeListing.listingNumber)}
                            type="button"
                        >
                            {isActiveListingCompared ? 'In comparison' : 'Compare'}
                        </button>
                    ) : null}
                    {onOpenListing ? (
                        <button
                            className={styles.mapSelectedDetails}
                            onClick={() => onOpenListing(activeListing)}
                            type="button"
                        >
                            Details
                        </button>
                    ) : null}
                </div>
            </div>
        </article>
    );
}
