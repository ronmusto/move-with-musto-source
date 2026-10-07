'use client';

import { useState } from 'react';
import type { CommercialSearchListing } from '@/lib/commercial-public-listings';
import type { RealEstateContact } from '@/lib/real-estate-profile';
import { buildMlsPhotoSet } from '@/lib/mls-public-listings';
import {
    businessRealEstateLabel, commercialAvailabilityLabels,
    commercialCategoryLabels, commercialListingSizeLabel,
} from '@/lib/commercial-search-filters';
import { formatNumber } from './commercial-presentation';
import buyerStyles from '../properties/PropertiesSearch.module.css';
import styles from './CommercialPropertiesSearch.module.css';

function firstPhotoUrl(listing: CommercialSearchListing) {
    return buildMlsPhotoSet(listing.listingNumber, listing.photoCount)[0]?.card ?? '';
}

function formatDecimal(value: number) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function quantityLabel(value: number, singular: string, plural: string) {
    return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
}

function positiveValue(value: number | null) {
    return value !== null && value > 0 ? value : null;
}

function listingAmountLabel(listing: CommercialSearchListing) {
    if (listing.category === 'business-opportunity') return 'Asking price';
    if (listing.availability === 'for-lease') return 'Listed lease amount';
    if (listing.availability === 'for-sale-or-lease') return 'Listed price / lease amount';
    return 'List price';
}

function listingAmountNote(listing: CommercialSearchListing) {
    if (listing.availability === 'for-lease') {
        return 'Lease rate basis is not provided in this export.';
    }
    if (listing.availability === 'for-sale-or-lease') {
        return 'Confirm sale and lease terms with Mai Ly.';
    }
    return null;
}

function listingSummaryFacts(listing: CommercialSearchListing) {
    const size = commercialListingSizeLabel(listing);
    const facts = [
        listing.availability ? {
            label: 'Offering',
            value: commercialAvailabilityLabels[listing.availability],
        } : null,
        listing.listingTypes[0] ? { label: 'Type', value: listing.listingTypes[0] } : null,
        size !== 'Size not provided' ? { label: 'Size', value: size } : null,
    ];
    return facts.filter((fact): fact is { label: string; value: string } => Boolean(fact)).slice(0, 3);
}

function listingSignals(listing: CommercialSearchListing) {
    const acreage = positiveValue(listing.facts.acreage);
    const sizeAlreadyUsesAcreage = positiveValue(listing.facts.buildingSqft) === null;
    const parking = positiveValue(listing.facts.parkingSpaces);
    const units = positiveValue(listing.facts.totalUnits);
    const stories = positiveValue(listing.facts.stories);
    const realEstate = businessRealEstateLabel(listing.category, listing.realEstateIncluded);
    return [
        acreage === null || sizeAlreadyUsesAcreage ? null : `${formatDecimal(acreage)} acres`,
        parking === null ? null : quantityLabel(parking, 'parking space', 'parking spaces'),
        units === null ? null : quantityLabel(units, 'total unit', 'total units'),
        stories === null ? null : quantityLabel(stories, 'story', 'stories'),
        realEstate,
    ].filter((label): label is string => Boolean(label));
}

function inquiryHref(listing: CommercialSearchListing, contact: RealEstateContact) {
    const subject = `Question about commercial listing ${listing.listingNumber}`;
    const body = [
        `Hi Mai Ly, I would like to ask about MLS #${listing.listingNumber}.`,
        `${listing.address.line}, ${listing.address.town}, ${listing.address.state} ${listing.address.zip}`,
    ].join('\n\n');
    return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function CommercialListingCard({
    contact,
    listing,
}: Readonly<{ contact: RealEstateContact; listing: CommercialSearchListing }>) {
    const [imageFailed, setImageFailed] = useState(false);
    const photoUrl = firstPhotoUrl(listing);
    const amountNote = listingAmountNote(listing);
    const signals = listingSignals(listing);

    return (
        <article className={buyerStyles.listingCard}>
            <div className={`${buyerStyles.listingImage} ${styles.commercialListingImage}`}>
                {photoUrl && !imageFailed ? (
                    // MLS PIN serves these public listing images dynamically by listing number.
                    // Native image preserves the reviewed listing photo URL.
                    <img
                        alt={`${listing.address.line}, ${listing.address.town}`}
                        loading="lazy"
                        onError={() => setImageFailed(true)}
                        src={photoUrl}
                    />
                ) : (
                    <div className={buyerStyles.photoFallback}>Image not provided</div>
                )}
                <span className={styles.categoryTag}>
                    {commercialCategoryLabels[listing.category]}
                </span>
                {listing.photoCount > 0 && !imageFailed ? (
                    <span className={styles.photoCount}>
                        {listing.photoCount} {listing.photoCount === 1 ? 'photo' : 'photos'}
                    </span>
                ) : null}
            </div>

            <div className={buyerStyles.listingBody}>
                <div className={`${buyerStyles.listingSummary} ${buyerStyles.listingCardSummary} ${styles.commercialListingSummary}`}>
                    <div className={styles.amountBlock}>
                        <span>{listingAmountLabel(listing)}</span>
                        <strong className={`${buyerStyles.listingPrice} ${styles.amountValue}`}>
                            {listing.priceLabel}
                        </strong>
                    </div>
                    <dl className={`${buyerStyles.listingFacts} ${styles.commercialSummaryFacts}`}>
                        {listingSummaryFacts(listing).map((fact) => (
                            <div key={`${fact.label}-${fact.value}`}>
                                <dt>{fact.label}</dt>
                                <dd>{fact.value}</dd>
                            </div>
                        ))}
                    </dl>
                    <span className={buyerStyles.listingStatusCorner}>{listing.status.label}</span>
                </div>

                <div className={buyerStyles.listingAddress}>
                    <h3>{listing.address.line}</h3>
                    <p>{listing.address.town}, {listing.address.state} {listing.address.zip}</p>
                </div>

                {amountNote ? <p className={styles.amountNote}>{amountNote}</p> : null}

                {signals.length > 0 ? (
                    <div className={styles.listingSignals} aria-label="Commercial listing facts">
                        {signals.map((signal) => <span key={signal}>{signal}</span>)}
                    </div>
                ) : null}

                <p className={buyerStyles.listingDisclosure}>
                    MLS #{listing.listingNumber} · Listed by {listing.attribution.listingAgent} ·
                    {' '}Listing office: {listing.attribution.listingOffice} · Source: {listing.source.name}
                </p>

                <div className={buyerStyles.cardActions}>
                    <a className={styles.inquiryButton} href={inquiryHref(listing, contact)}>
                        Ask about this listing
                    </a>
                </div>
            </div>
        </article>
    );
}
