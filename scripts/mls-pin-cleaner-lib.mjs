import { createHash } from 'node:crypto';
import preferredServiceAreaTowns from '../src/lib/preferred-service-area-towns.json' with { type: 'json' };
import { currentMlsOpenHouses } from './mls-open-house-time.mjs';
import { sanitizePublicHttpsUrl } from './public-url-safety.mjs';

export const ACTIVE_PUBLIC_STATUSES = Object.freeze(['ACT', 'NEW', 'PCG', 'BOM', 'RAC', 'EXT', 'CTG']);

export const MLS_SEARCH_MANIFEST_FILE = 'mls-search-manifest.json';
export const MLS_SEARCH_SHARD_FILES = Object.freeze({
    preferred: 'mls-search-preferred.json',
    other: 'mls-search-other.json',
});
export const MLS_SEARCH_SHARD_SCHEMA_VERSION = 1;
export const MLS_COORDINATE_INDEX_FILE = 'mls-coordinate-index.json';
export const MLS_COORDINATE_INDEX_SCHEMA_VERSION = 1;
export const MLS_ALLOWED_STATE = 'MA';
export const GOOGLE_GEOCODE_COORDINATE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const GOOGLE_GEOCODE_PUBLICATION_MARGIN_MS = 4 * 24 * 60 * 60 * 1000;

export const CANONICAL_SERVICE_AREA_TOWNS = Object.freeze(
    preferredServiceAreaTowns.map((town) => town.trim()),
);
export const CANONICAL_SERVICE_MARKET_AREA = CANONICAL_SERVICE_AREA_TOWNS.join(', ');

const PREFERRED_SERVICE_AREA_TOWNS = new Set(
    CANONICAL_SERVICE_AREA_TOWNS.map((town) => town.toUpperCase()),
);
const CANONICAL_SERVICE_AREA_TOWN_NAMES = new Set(
    CANONICAL_SERVICE_AREA_TOWNS.map((town) => town.toUpperCase()),
);

export const MLS_PIN_PUBLIC_DISCLAIMER =
    'The property listing data and information, or the Images, set forth herein were provided to MLS Property Information Network, Inc. from third party sources, including sellers, lessors, landlords and public records, and were compiled by MLS Property Information Network, Inc. The property listing data and information, and the Images, are for the personal, non-commercial use of consumers having a good faith interest in purchasing, leasing or renting listed properties of the type displayed to them and may not be used for any purpose other than to identify prospective properties which such consumers may have a good faith interest in purchasing, leasing or renting. MLS Property Information Network, Inc. and its subscribers disclaim any and all representations and warranties as to the accuracy of the property listing data and information, or as to the accuracy of any of the Images, set forth herein.';

const STATUS_LABELS = Object.freeze({
    ACT: 'Active',
    NEW: 'New',
    PCG: 'Price changed',
    BOM: 'Back on market',
    RAC: 'Reactivated',
    EXT: 'Extended',
    CTG: 'Contingent',
});

const PROPERTY_TYPE_LABELS = Object.freeze({
    'single-family': 'Single family',
    condo: 'Condo/co-op',
    'multi-family': 'Multi-family',
    SF: 'Single family',
    CC: 'Condo/co-op',
    MF: 'Multi-family',
});

const REQUIRED_COMPLIANCE_FIELDS = [
    'participantFirmName',
    'officeAddress',
    'phone',
    'marketArea',
];

const REQUIRED_PUBLIC_ROW_FIELDS = [
    ['LIST_NO', 'missing_listing_number'],
    ['PROP_TYPE', 'missing_property_type'],
    ['STATUS', 'missing_status'],
    ['LIST_PRICE', 'missing_list_price'],
    ['STREET_NO', 'missing_street_number'],
    ['STREET_NAME', 'missing_street_name'],
    ['TOWN_NUM', 'missing_town_number'],
    ['STATE', 'missing_state'],
    ['LIST_OFFICE', 'missing_listing_office'],
    ['LIST_AGENT', 'missing_listing_agent'],
];

