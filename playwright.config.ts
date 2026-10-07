import { defineConfig, devices } from '@playwright/test';

const isCI = process.env.CI === 'true';
const port = Number(process.env.E2E_PORT || 4319);
const isExtendedRun = process.env.E2E_EXTENDED === '1';
const isLiveMapRun = process.env.E2E_LIVE_MAPS === '1' && process.env.REQUIRE_GOOGLE_MAPS === '1';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    grep: isLiveMapRun ? /@live/ : isExtendedRun ? undefined : /@smoke/,
    grepInvert: isLiveMapRun ? undefined : /@live/,
    forbidOnly: isCI,
    timeout: isExtendedRun ? 60_000 : 30_000,
    workers: 1,
    retries: isCI ? 2 : 0,
    reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        serviceWorkers: 'block',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
            },
        },
    ],
    webServer: {
        command: 'npm run start:e2e',
        port,
        reuseExistingServer: false,
        env: {
            ...process.env,
            E2E_PORT: String(port),
        },
    },
});
