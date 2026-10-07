export type MapSearchPoint = Readonly<{
    lat: number;
    lng: number;
}>;

export type MapSearchBounds = Readonly<{
    north: number;
    east: number;
    south: number;
    west: number;
}>;

export type MapAreaGeometry =
    | Readonly<{
        kind: 'bounds';
        bounds: MapSearchBounds;
    }>
    | Readonly<{
        kind: 'polygon';
        path: readonly MapSearchPoint[];
        bounds: MapSearchBounds;
    }>;

const pointEqualityTolerance = 1e-10;

function pointsEqual(first: MapSearchPoint, second: MapSearchPoint) {
    return Math.abs(first.lat - second.lat) <= pointEqualityTolerance &&
        Math.abs(first.lng - second.lng) <= pointEqualityTolerance;
}

function squaredDistanceToSegment(
    point: MapSearchPoint,
    start: MapSearchPoint,
    end: MapSearchPoint,
) {
    const deltaLng = end.lng - start.lng;
    const deltaLat = end.lat - start.lat;

    if (deltaLng === 0 && deltaLat === 0) {
        const lngDistance = point.lng - start.lng;
        const latDistance = point.lat - start.lat;
        return (lngDistance * lngDistance) + (latDistance * latDistance);
    }

    const interpolation = Math.max(0, Math.min(1, (
        ((point.lng - start.lng) * deltaLng) + ((point.lat - start.lat) * deltaLat)
    ) / ((deltaLng * deltaLng) + (deltaLat * deltaLat))));
    const projectedLng = start.lng + (interpolation * deltaLng);
    const projectedLat = start.lat + (interpolation * deltaLat);
    const lngDistance = point.lng - projectedLng;
    const latDistance = point.lat - projectedLat;

    return (lngDistance * lngDistance) + (latDistance * latDistance);
}

function simplifyWithTolerance(points: readonly MapSearchPoint[], tolerance: number) {
    if (points.length <= 2) {
        return [...points];
    }

    const squaredTolerance = tolerance * tolerance;
    const keep = new Set<number>([0, points.length - 1]);
    const stack: Array<readonly [number, number]> = [[0, points.length - 1]];

    while (stack.length > 0) {
        const [startIndex, endIndex] = stack.pop() as readonly [number, number];
        let furthestIndex = -1;
        let furthestDistance = squaredTolerance;

        for (let index = startIndex + 1; index < endIndex; index += 1) {
            const distance = squaredDistanceToSegment(
                points[index],
                points[startIndex],
                points[endIndex],
            );
            if (distance > furthestDistance) {
                furthestDistance = distance;
                furthestIndex = index;
            }
        }

        if (furthestIndex >= 0) {
            keep.add(furthestIndex);
            stack.push([startIndex, furthestIndex], [furthestIndex, endIndex]);
        }
    }

    return [...keep]
        .sort((first, second) => first - second)
        .map((index) => points[index]);
}

function evenlySample(points: readonly MapSearchPoint[], maxVertices: number) {
    if (points.length <= maxVertices) {
        return [...points];
    }

    return Array.from({ length: maxVertices }, (_, index) => {
        const sourceIndex = Math.round((index * (points.length - 1)) / (maxVertices - 1));
        return points[sourceIndex];
    });
}

/**
 * Removes duplicate pointer samples and simplifies a freehand path without
 * allowing shared map geometry to exceed the public 64-vertex contract.
 */
export function simplifyFreehandPath(
    input: readonly MapSearchPoint[],
    maxVertices = 64,
) {
    const safeMaxVertices = Math.max(3, Math.trunc(maxVertices));
    const points = input.filter((point, index) => (
        Number.isFinite(point.lat) &&
        Number.isFinite(point.lng) &&
        (index === 0 || !pointsEqual(point, input[index - 1]))
    ));

    if (points.length <= safeMaxVertices) {
        return points;
    }

    const bounds = boundsFromPath(points);
    const span = Math.max(bounds.north - bounds.south, Math.abs(bounds.east - bounds.west));
    let lowerTolerance = 0;
    let upperTolerance = span || 1;
    let simplified = evenlySample(points, safeMaxVertices);

    for (let iteration = 0; iteration < 24; iteration += 1) {
        const tolerance = (lowerTolerance + upperTolerance) / 2;
        const candidate = simplifyWithTolerance(points, tolerance);
        if (candidate.length > safeMaxVertices) {
            lowerTolerance = tolerance;
        } else {
            simplified = candidate;
            upperTolerance = tolerance;
        }
    }

    return evenlySample(simplified, safeMaxVertices);
}

export function boundsFromPath(path: readonly MapSearchPoint[]): MapSearchBounds {
    if (path.length === 0) {
        throw new Error('A map polygon needs at least one point to calculate bounds.');
    }

    return path.reduce<MapSearchBounds>((bounds, point) => ({
        north: Math.max(bounds.north, point.lat),
        east: Math.max(bounds.east, point.lng),
        south: Math.min(bounds.south, point.lat),
        west: Math.min(bounds.west, point.lng),
    }), {
        north: Number.NEGATIVE_INFINITY,
        east: Number.NEGATIVE_INFINITY,
        south: Number.POSITIVE_INFINITY,
        west: Number.POSITIVE_INFINITY,
    });
}

export function pointInsideBounds(point: MapSearchPoint, bounds: MapSearchBounds) {
    const latitudeMatches = point.lat <= bounds.north && point.lat >= bounds.south;
    const longitudeMatches = bounds.west <= bounds.east
        ? point.lng >= bounds.west && point.lng <= bounds.east
        : point.lng >= bounds.west || point.lng <= bounds.east;

    return latitudeMatches && longitudeMatches;
}

function pointOnSegment(point: MapSearchPoint, start: MapSearchPoint, end: MapSearchPoint) {
    return squaredDistanceToSegment(point, start, end) <= pointEqualityTolerance * pointEqualityTolerance;
}

export function pointInsidePolygon(point: MapSearchPoint, path: readonly MapSearchPoint[]) {
    if (path.length < 3) {
        return false;
    }

    let isInside = false;
    for (let index = 0, previousIndex = path.length - 1; index < path.length; previousIndex = index, index += 1) {
        const current = path[index];
        const previous = path[previousIndex];

        if (pointOnSegment(point, previous, current)) {
            return true;
        }

        const crossesLatitude = (current.lat > point.lat) !== (previous.lat > point.lat);
        if (!crossesLatitude) {
            continue;
        }

        const crossingLongitude = (
            ((previous.lng - current.lng) * (point.lat - current.lat)) /
            (previous.lat - current.lat)
        ) + current.lng;
        if (point.lng < crossingLongitude) {
            isInside = !isInside;
        }
    }

    return isInside;
}

export function pointInsideMapArea(point: MapSearchPoint, geometry: MapAreaGeometry | null) {
    if (!geometry) {
        return true;
    }

    if (!pointInsideBounds(point, geometry.bounds)) {
        return false;
    }

    return geometry.kind === 'bounds' || pointInsidePolygon(point, geometry.path);
}

export function geometryFromBounds(bounds: MapSearchBounds): MapAreaGeometry {
    return { kind: 'bounds', bounds };
}

export function geometryFromPolygon(path: readonly MapSearchPoint[]): MapAreaGeometry | null {
    const simplifiedPath = simplifyFreehandPath(path, 64);
    if (simplifiedPath.length < 3) {
        return null;
    }

    return {
        kind: 'polygon',
        path: simplifiedPath,
        bounds: boundsFromPath(simplifiedPath),
    };
}
