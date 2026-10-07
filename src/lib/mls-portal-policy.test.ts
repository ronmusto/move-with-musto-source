import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'vitest';

const html = await readFile('infrastructure/mls-ingestion/portal/index.html', 'utf8');
const app = await readFile('infrastructure/mls-ingestion/portal/app.js', 'utf8');

test('uncapped portal confirms needed work and sends the exact policy without emergency mode', async () => {
    document.documentElement.innerHTML = html;
    const portalWindow = window as typeof window & { MLS_INGEST_CONFIG: Record<string, unknown>; policyReady: boolean; sent: Record<string, unknown> };
    const originalConfirm = window.confirm;
    try {
        portalWindow.MLS_INGEST_CONFIG = {
            apiBaseUrl: 'https://api.example.test', cognitoDomain: 'https://auth.example.test',
            redirectUri: 'https://portal.example.test', clientId: 'test123', maxGeocodeRequestsPerRun: -1,
        };
        let prompt = '';
        window.confirm = (text) => { prompt = String(text); return true; };
        window.eval(app.replace(/initialize\(\);\s*$/, '') + `
            window.policyReady = configurationIsReady();
            api = async (url, options) => { window.sent = JSON.parse(options.body); return { message: 'Validation started' }; };
            loadRuns = async () => {};
            elements.runsList.append(renderRun({ runId: 'test-run', state: 'UPLOADED', createdAt: '2026-09-13T00:00:00Z', fileCount: 12 }));
        `);
        assert.equal(portalWindow.policyReady, true);
        const buttons = [...window.document.querySelectorAll('#runs-list button')];
        assert.deepEqual(buttons.map((button) => button.textContent), ['Start validation']);
        (buttons[0] as HTMLButtonElement).click();
        await new Promise((resolve) => setImmediate(resolve));
        assert.match(prompt, /every missing, changed, or expired/);
        assert.match(prompt, /Valid saved coordinates are reused/);
        assert.match(prompt, /no fixed per-update cost maximum/);
        assert.equal(portalWindow.sent.acknowledgedGeocodingRequestCap, -1);
        assert.equal(portalWindow.sent.acknowledgeGeocodingCost, true);
        assert.equal(portalWindow.sent.emergencyUrgentOnly, false);
    } finally {
        window.confirm = originalConfirm;
        document.documentElement.innerHTML = '';
    }
});
