'use client';

import { type MlsListingFacts, type MlsListingFeatures } from '@/lib/mls-public-listings';
import styles from '../PropertiesSearch.module.css';
import { formatNumber } from './search-formatting';

type ListingDetailItem = Readonly<{ label: string; value: string }>;

function availableNumber(label: string, value: number | null | undefined, suffix = ''): ListingDetailItem | null {
    return value === null || value === undefined
        ? null
        : { label, value: `${formatNumber(value)}${suffix}` };
}

function availableList(label: string, values: string[] | undefined): ListingDetailItem | null {
    return values && values.length > 0 ? { label, value: values.join(', ') } : null;
}

export function ListingFactsAndFeatures({
    facts,
    features,
    neighborhood,
    propertyType,
}: Readonly<{
    facts: MlsListingFacts;
    features?: MlsListingFeatures;
    neighborhood?: string;
    propertyType: string;
}>) {
    const rooms = features?.rooms ?? [];
    const keyRoomNames = Array.from(new Set(
        rooms
            .map((room) => room.name.trim())
            .filter(Boolean),
    )).slice(0, 4);
    const overview = [
        { label: 'Property type', value: propertyType },
        neighborhood ? { label: 'Area', value: neighborhood } : null,
        availableNumber('Bedrooms', facts.beds),
        availableNumber('Full bathrooms', facts.fullBaths),
        availableNumber('Half bathrooms', facts.halfBaths),
        availableNumber('Total rooms', facts.rooms),
        availableNumber('Interior', facts.sqft, ' sqft'),
        facts.yearBuilt === null || facts.yearBuilt === undefined
            ? null
            : { label: 'Year built', value: String(facts.yearBuilt) },
        availableNumber('Parking spaces', facts.parking),
        availableNumber('Garage spaces', facts.garageSpaces),
        keyRoomNames.length > 0
            ? { label: 'Key rooms', value: keyRoomNames.join(', ') }
            : null,
        facts.acreage !== null && facts.acreage !== undefined && facts.acreage > 0
            ? { label: 'Lot', value: `${facts.acreage} acres` }
            : facts.lotSize !== null && facts.lotSize !== undefined && facts.lotSize > 0
                ? { label: 'Lot', value: `${formatNumber(facts.lotSize)} sqft` }
                : null,
        facts.hasBasement === null || facts.hasBasement === undefined
            ? null
            : { label: 'Basement', value: facts.hasBasement ? 'Yes' : 'No' },
    ].filter((item): item is ListingDetailItem => item !== null);
    const featureGroups = [
        {
            title: 'Home details',
            items: [
                availableList('Style', features?.style),
                availableList('Subtype', features?.propertySubtype),
            ],
        },
        {
            title: 'Interior & systems',
            items: [
                availableList('Interior features', features?.interior),
                availableList('Heating', features?.heating),
                availableList('Cooling', features?.cooling),
                availableList('Appliances', features?.appliances),
                availableList('Basement features', features?.basement),
            ],
        },
        {
            title: 'Exterior & parking',
            items: [
                availableList('Exterior features', features?.exterior),
                availableList('Roof', features?.roof),
                availableList('Lot features', features?.lot),
                availableList('Parking', features?.parking),
                availableList('Garage', features?.garage),
                availableList('Waterfront', features?.waterfront),
                availableList('Water view', features?.waterView),
            ],
        },
        {
            title: 'Utilities',
            items: [
                availableList('Water', features?.water),
                availableList('Sewer', features?.sewer),
            ],
        },
    ]
        .map((group) => ({
            ...group,
            items: group.items.filter((item): item is ListingDetailItem => item !== null),
        }))
        .filter((group) => group.items.length > 0);
    return (
        <>
            <section className={styles.factsFeaturesGroup} aria-labelledby="listing-at-a-glance-title">
                <h4 id="listing-at-a-glance-title">At a glance</h4>
                <dl className={styles.factsFeaturesList}>
                    {overview.map((item) => (
                        <div key={item.label}>
                            <dt>{item.label}</dt>
                            <dd>{item.value}</dd>
                        </div>
                    ))}
                </dl>
            </section>
            {rooms.length > 0 || featureGroups.length > 0 ? (
                <details className={styles.factsFeaturesDetails}>
                    <summary>
                        <span>
                            <strong>More facts &amp; features</strong>
                            <small>Rooms, systems, and additional property details</small>
                        </span>
                        <span aria-hidden="true" className={styles.factsFeaturesChevron}>+</span>
                    </summary>
                    <div className={styles.factsFeaturesContent}>
                        {rooms.length > 0 ? (
                            <section className={styles.factsFeaturesGroup}>
                                <h4>Rooms</h4>
                                <div className={styles.roomFeaturesGrid}>
                                    {rooms.map((room, index) => (
                                        <article key={`${room.name}-${index}`}>
                                            <h5>{room.name}</h5>
                                            <dl>
                                                {room.level ? <div><dt>Level</dt><dd>{room.level}</dd></div> : null}
                                                {room.dimensions ? <div><dt>Dimensions</dt><dd>{room.dimensions}</dd></div> : null}
                                                {room.features.length > 0 ? (
                                                    <div><dt>Features</dt><dd>{room.features.join(', ')}</dd></div>
                                                ) : null}
                                            </dl>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {featureGroups.map((group) => (
                            <section className={styles.factsFeaturesGroup} key={group.title}>
                                <h4>{group.title}</h4>
                                <dl className={styles.factsFeaturesList}>
                                    {group.items.map((item) => (
                                        <div key={item.label}>
                                            <dt>{item.label}</dt>
                                            <dd>{item.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </section>
                        ))}
                    </div>
                </details>
            ) : null}
        </>
    );
}
