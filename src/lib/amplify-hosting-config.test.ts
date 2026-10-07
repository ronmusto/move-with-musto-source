import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    stageAmplifyHostingConfig,
    validateAmplifyHostingConfig,
    validateCustomHeaderConfig,
    validateCustomRules,
} from '../../scripts/check-amplify-hosting-config.mjs';

describe('Amplify hosting policy', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('keeps security headers, cache policy, canonical redirect, and native 404 handling valid', async () => {
        await expect(validateAmplifyHostingConfig()).resolves.toEqual({
            headerConfigPath: expect.stringMatching(/customHttp\.yml$/),
            redirectConfigPath: expect.stringMatching(/custom-rules\.json$/),
        });
    });

    it('stages the custom header policy for manual Amplify ZIP uploads', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'musto-amplify-'));
        await mkdir(join(outputDirectory, '_next', 'static'), { recursive: true });
        await writeFile(join(outputDirectory, 'index.html'), '<!doctype html>', 'utf8');
        await writeFile(join(outputDirectory, '404.html'), '<!doctype html>', 'utf8');

        await stageAmplifyHostingConfig(outputDirectory);

        const staged = await readFile(join(outputDirectory, 'customHttp.yml'), 'utf8');
        expect(staged).toContain("key: 'Content-Security-Policy'");
        expect(staged).toContain("connect-src 'self' https://data.movewithmusto.com");
        expect(staged).toContain("pattern: '/mls/**'");
    });

    it('removes the gated commercial route and its public images from closed builds', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'musto-amplify-hidden-commercial-'));
        await mkdir(join(outputDirectory, '_next', 'static'), { recursive: true });
        await mkdir(join(outputDirectory, 'commercial'), { recursive: true });
        await mkdir(join(outputDirectory, 'images', 'commercial'), { recursive: true });
        await writeFile(join(outputDirectory, 'index.html'), '<!doctype html>', 'utf8');
        await writeFile(join(outputDirectory, '404.html'), '<!doctype html>', 'utf8');
        await writeFile(join(outputDirectory, 'commercial', 'index.html'), 'private', 'utf8');
        await writeFile(join(outputDirectory, 'images', 'commercial', 'streetscape.webp'), 'private', 'utf8');

        await stageAmplifyHostingConfig(outputDirectory);

        await expect(access(join(outputDirectory, 'commercial'))).rejects.toThrow();
        await expect(access(join(outputDirectory, 'images', 'commercial'))).rejects.toThrow();
    });

    it('preserves the commercial route when the built page proves the launch gate was enabled', async () => {
        const outputDirectory = await mkdtemp(join(tmpdir(), 'musto-amplify-public-commercial-'));
        await mkdir(join(outputDirectory, '_next', 'static'), { recursive: true });
        await mkdir(join(outputDirectory, 'commercial'), { recursive: true });
        await writeFile(join(outputDirectory, 'index.html'), '<!doctype html>', 'utf8');
        await writeFile(join(outputDirectory, '404.html'), '<!doctype html>', 'utf8');
        const publicCommercialHtml = [
            '<link rel="canonical" href="https://movewithmusto.com/commercial/">',
            '<h1>A clear starting point for your next commercial move.</h1>',
        ].join('');
        await writeFile(join(outputDirectory, 'commercial', 'index.html'), publicCommercialHtml, 'utf8');

        await stageAmplifyHostingConfig(outputDirectory);

        await expect(readFile(join(outputDirectory, 'commercial', 'index.html'), 'utf8'))
            .resolves.toBe(publicCommercialHtml);
    });

    it('requires the exact canonical MLS data origin in connect-src', async () => {
        const source = await readFile(join(process.cwd(), 'customHttp.yml'), 'utf8');
        const withoutMlsOrigin = source.replace(' https://data.movewithmusto.com', '');

        expect(() => validateCustomHeaderConfig(withoutMlsOrigin)).toThrow(
            /connect-src is missing https:\/\/data\.movewithmusto\.com/i,
        );
    });

    it('rejects catch-all rules that turn missing paths into redirects or successful responses', () => {
        expect(() => validateCustomRules([
            {
                source: 'https://www.movewithmusto.com',
                target: 'https://movewithmusto.com',
                status: '301',
            },
            {
                source: '/<*>',
                target: '/404.html',
                status: '404',
            },
        ])).toThrow(/only the canonical-host redirect/i);
    });
});