const FAIR_HOUSING_REVIEW_PATTERNS = [
    {
        code: 'familial_status_preference',
        pattern: /(?:\b(?:perfect|ideal|great|suited|suitable|designed|made)\s+(?:for\s+)?(?:a\s+)?(?:growing\s+)?famil(?:y|ies)\b|\b(?:perfect|ideal|great|suited|suitable|designed|made)\s+for\s+(?:a\s+)?single[-\s]+family\b|\bgrowing\s+famil(?:y|ies)\b)/i,
    },
    {
        code: 'family_friendly_claim',
        pattern: /\bfamil(?:y|ies)[-\s]+(?:friendly|oriented)\b/i,
    },
    {
        code: 'family_neighborhood_claim',
        pattern: /(?<!\bsingle[-\s])(?<!\bmulti[-\s])\bfamily\s+neighbou?rhoods?\b/i,
    },
    {
        code: 'children_reference',
        pattern: /\b(?:kids?|kiddo(?:s)?|kiddie|child(?:ren)?(?:'?s)?|teens?|teenagers?)\b/i,
    },
    {
        code: 'age_profile_reference',
        pattern: /\b(?:young professionals?|seniors?|retirees?|empty nesters?)\b/i,
    },
    {
        code: 'school_assignment_or_access_claim',
        pattern: /\b(?:eligible for\s+[^.!,;]+school|walk(?:ing)?\s+(?:distance\s+)?to\s+schools?|near\s+schools?|close\s+to\s+schools?|top-rated\s+schools?|highly\s+rated\s+schools?|award-winning\s+schools?|local\s+schools?|school access|school district|schools?)\b/i,
    },
    {
        code: 'neighborhood_safety_claim',
        pattern: /\b(?:safe neighborhood|low crime|crime rate|crime-free)\b/i,
    },
    {
        code: 'student_housing_preference',
        pattern: /\b(?:no students|students only)\b/i,
    },
    {
        code: 'household_composition_preference',
        pattern: /\b(?:(?:adults?|couples?|singles?|single\s+(?:person|occupant)|famil(?:y|ies))[-\s]+(?:only|preferred?|welcome)|(?:only|preferred?)[-\s]+(?:adults?|couples?|singles?|single\s+(?:person|occupant)|famil(?:y|ies))|no\s+famil(?:y|ies))\b/i,
    },
    {
        code: 'source_of_income_exclusion',
        pattern: /\b(?:no\s+(?:section\s*8|housing\s+vouchers?|vouchers?|rental\s+assistance)|(?:section\s*8|housing\s+vouchers?|vouchers?|rental\s+assistance)\s+(?:not\s+(?:accepted|allowed)|ineligible|unwelcome)|(?:must\s+be|only)\s+(?:employed|working)|(?:employment|proof\s+of\s+employment)\s+(?:is\s+)?required|(?:employment|earned)\s+income\s+only)\b/i,
    },
    {
        code: 'disability_exclusion',
        pattern: /\b(?:no\s+(?:wheelchairs?|disabled\s+(?:people|persons|tenants?)|people\s+with\s+disabilities)|wheelchairs?\s+(?:not\s+allowed|prohibited)|(?:must\s+be\s+)?able[-\s]+bodied\s+(?:only|required))\b/i,
    },
    {
        code: 'religion_or_national_origin_preference',
        pattern: /\b(?:(?:christians?|jewish|jews?|muslims?|hindus?|buddhists?|catholics?|protestants?|americans?|u\.?s\.?\s+citizens?|citizens?|immigrants?)[-\s]+(?:only|preferred?|welcome)|no\s+(?:immigrants?|foreigners?))\b/i,
    },
    {
        code: 'language_preference',
        pattern: /\b(?:must\s+speak\s+(?:english|spanish|portuguese|mandarin|cantonese|vietnamese|arabic|hindi|russian|french)|(?:english|spanish|portuguese|mandarin|cantonese|vietnamese|arabic|hindi|russian|french)(?:[-\s]+speakers?)?[-\s]+(?:only|preferred?))\b/i,
    },
    {
        code: 'student_or_professional_preference',
        pattern: /\b(?:perfect|ideal|great|suited|suitable|designed|made)\s+(?:for\s+)?(?:students?|professionals?)\b/i,
    },
    {
        code: 'race_color_ethnicity_or_ancestry_preference',
        pattern: /\b(?:(?:whites?|blacks?|african[-\s]+americans?|asians?|hispanics?|latinos?|latinas?|latinx|native[-\s]+americans?|indigenous\s+(?:people|persons)|middle[-\s]+easterners?|arabs?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?))?[-\s]+(?:only|preferred?|welcome|not\s+(?:accepted|allowed))|no\s+(?:whites?|blacks?|african[-\s]+americans?|asians?|hispanics?|latinos?|latinas?|latinx|native[-\s]+americans?|indigenous\s+(?:people|persons)|middle[-\s]+easterners?|arabs?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?))?|(?:race|color|ethnicity|ancestry|racial\s+background|ethnic\s+background)\s+(?:is\s+)?(?:required|preferred|restricted)|(?:italian|irish|greek|african|asian|european|middle[-\s]+eastern)\s+ancestry\s+(?:is\s+)?(?:required|preferred|only))\b/i,
    },
    {
        code: 'sex_gender_or_orientation_preference',
        pattern: /\b(?:(?:men|women|males?|females?|transgender|trans|non[-\s]*binary|gay|lesbian|bisexual|lgbtq\+?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?|couples?))?[-\s]+(?:only|preferred?|welcome|not\s+(?:accepted|allowed))|no\s+(?:men|women|males?|females?|transgender|trans|non[-\s]*binary|gay|lesbian|bisexual|lgbtq\+?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?|couples?))?|same[-\s]+sex\s+couples?[-\s]+(?:not\s+(?:accepted|allowed)|only|preferred)|(?:sex|gender|gender\s+identity|sexual\s+orientation)\s+(?:is\s+)?(?:required|preferred|restricted))\b/i,
    },
    {
        code: 'marital_status_preference',
        pattern: /\b(?:(?:married|unmarried|divorced|widowed|separated)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?|couples?))?[-\s]+(?:only|preferred?|welcome|not\s+(?:accepted|allowed))|no\s+(?:married|unmarried|divorced|widowed|separated)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?|couples?))?|must\s+be\s+(?:married|single|unmarried)|marital\s+status\s+(?:is\s+)?(?:required|preferred|restricted))\b/i,
    },
    {
        code: 'veteran_or_military_status_preference',
        pattern: /\b(?:(?:veterans?|military|active[-\s]+duty|service\s+members?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?))?[-\s]+(?:only|preferred?|welcome|not\s+(?:accepted|allowed))|no\s+(?:veterans?|military|active[-\s]+duty|service\s+members?)(?:[-\s]+(?:applicants?|tenants?|buyers?|people|persons?))?|(?:veteran|military)\s+status\s+(?:is\s+)?(?:required|preferred|restricted))\b/i,
    },
    {
        code: 'genetic_information_requirement_or_exclusion',
        pattern: /\b(?:(?:genetic\s+(?:screening|testing|test|information|history)|dna\s+(?:screening|testing|test|information))\s+(?:is\s+)?(?:required|mandatory|preferred)|must\s+(?:provide|complete|undergo)\s+(?:genetic\s+(?:screening|testing|test|information|history)|dna\s+(?:screening|testing|test|information))|(?:no\s+)?(?:applicants?|tenants?|buyers?)\s+with\s+(?:a\s+)?genetic\s+(?:condition|disorder|marker)\s+(?:not\s+(?:accepted|allowed)|excluded))\b/i,
    },
];

