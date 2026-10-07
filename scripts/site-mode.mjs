import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../', import.meta.url));
export function readSiteMode() {
    const { mode } = JSON.parse(readFileSync(new URL('../site-mode.json', import.meta.url), 'utf8'));
    if (!['coming-soon', 'full'].includes(mode)) throw new Error('site-mode.json must specify coming-soon or full.');
    return mode;
}