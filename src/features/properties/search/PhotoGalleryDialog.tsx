'use client';

import { useAccessibleDialog } from '@/components/useAccessibleDialog';
import { currentMlsOpenHouses } from '@/lib/mls-open-house-time';
import { buildMlsPhotoSet, type MlsSearchListing } from '@/lib/mls-public-listings';
import { sanitizePublicHttpsUrl } from '@/lib/safe-external-url';
import { useEffect, useMemo, useState } from 'react';
import styles from '../PropertiesSearch.module.css';
import type { ListingDetailContent } from './listing-detail-validation';
import { ListingFactsAndFeatures } from './ListingFactsAndFeatures';
import { PropertyLoadingMark } from './PropertyLoadingMark';
import { formatBaths, formatListingUpdatedAt, formatNumber, formatOpenHouseRange } from './search-formatting';

function getNearbyPhotoIndexes(currentIndex: number, photoCount: number) {
    const visibleCount = Math.min(photoCount, 5);
    const startIndex = Math.min(Math.max(currentIndex - 2, 0), Math.max(photoCount - visibleCount, 0));

    return Array.from({ length: visibleCount }, (_, offset) => startIndex + offset);
}

function ListingActivitySummary({ dataUpdatedAt }: Readonly<{ dataUpdatedAt: string | null }>) {
    return (
        <section className={styles.listingActivitySummary} aria-label="Listing data freshness">
            <p><strong>Last updated:</strong> {formatListingUpdatedAt(dataUpdatedAt)}</p>
        </section>
    );
}

