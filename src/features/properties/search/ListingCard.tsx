'use client';

import { getMlsPhotoUrl, type MlsSearchListing } from '@/lib/mls-public-listings';
import { useState } from 'react';
import styles from '../PropertiesSearch.module.css';
import { formatBaths, formatNumber, listingTitle } from './search-formatting';

type ListingCardProps = Readonly<{
    listing: MlsSearchListing;
    isSaved: boolean;
    isCompared: boolean;
    onToggleSaved: (id: string) => void;
    onToggleCompared: (id: string) => void;
    onOpenGallery: (listing: MlsSearchListing, index: number) => void;
    savedButtonRef: (id: string, button: HTMLButtonElement | null) => void;
}>;

export function ListingCard({
    listing,
    isSaved,
    isCompared,
    onToggleSaved,
    onToggleCompared,
    onOpenGallery,
    savedButtonRef,
}: ListingCardProps) {
    const photoUrl = listing.photoCount > 0
        ? getMlsPhotoUrl(listing.listingNumber, 0, 'card')
        : null;
    const [hasPhotoError, setHasPhotoError] = useState(false);

    return (
        <article className={styles.listingCard}>
            {photoUrl && !hasPhotoError ? (
                <button
                    aria-label={`Open photos for ${listing.address.line}`}
                    className={`${styles.listingImage} ${styles.listingImageButton}`}
                    onClick={() => onOpenGallery(listing, 0)}
                    type="button"
                >
                    {/* Native image preserves the reviewed listing photo URL. */}
                    <img
                        alt={`${listingTitle(listing)} property photo`}
                        decoding="async"
                        loading="lazy"
                        onError={() => setHasPhotoError(true)}
                        src={photoUrl}
                    />
                    <span>{listing.photoCount} {listing.photoCount === 1 ? 'photo' : 'photos'}</span>
                </button>
            ) : (
                <div className={styles.listingImage}>
                    <div className={styles.photoFallback}>Photo unavailable</div>
                </div>
            )}
            <div className={styles.listingBody}>
                <div className={`${styles.listingSummary} ${styles.listingCardSummary}`}>
                    <strong className={styles.listingPrice}>{listing.priceLabel}</strong>
                    <span aria-label={`Status: ${listing.status.label}`} className={styles.listingStatusCorner}>
                        {listing.status.label}
                    </span>
                    <dl className={styles.listingFacts}>
                        <div><dt>Beds</dt><dd>{formatNumber(listing.facts.beds)}</dd></div>
                        <div><dt>Baths</dt><dd>{formatBaths(listing.facts)}</dd></div>
                        <div><dt>Sqft</dt><dd>{formatNumber(listing.facts.sqft)}</dd></div>
                    </dl>
                </div>
                <div className={styles.listingAddress}>
                    <h3>{listing.address.line}</h3>
                    <p>{listing.address.town}, {listing.address.state} {listing.address.zip}</p>
                </div>
                {listing.openHouseCount > 0 || listing.hasVirtualTour ? (
                    <div className={styles.listingSignals}>
                        {listing.openHouseCount > 0 ? (
                            <span>{listing.openHouseCount} open {listing.openHouseCount === 1 ? 'house' : 'houses'}</span>
                        ) : null}
                        {listing.hasVirtualTour ? <span>Virtual tour</span> : null}
                    </div>
                ) : null}
                <p className={styles.listingDisclosure}>
                    MLS #{listing.listingNumber} · {listing.propertyType}<br />
                    Listed by {listing.attribution.listingAgent}, {listing.attribution.listingOffice}
                </p>
                <div className={styles.cardActions}>
                    <button
                        aria-pressed={isSaved}
                        className={isSaved ? styles.savedButtonActive : styles.savedButton}
                        onClick={() => onToggleSaved(listing.listingNumber)}
                        ref={(button) => savedButtonRef(listing.listingNumber, button)}
                        type="button"
                    >
                        {isSaved ? 'Saved' : 'Save'}
                    </button>
                    <button
                        aria-pressed={isCompared}
                        className={isCompared ? styles.compareButtonActive : styles.compareButton}
                        onClick={() => onToggleCompared(listing.listingNumber)}
                        type="button"
                    >
                        {isCompared ? 'In comparison' : 'Compare home'}
                    </button>
                    <button className={styles.detailsButton} type="button" onClick={() => onOpenGallery(listing, 0)}>
                        View details
                    </button>
                </div>
            </div>
        </article>
    );
}
