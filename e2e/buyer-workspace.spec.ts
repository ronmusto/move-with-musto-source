import type { Locator, Page } from '@playwright/test';
import { expect, test } from './offline-fixture';
import {
    collectRuntimeProblems,
    expectMinimumTarget,
    expectNoHorizontalOverflow,
    expectVisibleCustomTargetsAtLeast,
    gotoSuccessful,
} from './ux-test-helpers';

async function openBuyerWorkspace(page: Page) {
    await gotoSuccessful(page, '/buy/properties/');
    const results = page.getByRole('region', { name: /property search results/i });
    await expect(results).toBeVisible();
    await expect(results).not.toHaveAttribute('aria-busy', 'true');
    return results;
}

function interactiveMapLauncher(page: Page) {
    return page.getByRole('button', {
        name: /open interactive map for .* matching homes/i,
    });
}

async function openInteractiveMap(page: Page) {
    const launcher = interactiveMapLauncher(page);
    await expect(launcher).toBeVisible();
    await launcher.click();
    return launcher;
}

async function firstListingCard(page: Page, results: Locator) {
    const card = results.locator('article').filter({
        has: page.getByRole('button', { name: /^view details$/i }),
    }).first();
    await expect(card).toBeVisible();
    return card;
}

async function saveAndCompareFirstHome(page: Page, results: Locator) {
    const card = await firstListingCard(page, results);
    await card.getByRole('button', { name: /^save$/i }).click();
    await card.getByRole('button', { name: /^compare home$/i }).click();
    await expect(page.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /compare homes, 1 selected/i })).toBeVisible();
}

