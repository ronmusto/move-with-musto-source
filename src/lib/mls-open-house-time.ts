import type { MlsOpenHouse, MlsSearchListing } from './mls-public-listings';

export const mlsOpenHouseTimeZone = 'America/New_York';
const explicitOffsetPattern = /(?:z|[+-]\d{2}:?\d{2})$/iu;
const localTimestampPattern =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;

const easternPartsFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: mlsOpenHouseTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

function easternParts(timestamp: number) {
    const parts = Object.fromEntries(
        easternPartsFormatter
            .formatToParts(new Date(timestamp))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, Number(part.value)]),
    );

    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second,
    };
}

export function parseMlsOpenHouseTimestamp(value: string | null | undefined) {
    if (!value?.trim()) {
        return Number.NaN;
    }

    const normalized = value.trim();
    if (explicitOffsetPattern.test(normalized)) {
        return Date.parse(normalized);
    }

    const match = localTimestampPattern.exec(normalized);
    if (!match) {
        return Number.NaN;
    }

    const desired = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
        hour: Number(match[4]),
        minute: Number(match[5]),
        second: Number(match[6] ?? 0),
        millisecond: Number((match[7] ?? '').padEnd(3, '0')) || 0,
    };
    const desiredAsUtc = Date.UTC(
        desired.year,
        desired.month - 1,
        desired.day,
        desired.hour,
        desired.minute,
        desired.second,
        desired.millisecond,
    );
    const desiredDate = new Date(desiredAsUtc);
    if (
        desiredDate.getUTCFullYear() !== desired.year ||
        desiredDate.getUTCMonth() + 1 !== desired.month ||
        desiredDate.getUTCDate() !== desired.day ||
        desired.hour > 23 ||
        desired.minute > 59 ||
        desired.second > 59
    ) {
        return Number.NaN;
    }

    let candidate = desiredAsUtc;
    for (let iteration = 0; iteration < 4; iteration += 1) {
        const observed = easternParts(candidate);
        const observedAsUtc = Date.UTC(
            observed.year,
            observed.month - 1,
            observed.day,
            observed.hour,
            observed.minute,
            observed.second,
            desired.millisecond,
        );
        const correction = desiredAsUtc - observedAsUtc;
        candidate += correction;
        if (correction === 0) {
            break;
        }
    }

    const verified = easternParts(candidate);
    return (
        verified.year === desired.year &&
        verified.month === desired.month &&
        verified.day === desired.day &&
        verified.hour === desired.hour &&
        verified.minute === desired.minute &&
        verified.second === desired.second
    ) ? candidate : Number.NaN;
}

export function isCurrentMlsOpenHouse(openHouse: MlsOpenHouse, now = Date.now()) {
    const start = parseMlsOpenHouseTimestamp(openHouse.start);
    const end = parseMlsOpenHouseTimestamp(openHouse.end);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && end > now;
}

export function currentMlsOpenHouses(openHouses: readonly MlsOpenHouse[], now = Date.now()) {
    return openHouses
        .filter((openHouse) => isCurrentMlsOpenHouse(openHouse, now))
        .sort((first, second) => (
            parseMlsOpenHouseTimestamp(first.start) - parseMlsOpenHouseTimestamp(second.start)
        ));
}

export function currentOpenHouseCount(listing: MlsSearchListing, now = Date.now()) {
    if (!Array.isArray(listing.openHouseEndTimes)) {
        return listing.openHouseCount;
    }

    return listing.openHouseEndTimes.filter((end) => {
        const timestamp = parseMlsOpenHouseTimestamp(end);
        return Number.isFinite(timestamp) && timestamp > now;
    }).length;
}

export function withCurrentOpenHouseCount(listing: MlsSearchListing, now = Date.now()): MlsSearchListing {
    const openHouseCount = currentOpenHouseCount(listing, now);
    return openHouseCount === listing.openHouseCount ? listing : { ...listing, openHouseCount };
}
