'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import buyerStyles from '../properties/PropertiesSearch.module.css';
import styles from './CommercialPropertiesSearch.module.css';

type CommunityComboboxProps = Readonly<{
    actionLabel: 'Include' | 'Exclude';
    label: string;
    onQueryChange: (query: string) => void;
    onSelect: (community: string) => void;
    query: string;
    totalTownCount: number;
    towns: readonly string[];
}>;

export function CommunityCombobox({
    actionLabel,
    label,
    onQueryChange,
    onSelect,
    query,
    totalTownCount,
    towns,
}: CommunityComboboxProps) {
    const listboxId = useId();
    const helpId = useId();
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const normalizedQuery = query.trim().toLocaleLowerCase('en-US');
    const matchingTowns = useMemo(() => {
        if (!normalizedQuery) return [];
        return towns
            .filter((town) => town.toLocaleLowerCase('en-US').includes(normalizedQuery))
            .sort((left, right) => {
                const leftStartsWith = left.toLocaleLowerCase('en-US').startsWith(normalizedQuery);
                const rightStartsWith = right.toLocaleLowerCase('en-US').startsWith(normalizedQuery);
                return Number(rightStartsWith) - Number(leftStartsWith) || left.localeCompare(right);
            })
            .slice(0, 6);
    }, [normalizedQuery, towns]);

    useEffect(() => {
        setActiveIndex(isOpen && matchingTowns.length > 0 ? 0 : -1);
    }, [isOpen, matchingTowns]);

    function selectTown(town: string) {
        setIsOpen(false);
        onQueryChange('');
        onSelect(town);
    }

    function handleQueryChange(nextQuery: string) {
        onQueryChange(nextQuery);
        setIsOpen(Boolean(nextQuery.trim()));
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
            onQueryChange('');
            return;
        }

        if (matchingTowns.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => current < matchingTowns.length - 1 ? current + 1 : 0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((current) => current > 0 ? current - 1 : matchingTowns.length - 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setActiveIndex(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setActiveIndex(matchingTowns.length - 1);
        } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            selectTown(matchingTowns[activeIndex]);
        }
    }

    const showOptions = isOpen && matchingTowns.length > 0;

    return (
        <div className={styles.communityCombobox}>
            <label htmlFor={`${listboxId}-input`}>
                <span>{label}</span>
            </label>
            <input
                aria-activedescendant={showOptions && activeIndex >= 0
                    ? `${listboxId}-${activeIndex}`
                    : undefined}
                aria-autocomplete="list"
                aria-controls={showOptions ? listboxId : undefined}
                aria-describedby={showOptions ? undefined : helpId}
                aria-expanded={showOptions}
                aria-haspopup="listbox"
                aria-label={`Search communities to ${actionLabel.toLowerCase()}`}
                autoComplete="off"
                id={`${listboxId}-input`}
                onBlur={() => setIsOpen(false)}
                onChange={(event) => handleQueryChange(event.currentTarget.value)}
                onFocus={() => setIsOpen(Boolean(query.trim()))}
                onKeyDown={handleKeyDown}
                placeholder={`Search ${totalTownCount} communities`}
                role="combobox"
                type="search"
                value={query}
            />

            {showOptions ? (
                <div
                    aria-label={`Communities to ${actionLabel.toLowerCase()}`}
                    className={`${buyerStyles.townRuleResults} ${styles.communityResults}`}
                    id={listboxId}
                    role="listbox"
                >
                    {matchingTowns.map((town, index) => (
                        <button
                            aria-label={`${actionLabel} ${town}`}
                            aria-selected={index === activeIndex}
                            className={buyerStyles.townRuleOptionButton}
                            id={`${listboxId}-${index}`}
                            key={town}
                            onClick={() => selectTown(town)}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveIndex(index)}
                            role="option"
                            tabIndex={-1}
                            type="button"
                        >
                            <strong>{town}</strong>
                            <span>{actionLabel}</span>
                        </button>
                    ))}
                </div>
            ) : normalizedQuery && isOpen ? (
                <p className={buyerStyles.townRuleEmpty} id={helpId} role="status">
                    No service-area community matches that search.
                </p>
            ) : (
                <p className={buyerStyles.townRuleEmpty} id={helpId}>
                    Type a town name; up to six matching service-area communities are shown.
                </p>
            )}
        </div>
    );
}
