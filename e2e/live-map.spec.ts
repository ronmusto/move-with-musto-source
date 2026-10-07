import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { expectVisibleCustomTargetsAtLeast, gotoSuccessful } from './ux-test-helpers';

// Provider tests are separate from the offline suites and require both flags.
const liveMapsEnabled = process.env.E2E_LIVE_MAPS === '1' && process.env.REQUIRE_GOOGLE_MAPS === '1';
test.skip(!liveMapsEnabled, 'Set E2E_LIVE_MAPS=1 and REQUIRE_GOOGLE_MAPS=1 for explicitly authorized provider checks.');
test.setTimeout(90_000);

test.beforeEach(async ({ context }) => {
    // Even an opted-in map check cannot submit an inquiry or mutate a service.
    await context.route('**/*', (route) => (
        ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())
            ? route.continue()
            : route.abort('blockedbyclient')
    ));
});

async function openBuyerWorkspace(page: Page, address?: string) {
    const query = address ? `?${new URLSearchParams({ query: address })}` : '';
    await gotoSuccessful(page, `/buy/properties/${query}`);
    const results = page.getByRole('region', { name: /property search results/i });
    await expect(results).toBeVisible();
    await expect(results).not.toHaveAttribute('aria-busy', 'true');
    return results;
}

async function expectReadyMap(mapSurface: Locator) {
    await expect(mapSurface).toBeVisible();
    const drawArea = mapSurface.getByRole('button', { name: /draw area|redraw area/i });
    // This is a provider check: a graceful fallback is a failed precondition,
    // not evidence that the live map passed.
    await expect(drawArea, 'The opted-in check requires configured Google Maps and current reviewed coordinates')
        .toBeEnabled({ timeout: 30_000 });
    return drawArea;
}

async function drawMapArea(page: Page, mapSurface: Locator) {
    const drawingSurface = mapSurface.getByLabel(/draw a map search area/i);
    await expect(drawingSurface).toBeVisible();
    const box = await drawingSurface.boundingBox();
    expect(box).not.toBeNull();
    const path = [
        [box!.x + box!.width * 0.2, box!.y + box!.height * 0.25],
        [box!.x + box!.width * 0.78, box!.y + box!.height * 0.25],
        [box!.x + box!.width * 0.78, box!.y + box!.height * 0.72],
        [box!.x + box!.width * 0.2, box!.y + box!.height * 0.72],
        [box!.x + box!.width * 0.2, box!.y + box!.height * 0.25],
    ] as const;
    await page.mouse.move(path[0][0], path[0][1]);
    await page.mouse.down();
    for (const [x, y] of path.slice(1)) await page.mouse.move(x, y, { steps: 6 });
    await page.mouse.up();
    await expect(page).toHaveURL(/(?:\?|&)mapPolygon=[^&]+/);
}

