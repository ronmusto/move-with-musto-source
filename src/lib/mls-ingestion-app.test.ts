import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('portable MLS source boundary',()=>{
    it('retains tested processing libraries without private operator launchers or real overrides',()=>{
        expect(existsSync(resolve(process.cwd(),'tools/mls-ingestion-app'))).toBe(false);
        for(const file of ['scripts/mls-pin-cleaner-lib.mjs','scripts/mls-publication-lib.mjs','scripts/enrich-mls-coordinates.mjs'])expect(existsSync(resolve(process.cwd(),file))).toBe(true);
        const overrides=JSON.parse(readFileSync(resolve(process.cwd(),'scripts/mls-coordinate-overrides.json'),'utf8'));
        expect(overrides).toEqual({schemaVersion:'move-with-musto.reviewed-coordinate-overrides.v1',entries:{}});
    });
});
