import type { Locator, Page } from '@playwright/test';
import { expect, test } from './offline-fixture';
import {
    expectMinimumTarget,
    expectNoBuyerWorkspaceClipping,
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

function globalSavedCompareDock(page: Page) {
    return page
        .getByRole('complementary', { name: /map and listing status/i })
        .getByRole('group', { name: /search contact and home collections/i });
}

async function saveAndCompareFirstHome(page: Page, results: Locator) {
    const card = await firstListingCard(page, results);
    await card.getByRole('button', { name: /^save$/i }).click();
    await card.getByRole('button', { name: /^compare home$/i }).click();
    await expect(page.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /compare homes, 1 selected/i })).toBeVisible();
}

async function expectNoOverlap(first: Locator, second: Locator, context: string) {
    const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
    expect(firstBox, `${context}: first element should have measurable geometry`).not.toBeNull();
    expect(secondBox, `${context}: second element should have measurable geometry`).not.toBeNull();

    const overlapWidth = Math.max(0, Math.min(
        firstBox!.x + firstBox!.width,
        secondBox!.x + secondBox!.width,
    ) - Math.max(firstBox!.x, secondBox!.x));
    const overlapHeight = Math.max(0, Math.min(
        firstBox!.y + firstBox!.height,
        secondBox!.y + secondBox!.height,
    ) - Math.max(firstBox!.y, secondBox!.y));

    expect.soft(overlapWidth * overlapHeight, context).toBe(0);
}

test.describe('search composer width sweep', () => {
    test('keeps the map-closed filters compact, readable, and fully contained', async ({ page }) => {
        for (const width of [640, 768, 900, 1024, 1280, 1440, 1920]) {
            await page.setViewportSize({ width, height: 900 });
            await gotoSuccessful(page, '/buy/properties/');

            if (width <= 640) {
                const capsule = page.locator('[data-compact="true"]').first();
                const filters = capsule.getByRole('button', { name: /^filters$/i });
                await expect(capsule).toBeVisible();
                await expectMinimumTarget(filters, `${width}px compact filters`);
                await expectMinimumTarget(
                    capsule.getByRole('button', { name: /^edit search filters:/i }),
                    `${width}px compact search summary`,
                );
                await expectVisibleCustomTargetsAtLeast(capsule, `${width}px compact filter capsule`);
                await expectNoHorizontalOverflow(page, `${width}px compact filter capsule`);
                const capsuleBox = await capsule.boundingBox();
                expect(capsuleBox).not.toBeNull();
                expect(capsuleBox!.height, `${width}px capsule should stay compact`).toBeLessThanOrEqual(100);

                await filters.click();
                const dialog = page.getByRole('dialog', { name: /more filters/i });
                await expect(dialog).toBeVisible();
                await expect(dialog.getByRole('combobox', { name: /home basics property type/i })).toBeVisible();
                await expectVisibleCustomTargetsAtLeast(dialog, `${width}px filter dialog`);
                await expectNoHorizontalOverflow(page, `${width}px open filter dialog`);
                await dialog.getByRole('button', { name: /close more filters/i }).click();
                await expect(filters).toBeFocused();
                continue;
            }

            const composer = page.getByRole('search', { name: /property search filters/i });
            await expect(composer).toBeVisible();
            await expectNoHorizontalOverflow(page, `${width}px map-closed search composer`);

            const geometry = await composer.evaluate((element) => {
                const formRect = element.getBoundingClientRect();
                const visibleControls = Array.from(element.querySelectorAll('input, select, button'))
                    .map((control) => ({
                        label: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
                        rect: control.getBoundingClientRect(),
                        style: getComputedStyle(control),
                    }))
                    .filter(({ rect, style }) => (
                        rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
                    ));
                const address = element.querySelector<HTMLInputElement>('input[aria-label="Address search"]');

                return {
                    height: formRect.height,
                    addressWidth: address?.getBoundingClientRect().width ?? 0,
                    outside: visibleControls.flatMap(({ label, rect }) => (
                        rect.left < formRect.left - 1 || rect.right > formRect.right + 1
                            ? [{ label, left: rect.left, right: rect.right }]
                            : []
                    )),
                    undersized: visibleControls.flatMap(({ label, rect }) => (
                        rect.height < 43.5 ? [{ label, height: rect.height }] : []
                    )),
                };
            });

            expect.soft(geometry.outside, `${width}px controls should stay inside the composer`).toEqual([]);
            expect.soft(geometry.undersized, `${width}px controls should preserve touch targets`).toEqual([]);
            expect.soft(geometry.addressWidth, `${width}px location field should remain usable`).toBeGreaterThanOrEqual(180);
            expect.soft(
                geometry.height,
                `${width}px composer should not become a filter wall`,
            ).toBeLessThanOrEqual(190);
        }
    });
});

