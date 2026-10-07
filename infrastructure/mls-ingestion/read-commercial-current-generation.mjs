#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseCommercialCurrentPointer } from './handlers/commercial-publication-pointer.mjs';

const [pointerPath] = process.argv.slice(2);
if (!pointerPath) {
    throw new Error('usage: node read-commercial-current-generation.mjs <current.json>');
}

const pointer = parseCommercialCurrentPointer(JSON.parse(await readFile(pointerPath, 'utf8')));
process.stdout.write(pointer.generation);
