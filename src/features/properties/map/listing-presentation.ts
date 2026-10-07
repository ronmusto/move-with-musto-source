import type { MlsSearchListing } from '@/lib/mls-public-listings';

export function listingAddress(listing: MlsSearchListing) {
    return [
        listing.address.line,
        listing.address.town,
        listing.address.state,
        listing.address.zip,
    ].filter(Boolean).join(', ');
}
