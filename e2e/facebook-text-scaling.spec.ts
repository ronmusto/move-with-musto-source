import { expect, test } from './offline-fixture';
import {
    emulateTextOnlyScale,
    expectNoHorizontalOverflow,
    expectNoVisibleTextClipping,
    gotoSuccessful,
} from './ux-test-helpers';

const publicRoutes = [
    '/',
    '/about/',
    '/buy/properties/',
    '/contact/',
    '/privacy/',
    '/sell/',
    '/terms/',
    '/unsubscribe/',
] as const;

const facebookAndroidUserAgent = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 7 Pro Build/UQ1A.240205.004; wv)',
    'AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0',
    'Chrome/126.0.0.0 Mobile Safari/537.36',
    '[FB_IAB/FB4A;FBAV/470.0.0.0.82;]',
].join(' ');

test.describe('Facebook Android embedded-browser text scaling', () => {
    test.use({
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent: facebookAndroidUserAgent,
    });

    test('keeps every public route contained at 150% and 200% text zoom', async ({ page }) => {
        test.setTimeout(120_000);

        for (const width of [320, 360, 390] as const) {
            await page.setViewportSize({ width, height: 844 });

            for (const route of publicRoutes) {
                for (const factor of [1.5, 2] as const) {
                    const context = `Facebook Android ${route} at ${width}px and ${factor * 100}% text`;
                    await gotoSuccessful(page, route);
                    await emulateTextOnlyScale(page, factor);
                    await expectNoHorizontalOverflow(page, context);
                    await expectNoVisibleTextClipping(page, context);
                }
            }
        }
    });

    test('serves one correct viewport and opts out of automatic text inflation', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await gotoSuccessful(page, '/about/');

        const viewportValues = await page.locator('meta[name="viewport"]').evaluateAll(
            (elements) => elements.map((element) => element.getAttribute('content')),
        );
        expect(viewportValues).toEqual(['width=device-width, initial-scale=1, viewport-fit=cover']);

        const textAdjust = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return {
                standard: style.getPropertyValue('text-size-adjust'),
                webkit: style.getPropertyValue('-webkit-text-size-adjust'),
            };
        });
        expect(textAdjust).toEqual({ standard: '100%', webkit: '100%' });
    });
});
