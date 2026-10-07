const MLS_TIME_ZONE = 'America/New_York';
const EXPLICIT_OFFSET_PATTERN = /(?:z|[+-]\d{2}:?\d{2})$/iu;
const LOCAL_TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/u;

const easternPartsFormatter = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
    timeZone: MLS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
});

function easternParts(timestamp) {
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

/**
 * MLS PIN open-house timestamps do not include an offset. Interpret those wall
 * clock values in Massachusetts time rather than in the machine's time zone.
 */
export function parseMlsOpenHouseTimestamp(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return Number.NaN;
    }

    const normalized = value.trim();
    if (EXPLICIT_OFFSET_PATTERN.test(normalized)) {
        return Date.parse(normalized);
    }

    const match = LOCAL_TIMESTAMP_PATTERN.exec(normalized);
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

export function isCurrentMlsOpenHouse(openHouse, now = Date.now()) {
    const start = parseMlsOpenHouseTimestamp(openHouse?.start);
    const end = parseMlsOpenHouseTimestamp(openHouse?.end);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start && end > now;
}

export function currentMlsOpenHouses(openHouses, now = Date.now()) {
    if (!Array.isArray(openHouses)) {
        return [];
    }

    return openHouses
        .filter((openHouse) => isCurrentMlsOpenHouse(openHouse, now))
        .sort((first, second) => (
            parseMlsOpenHouseTimestamp(first.start) - parseMlsOpenHouseTimestamp(second.start)
        ));
}
