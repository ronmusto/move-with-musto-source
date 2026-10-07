const CONTACT_SOURCES = Object.freeze({
    'move-with-musto-contact-inquiry': 'Contact page',
    'move-with-musto-homepage-inquiry': 'Homepage',
    'move-with-musto-seller-consultation': 'Seller page',
});

const SEARCH_CONSULT_SCHEMA_VERSION = 'move-with-musto.search-consult-lead.v1';
const SEARCH_REQUEST_TYPES = new Set([
    'get_matching_homes',
    'request_details',
    'request_showing',
    'send_selected_homes',
    'ask_about_home',
]);

export const MAX_ATTACHED_LISTINGS = 20;
export const MAX_REQUEST_BYTES = 32 * 1024;

export class ContactPayloadError extends Error {
    constructor(message, code = 'invalid_request') {
        super(message);
        this.name = 'ContactPayloadError';
        this.code = code;
    }
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value, { field, maximum, required = false, multiline = false } = {}) {
    if (value === undefined || value === null || value === '') {
        if (required) throw new ContactPayloadError(`${field} is required.`);
        return '';
    }
    if (typeof value !== 'string') {
        throw new ContactPayloadError(`${field} must be text.`);
    }

    const controlCharacters = multiline
        ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu
        : /[\u0000-\u001f\u007f]/gu;
    const normalized = value
        .normalize('NFKC')
        .replace(controlCharacters, '')
        .replace(/\r\n?/gu, '\n')
        .trim();

    if (required && !normalized) throw new ContactPayloadError(`${field} is required.`);
    if (normalized.length > maximum) {
        throw new ContactPayloadError(`${field} is too long.`);
    }
    return normalized;
}

function emailAddress(value) {
    const email = text(value, { field: 'email', maximum: 254, required: true }).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
        throw new ContactPayloadError('email is invalid.');
    }
    return email;
}

function bool(value) {
    return value === true;
}

function stringList(value, field, maximumItems = MAX_ATTACHED_LISTINGS) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > maximumItems) {
        throw new ContactPayloadError(`${field} is invalid.`);
    }
    return Array.from(new Set(value.map((entry) => text(entry, {
        field,
        maximum: 80,
        required: true,
    }))));
}

function normalizedListing(value) {
    if (!isPlainObject(value)) throw new ContactPayloadError('attachedListings is invalid.');
    return Object.freeze({
        listingNumber: text(value.listingNumber, {
            field: 'listingNumber',
            maximum: 40,
            required: true,
        }),
        title: text(value.title, { field: 'listing title', maximum: 180, required: true }),
        town: text(value.town, { field: 'listing town', maximum: 100 }),
        status: text(value.status, { field: 'listing status', maximum: 50 }),
        priceLabel: text(value.priceLabel, { field: 'listing price', maximum: 60 }),
        detailUrl: siteLocation(value.detailUrl, 'listing detail URL', { required: true }),
    });
}

function siteLocation(value, field, { required = false, allowAddress = false } = {}) {
    const location = text(value, { field, maximum: 600, required });
    if (!location) return '';
    if (allowAddress && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(location)) return location;
    if (location.startsWith('/') && !location.startsWith('//')) return location;

    let url;
    try {
        url = new URL(location);
    } catch {
        throw new ContactPayloadError(`${field} is invalid.`);
    }
    if (
        url.protocol !== 'https:' ||
        !['movewithmusto.com', 'www.movewithmusto.com'].includes(url.hostname.toLowerCase()) ||
        url.username ||
        url.password
    ) {
        throw new ContactPayloadError(`${field} must use the Move With Musto website.`);
    }
    return url.href;
}

function normalizedFilters(value) {
    if (value === undefined || value === null) return null;
    if (!isPlainObject(value)) throw new ContactPayloadError('filters is invalid.');
    const output = {};
    const stringFields = [
        'query', 'state', 'region', 'county', 'propertyType', 'minPrice', 'maxPrice',
        'minBeds', 'maxBeds', 'minBaths', 'maxBaths', 'sortBy', 'sortDirection', 'mode',
    ];
    for (const field of stringFields) {
        const valueText = text(value[field], { field: `filters.${field}`, maximum: 120 });
        if (valueText) output[field] = valueText;
    }
    for (const field of ['includeTowns', 'excludeTowns']) {
        const values = stringList(value[field], `filters.${field}`, 30);
        if (values.length > 0) output[field] = values;
    }
    for (const field of ['openHouseOnly', 'virtualTourOnly', 'savedOnly']) {
        if (typeof value[field] === 'boolean') output[field] = value[field];
    }
    return Object.freeze(output);
}

function sourceDetails(payload) {
    if (payload.schemaVersion === SEARCH_CONSULT_SCHEMA_VERSION) {
        const requestType = text(payload.requestType, {
            field: 'requestType',
            maximum: 50,
            required: true,
        });
        if (!SEARCH_REQUEST_TYPES.has(requestType)) {
            throw new ContactPayloadError('requestType is invalid.');
        }
        return { category: 'buyer-search', label: 'Buyer search', requestType };
    }

    const source = text(payload.source, { field: 'source', maximum: 80, required: true });
    const label = CONTACT_SOURCES[source];
    if (!label) throw new ContactPayloadError('source is invalid.');
    return { category: source, label, requestType: '' };
}

