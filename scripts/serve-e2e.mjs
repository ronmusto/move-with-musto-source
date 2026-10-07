import { resolve } from 'node:path';
import { createStaticExportServer } from './serve-static-export.mjs';

// Browser verification always exercises the full export; production site-mode
// remains unchanged and no already-running development server is reused.
const port = Number(process.env.E2E_PORT || 4319);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('E2E_PORT must be an integer between 1024 and 65535.');
}
createStaticExportServer({ rootDirectory: resolve('out') }).listen(port, '127.0.0.1', () => {
    console.log(`Isolated full-export preview listening at http://127.0.0.1:${port}`);
});