function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function readMarketArea(value) {
    if (Array.isArray(value)) {
        return value.map(readString).filter(Boolean).join(', ');
    }

    return readString(value);
}

function readMarketAreaTowns(value) {
    const values = Array.isArray(value) ? value : readString(value).split(',');
    return values.map(readString).filter(Boolean);
}

function validateCanonicalServiceMarketArea(value) {
    const configuredTowns = readMarketAreaTowns(value);
    const configuredTownNames = configuredTowns.map((town) => town.toUpperCase());
    const configuredTownNameSet = new Set(configuredTownNames);
    const missingTowns = CANONICAL_SERVICE_AREA_TOWNS.filter(
        (town) => !configuredTownNameSet.has(town.toUpperCase()),
    );
    const unexpectedTowns = configuredTowns.filter(
        (town) => !CANONICAL_SERVICE_AREA_TOWN_NAMES.has(town.toUpperCase()),
    );
    const duplicateTowns = configuredTowns.filter(
        (town, index) => configuredTownNames.indexOf(town.toUpperCase()) !== index,
    );

    if (missingTowns.length > 0 || unexpectedTowns.length > 0 || duplicateTowns.length > 0) {
        const problems = [
            missingTowns.length > 0 ? `missing towns: ${missingTowns.join(', ')}` : '',
            unexpectedTowns.length > 0 ? `unexpected towns: ${unexpectedTowns.join(', ')}` : '',
            duplicateTowns.length > 0 ? `duplicate towns: ${duplicateTowns.join(', ')}` : '',
        ].filter(Boolean);
        throw new Error(
            `MLS PIN marketArea must include exactly the ${CANONICAL_SERVICE_AREA_TOWNS.length} ` +
            `canonical Massachusetts service towns (${problems.join('; ')}).`,
        );
    }

    const hasCanonicalOrderAndSpelling = configuredTowns.length === CANONICAL_SERVICE_AREA_TOWNS.length &&
        configuredTowns.every((town, index) => town === CANONICAL_SERVICE_AREA_TOWNS[index]);
    if (!hasCanonicalOrderAndSpelling) {
        throw new Error(
            'MLS PIN marketArea must use the canonical alphabetical town order and spelling: ' +
            CANONICAL_SERVICE_MARKET_AREA,
        );
    }
}

function isPlaceholder(value) {
    return /(?:goes here|placeholder|broker[- ]approved|city or town|example|replace[_ -]with)/i.test(value);
}

