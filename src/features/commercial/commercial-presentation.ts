export function formattedDataDate(value: string) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return 'Unavailable';
    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeZone: 'America/New_York',
    }).format(timestamp);
}

export function marketAreaCommunities(value: string) {
    return value
        .split(',')
        .map((community) => community.trim())
        .filter(Boolean);
}

export function formatNumber(value: number) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}
