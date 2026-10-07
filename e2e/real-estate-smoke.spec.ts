import type { Page } from '@playwright/test';
import { expect, test } from './offline-fixture';
import {
    collectRuntimeProblems,
    expectMinimumTarget,
    expectNoHorizontalOverflow,
    expectNoPrivateMaterialLinks,
    expectVisibleCustomTargetsAtLeast,
    gotoSuccessful,
} from './ux-test-helpers';

const publicRouteChecks = [
    { route: '/', heading: /move with musto/i },
    { route: '/about/', heading: /^mai ly musto\.?$/i },
    { route: '/buy/properties/', heading: /homes for sale with mai ly musto/i },
    { route: '/contact/', heading: /mai ly musto/i },
    { route: '/privacy/', heading: /how inquiry data is handled/i },
    { route: '/sell/', heading: /your next move can start with a simple conversation/i },
    { route: '/terms/', heading: /website and inquiry terms/i },
    { route: '/unsubscribe/', heading: /^unsubscribe\.?$/i },
] as const;

const professionalLicenseLabel = 'Massachusetts Real Estate Salesperson License #9572796-RE-S';

const formerPublicMaterialRoutes = [
    '/guides',
    '/guides/',
    '/guides/buyers',
    '/guides/buyers/',
    '/guides/sellers',
    '/guides/sellers/',
    '/neighborhoods',
    '/neighborhoods/',
    '/buy/neighborhoods',
    '/buy/neighborhoods/',
] as const;

async function assertUsableUnsubscribe(page: Page) {
    const form = page.getByRole('form', { name: /unsubscribe from move with musto updates/i });
    await expect(form.getByRole('button', { name: /^send$/i })).toBeDisabled();
    const fallback = form.getByRole('link', { name: /send an unsubscribe request/i });
    await expect(fallback).toHaveAttribute('href', /^mailto:[^?]+\?subject=Unsubscribe$/i);
}

test.describe('public-site privacy and canonical routes @smoke', () => {
    test('missing inventory fails closed with a clear contact path', async ({ page }) => {
        await page.route('**/mls/**', (route) => route.fulfill({ status: 404, json: { error: 'Unavailable' } }));
        await gotoSuccessful(page, '/buy/properties/');
        await expect(page.getByRole('heading', { name: /home search is temporarily unavailable/i })).toBeVisible();
        await expect(page.getByRole('region', { name: /property search results/i })).toHaveCount(0);
        await expect(page.locator('main').getByRole('link', { name: /email|contact/i }).first()).toHaveAttribute('href', /^mailto:/);
    });

    test('private client materials return direct 404s and are not linked publicly', async ({ page, request }) => {
        for (const route of formerPublicMaterialRoutes) {
            const response = await request.get(route);
            expect(response.status(), `${route} must not be a public website route`).toBe(404);
        }

        for (const { route } of publicRouteChecks) {
            await gotoSuccessful(page, route);
            await expectNoPrivateMaterialLinks(page);
        }
        await gotoSuccessful(page, '/buy/properties/');
        await expectNoPrivateMaterialLinks(page);
    });

    for (const legacyRoute of ['/buy/', '/properties/'] as const) {
        test(`${legacyRoute} preserves its query and hash while canonicalizing`, async ({ page }) => {
            await page.goto(`${legacyRoute}?scope=all&query=Arlington#properties-search-title`);
            await expect(page).toHaveURL((url) => (
                url.pathname === '/buy/properties/' &&
                !url.searchParams.has('scope') &&
                url.searchParams.get('query') === 'Arlington' &&
                url.hash === '#properties-search-title'
            ));
            await expect(page.getByRole('heading', { name: /^homes for sale$/i })).toBeVisible();
        });
    }
});

