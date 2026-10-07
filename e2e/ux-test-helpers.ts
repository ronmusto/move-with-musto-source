import { expect, type Locator, type Page } from '@playwright/test';

export type RuntimeProblemCollector = ReturnType<typeof collectRuntimeProblems>;

export function collectRuntimeProblems(page: Page) {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (message) => {
        if (message.type() === 'error') {
            const text = message.text();
            // The managed test browser reports its network policy as a console error
            // when it blocks MLS photos or Google Maps. Product-owned runtime errors
            // and ordinary missing resources remain failures.
            if (!/^Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED$/u.test(text)) {
                consoleErrors.push(text);
            }
        }
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    return {
        assertNone(context: string) {
            expect.soft(consoleErrors, `${context} emitted console errors`).toEqual([]);
            expect.soft(pageErrors, `${context} emitted uncaught page errors`).toEqual([]);
            consoleErrors.length = 0;
            pageErrors.length = 0;
        },
    };
}

export async function settleLayout(page: Page) {
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    }));
}

export async function expectNoHorizontalOverflow(page: Page, context: string) {
    await settleLayout(page);
    const measurements = await page.evaluate(() => ({
        body: document.body.scrollWidth,
        document: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
    }));
    const widest = Math.max(measurements.body, measurements.document);

    expect.soft(
        widest,
        `${context} horizontally overflows (${widest}px content in a ${measurements.viewport}px viewport)`,
    ).toBeLessThanOrEqual(measurements.viewport + 1);
}

export async function emulateTextOnlyScale(page: Page, factor: number) {
    await settleLayout(page);
    await page.evaluate((scale) => {
        const hiddenClass = /(?:honeypot|visuallyHidden|scrollSentinel)/iu;
        const targets: Array<[HTMLElement, number]> = [];

        for (const element of document.body.querySelectorAll<HTMLElement>('*')) {
            if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG'].includes(element.tagName)) continue;
            if (element.matches('[hidden], [inert], [aria-hidden="true"]')) continue;
            if (element.closest('[hidden], [inert], [aria-hidden="true"]')) continue;
            if (hiddenClass.test(String(element.className))) continue;

            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (
                style.display === 'none'
                || style.visibility === 'hidden'
                || Number(style.opacity) === 0
                || rect.width <= 1
                || rect.height <= 1
            ) continue;

            const ownsText = Array.from(element.childNodes).some(
                (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
            );
            const isTextControl = element.matches('input:not([type="hidden"]), select, textarea');
            if (!ownsText && !isTextControl) continue;

            const fontSize = Number.parseFloat(style.fontSize);
            if (Number.isFinite(fontSize) && fontSize > 0) {
                targets.push([element, fontSize]);
            }
        }

        // Apply from a complete computed-size snapshot so nested text never
        // compounds. This models host-level WebView text zoom without changing
        // rem-based spacing or the layout viewport.
        for (const [element, fontSize] of targets) {
            element.style.setProperty('font-size', `${fontSize * scale}px`, 'important');
        }
    }, factor);
    await settleLayout(page);
}

export async function expectNoVisibleTextClipping(page: Page, context: string) {
    await settleLayout(page);
    const issues = await page.evaluate(() => {
        const viewportWidth = document.documentElement.clientWidth;
        const tolerance = 2;
        const hiddenClass = /(?:honeypot|visuallyHidden|scrollSentinel)/iu;
        const intentionalScrollerSelector = [
            '[class*="galleryCompactStrip"]',
            '[class*="comparisonTrayList"]',
            '[class*="fullComparisonBody"]',
            '[class*="mapToolbar"]',
            '[class*="mapToolbarAreaActions"]',
        ].join(',');

        const isHidden = (element: Element) => {
            if (!(element instanceof HTMLElement)) return true;
            if (element.matches('[hidden], [inert], [aria-hidden="true"]')) return true;
            if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return true;
            if (hiddenClass.test(String(element.className))) return true;

            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            if (
                style.display === 'none'
                || style.visibility === 'hidden'
                || Number(style.opacity) === 0
                || rect.width === 0
                || rect.height === 0
            ) return true;
            if (
                rect.width <= 1
                && rect.height <= 1
                && (style.clip !== 'auto' || style.clipPath !== 'none')
            ) return true;
            return element.matches('a') && rect.bottom <= 0;
        };

        const isInsideIntentionalScroller = (element: Element) => {
            const scroller = element.closest(intentionalScrollerSelector);
            return scroller !== null && scroller !== element;
        };

        const describe = (
            element: HTMLElement,
            kind: string,
            rect: DOMRect,
            clippingAncestor = '',
        ) => ({
            kind,
            tag: element.tagName.toLowerCase(),
            label: (
                element.getAttribute('aria-label')
                || element.textContent
                || ''
            ).trim().replace(/\s+/gu, ' ').slice(0, 110),
            className: String(element.className).slice(0, 140),
            left: Math.round(rect.left * 10) / 10,
            right: Math.round(rect.right * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            clippingAncestor,
        });

        const found: ReturnType<typeof describe>[] = [];
        const semanticSelector = [
            'header',
            'main',
            'footer',
            'section',
            'article',
            'form',
            'fieldset',
            '[role="dialog"]',
            '[role="region"]',
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'p',
            'li',
            'dl',
            'dt',
            'dd',
            'a',
            'button',
            'label',
            'input',
            'select',
            'textarea',
        ].join(',');

        for (const element of document.querySelectorAll<HTMLElement>(semanticSelector)) {
            if (isHidden(element) || isInsideIntentionalScroller(element)) continue;
            const rect = element.getBoundingClientRect();
            if (rect.left < -tolerance || rect.right > viewportWidth + tolerance) {
                found.push(describe(element, 'semantic-viewport', rect));
            }
        }

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent?.trim()) continue;
            const parent = node.parentElement;
            if (!parent || isHidden(parent) || parent.closest(intentionalScrollerSelector)) continue;

            const range = document.createRange();
            range.selectNodeContents(node);
            for (const rect of Array.from(range.getClientRects())) {
                if (rect.width === 0 || rect.height === 0) continue;
                if (rect.left < -tolerance || rect.right > viewportWidth + tolerance) {
                    found.push(describe(parent, 'text-viewport', rect));
                    break;
                }

                let ancestor = parent.parentElement;
                while (ancestor && ancestor !== document.body) {
                    const style = getComputedStyle(ancestor);
                    if (style.overflowX === 'hidden' || style.overflowX === 'clip') {
                        const ancestorRect = ancestor.getBoundingClientRect();
                        if (
                            rect.left < ancestorRect.left - tolerance
                            || rect.right > ancestorRect.right + tolerance
                        ) {
                            found.push(describe(
                                parent,
                                'text-clipped-by-ancestor',
                                rect,
                                `${ancestor.tagName.toLowerCase()}.${String(ancestor.className).slice(0, 90)}`,
                            ));
                            break;
                        }
                    }
                    ancestor = ancestor.parentElement;
                }
            }
        }

        return Array.from(new Map(
            found.map((issue) => [
                `${issue.kind}|${issue.tag}|${issue.className}|${issue.label}|${issue.clippingAncestor}`,
                issue,
            ]),
        ).values());
    });

    expect.soft(issues, `${context} has visible text or semantic content outside its bounds`).toEqual([]);
}