export function parseContactPayload(payload) {
    if (!isPlainObject(payload)) throw new ContactPayloadError('Request body must be an object.');

    const website = text(payload.website, { field: 'website', maximum: 300 });
    if (website) return Object.freeze({ honeypot: true });

    if (!bool(payload.termsAccepted) || !bool(payload.privacyAccepted)) {
        throw new ContactPayloadError('Terms and privacy consent are required.', 'consent_required');
    }

    const source = sourceDetails(payload);
    const attachedRaw = payload.attachedListings ?? [];
    if (!Array.isArray(attachedRaw) || attachedRaw.length > MAX_ATTACHED_LISTINGS) {
        throw new ContactPayloadError(`No more than ${MAX_ATTACHED_LISTINGS} homes may be attached.`);
    }
    const attachedListings = attachedRaw.map(normalizedListing);

    return Object.freeze({
        honeypot: false,
        source,
        name: text(payload.name, { field: 'name', maximum: 120, required: true }),
        email: emailAddress(payload.email),
        phone: text(payload.phone, { field: 'phone', maximum: 40 }),
        preferredContact: text(payload.preferredContact, { field: 'preferredContact', maximum: 20 }),
        timeline: text(payload.timeline, { field: 'timeline', maximum: 80 }),
        primaryGoal: text(payload.primaryGoal, { field: 'primaryGoal', maximum: 120 }),
        propertyAddress: text(payload.propertyAddress, { field: 'propertyAddress', maximum: 240 }),
        sellerPriority: text(payload.sellerPriority, { field: 'sellerPriority', maximum: 120 }),
        message: text(payload.freeformMessage ?? payload.message, {
            field: 'message',
            maximum: 5000,
            multiline: true,
        }),
        propertyLink: siteLocation(payload.propertyLink, 'propertyLink', { allowAddress: true }),
        sourcePage: siteLocation(payload.sourcePage, 'sourcePage'),
        activeRegion: text(payload.activeRegion, { field: 'activeRegion', maximum: 120 }),
        searchAreaLabel: text(payload.searchAreaLabel, { field: 'searchAreaLabel', maximum: 240 }),
        selectedMlsNumbers: stringList(payload.selectedMlsNumbers, 'selectedMlsNumbers'),
        attachedListings,
        filters: normalizedFilters(payload.filters),
        emailUpdatesOptIn: bool(payload.emailUpdatesOptIn),
        termsVersion: text(payload.termsVersion, {
            field: 'termsVersion',
            maximum: 40,
            required: true,
        }),
        privacyVersion: text(payload.privacyVersion, {
            field: 'privacyVersion',
            maximum: 40,
            required: true,
        }),
    });
}

function labelLine(label, value) {
    return value ? `${label}: ${value}` : '';
}

function filterLines(filters) {
    if (!filters) return [];
    return Object.entries(filters).map(([key, value]) => (
        `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`
    ));
}

export function buildContactEmail(inquiry) {
    const subjectSuffix = inquiry.source.requestType
        ? inquiry.source.requestType.replaceAll('_', ' ')
        : inquiry.source.label;
    const subject = `[Move With Musto website] ${subjectSuffix}`;
    const lines = [
        'A visitor submitted a Move With Musto website inquiry.',
        '',
        labelLine('Source', inquiry.source.label),
        labelLine('Request type', inquiry.source.requestType),
        labelLine('Name', inquiry.name),
        labelLine('Email', inquiry.email),
        labelLine('Phone', inquiry.phone),
        labelLine('Preferred contact', inquiry.preferredContact),
        labelLine('Timeline', inquiry.timeline),
        labelLine('Primary goal', inquiry.primaryGoal),
        labelLine('Property address or town', inquiry.propertyAddress),
        labelLine('Seller priority', inquiry.sellerPriority),
        labelLine('Active region', inquiry.activeRegion),
        labelLine('Search area', inquiry.searchAreaLabel),
        labelLine('Source page', inquiry.sourcePage),
        labelLine('Additional property or link', inquiry.propertyLink),
        '',
        'Message:',
        inquiry.message || '(No additional message.)',
    ].filter((line) => line !== '');

    if (inquiry.attachedListings.length > 0) {
        lines.push('', `Attached homes (${inquiry.attachedListings.length}):`);
        for (const listing of inquiry.attachedListings) {
            lines.push(
                `- ${listing.title}${listing.town ? `, ${listing.town}` : ''}`,
                `  ${[listing.priceLabel, listing.status, `MLS #${listing.listingNumber}`].filter(Boolean).join(' | ')}`,
                `  ${listing.detailUrl}`,
            );
        }
    }

    const filters = filterLines(inquiry.filters);
    if (filters.length > 0) lines.push('', 'Search filters:', ...filters);
    if (inquiry.selectedMlsNumbers.length > 0 && inquiry.attachedListings.length === 0) {
        lines.push('', `Selected MLS numbers: ${inquiry.selectedMlsNumbers.join(', ')}`);
    }

    lines.push(
        '',
        `Optional property-update interest: ${inquiry.emailUpdatesOptIn ? 'Yes' : 'No'}`,
        'No marketing subscription was created by this inquiry.',
        labelLine('Terms version', inquiry.termsVersion),
        labelLine('Privacy version', inquiry.privacyVersion),
    );

    return Object.freeze({ subject, body: lines.filter(Boolean).join('\n') });
}