for (const viewport of [
    { label: 'desktop', width: 1440, height: 1000 },
    { label: '390px mobile', width: 390, height: 844 },
] as const) {
    test.describe(`${viewport.label} public-route experience @smoke`, () => {
        test.use({ viewport: { width: viewport.width, height: viewport.height } });

        test('primary routes render without runtime errors or horizontal overflow', async ({ page }) => {
            const problems = collectRuntimeProblems(page);

            for (const { route, heading } of publicRouteChecks) {
                await gotoSuccessful(page, route);
                await expect(page.locator('main')).toBeVisible();
                await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
                await expectNoPrivateMaterialLinks(page);
                await expectNoHorizontalOverflow(page, `${viewport.label} ${route}`);
                await expectVisibleCustomTargetsAtLeast(page.locator('header'), `${viewport.label} ${route} header`);
                await expectVisibleCustomTargetsAtLeast(page.locator('main'), `${viewport.label} ${route} main controls`);
                const footer = page.locator('footer');
                await expect(footer).toContainText(professionalLicenseLabel);
                await expectVisibleCustomTargetsAtLeast(footer, `${viewport.label} ${route} footer`);
                problems.assertNone(`${viewport.label} ${route}`);
            }
        });

        test('seller page keeps detailed advice off the public page and offers a welcoming next step', async ({ page }, testInfo) => {
            await gotoSuccessful(page, '/sell/');
            await expect(page.getByRole('link', { name: /share what you are considering/i }).first()).toHaveAttribute('href', '#valuation');
            await expect(page.getByText(
                /what sellers need to know|a composed sale, step by step|offer matrix|decision signals?|launch sequence|pricing lenses?/i,
            )).toHaveCount(0);
            await expect(page.getByText(/detailed planning materials that fit your situation/i).first()).toBeVisible();
            await expectVisibleCustomTargetsAtLeast(page.locator('main'), `${viewport.label} seller controls`);
            if (viewport.label === 'desktop') {
                await page.setViewportSize({ width: 1280, height: 640 });
                await expectNoHorizontalOverflow(page, 'short-height seller page');
                await page.screenshot({
                    animations: 'disabled',
                    path: testInfo.outputPath('seller-short-height-1280x640.png'),
                });
            }
        });

        test('unsubscribe always provides an actionable removal path', async ({ page }) => {
            await gotoSuccessful(page, '/unsubscribe/');
            await assertUsableUnsubscribe(page);
        });

        test('homepage market cards and footer keep a natural responsive rhythm', async ({ page }, testInfo) => {
            await gotoSuccessful(page, '/');
            const marketHeading = page.getByRole('heading', { name: /areas served/i });
            await marketHeading.scrollIntoViewIfNeeded();
            for (const name of [
                'Greater Boston',
                'Burlington & Route 128',
                'Greater Lowell & Nashoba',
                'Merrimack Valley',
                'North Shore',
                'Route 2 & MetroWest',
                'South of Boston & Route 128',
            ]) {
                await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
            }
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`home-markets-${viewport.width}.png`),
            });

            const footer = page.locator('footer');
            await footer.scrollIntoViewIfNeeded();
            await expectVisibleCustomTargetsAtLeast(footer, `${viewport.label} homepage footer controls`);
            await page.screenshot({
                animations: 'disabled',
                path: testInfo.outputPath(`home-footer-${viewport.width}.png`),
            });
        });
    });
}

test.describe('mobile navigation and primary touch targets @smoke', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('mobile navigation and primary actions meet the 44px touch target', async ({ page }) => {
        await gotoSuccessful(page, '/');

        const menuToggle = page.getByRole('button', { name: /open navigation menu/i });
        await expectMinimumTarget(menuToggle, 'mobile menu toggle');
        await expectMinimumTarget(page.getByRole('link', { name: /^search homes$/i }), 'home Search homes action');
        await expectMinimumTarget(
            page.getByRole('link', { name: /search service-area homes/i }),
            'home service-area action',
        );

        await menuToggle.click();
        const mobileNavigation = page.getByRole('navigation', { name: /mobile navigation/i });
        await expect(mobileNavigation).toBeVisible();
        for (const name of [/^about$/i, /^buy$/i, /^sell$/i, /^contact$/i]) {
            await expectMinimumTarget(mobileNavigation.getByRole('link', { name }), `mobile ${name} link`);
        }
        await expectMinimumTarget(
            page.getByRole('button', { name: /close navigation menu/i }),
            'mobile menu close button',
        );

        await page.getByRole('button', { name: /close navigation menu/i }).click();
        await gotoSuccessful(page, '/sell/');
        await expectMinimumTarget(page.getByRole('link', { name: /share what you are considering/i }).first(), 'seller consultation action');

        await gotoSuccessful(page, '/unsubscribe/');
        const unsubscribeAction = page.getByRole('button', { name: /unsubscribe from updates/i })
            .or(page.getByRole('link', { name: /send an unsubscribe request/i }));
        await expectMinimumTarget(unsubscribeAction, 'unsubscribe action');
    });
});
test('legal consent links open a new tab whenever configured forms are present', async ({ page }) => {
    const formRoutes = ['/', '/contact/', '/sell/'] as const;

    for (const route of formRoutes) {
        await gotoSuccessful(page, route);
        const consentLinks = page.locator('form a[href="/terms/"], form a[href="/privacy/"]');
        for (let index = 0; index < await consentLinks.count(); index += 1) {
            const link = consentLinks.nth(index);
            await expect(link, `${route} legal consent link should open away from the active form`).toHaveAttribute('target', '_blank');
            await expect(link).toHaveAttribute('rel', /(?:noopener|noreferrer)/);
        }
    }
});
