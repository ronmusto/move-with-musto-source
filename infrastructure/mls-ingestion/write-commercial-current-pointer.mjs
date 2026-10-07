#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import {
    createCommercialCurrentPointer,
    parseCommercialCurrentPointer,
} from './handlers/commercial-publication-pointer.mjs';

const [manifestPath, generation, destinationPath] = process.argv.slice(2);
if (!manifestPath || !generation || !destinationPath) {
    throw new Error('usage: node write-commercial-current-pointer.mjs <manifest.json> <generation> <destination.json>');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pointer = createCommercialCurrentPointer(generation, manifest);
parseCommercialCurrentPointer(pointer);
await writeFile(destinationPath, `${JSON.stringify(pointer)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(`Prepared validated commercial current pointer for generation ${generation}.`);
