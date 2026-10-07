'use client';

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import styles from '../PropertiesSearch.module.css';

type TownRuleComboboxProps = Readonly<{
    label: string;
    actionLabel: 'Include' | 'Exclude';
    options: readonly string[];
    query: string;
    onQueryChange: (query: string) => void;
    onSelect: (town: string) => void;
}>;

export function TownRuleCombobox({
    label,
    actionLabel,
    options,
    query,
    onQueryChange,
    onSelect,
}: TownRuleComboboxProps) {
    const listboxId = useId();
    const [activeIndex, setActiveIndex] = useState(-1);
    const hasOptions = options.length > 0;

    useEffect(() => {
        setActiveIndex(hasOptions ? 0 : -1);
    }, [hasOptions, options, query]);

    function selectTown(town: string) {
        onSelect(town);
        setActiveIndex(-1);
    }

    function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
        if (!hasOptions) {
            if (event.key === 'Escape' && query) {
                event.preventDefault();
                event.stopPropagation();
                onQueryChange('');
            }
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => current < options.length - 1 ? current + 1 : 0);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => current > 0 ? current - 1 : options.length - 1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            setActiveIndex(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            setActiveIndex(options.length - 1);
        } else if (event.key === 'Enter' && activeIndex >= 0) {
            event.preventDefault();
            selectTown(options[activeIndex]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onQueryChange('');
        }
    }

    return (
        <>
            <label>
                <span>{label}</span>
                <input
                    aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
                    aria-autocomplete="list"
                    aria-controls={listboxId}
                    aria-expanded={hasOptions}
                    aria-haspopup="listbox"
                    aria-label={`Search communities to ${actionLabel.toLowerCase()}`}
                    onChange={(event) => onQueryChange(event.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Search communities"
                    role="combobox"
                    type="search"
                    value={query}
                />
            </label>

            {hasOptions ? (
                <div
                    aria-label={`Towns to ${actionLabel.toLowerCase()}`}
                    className={styles.townRuleResults}
                    id={listboxId}
                    role="listbox"
                >
                    {options.map((town, index) => (
                        <button
                            aria-label={`${actionLabel} ${town}`}
                            aria-selected={index === activeIndex}
                            className={styles.townRuleOptionButton}
                            id={`${listboxId}-${index}`}
                            key={`${actionLabel.toLowerCase()}-option-${town}`}
                            onClick={() => selectTown(town)}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            role="option"
                            tabIndex={-1}
                            type="button"
                        >
                            <strong>{town}</strong>
                            <span>{actionLabel}</span>
                        </button>
                    ))}
                </div>
            ) : query.trim() ? (
                <p className={styles.townRuleEmpty} role="status">No close community matches found.</p>
            ) : (
                <p className={styles.townRuleEmpty}>Search for a community to {actionLabel.toLowerCase()}.</p>
            )}
        </>
    );
}
