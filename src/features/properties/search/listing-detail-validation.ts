import { isMassachusettsMlsState, type MlsListingDetail } from '@/lib/mls-public-listings';

/** Detail content consumed by the gallery; summary facts stay in its index. */
export type ListingDetailContent = Pick<MlsListingDetail,
    'listingNumber' | 'generatedAt' | 'address' | 'facts' | 'features' |
    'photoCount' | 'remarks' | 'openHouses' | 'virtualTourUrl'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalNumber(value: unknown) {
    return value == null || (typeof value === 'number' && Number.isFinite(value));
}

/** Validate at the network boundary so malformed detail cannot crash rendering. */
export function isDisplayableListingDetail(
    value: unknown,
    listingNumber: string,
    generatedAt: string,
): value is ListingDetailContent {
    if (!isRecord(value) || value.listingNumber !== listingNumber || value.generatedAt !== generatedAt) return false;
    const { address, facts, features, openHouses, photoCount } = value;
    if (!isRecord(address) || typeof address.state !== 'string' || !isMassachusettsMlsState(address.state)) return false;
    if (!['line', 'town', 'county', 'state', 'zip'].every((key) => typeof address[key] === 'string')) return false;
    if (!['area', 'neighborhood'].every((key) => address[key] === undefined || typeof address[key] === 'string')) return false;
    if (!isRecord(facts) || typeof facts.bathsLabel !== 'string') return false;
    if (!['beds', 'fullBaths', 'halfBaths', 'sqft', 'lotSize', 'acreage', 'yearBuilt', 'parking']
        .every((key) => key in facts && isOptionalNumber(facts[key]))) return false;
    if (!['rooms', 'garageSpaces'].every((key) => isOptionalNumber(facts[key]))) return false;
    if (facts.hasBasement != null && typeof facts.hasBasement !== 'boolean') return false;
    if (typeof photoCount !== 'number' || !Number.isSafeInteger(photoCount) || photoCount < 0) return false;
    if (typeof value.remarks !== 'string' || typeof value.virtualTourUrl !== 'string') return false;
    if (!Array.isArray(openHouses) || !openHouses.every((house) => isRecord(house) &&
        ['start', 'end', 'type', 'url'].every((key) => typeof house[key] === 'string'))) return false;
    if (features !== undefined) {
        if (!isRecord(features)) return false;
        const lists = ['style', 'propertySubtype', 'parking', 'waterfront', 'waterView', 'interior',
            'exterior', 'basement', 'heating', 'cooling', 'appliances', 'roof', 'lot', 'water', 'sewer', 'garage'];
        if (!lists.every((key) => features[key] === undefined || isStringList(features[key]))) return false;
        if (features.rooms !== undefined && (!Array.isArray(features.rooms) || !features.rooms.every((room) =>
            isRecord(room) && ['name', 'level', 'dimensions'].every((key) => typeof room[key] === 'string') &&
            isStringList(room.features)))) return false;
    }
    return true;
}
