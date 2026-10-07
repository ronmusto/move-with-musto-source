'use client';

import { type MlsSearchIndexBundle } from '@/lib/mls-public-listings';
import Link from 'next/link';
import styles from '../PropertiesSearch.module.css';

export function MlsScreenDisclosure({ bundle }: Readonly<{ bundle: MlsSearchIndexBundle }>) {
    return (
        <div
            aria-label="MLS listing disclosure and participant information"
            className={styles.screenDisclosure}
            role="region"
            tabIndex={0}
        >
            <div>
                <span>MLS listing disclosure</span>
                <p>{bundle.disclaimer}</p>
            </div>
            <dl>
                <div><dt>Participant firm</dt><dd>{bundle.compliance.participantFirmName}</dd></div>
                <div><dt>Office address</dt><dd>{bundle.compliance.officeAddress}</dd></div>
                <div><dt>Phone</dt><dd>{bundle.compliance.phone}</dd></div>
                <div><dt>Market area cities and towns</dt><dd>{bundle.compliance.marketArea}</dd></div>
                <div><dt>Data updated</dt><dd>{new Date(bundle.generatedAt).toLocaleString()}</dd></div>
            </dl>
            <Link href="/privacy/">Privacy policy</Link>
        </div>
    );
}

export function CompliancePanel({ bundle }: Readonly<{ bundle: MlsSearchIndexBundle }>) {
    return (
        <section className={styles.compliancePanel} aria-label="MLS listing compliance information">
            <MlsScreenDisclosure bundle={bundle} />
        </section>
    );
}