export function PhotoGalleryDialog({
    closeLabel,
    dataUpdatedAt,
    listing,
    detail,
    detailState,
    initialIndex,
    isSaved,
    isCompared,
    onClose,
    onContact,
    onRequestShowing,
    onRetryDetail,
    onToggleCompared,
    onToggleSaved,
    presentation,
}: Readonly<{
    closeLabel: string;
    dataUpdatedAt: string | null;
    listing: MlsSearchListing;
    detail?: ListingDetailContent;
    detailState: 'loading' | 'ready' | 'error';
    initialIndex: number;
    isSaved: boolean;
    isCompared: boolean;
    onClose: () => void;
    onContact: () => void;
    onRequestShowing: () => void;
    onRetryDetail: () => void;
    onToggleCompared: () => void;
    onToggleSaved: () => void;
    presentation: 'dialog' | 'workspace';
}>) {
    const isWorkspace = presentation === 'workspace';
    const dialogRef = useAccessibleDialog<HTMLElement>({
        active: !isWorkspace,
        onClose,
    });
    const photos = useMemo(
        () => buildMlsPhotoSet(listing.listingNumber, detail?.photoCount ?? listing.photoCount),
        [detail?.photoCount, listing.listingNumber, listing.photoCount],
    );
    const [photoIndex, setPhotoIndex] = useState(() => Math.min(initialIndex, Math.max(photos.length - 1, 0)));
    const [isAutoplaying, setIsAutoplaying] = useState(false);
    const [isPhotoDrawerOpen, setIsPhotoDrawerOpen] = useState(false);
    const [previousPhotoUrl, setPreviousPhotoUrl] = useState<string | null>(null);
    const [isPhotoLoaded, setIsPhotoLoaded] = useState(true);
    const [isRemarksExpanded, setIsRemarksExpanded] = useState(false);
    const [failedPhotoUrls, setFailedPhotoUrls] = useState<ReadonlySet<string>>(() => new Set());
    const photoDrawerRef = useAccessibleDialog<HTMLElement>({
        active: isPhotoDrawerOpen,
        onClose: () => setIsPhotoDrawerOpen(false),
    });
    const photo = photos[photoIndex] ?? photos[0];
    const activePhotoFailed = Boolean(photo && failedPhotoUrls.has(photo.detail));
    const nearbyPhotoIndexes = getNearbyPhotoIndexes(photoIndex, photos.length);
    const facts = detail?.facts ?? listing.facts;
    const openHouses = currentMlsOpenHouses(detail?.openHouses ?? []);
    const virtualTourUrl = sanitizePublicHttpsUrl(detail?.virtualTourUrl);
    const remarks = detail?.remarks || 'No listing description was provided.';
    const hasExpandableRemarks = detailState === 'ready' && remarks.length > 240;

    useEffect(() => {
        if (!isAutoplaying || photos.length < 2) {
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            setPreviousPhotoUrl(photos[photoIndex]?.detail ?? null);
            setIsPhotoLoaded(false);
            setPhotoIndex((photoIndex + 1) % photos.length);
        }, 4000);

        return () => window.clearTimeout(timeoutId);
    }, [isAutoplaying, photoIndex, photos]);

    useEffect(() => {
        setPhotoIndex((current) => Math.min(current, Math.max(photos.length - 1, 0)));
    }, [photos.length]);

    function movePhoto(direction: -1 | 1) {
        setIsAutoplaying(false);
        setPreviousPhotoUrl(photo?.detail ?? null);
        setIsPhotoLoaded(false);
        setPhotoIndex((photoIndex + direction + photos.length) % photos.length);
    }

    function toggleAutoplay() {
        if (!isAutoplaying && photos.length > 1) {
            setPreviousPhotoUrl(photo?.detail ?? null);
            setIsPhotoLoaded(false);
            setPhotoIndex((photoIndex + 1) % photos.length);
        }

        setIsAutoplaying((current) => !current);
    }

    function openPhoto(index: number, shouldCloseDrawer = false) {
        setIsAutoplaying(false);
        if (index !== photoIndex) {
            setPreviousPhotoUrl(photo?.detail ?? null);
            setIsPhotoLoaded(false);
            setPhotoIndex(index);
        }
        if (shouldCloseDrawer) {
            setIsPhotoDrawerOpen(false);
        }
    }

    return (
        <div className={isWorkspace ? styles.galleryWorkspaceSurface : styles.galleryBackdrop}>
            <section
                aria-label={`${isWorkspace ? 'Listing details' : 'Photos'} for ${listing.address.line}`}
                aria-modal={isWorkspace ? undefined : 'true'}
                className={`${styles.photoGallery} ${isWorkspace ? styles.photoGalleryWorkspace : ''}`}
                ref={dialogRef}
                role={isWorkspace ? 'region' : 'dialog'}
                tabIndex={isWorkspace ? -1 : undefined}
            >
                <div className={styles.galleryHeader}>
                    <div>
                        <p className={styles.eyebrow}>Listing details</p>
                        <span>
                            {photos.length > 0
                                ? `${photoIndex + 1} of ${photos.length} photos`
                                : 'No photos available'}{' '}
                            · MLS #{listing.listingNumber}
                        </span>
                    </div>
                    <button type="button" onClick={onClose}>{closeLabel}</button>
                </div>
                <div className={styles.galleryContent}>
                    <div className={styles.galleryListingSummary}>
                        <div className={styles.listingSummary}>
                            <strong className={styles.listingPrice}>{listing.priceLabel}</strong>
                            <span aria-label={`Status: ${listing.status.label}`} className={styles.listingStatusCorner}>
                                {listing.status.label}
                            </span>
                            <dl className={styles.listingFacts}>
                                <div><dt>Beds</dt><dd>{formatNumber(facts.beds)}</dd></div>
                                <div><dt>Baths</dt><dd>{formatBaths(facts)}</dd></div>
                                <div><dt>Sqft</dt><dd>{formatNumber(facts.sqft)}</dd></div>
                            </dl>
                        </div>
                        <div className={styles.listingAddress}>
                            <h3>{listing.address.line}</h3>
                            <p>{listing.address.town}, {listing.address.state} {listing.address.zip}</p>
                        </div>
                        <p className={styles.listingDisclosure}>
                            MLS #{listing.listingNumber} · {listing.propertyType}<br />
                            Listed by {listing.attribution.listingAgent}, {listing.attribution.listingOffice}
                        </p>
                        <ListingActivitySummary dataUpdatedAt={dataUpdatedAt} />
                    </div>
                    <aside className={styles.galleryCopyPane}>
                        {detailState === 'ready' && detail ? (
                            <ListingFactsAndFeatures
                                facts={detail.facts}
                                features={detail.features}
                                neighborhood={detail.address.neighborhood || detail.address.area || listing.address.town}
                                propertyType={listing.propertyType}
                            />
                        ) : null}
                        <div className={styles.galleryRemarksPanel}>
                            <p className={styles.eyebrow}>Listing description</p>
                            {detailState === 'loading' ? (
                                <PropertyLoadingMark label="Loading listing details" />
                            ) : null}
                            {detailState === 'error' ? (
                                <div>
                                    <p className={styles.galleryRemarks}>
                                        Some details are not showing right now. Try again or ask about this home.
                                    </p>
                                    <button onClick={onRetryDetail} type="button">Try again</button>
                                </div>
                            ) : null}
                            {detailState === 'ready' ? (
                                <p
                                    className={`${styles.galleryRemarks} ${!isRemarksExpanded && hasExpandableRemarks ? styles.galleryRemarksPreview : ''}`}
                                >
                                    {remarks}
                                </p>
                            ) : null}
                            {hasExpandableRemarks ? (
                                <button
                                    aria-expanded={isRemarksExpanded}
                                    className={styles.remarksToggle}
                                    onClick={() => setIsRemarksExpanded((current) => !current)}
                                    type="button"
                                >
                                    {isRemarksExpanded ? 'Show less' : 'Show more'}
                                </button>
                            ) : null}
                        </div>
                        <div className={styles.galleryActionBar}>
                            <button
                                className={styles.scheduleAppointmentButton}
                                onClick={onRequestShowing}
                                type="button"
                            >
                                Request a showing
                            </button>
                            <div className={styles.gallerySecondaryActions}>
                                <button aria-pressed={isSaved} onClick={onToggleSaved} type="button">
                                    {isSaved ? 'Saved home' : 'Save home'}
                                </button>
                                <button aria-pressed={isCompared} onClick={onToggleCompared} type="button">
                                    {isCompared ? 'In comparison' : 'Compare home'}
                                </button>
                                <button onClick={onContact} type="button">Ask about this home</button>
                            </div>
                        </div>
                        {openHouses.length > 0 ? (
                            <div className={styles.detailList}>
                                <span>Open houses</span>
                                {openHouses.map((openHouse) => (
                                    <p key={`${openHouse.start}-${openHouse.end}`}>
                                        {openHouse.type}: {formatOpenHouseRange(openHouse.start, openHouse.end)}
                                    </p>
                                ))}
                            </div>
                        ) : null}
                        {virtualTourUrl ? (
                            <a className={styles.textLink} href={virtualTourUrl} rel="noopener noreferrer" target="_blank">
                                Open virtual tour
                            </a>
                        ) : null}
                    </aside>
                    <div className={styles.galleryMediaPane}>
                        <div className={styles.galleryStage} aria-live="polite">
                            {photo && !activePhotoFailed ? (
                                <>
                                    {previousPhotoUrl ? (
                                        // Native image preserves the reviewed listing photo URL.
                                        <img
                                            alt=""
                                            aria-hidden="true"
                                            className={styles.galleryStagePreviousImage}
                                            onError={() => setPreviousPhotoUrl(null)}
                                            src={previousPhotoUrl}
                                        />
                                    ) : null}
                                    {/* Native image preserves the reviewed listing photo URL. */}
                                    <img
                                        alt={`${listing.address.line} photo ${photoIndex + 1} of ${photos.length}`}
                                        className={`${styles.galleryStageImage} ${isPhotoLoaded ? styles.galleryStageImageVisible : ''}`}
                                        key={photo.detail}
                                        onError={() => setFailedPhotoUrls((current) => new Set(current).add(photo.detail))}
                                        onLoad={() => setIsPhotoLoaded(true)}
                                        src={photo.detail}
                                    />
                                </>
                            ) : (
                                <div className={styles.galleryPhotoFallback}>Photo unavailable</div>
                            )}
                            {photos.length > 0 ? (
                                <div className={styles.galleryControls} aria-label="Photo slideshow controls">
                                    <div className={styles.galleryControlTab}>
                                        <button
                                            aria-label="Previous photo"
                                            disabled={photos.length < 2}
                                            onClick={() => movePhoto(-1)}
                                            type="button"
                                        >
                                            <span aria-hidden="true">‹</span>
                                        </button>
                                        <button
                                            aria-label={isAutoplaying ? 'Pause autoplay' : 'Start autoplay'}
                                            disabled={photos.length < 2}
                                            onClick={toggleAutoplay}
                                            type="button"
                                        >
                                            <span aria-hidden="true">{isAutoplaying ? '❚❚' : '▶'}</span>
                                        </button>
                                        <button
                                            aria-label="Next photo"
                                            disabled={photos.length < 2}
                                            onClick={() => movePhoto(1)}
                                            type="button"
                                        >
                                            <span aria-hidden="true">›</span>
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                        {photos.length > 0 ? (
                            <>
                                <div className={styles.galleryCompactStrip} aria-label="Nearby listing photos" tabIndex={0}>
                                    {nearbyPhotoIndexes.map((index) => {
                                        const thumbnailPhoto = photos[index];

                                        return (
                                            <button
                                                aria-label={`Open photo ${index + 1}`}
                                                className={index === photoIndex ? styles.activeThumbnail : ''}
                                                key={thumbnailPhoto.index}
                                                onClick={() => openPhoto(index)}
                                                type="button"
                                            >
                                                {failedPhotoUrls.has(thumbnailPhoto.thumbnail) ? (
                                                    <span className={styles.galleryPhotoFallback}>Photo unavailable</span>
                                                ) : (
                                                    /* Native image preserves the reviewed listing photo URL. */
                                                    <img
                                                        alt=""
                                                        decoding="async"
                                                        loading="lazy"
                                                        onError={() => setFailedPhotoUrls((current) => new Set(current).add(thumbnailPhoto.thumbnail))}
                                                        src={thumbnailPhoto.thumbnail}
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                    <button
                                        className={styles.viewAllPhotosButton}
                                        onClick={() => {
                                            setIsAutoplaying(false);
                                            setIsPhotoDrawerOpen(true);
                                        }}
                                        type="button"
                                    >
                                        View all photos
                                    </button>
                                </div>
                                {isPhotoDrawerOpen ? (
                                    <aside
                                        aria-label="All listing photos"
                                        aria-modal="true"
                                        className={styles.photoDrawer}
                                        ref={photoDrawerRef}
                                        role="dialog"
                                    >
                                        <div className={styles.photoDrawerHeader}>
                                            <div>
                                                <p className={styles.eyebrow}>All photos</p>
                                                <span>{photos.length} MLS photos</span>
                                            </div>
                                            <button
                                                className={styles.photoDrawerCloseButton}
                                                type="button"
                                                onClick={() => setIsPhotoDrawerOpen(false)}
                                            >
                                                Close photo drawer
                                            </button>
                                        </div>
                                        <div className={styles.photoDrawerGrid}>
                                            {photos.map((thumbnailPhoto, index) => (
                                                <button
                                                    aria-label={`Open photo ${index + 1} from all photos`}
                                                    className={[
                                                        styles.photoDrawerTile,
                                                        index === photoIndex ? styles.activeThumbnail : '',
                                                    ].filter(Boolean).join(' ')}
                                                    key={thumbnailPhoto.index}
                                                    onClick={() => openPhoto(index, true)}
                                                    type="button"
                                                >
                                                    {failedPhotoUrls.has(thumbnailPhoto.thumbnail) ? (
                                                        <span className={styles.galleryPhotoFallback}>Photo unavailable</span>
                                                    ) : (
                                                        /* Native image preserves the reviewed listing photo URL. */
                                                        <img
                                                            alt=""
                                                            decoding="async"
                                                            loading="lazy"
                                                            onError={() => setFailedPhotoUrls((current) => new Set(current).add(thumbnailPhoto.thumbnail))}
                                                            src={thumbnailPhoto.thumbnail}
                                                        />
                                                    )}
                                                    <span>{index + 1}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </aside>
                                ) : null}
                            </>
                        ) : null}
                    </div>
                </div>
            </section>
        </div>
    );
}
