#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { createCurrentPointer, parseCurrentPointer } from './handlers/publication-pointer.mjs';

const [manifestPath, generation, destinationPath] = process.argv.slice(2);
if (!manifestPath || !generation || !destinationPath) {
    throw new Error('usage: node write-current-pointer.mjs <manifest.json> <generation> <destination.json>');
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const pointer = createCurrentPointer(generation, manifest);
parseCurrentPointer(pointer);
await writeFile(destinationPath, `${JSON.stringify(pointer)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(`Prepared validated MLS current pointer for generation ${generation}.`);
