import massachusettsMunicipalGeofences from './massachusetts-municipal-geofences.generated.json' with { type: 'json' };

function ringContainsCoordinate(ring, longitude, latitude) {
    let contains = false;

    for (
        let currentIndex = 0, previousIndex = ring.length - 1;
        currentIndex < ring.length;
        previousIndex = currentIndex, currentIndex += 1
    ) {
        const current = ring[currentIndex];
        const previous = ring[previousIndex];
        const currentX = Number(current?.[0]);
        const currentY = Number(current?.[1]);
        const previousX = Number(previous?.[0]);
        const previousY = Number(previous?.[1]);

        if (![currentX, currentY, previousX, previousY].every(Number.isFinite)) {
            continue;
        }

        const crossesLatitude = (currentY > latitude) !== (previousY > latitude);
        const crossingLongitude = (previousX - currentX) * (latitude - currentY) /
            (previousY - currentY) + currentX;

        if (crossesLatitude && longitude < crossingLongitude) {
            contains = !contains;
        }
    }

    return contains;
}

function polygonContainsCoordinate(polygon, longitude, latitude) {
    if (!Array.isArray(polygon?.[0]) || !ringContainsCoordinate(polygon[0], longitude, latitude)) {
        return false;
    }

    return polygon.slice(1).every((hole) => !ringContainsCoordinate(hole, longitude, latitude));
}

function geometryContainsCoordinate(geometry, longitude, latitude) {
    if (geometry?.type === 'Polygon') {
        return polygonContainsCoordinate(geometry.coordinates, longitude, latitude);
    }

    if (geometry?.type === 'MultiPolygon') {
        return geometry.coordinates.some((polygon) =>
            polygonContainsCoordinate(polygon, longitude, latitude));
    }

    return false;
}

function distanceMilesToSegment(longitude, latitude, first, second) {
    const milesPerLongitudeDegree = 69.172 * Math.cos(latitude * Math.PI / 180);
    const milesPerLatitudeDegree = 69.0;
    const firstX = (Number(first?.[0]) - longitude) * milesPerLongitudeDegree;
    const firstY = (Number(first?.[1]) - latitude) * milesPerLatitudeDegree;
    const secondX = (Number(second?.[0]) - longitude) * milesPerLongitudeDegree;
    const secondY = (Number(second?.[1]) - latitude) * milesPerLatitudeDegree;

    if (![firstX, firstY, secondX, secondY].every(Number.isFinite)) {
        return Number.POSITIVE_INFINITY;
    }

    const segmentX = secondX - firstX;
    const segmentY = secondY - firstY;
    const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
    const projection = segmentLengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, -(firstX * segmentX + firstY * segmentY) / segmentLengthSquared));
    const nearestX = firstX + projection * segmentX;
    const nearestY = firstY + projection * segmentY;
    return Math.hypot(nearestX, nearestY);
}

function ringIsWithinTolerance(ring, longitude, latitude, toleranceMiles) {
    for (let index = 0; index < ring.length; index += 1) {
        const nextIndex = (index + 1) % ring.length;
        if (distanceMilesToSegment(longitude, latitude, ring[index], ring[nextIndex]) <= toleranceMiles) {
            return true;
        }
    }
    return false;
}

function geometryIsWithinTolerance(geometry, longitude, latitude, toleranceMiles) {
    const polygons = geometry?.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon'
            ? geometry.coordinates
            : [];

    return polygons.some((polygon) =>
        polygon.some((ring) => ringIsWithinTolerance(ring, longitude, latitude, toleranceMiles)));
}

export function coordinateIsInMassachusetts(mapPosition, toleranceMiles = 0.75) {
    const latitude = Number(mapPosition?.lat);
    const longitude = Number(mapPosition?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return false;
    }

    if (massachusettsMunicipalGeofences.features.some((feature) =>
        geometryContainsCoordinate(feature.geometry, longitude, latitude))) {
        return true;
    }

    return massachusettsMunicipalGeofences.features.some((feature) =>
        geometryIsWithinTolerance(feature.geometry, longitude, latitude, toleranceMiles));
}
