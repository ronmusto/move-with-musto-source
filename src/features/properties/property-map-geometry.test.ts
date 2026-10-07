import { describe, expect, it } from 'vitest';
import {
    boundsFromPath,
    geometryFromPolygon,
    pointInsideBounds,
    pointInsideMapArea,
    pointInsidePolygon,
    simplifyFreehandPath,
} from './property-map-geometry';

describe('property map geometry', () => {
    const square = [
        { lat: 42.5, lng: -71.2 },
        { lat: 42.5, lng: -71.1 },
        { lat: 42.4, lng: -71.1 },
        { lat: 42.4, lng: -71.2 },
    ];

    it('calculates bounds and includes points on polygon edges', () => {
        expect(boundsFromPath(square)).toEqual({
            north: 42.5,
            east: -71.1,
            south: 42.4,
            west: -71.2,
        });
        expect(pointInsidePolygon({ lat: 42.45, lng: -71.15 }, square)).toBe(true);
        expect(pointInsidePolygon({ lat: 42.5, lng: -71.15 }, square)).toBe(true);
        expect(pointInsidePolygon({ lat: 42.35, lng: -71.15 }, square)).toBe(false);
    });

    it('filters against the polygon itself instead of only its bounding box', () => {
        const triangle = geometryFromPolygon([
            { lat: 42.5, lng: -71.2 },
            { lat: 42.5, lng: -71.1 },
            { lat: 42.4, lng: -71.2 },
        ]);

        expect(triangle).not.toBeNull();
        expect(pointInsideMapArea({ lat: 42.47, lng: -71.18 }, triangle)).toBe(true);
        expect(pointInsideMapArea({ lat: 42.41, lng: -71.11 }, triangle)).toBe(false);
    });

    it('supports viewport bounds that cross the antimeridian', () => {
        const bounds = { north: 10, east: -170, south: -10, west: 170 };

        expect(pointInsideBounds({ lat: 0, lng: 175 }, bounds)).toBe(true);
        expect(pointInsideBounds({ lat: 0, lng: -175 }, bounds)).toBe(true);
        expect(pointInsideBounds({ lat: 0, lng: 0 }, bounds)).toBe(false);
    });

    it('deduplicates and simplifies dense freehand paths to at most 64 vertices', () => {
        const denseCircle = Array.from({ length: 400 }, (_, index) => {
            const angle = (index / 399) * Math.PI * 2;
            return {
                lat: 42.45 + (Math.sin(angle) * 0.05),
                lng: -71.15 + (Math.cos(angle) * 0.05),
            };
        });
        denseCircle.splice(10, 0, denseCircle[9], denseCircle[9]);

        const simplified = simplifyFreehandPath(denseCircle, 64);

        expect(simplified.length).toBeLessThanOrEqual(64);
        expect(simplified.length).toBeGreaterThanOrEqual(3);
        expect(simplified[0]).toEqual(denseCircle[0]);
        expect(simplified.at(-1)).toEqual(denseCircle.at(-1));
    });

    it('rejects incomplete polygons', () => {
        expect(geometryFromPolygon(square.slice(0, 2))).toBeNull();
    });
});
