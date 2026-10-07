'use client';

import styles from '../PropertiesSearch.module.css';

export function PropertyLoadingMark({ label }: Readonly<{ label: string }>) {
    return (
        <div aria-label={label} className={styles.loadingState} role="status">
            <span aria-hidden="true" className={styles.loadingSpinner} />
            <span>{label}</span>
        </div>
    );
}
