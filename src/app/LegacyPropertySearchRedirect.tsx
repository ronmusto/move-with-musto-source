import Link from 'next/link';
import styles from './LegacyPropertySearchRedirect.module.css';

const destination = '/buy/properties/';

export function LegacyPropertySearchRedirect() {
    const redirectScript = `const target=new URL(${JSON.stringify(destination)},window.location.origin);const current=new URL(window.location.href);current.searchParams.delete('scope');target.search=current.searchParams.toString();target.hash=current.hash;window.location.replace(target.pathname+target.search+target.hash);`;

    return (
        <main className={styles.page}>
            <meta httpEquiv="refresh" content={`0;url=${destination}`} />
            <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
            <section className={styles.card} aria-labelledby="property-search-redirect-title">
                <p>Property search</p>
                <h1 id="property-search-redirect-title">Opening the home search...</h1>
                <span>
                    If the search does not open automatically,{' '}
                    <Link href={destination}>continue to property search</Link>.
                </span>
            </section>
        </main>
    );
}