test.describe('desktop buyer width sweep', () => {
    test('keeps the closed action dock inside the map rail at every desktop width', async ({ page }) => {
        await page.setViewportSize({ width: 1024, height: 900 });
        const results = await openBuyerWorkspace(page);
        await saveAndCompareFirstHome(page, results);

        for (const width of [1024, 1100, 1280, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            const searchRail = page.getByRole('complementary', { name: /map and listing status/i });
            const actionDock = globalSavedCompareDock(page);
            await expect(actionDock).toBeVisible();
            await expectNoOverlap(
                actionDock,
                results,
                `${width}px search actions should stay out of the listing column`,
            );

            const [railBox, dockBox] = await Promise.all([
                searchRail.boundingBox(),
                actionDock.boundingBox(),
            ]);
            expect(railBox).not.toBeNull();
            expect(dockBox).not.toBeNull();
            expect.soft(dockBox!.x, `${width}px action dock left edge`).toBeGreaterThanOrEqual(railBox!.x - 1);
            expect.soft(
                dockBox!.x + dockBox!.width,
                `${width}px action dock right edge`,
            ).toBeLessThanOrEqual(railBox!.x + railBox!.width + 1);
        }
    });

    for (const width of [1024, 1100, 1280, 1440]) {
        test(`${width}px keeps split panes, cards, and actions inside their containers`, async ({ page }, testInfo) => {
            await page.setViewportSize({ width, height: 900 });
            const results = await openBuyerWorkspace(page);
            await saveAndCompareFirstHome(page, results);
            const globalDock = globalSavedCompareDock(page);
            const searchRail = page.getByRole('complementary', { name: /map and listing status/i });
            const globalCollections = globalDock.getByLabel(/saved and compared homes/i);
            const globalContact = globalDock.getByRole('button', { name: /contact mai ly/i });
            await expect(globalDock).toBeVisible();
            await expect(globalCollections).toBeVisible();
            await expectNoOverlap(
                globalDock,
                results,
                `${width}px search actions should stay out of the listing column`,
            );
            const [railBox, dockBox] = await Promise.all([
                searchRail.boundingBox(),
                globalDock.boundingBox(),
            ]);
            expect(railBox).not.toBeNull();
            expect(dockBox).not.toBeNull();
            expect.soft(dockBox!.x, `${width}px action rail left edge`).toBeGreaterThanOrEqual(railBox!.x - 1);
            expect.soft(
                dockBox!.x + dockBox!.width,
                `${width}px action rail right edge`,
            ).toBeLessThanOrEqual(railBox!.x + railBox!.width + 1);
            await expect(globalContact).toBeVisible();
            await openInteractiveMap(page);
            const mapSurface = page.getByRole('region', { name: /explore homes on the map/i });
            await expect(mapSurface).toBeVisible();
            await expect(globalDock).toHaveCount(0);
            const mapActions = mapSurface.getByRole('group', {
                name: /search contact and home collections/i,
            });
            const mapCollections = mapActions.getByLabel(/saved and compared homes/i);
            await expect(mapActions.getByRole('button', { name: /contact mai ly/i })).toBeVisible();
            await expect(mapCollections).toBeVisible();
            await expect(mapCollections.getByRole('button', { name: /compare homes, 1 selected/i })).toBeVisible();
            await expect(mapCollections.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeVisible();
            await firstListingCard(page, results);

            // This suite deliberately supplies no Maps key or real coordinates.
            // The fallback must remain useful and keep its contact controls clear.
            const fallback = mapSurface.getByRole('status');
            await expect(fallback.getByRole('heading', { name: 'Map temporarily unavailable', exact: true })).toBeVisible();
            await expectMinimumTarget(fallback.getByRole('button', { name: /get search help/i }), `${width}px map fallback search help`);
            await expectNoOverlap(mapCollections, fallback, `${width}px collection controls should not cover fallback content`);

            await expectNoHorizontalOverflow(page, `${width}px desktop buyer workspace`);
            await expectNoBuyerWorkspaceClipping(page, `${width}px desktop buyer workspace`);

            const actionContainment = await results.locator('article').evaluateAll((cards) => cards.flatMap((card) => {
                const cardRect = card.getBoundingClientRect();
                return Array.from(card.querySelectorAll('button')).flatMap((button) => {
                    const rect = button.getBoundingClientRect();
                    if (rect.width === 0 || rect.height === 0) return [];
                    return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1
                        ? []
                        : [{ label: button.textContent?.trim() ?? '', cardWidth: cardRect.width, left: rect.left, right: rect.right }];
                });
            }));
            expect.soft(actionContainment, `${width}px listing actions should remain fully inside each card`).toEqual([]);
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`buy-split-${width}.png`),
            });
            await mapSurface.getByRole('button', { name: /^close$/i }).click();
            await expect(globalDock).toBeVisible();
            await expect(globalDock.getByRole('button', { name: /compare homes, 1 selected/i })).toBeVisible();
            await expect(globalDock.getByRole('button', { name: /show saved homes, 1 saved/i })).toBeVisible();
        });
    }

    test('short desktop windows keep both sticky map states inside the viewport', async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 600 });
        const results = await openBuyerWorkspace(page);
        const siteHeader = page.getByRole('banner');
        const closedMapRail = page.getByRole('complementary', { name: /map and listing status/i });

        await results.locator('article').nth(4).scrollIntoViewIfNeeded();
        const headerBox = await siteHeader.boundingBox();
        const closedRailBox = await closedMapRail.boundingBox();
        expect(headerBox).not.toBeNull();
        expect(closedRailBox).not.toBeNull();
        expect.soft(closedRailBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height + 12);
        expect.soft(closedRailBox!.y + closedRailBox!.height).toBeLessThanOrEqual(588);

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
        const openMapBox = await mapSurface.boundingBox();
        expect(openMapBox).not.toBeNull();
        expect.soft(openMapBox!.y + openMapBox!.height).toBeLessThanOrEqual(588);

        await results.locator('article').nth(7).scrollIntoViewIfNeeded();
        const mapBoxAfterResultsScroll = await mapSurface.boundingBox();
        expect(mapBoxAfterResultsScroll).not.toBeNull();
        expect.soft(Math.abs(mapBoxAfterResultsScroll!.y - openMapBox!.y)).toBeLessThanOrEqual(1);
        expect.soft(Math.abs(mapBoxAfterResultsScroll!.height - openMapBox!.height)).toBeLessThanOrEqual(1);
    });
});
