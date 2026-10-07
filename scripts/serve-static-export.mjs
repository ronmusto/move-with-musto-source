import { readSiteMode } from './site-mode.mjs';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cacheControlForStaticRequest } from './static-export-cache.mjs';

const port = Number(process.env.PORT ?? 3019);

const mimeTypes = new Map([
    ['.avif', 'image/avif'],
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.ico', 'image/x-icon'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.txt', 'text/plain; charset=utf-8'],
    ['.webmanifest', 'application/manifest+json'],
    ['.webp', 'image/webp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
]);

function resolveRequestPath(requestUrl, root) {
    const url = new URL(requestUrl ?? '/', `http://127.0.0.1:${port}`);
    const decodedPath = decodeURIComponent(url.pathname);
    if (decodedPath.includes('\0')) throw new URIError('Invalid path.');
    const safePath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const target = resolve(root, `.${safePath}`);

    if (!target.startsWith(`${root}${sep}`) && target !== root) {
        return null;
    }

    if (existsSync(target)) {
        if (statSync(target).isDirectory()) {
            return join(target, 'index.html');
        }

        return target;
    }

    const nextPageMatch = basename(target).match(/^(__next\.[^.]+)\.(.+\.txt)$/);
    if (nextPageMatch) {
        const nextPageParts = nextPageMatch[2].replace(/\.txt$/, '').split('.');
        const nextPageTarget = join(dirname(target), nextPageMatch[1], ...nextPageParts) + '.txt';
        if (existsSync(nextPageTarget) && !statSync(nextPageTarget).isDirectory()) {
            return nextPageTarget;
        }
    }

    return target;
}

function sendError(response, statusCode, message) {
    response.writeHead(statusCode, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    response.end(message);
}

export function createStaticExportServer({
    rootDirectory = resolve(process.cwd(), readSiteMode() === 'coming-soon' ? 'coming-soon-out' : 'out'),
} = {}) {
    const root = resolve(rootDirectory);
    return createServer((request, response) => {
        let target;
        try {
            target = resolveRequestPath(request.url, root);
            if (!target || !existsSync(target) || !statSync(target).isFile()) {
                sendError(response, 404, 'Not found');
                return;
            }
        } catch (error) {
            if (error instanceof URIError || error?.code === 'ERR_INVALID_URL') {
                sendError(response, 400, 'Invalid request URL');
            } else {
                sendError(response, error?.code === 'ENOENT' ? 404 : 500, 'File unavailable');
            }
            return;
        }

        const stream = createReadStream(target);
        // A file can disappear after stat, or fail while streaming. Keep the
        // failure confined to this response rather than terminating preview.
        stream.on('error', (error) => {
            if (response.headersSent) {
                response.destroy();
            } else {
                sendError(response, error?.code === 'ENOENT' ? 404 : 500, 'File unavailable');
            }
        });
        response.on('close', () => stream.destroy());
        stream.once('open', () => {
            if (response.destroyed) { stream.destroy(); return; }
            response.writeHead(200, {
                'Content-Type': mimeTypes.get(extname(target)) ?? 'application/octet-stream',
                'Cache-Control': cacheControlForStaticRequest(request.url),
            });
            stream.pipe(response);
        });
    });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    createStaticExportServer().listen(port, '127.0.0.1', () => {
        console.log(`Static export server listening at http://127.0.0.1:${port}`);
    });
}