function toNumber(value) {
    const normalized = readString(value).replace(/[$,]/g, '');
    if (!normalized) {
        return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

function increment(target, key, by = 1) {
    const safeKey = key || 'unknown';
    target[safeKey] = (target[safeKey] ?? 0) + by;
}

function decodeFieldValues(fieldReference, fieldName, rawValue) {
    const value = readString(rawValue);
    if (!value) {
        return [];
    }

    return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((code) => fieldReference?.get(`${fieldName}:${code}`) ?? code);
}

function toBooleanFlag(value) {
    const normalized = readString(value).toUpperCase();
    if (normalized === 'Y') {
        return true;
    }
    if (normalized === 'N') {
        return false;
    }
    return null;
}

function roomLevelLabel(value) {
    const level = readString(value).toUpperCase();
    return ({
        '1': 'First',
        '2': 'Second',
        '3': 'Third',
        '4': 'Fourth',
        B: 'Basement',
    })[level] ?? readString(value);
}

function buildRoomDetails(row, fieldReference) {
    const standardRooms = [
        ['Living room', 'LIV'],
        ['Dining room', 'DIN'],
        ['Family room', 'FAM'],
        ['Kitchen', 'KIT'],
        ['Primary bedroom', 'MBR'],
        ['Bedroom 2', 'BED2'],
        ['Bedroom 3', 'BED3'],
        ['Bedroom 4', 'BED4'],
        ['Bedroom 5', 'BED5'],
        ['Bathroom 1', 'BTH1'],
        ['Bathroom 2', 'BTH2'],
        ['Bathroom 3', 'BTH3'],
        ['Laundry', 'LAUNDRY'],
    ];
    const otherRooms = Array.from({ length: 6 }, (_, index) => {
        const prefix = `OTH${index + 1}`;
        const rawName = readString(row[`${prefix}_ROOM_NAME`]);
        const decodedName = decodeFieldValues(fieldReference, 'ROOM_NAME', rawName)[0];
        return [decodedName || rawName || `Other room ${index + 1}`, prefix];
    });

    return [...standardRooms, ...otherRooms]
        .map(([name, prefix]) => ({
            name,
            level: roomLevelLabel(row[`${prefix}_LEVEL`]),
            dimensions: readString(row[`${prefix}_DIMEN`]).replace(/\s*[xX]\s*/g, ' x '),
            features: decodeFieldValues(fieldReference, 'ROOM', row[`${prefix}_DSCRP`]),
        }))
        .filter((room) => room.level || room.dimensions || room.features.length > 0);
}

function propertySubtype(row, propertyClass, fieldReference) {
    const subtypeField = ({
        'single-family': 'SF_TYPE',
        condo: 'CC_TYPE',
        'multi-family': 'MF_TYPE',
    })[propertyClass];

    return subtypeField ? decodeFieldValues(fieldReference, subtypeField, row[subtypeField]) : [];
}

function formatAddress(row) {
    const streetNo = readString(row.STREET_NO);
    const streetName = readString(row.STREET_NAME);
    const unitNo = readString(row.UNIT_NO);
    const line = [streetNo, streetName].filter(Boolean).join(' ');

    return unitNo ? `${line} #${unitNo}` : line;
}

function requiredFieldReasons(row) {
    return REQUIRED_PUBLIC_ROW_FIELDS
        .filter(([field]) => !readString(row[field]))
        .map(([, reason]) => reason);
}

export function fairHousingReviewFlags(remarks) {
    const text = readString(remarks);

    if (!text) {
        return [];
    }

    return FAIR_HOUSING_REVIEW_PATTERNS
        .map(({ code, pattern }) => {
            const match = text.match(pattern);

            return match ? { code, matchedText: match[0] } : null;
        })
        .filter(Boolean);
}

function sha256Remarks(remarks) {
    const sourceText = typeof remarks === 'string' ? remarks : '';
    return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

function splitPipeLine(line) {
    const values = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        const next = line[index + 1];

        if (character === '"' && quoted && next === '"') {
            current += '"';
            index += 1;
            continue;
        }

        if (character === '"') {
            quoted = !quoted;
            continue;
        }

        if (character === '|' && !quoted) {
            values.push(current);
            current = '';
            continue;
        }

        current += character;
    }

    values.push(current);
    return values.map((value) => value.trim());
}

const WINDOWS_1252_CONTROL_CHARS = new Map([
    [0x80, '\u20AC'],
    [0x82, '\u201A'],
    [0x83, '\u0192'],
    [0x84, '\u201E'],
    [0x85, '\u2026'],
    [0x86, '\u2020'],
    [0x87, '\u2021'],
    [0x88, '\u02C6'],
    [0x89, '\u2030'],
    [0x8A, '\u0160'],
    [0x8B, '\u2039'],
    [0x8C, '\u0152'],
    [0x8E, '\u017D'],
    [0x91, '\u2018'],
    [0x92, '\u2019'],
    [0x93, '\u201C'],
    [0x94, '\u201D'],
    [0x95, '\u2022'],
    [0x96, '\u2013'],
    [0x97, '\u2014'],
    [0x98, '\u02DC'],
    [0x99, '\u2122'],
    [0x9A, '\u0161'],
    [0x9B, '\u203A'],
    [0x9C, '\u0153'],
    [0x9E, '\u017E'],
    [0x9F, '\u0178'],
]);

export function decodeMlsText(buffer) {
    return buffer.toString('latin1').replace(/[\u0080-\u009F]/g, (character) => (
        WINDOWS_1252_CONTROL_CHARS.get(character.charCodeAt(0)) ?? character
    ));
}

export function parsePipeDelimited(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
    if (lines.length === 0) {
        return [];
    }

    const headers = splitPipeLine(lines[0]);
    return lines.slice(1).map((line) => {
        const values = splitPipeLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    });
}

export function validateComplianceConfig(config) {
    const normalized = {
        participantFirmName: readString(config?.participantFirmName),
        officeAddress: readString(config?.officeAddress),
        phone: readString(config?.phone),
        marketArea: readMarketArea(config?.marketArea),
    };
    const missing = REQUIRED_COMPLIANCE_FIELDS.filter((field) => !normalized[field]);
    if (missing.length > 0) {
        throw new Error(`Missing MLS PIN compliance config: ${missing.join(', ')}`);
    }

    const placeholders = REQUIRED_COMPLIANCE_FIELDS.filter((field) => isPlaceholder(normalized[field]));
    if (placeholders.length > 0) {
        throw new Error(`Placeholder MLS PIN compliance config: ${placeholders.join(', ')}`);
    }

    validateCanonicalServiceMarketArea(config?.marketArea);
    normalized.marketArea = CANONICAL_SERVICE_MARKET_AREA;

    return normalized;
}

export function buildPhotoUrls(listingNumber, photoCount) {
    const safeListingNumber = encodeURIComponent(readString(listingNumber));
    const count = Math.max(0, Math.min(42, toNumber(photoCount) ?? 0));

    return Array.from({ length: count }, (_, index) => ({
        index,
        card: `https://media.mlspin.com/photo.aspx?mls=${safeListingNumber}&n=${index}&w=600&h=450`,
        detail: `https://media.mlspin.com/photo.aspx?mls=${safeListingNumber}&n=${index}&w=1024&h=768`,
        thumbnail: `https://media.mlspin.com/photo.aspx?mls=${safeListingNumber}&n=${index}&w=320&h=250`,
    }));
}

function listingPhotoCount(listing) {
    if (Number.isFinite(listing?.photoCount)) {
        return Math.max(0, Math.min(42, Math.trunc(listing.photoCount)));
    }

    if (Array.isArray(listing?.photos)) {
        return Math.max(0, Math.min(42, listing.photos.length));
    }

    return 0;
}

function toListingDetail(listing, generatedAt = '') {
    const { photos, ...detail } = listing;
    const openHouses = currentMlsOpenHouses(
        listing.openHouses,
        generatedAt ? Date.parse(generatedAt) : Date.now(),
    ).map((openHouse) => ({
        ...openHouse,
        url: sanitizePublicHttpsUrl(openHouse.url),
    }));

    return {
        ...detail,
        openHouses,
        photoCount: listingPhotoCount(listing),
        ...(generatedAt ? { generatedAt } : {}),
    };
}

function toSearchListing(listing, generatedAt = '') {
    const openHouses = currentMlsOpenHouses(
        listing.openHouses,
        generatedAt ? Date.parse(generatedAt) : Date.now(),
    );
    return {
        listingNumber: listing.listingNumber,
        propertyType: listing.propertyType,
        status: {
            code: listing.status.code,
            label: listing.status.label,
            isActive: listing.status.isActive,
        },
        listPrice: listing.listPrice,
        priceLabel: listing.priceLabel,
        address: {
            line: listing.address.line,
            town: listing.address.town,
            county: listing.address.county,
            state: listing.address.state,
            zip: listing.address.zip,
        },
        facts: {
            beds: listing.facts.beds,
            fullBaths: listing.facts.fullBaths,
            halfBaths: listing.facts.halfBaths,
            bathsLabel: listing.facts.bathsLabel,
            sqft: listing.facts.sqft,
        },
        photoCount: listingPhotoCount(listing),
        openHouseCount: openHouses.length,
        openHouseEndTimes: openHouses.map((openHouse) => openHouse.end),
        hasVirtualTour: Boolean(listing.virtualTourUrl),
        attribution: {
            listingAgent: listing.attribution.listingAgent,
            listingOffice: listing.attribution.listingOffice,
        },
        source: {
            name: listing.source.name,
        },
        ...(listing.mapPosition ? {
            mapPosition: {
                lat: listing.mapPosition.lat,
                lng: listing.mapPosition.lng,
                source: listing.mapPosition.source,
                precision: listing.mapPosition.precision,
                geocodedAt: listing.mapPosition.geocodedAt,
                expiresAt: listing.mapPosition.expiresAt,
            },
        } : {}),
    };
}

export function serializeMlsJson(value, { pretty = false } = {}) {
    return `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`;
}

export function normalizeMlsState(value) {
    return readString(value).toUpperCase();
}

export function listingIsMassachusetts(listing) {
    return normalizeMlsState(listing?.address?.state) === MLS_ALLOWED_STATE;
}

export function assertMassachusettsListings(listings, label = 'MLS reviewed output') {
    if (!Array.isArray(listings)) {
        throw new Error(`${label} is missing its listing collection.`);
    }
    const outsideMassachusetts = listings.find((listing) => !listingIsMassachusetts(listing));
    if (outsideMassachusetts) {
        throw new Error(
            `${label} can contain only Massachusetts listings with state ${MLS_ALLOWED_STATE}; ` +
            `found ${readString(outsideMassachusetts.listingNumber) || 'unknown'}.`,
        );
    }
}

export function listingMatchesPreferredServiceArea(listing) {
    return listingIsMassachusetts(listing) &&
        PREFERRED_SERVICE_AREA_TOWNS.has(listing?.address?.town?.trim().toUpperCase());
}

function withoutMapPosition(listing) {
    const { mapPosition: _mapPosition, ...listingWithoutMapPosition } = listing;
    return listingWithoutMapPosition;
}

export function buildMlsCoordinateIndex(searchIndexBundle, now = Date.now()) {
    const coordinateEntries = [];

    for (const listing of searchIndexBundle.listings) {
        const geocodedAt = Date.parse(listing.mapPosition?.geocodedAt);
        const sourceExpiresAt = Date.parse(listing.mapPosition?.expiresAt);
        if (
            !listing.mapPosition ||
            !Number.isFinite(listing.mapPosition.lat) ||
            !Number.isFinite(listing.mapPosition.lng) ||
            !Number.isFinite(geocodedAt) ||
            !Number.isFinite(sourceExpiresAt) ||
            geocodedAt > now ||
            sourceExpiresAt - geocodedAt > GOOGLE_GEOCODE_COORDINATE_TTL_MS ||
            sourceExpiresAt <= now + GOOGLE_GEOCODE_PUBLICATION_MARGIN_MS
        ) {
            continue;
        }

        coordinateEntries.push([listing.listingNumber, {
            lat: listing.mapPosition.lat,
            lng: listing.mapPosition.lng,
            expiresAt: new Date(sourceExpiresAt).toISOString(),
        }]);
    }

    return {
        schemaVersion: MLS_COORDINATE_INDEX_SCHEMA_VERSION,
        generatedAt: searchIndexBundle.generatedAt,
        coordinates: Object.fromEntries(coordinateEntries),
    };
}

export function buildMlsSearchDelivery(searchIndexBundle, now = Date.now()) {
    assertMassachusettsListings(searchIndexBundle.listings, 'MLS search delivery');
    const preferredListings = [];
    const otherListings = [];
    const facetValues = (readValue) => Array.from(new Set(
        searchIndexBundle.listings.map(readValue).filter(Boolean),
    )).sort((first, second) => first.localeCompare(second));

    for (const listing of searchIndexBundle.listings) {
        const shardListing = withoutMapPosition(listing);
        if (listingMatchesPreferredServiceArea(listing)) {
            preferredListings.push(shardListing);
        } else {
            otherListings.push(shardListing);
        }
    }

    const coordinateIndex = buildMlsCoordinateIndex(searchIndexBundle, now);

    const shardRecords = [
        {
            id: 'preferred',
            fileName: MLS_SEARCH_SHARD_FILES.preferred,
            value: {
                schemaVersion: MLS_SEARCH_SHARD_SCHEMA_VERSION,
                id: 'preferred',
                generatedAt: searchIndexBundle.generatedAt,
                listings: preferredListings,
            },
        },
        {
            id: 'other',
            fileName: MLS_SEARCH_SHARD_FILES.other,
            value: {
                schemaVersion: MLS_SEARCH_SHARD_SCHEMA_VERSION,
                id: 'other',
                generatedAt: searchIndexBundle.generatedAt,
                listings: otherListings,
            },
        },
    ];

    return {
        manifest: {
            schemaVersion: MLS_SEARCH_SHARD_SCHEMA_VERSION,
            generatedAt: searchIndexBundle.generatedAt,
            source: searchIndexBundle.source,
            disclaimer: searchIndexBundle.disclaimer,
            compliance: searchIndexBundle.compliance,
            totalListingCount: searchIndexBundle.listings.length,
            facets: {
                states: facetValues((listing) => listing.address.state),
                counties: facetValues((listing) => listing.address.county),
                towns: facetValues((listing) => listing.address.town),
                propertyTypes: facetValues((listing) => listing.propertyType),
            },
            coordinateIndex: {
                file: MLS_COORDINATE_INDEX_FILE,
                coordinateCount: Object.keys(coordinateIndex.coordinates).length,
            },
            shards: shardRecords.map((shard) => ({
                id: shard.id,
                file: shard.fileName,
                listingCount: shard.value.listings.length,
            })),
        },
        shardRecords,
        coordinateIndex,
    };
}

export function buildPublicListingOutputs({
    generatedAt,
    source,
    disclaimer,
    compliance,
    listings,
    sourceSnapshot,
    now = Date.now(),
}) {
    assertMassachusettsListings(listings);
    const base = {
        generatedAt,
        source,
        disclaimer,
        compliance,
        ...(sourceSnapshot ? { sourceSnapshot } : {}),
    };
    const detailRecords = listings.map((listing) => ({
        fileName: `${encodeURIComponent(readString(listing.listingNumber))}.json`,
        listing: toListingDetail(listing, generatedAt),
    }));

    const searchIndexBundle = {
        ...base,
        listings: listings.map((listing) => toSearchListing(listing, generatedAt)),
    };
    const searchDelivery = buildMlsSearchDelivery(searchIndexBundle, now);

    return {
        searchIndexBundle,
        searchManifest: searchDelivery.manifest,
        searchShardRecords: searchDelivery.shardRecords,
        coordinateIndex: searchDelivery.coordinateIndex,
        detailRecords,
    };
}

export function cleanSalesRows({
    rows,
    propertyClass,
    references,
    optOutOfficeIds,
    complianceConfig,
}) {
    const compliance = validateComplianceConfig(complianceConfig);
    const listings = [];
    const quarantined = [];
    const remarksReviews = [];
    const report = {
        totalRows: rows.length,
        published: 0,
        excludedByOptOut: 0,
        hiddenByStatus: {},
        quarantined: 0,
        byStatus: {},
        byInputState: {},
        excludedOutsideMassachusetts: 0,
        excludedByState: {},
        stateReferenceMismatches: 0,
        byPropertyType: {},
        byState: {},
        byCounty: {},
        byArea: {},
        remarksSuppressed: 0,
        warnings: [],
        compliance,
    };

    for (const row of rows) {
        const listingNumber = readString(row.LIST_NO) || 'unknown';
        const statusCode = readString(row.STATUS);
        const officeId = readString(row.LIST_OFFICE);
        const inputState = normalizeMlsState(row.STATE);
        const townRef = references.towns.get(readString(row.TOWN_NUM));
        const townReferenceState = normalizeMlsState(townRef?.state);
        increment(report.byStatus, statusCode);
        increment(report.byInputState, inputState);

        if (inputState && townReferenceState && inputState !== townReferenceState) {
            quarantined.push({
                listingNumber,
                reasons: ['state_reference_mismatch'],
                inputState,
                townReferenceState,
            });
            report.stateReferenceMismatches += 1;
            report.quarantined += 1;
            continue;
        }

        if (inputState && inputState !== MLS_ALLOWED_STATE) {
            report.excludedOutsideMassachusetts += 1;
            increment(report.excludedByState, inputState);
            continue;
        }

        if (officeId && optOutOfficeIds.has(officeId)) {
            report.excludedByOptOut += 1;
            continue;
        }

        if (!ACTIVE_PUBLIC_STATUSES.includes(statusCode)) {
            increment(report.hiddenByStatus, statusCode);
            continue;
        }

        const reasons = requiredFieldReasons(row);
        const officeRef = references.offices.get(officeId);
        const agentName = references.agents.get(readString(row.LIST_AGENT));

        if (!townRef) {
            reasons.push('missing_town_reference');
        }

        if (!officeRef) {
            reasons.push('missing_office_reference');
        }

        if (!agentName) {
            reasons.push('missing_agent_reference');
        }

        if (reasons.length > 0) {
            quarantined.push({ listingNumber, reasons });
            report.quarantined += 1;
            continue;
        }

        const fairHousingFlags = fairHousingReviewFlags(row.REMARKS);

        if (fairHousingFlags.length > 0) {
            remarksReviews.push({
                listingNumber,
                action: 'remarks_suppressed',
                remarksSha256: sha256Remarks(row.REMARKS),
                fairHousingFlags,
            });
            report.remarksSuppressed += 1;
        }

        const county = readString(row.COUNTY) ||
            references.counties.get(townRef.countyCode) ||
            townRef.countyCode ||
            'Not provided';
        const areaCode = readString(row.AREA);
        const area = areaCode ? references.areas?.get(areaCode) ?? areaCode : '';
        const propertyType = PROPERTY_TYPE_LABELS[propertyClass] ||
            PROPERTY_TYPE_LABELS[readString(row.PROP_TYPE)] ||
            readString(row.PROP_TYPE);
        const photos = buildPhotoUrls(listingNumber, row.PHOTO_COUNT);

        if (photos.length === 0) {
            report.warnings.push({
                listingNumber,
                code: 'missing_photos',
                message: 'Listing has no published photo metadata.',
            });
        }

        const listing = {
            listingNumber,
            propertyType,
            status: {
                code: statusCode,
                label: STATUS_LABELS[statusCode] ?? statusCode,
                isActive: true,
                isContingent: statusCode === 'CTG',
            },
            listPrice: toNumber(row.LIST_PRICE),
            priceLabel: toNumber(row.LIST_PRICE) === null
                ? 'Price unavailable'
                : new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: 'USD',
                    maximumFractionDigits: 0,
                }).format(toNumber(row.LIST_PRICE)),
            address: {
                line: formatAddress(row),
                town: townRef.town,
                area,
                neighborhood: readString(row.NEIGHBORHOOD),
                county,
                state: MLS_ALLOWED_STATE,
                zip: readString(row.ZIP_CODE),
            },
            facts: {
                beds: toNumber(row.NO_BEDROOMS),
                fullBaths: toNumber(row.NO_FULL_BATHS),
                halfBaths: toNumber(row.NO_HALF_BATHS),
                bathsLabel: readString(row.NO_BATHS),
                sqft: toNumber(row.SQUARE_FEET),
                lotSize: toNumber(row.LOT_SIZE),
                acreage: toNumber(row.ACRE),
                yearBuilt: toNumber(row.YEAR_BUILT),
                parking: toNumber(row.TOTAL_PARKING),
                rooms: toNumber(row.NO_ROOMS),
                garageSpaces: toNumber(row.GARAGE_SPACES),
                hasBasement: toBooleanFlag(row.BASEMENT),
            },
            features: {
                style: decodeFieldValues(references.fieldReference, 'STYLE', row.STYLE),
                propertySubtype: propertySubtype(row, propertyClass, references.fieldReference),
                parking: decodeFieldValues(references.fieldReference, 'PARKING_FEATURE', row.PARKING_FEATURE),
                waterfront: decodeFieldValues(references.fieldReference, 'WATERFRONT_FLAG', row.WATERFRONT_FLAG),
                waterView: decodeFieldValues(references.fieldReference, 'WATERVIEW_FLAG', row.WATERVIEW_FLAG),
                rooms: buildRoomDetails(row, references.fieldReference),
                interior: decodeFieldValues(references.fieldReference, 'INTERIOR_FEATURES', row.INTERIOR_FEATURES),
                exterior: decodeFieldValues(references.fieldReference, 'EXTERIOR_FEATURES', row.EXTERIOR_FEATURES),
                basement: decodeFieldValues(references.fieldReference, 'BASEMENT_FEATURE', row.BASEMENT_FEATURE),
                heating: decodeFieldValues(references.fieldReference, 'HEATING', row.HEATING),
                cooling: decodeFieldValues(references.fieldReference, 'COOLING', row.COOLING),
                appliances: decodeFieldValues(references.fieldReference, 'APPLIANCES', row.APPLIANCES),
                roof: decodeFieldValues(references.fieldReference, 'ROOF_MATERIAL', row.ROOF_MATERIAL),
                lot: decodeFieldValues(references.fieldReference, 'LOT_DESCRIPTION', row.LOT_DESCRIPTION),
                water: decodeFieldValues(references.fieldReference, 'WATER', row.WATER),
                sewer: decodeFieldValues(references.fieldReference, 'SEWER', row.SEWER),
                garage: decodeFieldValues(references.fieldReference, 'GARAGE_PARKING', row.GARAGE_PARKING),
            },
            remarks: fairHousingFlags.length > 0 ? '' : readString(row.REMARKS),
            photoCount: photos.length,
            photos,
            openHouses: references.openHouses.get(listingNumber) ?? [],
            virtualTourUrl: sanitizePublicHttpsUrl(references.virtualTours.get(listingNumber)),
            attribution: {
                listingAgent: agentName,
                listingOffice: officeRef.name,
                listingOfficePhone: officeRef.phone,
            },
            source: {
                name: 'MLS Property Information Network, Inc.',
                photoDate: readString(row.PHOTO_DATE),
                listingAlert: readString(row.LISTING_ALERT),
            },
        };

        listings.push(listing);
        report.published += 1;
        increment(report.byPropertyType, propertyType);
        increment(report.byState, listing.address.state);
        increment(report.byCounty, county);
        increment(report.byArea, area || 'Not provided');
    }

    return { listings, quarantined, remarksReviews, report };
}
