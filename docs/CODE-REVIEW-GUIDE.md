# Code review guide

This project combines an interactive static frontend with separate serverless
data processing. These paths provide a useful review order without requiring
cloud access or licensed listing data.

## Start with the data contract

Read `src/lib/mls-public-listings.ts` and its tests for the boundary between a
published generation and the browser. Follow the pure filtering and sorting
logic in `src/features/properties/property-search-utils.ts` and its tests.
Look for validation and normalization before values reach presentation code.

## Follow one user journey

Start at `src/features/properties/PropertiesSearch.tsx`, then follow a detail
selection into `search/useListingDetail.ts` and the detail/gallery views.
Delivery and caching live in `search/mls-delivery.ts` and
`search/usePropertySearchDelivery.ts`. Persistence and URL/history helpers
live alongside them.

The map boundary starts at `PropertyMapView.tsx`; SDK interactions and marker
work live under `map/`. Commercial search uses its own listing model and
focused controls under `src/features/commercial/`.

Use the fixture browser suite to try filters, history, details, saved homes,
comparison, mobile layout and the map-unavailable path without production
services. The fixture data is invented and does not represent actual
properties or customers.

## Inspect serverless failure handling

Read `infrastructure/mls-ingestion/handlers/domain.mjs` for request validation
and operator identity, then one of the upload, run or contact handlers.
Tests under `infrastructure/mls-ingestion/tests/` exercise those boundaries
with local service substitutes.

For durable processing, follow `scripts/enrich-mls-coordinates.mjs` into
`scripts/geocode/audit-events.mjs` and `audit-storage.mjs`. The event module
has no listing-data or I/O dependencies; storage behavior is explicit.
`src/lib/mls-coordinate-enrichment.test.ts` covers request planning, cache
retention, failure persistence and audit redaction.

## Review changes by contract

- UI changes: preserve focus/keyboard behavior, narrow-screen layout, history
  restoration and empty/error states.
- Async changes: test delayed success, failure, cancellation and retry. A
  cached response is not trustworthy until it has passed validation.
- Persistence changes: handle blocked storage and malformed saved values.
- Processing changes: use invented fixtures and service substitutes. Do not
  run paid geocoding, import real records or deploy AWS to demonstrate a patch.
- Public-package changes: inspect the exact exported files and notices.
  Deleting something from the latest commit does not remove it from history.

The [architecture guide](ARCHITECTURE.md) explains the boundaries. The
[license](../LICENSE) permits private evaluation and hiring review; it does
not grant general product reuse or public deployment rights.
