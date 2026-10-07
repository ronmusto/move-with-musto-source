#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseCurrentPointer } from './handlers/publication-pointer.mjs';

const [pointerPath] = process.argv.slice(2);
if (!pointerPath) {
    throw new Error('usage: node read-current-generation.mjs <current.json>');
}

const pointer = parseCurrentPointer(JSON.parse(await readFile(pointerPath, 'utf8')));
process.stdout.write(pointer.generation);