test.describe('@live real-map service-inventory performance', () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    test('renders reviewed service-area pins without requesting outside inventory', async ({ page }, testInfo) => {
        const outsideInventoryRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('mls-search-other.json')) outsideInventoryRequests.push(request.url());
        });
        await openBuyerWorkspace(page);
        expect(outsideInventoryRequests).toEqual([]);
        await page.evaluate(() => {
            const evidence = { longTasks: [] as number[], startedAt: performance.now() };
            const observer = 'PerformanceObserver' in window
                ? new PerformanceObserver((list) => {
                    evidence.longTasks.push(...list.getEntries().map((entry) => entry.duration));
                })
                : null;
            // Do not count buffered work from before the map opened.
            observer?.observe({ type: 'longtask' });
            Object.assign(window, { __uxMapPerformanceEvidence: evidence, __uxMapPerformanceObserver: observer });
        });

        await page.getByRole('button', { name: /open interactive map for .* matching homes/i }).click();
        const mapSurface = page.getByRole('region', { name: /explore homes on the map/i });
        const drawArea = await expectReadyMap(mapSurface);
        await expect(mapSurface).not.toContainText(/current scope|reviewed coordinates|saved coordinates/i);
        await expect(mapSurface.getByRole('button', {
            name: /(?:^show .+|^[\d,]+ homes$)/i,
        }).first()).toBeVisible({ timeout: 45_000 });
        const metrics = await page.evaluate(() => {
            const target = window as typeof window & {
                __uxMapPerformanceEvidence?: { longTasks: number[]; startedAt: number };
                __uxMapPerformanceObserver?: PerformanceObserver;
            };
            target.__uxMapPerformanceObserver?.disconnect();
            const evidence = target.__uxMapPerformanceEvidence;
            if (!evidence) throw new Error('Map performance collection was not initialized.');
            return {
                elapsedMs: Math.round(performance.now() - evidence.startedAt),
                longTaskCount: evidence.longTasks.length,
                longestTaskMs: Math.round(Math.max(0, ...evidence.longTasks)),
            };
        });
        await testInfo.attach('map-performance', {
            body: JSON.stringify(metrics, null, 2), contentType: 'application/json',
        });
        expect(metrics.elapsedMs).toBeLessThan(45_000);
        expect(metrics.longestTaskMs).toBeLessThan(2_000);

        const interactionStartedAt = Date.now();
        await drawArea.click();
        await expect(mapSurface.getByLabel(/draw a map search area/i)).toBeVisible();
        expect(Date.now() - interactionStartedAt).toBeLessThan(2_500);
        await mapSurface.getByRole('button', { name: /cancel drawing/i }).click();
        await expect(page).not.toHaveURL(/(?:\?|&)(?:mapBounds|mapPolygon)=/);
        await expect(mapSurface).toBeVisible();
        expect(outsideInventoryRequests).toEqual([]);
    });
});

test.describe('@live 390px map', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('opens pin details and applies a freehand area on mobile', async ({ page }) => {
        const address = process.env.E2E_LIVE_LISTING_ADDRESS?.trim() ?? '';
        expect(address, 'Set E2E_LIVE_LISTING_ADDRESS to a current, uniquely searchable address with reviewed coordinates')
            .not.toBe('');
        // The mobile quick-search form is intentionally collapsed. Restore a
        // targeted search through the same supported URL contract used by links.
        const results = await openBuyerWorkspace(page, address);
        await expect(results.getByRole('heading', { name: address, exact: true })).toBeVisible();
        await page.getByRole('navigation', { name: 'Mobile property search actions' })
            .getByRole('button', { name: 'Show property map', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: /explore homes on the map/i });
        const drawArea = await expectReadyMap(dialog);
        const escapedAddress = address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const marker = dialog.getByRole('button', { name: new RegExp(`^Show ${escapedAddress}(?:,|$)`, 'i') });
        await expect(marker).toBeVisible({ timeout: 20_000 });
        const [markerBox, toolbarBox] = await Promise.all([
            marker.boundingBox(),
            dialog.getByRole('toolbar', { name: /map search tools/i }).boundingBox(),
        ]);
        expect(markerBox).not.toBeNull();
        expect(toolbarBox).not.toBeNull();
        expect(markerBox!.y).toBeGreaterThanOrEqual(toolbarBox!.y + toolbarBox!.height);
        await marker.click();
        const selectedCard = dialog.getByRole('article', { name: new RegExp(`^Selected home: ${escapedAddress}(?:,|$)`, 'i') });
        await expect(selectedCard).toBeVisible();
        await expectVisibleCustomTargetsAtLeast(selectedCard, '390px selected map home card');

        const cameraBeforeDetails = new URL(page.url()).searchParams.get('mapCenter');
        await selectedCard.getByRole('button', { name: 'Details', exact: true }).click();
        const details = page.getByRole('dialog', { name: `Photos for ${address}`, exact: true });
        await expect(details).toBeVisible();
        await details.getByRole('button', { name: /back to map/i }).click();
        await expect(dialog).toBeVisible();
        expect(new URL(page.url()).searchParams.get('mapCenter')).toBe(cameraBeforeDetails);

        await dialog.getByRole('button', { name: /dismiss selected home/i }).click();
        await expect(marker).toBeFocused();
        await drawArea.click();
        await drawMapArea(page, dialog);
        await dialog.getByRole('button', { name: /edit area/i }).click();
        await expect(dialog.getByRole('button', { name: /done editing/i })).toBeVisible();
        await dialog.getByRole('button', { name: /done editing/i }).click();
        await expect(dialog).toBeVisible();
    });
});
