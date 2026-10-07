import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public source application mode',()=>{
    it('defaults to the full application without changing a private production release',()=>{
        const mode=JSON.parse(readFileSync(resolve(process.cwd(),'site-mode.json'),'utf8'));
        expect(mode).toEqual({mode:'full'});
        const scripts=JSON.parse(readFileSync(resolve(process.cwd(),'package.json'),'utf8')).scripts;
        expect(scripts.build).toContain('next build');
        expect(scripts.build).not.toMatch(/build-site|mls:publish|mls:geocode/);
        expect(existsSync(resolve(process.cwd(),'maintenance'))).toBe(false);
    });
});