export async function expectNoBuyerWorkspaceClipping(page: Page, context: string) {
    const clipped = await page.locator([
        '.property-search-results-pane',
        '.property-search-summary-rail',
        '[aria-label="Property search results"] article',
        '[aria-label="Property search filters"]',
    ].join(',')).evaluateAll((elements) => elements.flatMap((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        if (style.display === 'none' || node.getClientRects().length === 0) return [];
        if (node.scrollWidth <= node.clientWidth + 1) return [];

        return [{
            tag: node.tagName.toLowerCase(),
            label: node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 80) ?? '',
            className: node.className,
            clientWidth: node.clientWidth,
            scrollWidth: node.scrollWidth,
        }];
    }));

    expect.soft(clipped, `${context} has internally clipped buyer panes or cards`).toEqual([]);
}

export async function expectVisibleCustomTargetsAtLeast(
    root: Locator,
    context: string,
    minimum = 44,
) {
    const undersized = await root.locator([
        'button',
        'a[href]',
        'input',
        'select',
        'summary',
        '[role="button"]',
        '[tabindex]:not([tabindex="-1"])',
    ].join(',')).evaluateAll((elements, targetMinimum) => elements.flatMap((element) => {
        const node = element as HTMLElement;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (
            style.display === 'none' || style.visibility === 'hidden' ||
            rect.width === 0 || rect.height === 0 ||
            node.closest('[hidden], [inert]')
        ) return [];

        if (node instanceof HTMLAnchorElement && style.display === 'inline') return [];

        if (node instanceof HTMLInputElement && (node.type === 'checkbox' || node.type === 'radio')) {
            const label = node.closest('label');
            const labelRect = label?.getBoundingClientRect();
            if (labelRect && labelRect.width >= targetMinimum && labelRect.height >= targetMinimum) return [];
        }

        if (rect.width >= targetMinimum && rect.height >= targetMinimum) return [];
        return [{
            tag: node.tagName.toLowerCase(),
            type: node instanceof HTMLInputElement ? node.type : '',
            label: node.getAttribute('aria-label') ?? node.textContent?.trim().replace(/\s+/g, ' ').slice(0, 90) ?? '',
            className: node.className,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10,
        }];
    }), minimum);

    expect.soft(undersized, `${context} has visible custom controls below ${minimum}px`).toEqual([]);
}

export async function expectMinimumTarget(locator: Locator, label: string, minimum = 44) {
    await expect(locator, `${label} should be visible`).toBeVisible();
    const box = await locator.boundingBox();

    expect(box, `${label} should have a measurable hit area`).not.toBeNull();
    // Browser layout may report a 44px CSS target as 43.99998px.
    const width = Math.round(box!.width * 100) / 100;
    const height = Math.round(box!.height * 100) / 100;
    expect.soft(width, `${label} should be at least ${minimum}px wide`).toBeGreaterThanOrEqual(minimum);
    expect.soft(height, `${label} should be at least ${minimum}px tall`).toBeGreaterThanOrEqual(minimum);
}

export async function gotoSuccessful(page: Page, route: string) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response, `${route} should return a document response`).not.toBeNull();
    expect(response!.status(), `${route} should return HTTP 200`).toBe(200);
    await settleLayout(page);
}

export async function readCount(locator: Locator, expression: RegExp) {
    const text = (await locator.textContent()) ?? '';
    const match = text.match(expression);
    expect(match, `Could not read a listing count from: ${text}`).not.toBeNull();
    return Number(match![1].replaceAll(',', ''));
}

export async function expectNoPrivateMaterialLinks(page: Page) {
    await expect(page.locator([
        'a[href="/guides"]',
        'a[href^="/guides/"]',
        'a[href="/neighborhoods"]',
        'a[href^="/neighborhoods/"]',
        'a[href="/buy/neighborhoods"]',
        'a[href^="/buy/neighborhoods/"]',
    ].join(','))).toHaveCount(0);
}
