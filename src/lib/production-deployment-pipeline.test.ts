import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(resolve('.github/workflows/verify-public-source.yml'), 'utf8');
const scripts = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).scripts;
const browserRunner = readFileSync(resolve('scripts/run-e2e.mjs'), 'utf8');

describe('public source verification boundary', () => {
    it('accepts ordinary pull requests with read-only, credential-free verification', () => {
        expect(workflow).toContain('pull_request:');
        expect(workflow).not.toContain('pull_request_target');
        expect(workflow).toContain('contents: read');
        expect(workflow).toContain('persist-credentials: false');
        expect(workflow).not.toMatch(/secrets\.|id-token:|configure-aws-credentials|aws amplify/);
    });

    it('verifies the full application, infrastructure and isolated browser journeys', () => {
        for (const command of ['check:public', 'lint', 'test:infra', 'check:infra', 'test:preview', 'build', 'test:e2e']) {
            expect(workflow).toContain(`npm run ${command}`);
        }
        expect(workflow).toContain('npm test');
        expect(scripts.build).toContain('next build');
        expect(scripts['test:e2e']).toContain('scripts/run-e2e.mjs');
        expect(browserRunner).toContain("run('node_modules/next/dist/bin/next', ['build'])");
    });

    it('omits install hooks, production workflows and operator permissions', () => {
        expect(scripts.prepare).toBeUndefined();
        expect(scripts.postinstall).toBeUndefined();
        expect(Object.keys(scripts).some((key) => /governance|:live|deploy/.test(key))).toBe(false);
        for (const file of [
            '.githooks', '.github/workflows/deploy-production.yml',
            'infrastructure/amplify/github-oidc-deploy-role.json', 'scripts/install-git-hooks.mjs',
        ]) {
            expect(existsSync(resolve(file))).toBe(false);
        }
    });
});
