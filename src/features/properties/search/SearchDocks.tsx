'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import styles from '../PropertiesSearch.module.css';
import { MobileSearchView } from './search-types';

export function MobileSearchCommandBar({
    activeView,
    comparedCount,
    isMapOpen = false,
    mapButtonRef,
    mapDisabled,
    onContact,
    onShowComparison,
    onShowList,
    onShowMap,
    onShowSaved,
    savedCount,
}: Readonly<{
    activeView: MobileSearchView;
    comparedCount: number;
    isMapOpen?: boolean;
    mapButtonRef?: RefObject<HTMLButtonElement | null>;
    mapDisabled: boolean;
    onContact: () => void;
    onShowComparison: () => void;
    onShowList: () => void;
    onShowMap: () => void;
    onShowSaved: () => void;
    savedCount: number;
}>) {
    return (
        <nav
            aria-label="Mobile property search actions"
            className={`${styles.mobileCommandBar} ${isMapOpen ? styles.mobileCommandBarOnMap : ''}`}
        >
            <button
                aria-label="Show property list"
                aria-pressed={activeView === 'list'}
                className={activeView === 'list' ? styles.mobileCommandBarActive : undefined}
                onClick={onShowList}
                type="button"
            >
                <svg aria-hidden="true" className={styles.mobileCommandBarIcon} viewBox="0 0 24 24">
                    <path d="M5 7h14M5 12h14M5 17h14" />
                </svg>
                <span>List</span>
            </button>
            <button
                aria-label="Show property map"
                aria-pressed={activeView === 'map'}
                className={activeView === 'map' ? styles.mobileCommandBarActive : undefined}
                disabled={mapDisabled}
                onClick={onShowMap}
                ref={mapButtonRef}
                type="button"
            >
                <svg aria-hidden="true" className={styles.mobileCommandBarIcon} viewBox="0 0 24 24">
                    <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" />
                    <circle cx="12" cy="10" r="2.2" />
                </svg>
                <span>Map</span>
            </button>
            <button
                aria-label={`Show saved homes, ${savedCount} saved`}
                aria-pressed={activeView === 'saved'}
                className={activeView === 'saved' ? styles.mobileCommandBarActive : undefined}
                onClick={onShowSaved}
                type="button"
            >
                <svg aria-hidden="true" className={styles.mobileCommandBarIcon} viewBox="0 0 24 24">
                    <path d="M20.8 8.2c0 5-8.8 10.4-8.8 10.4S3.2 13.2 3.2 8.2A4.7 4.7 0 0 1 12 5.8a4.7 4.7 0 0 1 8.8 2.4Z" />
                </svg>
                <span>Saved</span>
                <strong aria-hidden="true">{savedCount}</strong>
            </button>
            <button
                aria-label={`Compare homes, ${comparedCount} selected`}
                aria-pressed={activeView === 'compare'}
                className={activeView === 'compare' ? styles.mobileCommandBarActive : undefined}
                disabled={comparedCount === 0}
                onClick={onShowComparison}
                type="button"
            >
                <svg aria-hidden="true" className={styles.mobileCommandBarIcon} viewBox="0 0 24 24">
                    <rect height="14" rx="1.5" width="7" x="3" y="5" />
                    <rect height="14" rx="1.5" width="7" x="14" y="5" />
                </svg>
                <span>Compare</span>
                <strong aria-hidden="true">{comparedCount}</strong>
            </button>
            <button
                aria-label="Contact Mai Ly"
                aria-pressed={activeView === 'contact'}
                className={activeView === 'contact' ? styles.mobileCommandBarActive : undefined}
                onClick={onContact}
                type="button"
            >
                <svg aria-hidden="true" className={styles.mobileCommandBarIcon} viewBox="0 0 24 24">
                    <path d="M5 5.5h14v10H9l-4 3v-13Z" />
                </svg>
                <span>Contact</span>
            </button>
        </nav>
    );
}

