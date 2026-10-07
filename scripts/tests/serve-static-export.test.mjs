import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createStaticExportServer } from '../serve-static-export.mjs';

test('malformed URLs cannot terminate preview and paths stay within its export root', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'mwm-static-security-'));
    const root = join(directory, 'export');
    await mkdir(root);
    await writeFile(join(root, 'index.html'), '<h1>Preview works</h1>');
    await writeFile(join(directory, 'private.txt'), 'outside export');
    const server = createStaticExportServer({ rootDirectory: root });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}${sep}mwm-static-security-`));
        await rm(directory, { recursive: true, force: true });
    });
    const get = (path) => new Promise((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port: server.address().port, path }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, body }));
        });
        req.on('error', reject);
        req.end();
    });
    for (const path of ['/%', '/%ZZ', '/%E0%A4%A', '/%00']) {
        assert.equal((await get(path)).status, 400);
        assert.equal((await get('/')).status, 200);
    }
    for (const path of ['/missing.txt', '/%2e%2e%2fprivate.txt', '/%2e%2e%5cprivate.txt']) {
        assert.equal((await get(path)).status, 404);
    }
    assert.match((await get('/')).body, /Preview works/u);

    // Exercise a filesystem race between stat and open without changing any
    // user files or relying on OS-specific permission semantics.
    const originalReadStream = fs.createReadStream;
    try {
        fs.createReadStream = () => {
            const stream = new PassThrough();
            queueMicrotask(() => stream.destroy(Object.assign(new Error('File removed'), { code: 'ENOENT' })));
            return stream;
        };
        syncBuiltinESMExports();
        assert.equal((await get('/')).status, 404);
    } finally {
        fs.createReadStream = originalReadStream;
        syncBuiltinESMExports();
    }
    assert.equal((await get('/')).status, 200);
});
