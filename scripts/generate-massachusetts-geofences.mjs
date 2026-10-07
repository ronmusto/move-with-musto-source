#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import preferredServiceAreaTownList from '../src/lib/preferred-service-area-towns.json' with { type: 'json' };

function normalizedTown(value) {
    const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized === 'manchesterbythesea' ? 'manchester' : normalized;
}

const preferredTowns = new Set(preferredServiceAreaTownList.map(normalizedTown));

const sourceUrl = new URL(
    'https://services8.arcgis.com/o4UVke7qqC8oNJ7j/ArcGIS/rest/services/Massachusetts_Towns_General_Coast/FeatureServer/0/query',
);

sourceUrl.search = new URLSearchParams({
    where: '1=1',
    outFields: 'TOWN,TOWN_ID',
    returnGeometry: 'true',
    outSR: '4326',
    geometryPrecision: '5',
    maxAllowableOffset: '0.0002',
    f: 'geojson',
}).toString();

const response = await fetch(sourceUrl);
if (!response.ok) {
    throw new Error(`MassGIS request failed with ${response.status} ${response.statusText}`);
}

const featureCollection = await response.json();
if (!Array.isArray(featureCollection.features) || featureCollection.features.length !== 351) {
    throw new Error(
        `Expected 351 Massachusetts municipalities, received ${featureCollection.features?.length ?? 0}`,
    );
}

const geofences = {
    schemaVersion: 'move-with-musto.massachusetts-service-area-geofences.v1',
    source: `${sourceUrl.origin}${sourceUrl.pathname}`,
    spatialReference: 'EPSG:4326',
    generatedAt: new Date().toISOString(),
    features: featureCollection.features
        .filter((feature) => preferredTowns.has(normalizedTown(feature.properties?.TOWN)))
        .map((feature) => ({
            town: String(feature.properties?.TOWN ?? '').trim(),
            geometry: feature.geometry,
        })),
};

if (geofences.features.some((feature) => !feature.town || !feature.geometry)) {
    throw new Error('MassGIS returned a municipality without a town name or geometry.');
}
if (geofences.features.length !== preferredTowns.size) {
    throw new Error(
        `Expected ${preferredTowns.size} preferred-area geofences, received ${geofences.features.length}.`,
    );
}

const outputPath = resolve(
    process.cwd(),
    'scripts/massachusetts-municipal-geofences.generated.json',
);
await writeFile(outputPath, `${JSON.stringify(geofences)}\n`, 'utf8');

console.log(`Generated ${geofences.features.length} Massachusetts municipal geofences at ${outputPath}`);