test.describe('buyer search state and results', () => {
    test.use({ viewport: { width: 1440, height: 1000 } });

    test('keeps inventory service-area-only with Recommended sort and coherent List/Gallery/map-launch semantics @smoke', async ({ page }) => {
        const outsideInventoryRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('mls-search-other.json')) outsideInventoryRequests.push(request.url());
        });
        const results = await openBuyerWorkspace(page);
        await expect(page.getByRole('button', { name: /all reviewed mls listings/i })).toHaveCount(0);
        await expect(page.getByText(/across the burlington-centered service area/i).first()).toBeVisible();
        expect(outsideInventoryRequests).toEqual([]);
        await expect(page.getByLabel(/sort results/i)).toHaveValue('recommended:desc');
        await expect(page.getByRole('combobox', { name: /results per page/i })).toHaveValue('10');
        await expect(results.getByText(/active flag:/i)).toHaveCount(0);

        const resultLayout = page.getByRole('group', { name: /view mode|result layout/i });
        const list = resultLayout.getByRole('button', { name: /^list$/i });
        const gallery = resultLayout.getByRole('button', { name: /^grid$/i });
        const mapLauncher = interactiveMapLauncher(page);

        await expect(list).toHaveAttribute('aria-pressed', 'true');
        await expect(gallery).toHaveAttribute('aria-pressed', 'false');
        await expect(resultLayout.getByRole('button', { name: /^map$/i })).toHaveCount(0);
        await expect(mapLauncher).toBeVisible();

        await gallery.click();
        await expect(gallery).toHaveAttribute('aria-pressed', 'true');
        await expect(list).toHaveAttribute('aria-pressed', 'false');

        await mapLauncher.click();
        const mapSurface = page.getByRole('region', { name: /explore homes on the map/i });
        await expect(mapSurface).toBeVisible();
        await expect(gallery).toHaveAttribute('aria-pressed', 'true');
        await expect(results).toBeVisible();
        await expect(results.getByRole('combobox', { name: /results per page/i })).toHaveCount(0);
        await expect(results.locator('[aria-label="Result pages"]')).toHaveCount(0);

        const initialSplitCardCount = await results.locator('article').count();
        expect(initialSplitCardCount).toBe(50);
        const pageBeforeContinuousLoad = new URL(page.url()).searchParams.get('page');
        await results.getByRole('button', { name: /load 50 more homes/i }).scrollIntoViewIfNeeded();
        await expect.poll(async () => results.locator('article').count()).toBeGreaterThan(initialSplitCardCount);
        expect(new URL(page.url()).searchParams.get('page')).toBe(pageBeforeContinuousLoad);

        await page.getByRole('button', { name: /^close$/i }).click();
        await expect(mapSurface).toHaveCount(0);
        await expect(mapLauncher).toBeFocused();
        await expect(gallery).toHaveAttribute('aria-pressed', 'true');

        await mapLauncher.click();
        await expect(mapSurface).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(mapSurface).toHaveCount(0);
        await expect(mapLauncher).toBeFocused();

        await expect(page).not.toHaveURL(/(?:\?|&)scope=/);
        expect(outsideInventoryRequests).toEqual([]);
    });

    test('normalizes obsolete all-scope and out-of-area URL state back to the service area @smoke', async ({ page }) => {
        const outsideInventoryRequests: string[] = [];
        page.on('request', (request) => {
            if (request.url().includes('mls-search-other.json')) outsideInventoryRequests.push(request.url());
        });

        await gotoSuccessful(page, '/buy/properties/?scope=all&state=NH&includeTown=Nashua');
        const results = page.getByRole('region', { name: /property search results/i });
        await expect(results).toBeVisible();
        await expect(results).not.toHaveAttribute('aria-busy', 'true');
        await expect(page).toHaveURL((url) => (
            url.pathname === '/buy/properties/' &&
            !url.searchParams.has('scope') &&
            !url.searchParams.has('state') &&
            !url.searchParams.has('includeTown')
        ));
        await expect(page.getByRole('button', { name: /all reviewed mls listings/i })).toHaveCount(0);
        expect(outsideInventoryRequests).toEqual([]);
    });

    test('desktop map keeps results usable and restores focus when the provider is unavailable', async ({ page }) => {
        const problems = collectRuntimeProblems(page);
        const results = await openBuyerWorkspace(page);
        const mapLauncher = await openInteractiveMap(page);
        const mapSurface = page.getByRole('region', { name: /explore homes on the map/i });
        await expect(mapSurface).toBeVisible();
        await expect(results).toBeVisible();
        await expect(page).toHaveURL(/(?:\?|&)map=1(?:&|$)/);
        await expect(page).not.toHaveURL(/(?:\?|&)(?:mapBounds|mapPolygon)=/);
        await expect(mapSurface.getByRole('heading', { name: /map (?:temporarily unavailable|setup needed)/i })).toBeVisible();
        await expect(mapSurface.getByText(/property list is ready/i)).toBeVisible();
        await expectNoHorizontalOverflow(page, 'desktop map fallback');
        await page.keyboard.press('Escape');
        await expect(mapSurface).toHaveCount(0);
        await expect(mapLauncher).toBeFocused();
        await expect(results).toBeVisible();
        problems.assertNone('desktop buyer map fallback');
    });

    test('touchpad-style scrolling over the desktop map moves the shared page', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await openBuyerWorkspace(page);
        await openInteractiveMap(page);

        const mapSurface = page.getByRole('region', { name: /explore homes on the map/i });
        await expect(mapSurface).toBeVisible();
        const stickyTop = await mapSurface.evaluate((element) => {
            const pane = element.parentElement;
            if (!pane) return 0;
            const top = Number.parseFloat(getComputedStyle(pane).top) || 0;
            const documentTop = pane.getBoundingClientRect().top + window.scrollY;
            window.scrollTo(0, Math.max(0, documentTop - top));
            return top;
        });
        await expect.poll(async () => Math.round((await mapSurface.boundingBox())?.y ?? -1))
            .toBe(Math.round(stickyTop));

        const mapCanvas = mapSurface.getByLabel('Map of matching homes');
        const canvasCount = await mapCanvas.count();
        const gestureTarget = canvasCount === 1 ? mapCanvas : mapSurface;
        const targetBox = await gestureTarget.boundingBox();
        expect(targetBox).not.toBeNull();
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const mapBoxBefore = await mapSurface.boundingBox();
        await page.mouse.move(
            targetBox!.x + (targetBox!.width / 2),
            Math.min((page.viewportSize()?.height ?? 800) - 60, targetBox!.y + targetBox!.height / 2),
        );
        await page.mouse.wheel(0, 600);

        await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);
        const mapBoxAfter = await mapSurface.boundingBox();
        expect(mapBoxBefore).not.toBeNull();
        expect(mapBoxAfter).not.toBeNull();
        expect.soft(Math.abs(mapBoxAfter!.y - mapBoxBefore!.y)).toBeLessThanOrEqual(1);
        await expect(mapSurface).toBeVisible();
    });

    test('listing details survive Back and Forward and retain an early At a glance summary @smoke', async ({ page }) => {
        const results = await openBuyerWorkspace(page);
        const card = await firstListingCard(page, results);
        const address = (await card.getByRole('heading', { level: 3 }).textContent())!.trim();

        await card.getByRole('button', { name: /^view details$/i }).click();
        const details = page.getByRole('dialog', {
            name: new RegExp(`(?:photos|listing details) for ${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
        });
        await expect(details).toBeVisible();
        await expect(page).toHaveURL(/(?:\?|&)listing=[^&]+/);
        await expect(details.getByRole('heading', { name: /at a glance/i })).toBeVisible();
        await expect(details.getByText('Area', { exact: true })).toBeVisible();
        await expect(details.getByText('Key rooms', { exact: true })).toBeVisible();

        await page.goBack();
        await expect(details).toHaveCount(0);
        await expect(results).toBeVisible();
        await expect(page).not.toHaveURL(/(?:\?|&)listing=/);

        await page.goForward();
        await expect(details).toBeVisible();
        await expect(page).toHaveURL(/(?:\?|&)listing=[^&]+/);

        await details.getByRole('button', { name: /request a showing/i }).click();
        await expect(page.getByRole('dialog', { name: /^plan a showing$/i })).toBeVisible();
    });

    test('Saved Homes is a distinct view and Back to search restores prior state @smoke', async ({ page }) => {
        const results = await openBuyerWorkspace(page);
        await page.getByLabel(/sort results/i).selectOption('price:asc');
        const card = await firstListingCard(page, results);

        await card.getByRole('button', { name: /^save$/i }).click();
        await expect(card.getByRole('button', { name: /^saved$/i })).toHaveAttribute('aria-pressed', 'true');

        const savedDock = page.getByRole('button', { name: /show saved homes, 1 saved/i });
        await page.locator('footer').scrollIntoViewIfNeeded();
        await expect(savedDock, 'Saved dock should not cover footer content').toBeHidden();
        await results.scrollIntoViewIfNeeded();
        await expect(savedDock).toBeVisible();
        await savedDock.click();
        await expect(results.getByRole('heading', { name: /^saved homes$/i })).toBeVisible();
        await expect(results.getByRole('button', { name: /back to search/i })).toBeVisible();
        const savedHomeButton = results.getByRole('button', { name: /^saved$/i });
        await expect(savedHomeButton).toHaveCount(1);

        await savedHomeButton.click();
        await expect(results.getByRole('heading', { name: /ready to look again/i })).toBeVisible();
        await expect(results.getByText(/your saved list is clear/i)).toBeVisible();
        const returnToSearch = results.getByRole('button', { name: /return to home search/i });
        await expect(returnToSearch).toBeFocused();

        await returnToSearch.click();
        await expect(results.getByRole('heading', { name: /^saved homes$/i })).toHaveCount(0);
        await expect(results.getByRole('heading', { name: /ready to look again/i })).toHaveCount(0);
        await expect(page.getByLabel(/sort results/i)).toHaveValue('price:asc');
        await expect(page.getByText(/across the burlington-centered service area/i).first()).toBeVisible();
        await expect(page).not.toHaveURL(/(?:\?|&)scope=/);
    });

    test('comparison keeps selection order, supports four homes, and blocks a fifth accessibly @smoke', async ({ page }) => {
        const results = await openBuyerWorkspace(page);
        const selectedAddresses: string[] = [];

        for (let index = 1; index <= 4; index += 1) {
            const compare = results.getByRole('button', { name: /^compare home$/i }).first();
            const card = compare.locator('xpath=ancestor::article[1]');
            selectedAddresses.push((await card.getByRole('heading', { level: 3 }).textContent())!.trim());
            await compare.click();
            await expect(page.getByRole('button', { name: new RegExp(`compare homes, ${index} selected`, 'i') })).toBeVisible();
        }

        await results.getByRole('button', { name: /^compare home$/i }).first().click();
        const limitNotice = page.getByRole('status').filter({ hasText: /you have selected four homes/i });
        await expect(limitNotice).toBeVisible();
        await expect(page.getByRole('button', { name: /compare homes, 4 selected/i })).toBeVisible();
        await limitNotice.getByRole('button', { name: /dismiss/i }).click();
        await expect(limitNotice).toHaveCount(0);

        await page.getByRole('button', { name: /compare homes, 4 selected/i }).click();
        const tray = page.getByRole('complementary', { name: /home comparison drawer/i });
        await expectVisibleCustomTargetsAtLeast(tray, 'desktop comparison tray controls');
        await tray.getByRole('button', { name: /compare details|^details$/i }).click();
        const dialog = page.getByRole('dialog', { name: /compare your homes/i });
        await expect(dialog).toBeVisible();
        await expectVisibleCustomTargetsAtLeast(dialog, 'desktop full comparison controls');
        await expect(dialog.getByRole('table', { name: /selected home comparison/i })).toBeVisible();
        await expect(dialog.getByRole('button', { name: /^remove .* from comparison$/i })).toHaveCount(4);
        await expect.poll(async () => (
            dialog.getByRole('columnheader').locator('h4').allTextContents()
        )).toEqual(selectedAddresses);
    });

    test('keeps an empty Saved dock out of the way and gives a zero-result search clear recovery @smoke', async ({ page }) => {
        const results = await openBuyerWorkspace(page);

        await expect(page.getByRole('button', { name: /show saved homes, 0 saved/i })).toHaveCount(0);

        const address = page.getByLabel(/^address search$/i).first();
        await address.fill('zzzz-no-such-listing-917463');
        await address.press('Enter');
        await expect(results.getByRole('heading', { name: /^no matching homes\.?$/i })).toBeVisible();
        await expect(results.getByRole('button', { name: /clear filters/i })).toBeVisible();
        await expect(results.getByRole('button', { name: /get search help/i })).toBeVisible();
    });

    test('numeric Enter preserves the unsubmitted search draft while explicit buttons activate', async ({ page }) => {
        await gotoSuccessful(page, '/buy/properties/?query=Boston&maxPrice=750000');
        const results = page.getByRole('region', { name: /property search results/i });
        await expect(results).toBeVisible();
        await expect(results).not.toHaveAttribute('aria-busy', 'true');

        const addressSearch = page.getByRole('searchbox', { name: /^address search$/i }).first();
        await expect(addressSearch).toHaveValue('Boston');
        await addressSearch.fill('Burlington');
        const minimumBeds = page.getByRole('combobox', { name: /minimum beds/i });
        await minimumBeds.selectOption('2');
        await minimumBeds.press('Enter');
        await expect(minimumBeds).toHaveValue('2');
        await expect(addressSearch).toHaveValue('Burlington');
        await expect(page).toHaveURL((url) => (
            url.searchParams.get('query') === 'Boston'
            && url.searchParams.get('minBeds') === '2'
            && url.searchParams.get('maxPrice') === '750000'
        ));

        const more = page.getByRole('button', { name: /more filters/i });
        await more.focus();
        await more.press('Enter');
        await expect(page.getByRole('dialog', { name: /more filters/i })).toBeVisible();
    });
});

test.describe('390px buyer workspace', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('keeps collapsed mobile filter criteria visible and easy to clear', async ({ page }) => {
        await openBuyerWorkspace(page);
        await page.getByRole('button', { name: /^filters$/i }).click();
        const dialog = page.getByRole('dialog', { name: /more filters/i });
        await dialog.getByRole('combobox', { name: /home basics property type/i }).selectOption('Single family');
        await dialog.getByRole('spinbutton', { name: /home basics minimum beds/i }).fill('3');
        await dialog.getByRole('spinbutton', { name: /home basics minimum baths/i }).fill('2');
        await dialog.getByRole('group', { name: /price shortcuts/i }).getByRole('button', { name: /up to \$750k/i }).click();
        await dialog.getByRole('button', { name: /close more filters/i }).click();
        const summary = page.getByRole('button', { name: /edit search filters/i });
        await expect(summary).toContainText(/750k/i);
        await expect(summary).toContainText(/3.*bed/i);
        await expect(page.getByRole('button', { name: /filters, 4 active/i })).toBeVisible();
        await page.getByRole('button', { name: /filters, 4 active/i }).click();
        await expect(dialog.getByRole('combobox', { name: /home basics property type/i })).toHaveValue('Single family');
        await dialog.getByRole('button', { name: /reset filters/i }).click();
        await dialog.getByRole('button', { name: /close more filters/i }).click();
        await expect(summary).toContainText(/any location.*any price/i);
        await expect(page.getByRole('button', { name: /^filters$/i })).toBeVisible();
    });

    test('map is a bounded dialog with usable chrome and no horizontal overflow @smoke', async ({ page }, testInfo) => {
        const results = await openBuyerWorkspace(page);
        await saveAndCompareFirstHome(page, results);
        const actions = page.getByRole('navigation', { name: /mobile property search actions/i });
        await expect(actions).toBeVisible();
        await expectVisibleCustomTargetsAtLeast(actions, 'mobile search actions');
        const mapLauncher = actions.getByRole('button', { name: /show property map/i });
        await mapLauncher.click();
        const dialog = page.getByRole('dialog', { name: /explore homes on the map/i });
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await expect.poll(async () => results.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);
        await expectMinimumTarget(dialog.getByRole('button', { name: /show property list/i }), 'mobile map return-to-list button');
        await expectNoHorizontalOverflow(page, '390px map workspace');
        const box = await dialog.boundingBox();
        expect(box).not.toBeNull();
        expect.soft(box!.x).toBeGreaterThanOrEqual(0);
        expect.soft(box!.width).toBeLessThanOrEqual(390);
        expect.soft(box!.y + box!.height).toBeLessThanOrEqual(845);
        await expect(dialog.getByRole('heading', { name: /map (?:setup needed|temporarily unavailable)/i })).toBeVisible();
        await dialog.getByRole('button', { name: /show property list/i }).click();
        await expect(dialog).toHaveCount(0);
        await expect(results).toBeFocused();
        await expect(actions.getByRole('button', { name: /compare homes, 1 selected/i })).toBeVisible();
        await expect(actions.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeVisible();
        await expect(results).toBeVisible();
        await expect.poll(async () => results.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
        await mapLauncher.click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(mapLauncher).toBeFocused();
        await expect.poll(async () => results.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(false);
        await page.screenshot({ path: testInfo.outputPath('buy-mobile-offline-smoke.png'), animations: 'disabled' });
    });

    test('primary buyer controls and listing actions meet the 44px target', async ({ page }, testInfo) => {
        const results = await openBuyerWorkspace(page);
        await expectMinimumTarget(page.getByRole('button', { name: /edit search filters/i }), 'mobile search capsule');
        await expectMinimumTarget(page.getByRole('button', { name: /^filters$/i }), 'mobile advanced filters');
        await expectVisibleCustomTargetsAtLeast(page.getByRole('navigation', { name: /mobile property search actions/i }), 'mobile search actions');
        await page.getByRole('button', { name: /^filters$/i }).click();
        const filterDialog = page.getByRole('dialog', { name: /more filters/i });
        await expect(filterDialog.getByRole('heading', { name: /home basics/i })).toBeVisible();
        await expect(filterDialog.getByLabel(/home basics property type/i)).toBeVisible();
        await expect(filterDialog.getByLabel(/home basics minimum beds/i)).toBeVisible();
        await expect(filterDialog.getByLabel(/home basics maximum baths/i)).toBeVisible();
        await expectVisibleCustomTargetsAtLeast(filterDialog, '390px More filters controls');
        await filterDialog.getByRole('button', { name: /close more filters/i }).click();

        const card = await firstListingCard(page, results);
        for (const name of [/^save$/i, /^compare home$/i, /^view details$/i]) {
            const action = card.getByRole('button', { name });
            await action.scrollIntoViewIfNeeded();
            await expectMinimumTarget(action, `mobile listing ${name} action`);
        }
        await expectNoHorizontalOverflow(page, '390px buyer results');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('buy-mobile-results-390.png'),
        });

        await card.getByRole('button', { name: /^view details$/i }).click();
        const details = page.getByRole('dialog', { name: /photos for|listing details for/i });
        await expect(details).toBeVisible();
        await expectVisibleCustomTargetsAtLeast(details, '390px listing details controls');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('buy-mobile-details-390.png'),
        });
    });

    test('mobile comparison keeps controls and home context readable while scrolling', async ({ page }, testInfo) => {
        const results = await openBuyerWorkspace(page);
        for (let index = 0; index < 2; index += 1) {
            await results.getByRole('button', { name: /^compare home$/i }).first().click();
        }

        const dock = page.getByRole('button', { name: /compare homes, 2 selected/i });
        await dock.click();
        const tray = page.getByRole('complementary', { name: /home comparison drawer/i });
        await expectVisibleCustomTargetsAtLeast(tray, '390px comparison tray controls');
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('buy-mobile-comparison-tray-390.png'),
        });

        await tray.getByRole('button', { name: /compare details|^details$/i }).click();
        const full = page.getByRole('dialog', { name: /compare your homes/i });
        await expectVisibleCustomTargetsAtLeast(full, '390px full comparison controls');
        const scrollingBody = full.locator('[class*="fullComparisonBody"]');
        await scrollingBody.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        await expect(full.getByRole('rowheader', { name: /price/i }).first()).toBeVisible();
        await page.screenshot({
            animations: 'disabled',
            path: testInfo.outputPath('buy-mobile-comparison-full-390.png'),
        });
    });


});
