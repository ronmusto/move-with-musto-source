export const noStoreCacheControl = 'no-store';
export const immutableCacheControl = 'public, max-age=31536000, immutable';

const immutableMlsFiles = new Set([
    '/mls/mls-coordinate-index.json',
    '/mls/mls-search-index.json',
    '/mls/mls-search-preferred.json',
]);

function hasValidGeneration(url) {
    const generation = url.searchParams.get('generation');
    return Boolean(generation) && Number.isFinite(Date.parse(generation));
}

function isGenerationVersionedMlsAsset(url) {
    if (!hasValidGeneration(url)) {
        return false;
    }

    return immutableMlsFiles.has(url.pathname) || /^\/mls\/listings\/[^/]+\.json$/u.test(url.pathname);
}

export function cacheControlForStaticRequest(requestUrl) {
    const url = new URL(requestUrl ?? '/', 'http://127.0.0.1');

    // The manifest is the freshness authority and must always reach the active deployment.
    if (url.pathname === '/mls/mls-search-manifest.json') {
        return noStoreCacheControl;
    }

    if (isGenerationVersionedMlsAsset(url) || url.pathname.startsWith('/_next/static/')) {
        return immutableCacheControl;
    }

    return noStoreCacheControl;
}