export function SavedHomesDock({
    comparisonCelebrationKey,
    comparedCount,
    contactAction,
    count,
    hasComparisonTray,
    isComparisonMinimized,
    isMapDock = false,
    onShowComparison,
    onShowSaved,
    savedCelebrationKey,
}: Readonly<{
    comparisonCelebrationKey: number;
    comparedCount: number;
    contactAction?: {
        disabled: boolean;
        label: string;
        onClick: () => void;
    };
    count: number;
    hasComparisonTray: boolean;
    isComparisonMinimized: boolean;
    isMapDock?: boolean;
    onShowComparison: () => void;
    onShowSaved: () => void;
    savedCelebrationKey: number;
}>) {
    const dockRef = useRef<HTMLDivElement>(null);
    const [isFooterVisible, setIsFooterVisible] = useState(false);

    useEffect(() => {
        if (isMapDock) {
            return undefined;
        }

        const footer = document.querySelector<HTMLElement>('footer');
        if (!footer || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }

        const observer = new IntersectionObserver(([entry]) => {
            const nextFooterVisible = Boolean(entry?.isIntersecting);
            if (nextFooterVisible && dockRef.current?.contains(document.activeElement)) {
                footer.querySelector<HTMLElement>('a, button, [tabindex]:not([tabindex="-1"])')
                    ?.focus({ preventScroll: true });
            }
            setIsFooterVisible(nextFooterVisible);
        }, { threshold: 0.01 });
        observer.observe(footer);
        return () => observer.disconnect();
    }, [isMapDock]);

    if (!isMapDock && count === 0 && comparedCount === 0 && !contactAction) {
        return null;
    }

    const showComparisonAction = isComparisonMinimized && comparedCount > 0;
    const hasCollectionDock = isMapDock || count > 0 || comparedCount > 0;

    const collectionDock = hasCollectionDock ? (
        <div
            className={[
                styles.savedHomesDock,
                showComparisonAction ? styles.savedHomesDockWithComparison : '',
                hasComparisonTray ? styles.savedHomesDockRaised : '',
                isMapDock ? styles.savedHomesDockOnMap : '',
                contactAction ? styles.savedHomesDockInStack : '',
            ].filter(Boolean).join(' ')}
            aria-label="Saved and compared homes"
            aria-live="polite"
            hidden={!contactAction && !isMapDock && isFooterVisible}
            ref={contactAction ? undefined : dockRef}
        >
            {showComparisonAction ? (
                <button
                    aria-expanded="false"
                    aria-label={`Compare homes, ${comparedCount} selected`}
                    className={styles.comparisonFolderTab}
                    onClick={onShowComparison}
                    type="button"
                >
                    <span className={styles.compareHomesIcon} aria-hidden="true">
                        <svg focusable="false" viewBox="0 0 24 24">
                            <path d="M5 5.5h5.5v13H5z" />
                            <path d="M13.5 5.5H19v13h-5.5z" />
                            <path d="M10.5 8.3h3" />
                            <path d="M10.5 15.7h3" />
                        </svg>
                    </span>
                    <span className={styles.dockLabel}>
                        <span className={styles.dockLabelLong}>Compare homes</span>
                        <span className={styles.dockLabelShort}>Compare</span>
                    </span>
                    <strong>{comparedCount}</strong>
                    {comparisonCelebrationKey > 0 ? (
                        <DockCheers key={`compare-${comparisonCelebrationKey}`} />
                    ) : null}
                </button>
            ) : null}
            <button
                aria-label={`Show saved homes, ${count} saved`}
                className={styles.savedHomesButton}
                onClick={onShowSaved}
                type="button"
            >
                <span className={styles.savedHomesIcon} aria-hidden="true">
                    <svg focusable="false" viewBox="0 0 24 24">
                        <path d="M7 8V6.8A3.2 3.2 0 0 1 10.2 3.6h3.6A3.2 3.2 0 0 1 17 6.8V8" />
                        <path d="M4.5 8.2h15l-1 11.2h-13z" />
                        <path d="M12 16.9s-4-2.25-4-5a2.15 2.15 0 0 1 4-1.08A2.15 2.15 0 0 1 16 11.9c0 2.75-4 5-4 5Z" />
                    </svg>
                </span>
                <span className={styles.dockLabel}>
                    <span className={styles.dockLabelLong}>Saved homes</span>
                    <span className={styles.dockLabelShort}>Saved</span>
                </span>
                <strong>{count}</strong>
                {savedCelebrationKey > 0 ? <DockCheers key={`saved-${savedCelebrationKey}`} /> : null}
            </button>
        </div>
    ) : null;

    if (contactAction) {
        return (
            <div
                aria-label="Search contact and home collections"
                className={styles.savedHomesDockStack}
                hidden={hasComparisonTray || isFooterVisible}
                ref={dockRef}
                role="group"
            >
                <button
                    className={styles.searchHelpDockButton}
                    disabled={contactAction.disabled}
                    onClick={contactAction.onClick}
                    type="button"
                >
                    {contactAction.label}
                </button>
                {collectionDock}
            </div>
        );
    }

    return collectionDock;
}

export function DockCheers() {
    return (
        <span className={styles.savedCheers} aria-hidden="true">
            {Array.from({ length: 10 }, (_, index) => (
                <i key={index} />
            ))}
        </span>
    );
}
