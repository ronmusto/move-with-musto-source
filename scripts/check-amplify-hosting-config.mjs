import { access, copyFile, readFile, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(process.cwd());
const defaultHeaderConfigPath = resolve(repoRoot, 'customHttp.yml');
const defaultRedirectConfigPath = resolve(repoRoot, 'infrastructure/amplify/custom-rules.json');

const SECURITY_HEADERS = new Map([
    ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
]);

const PUBLIC_ROUTE_CACHE = 'public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=60';
const CACHE_POLICIES = new Map([
    ['/_next/static/**', 'public, max-age=31536000, immutable'],
    ['/mls/**', 'public, max-age=60, must-revalidate, s-maxage=300'],
    ['/images/**', 'public, max-age=2592000, s-maxage=31536000, stale-while-revalidate=86400'],
    ['/', PUBLIC_ROUTE_CACHE],
    ['/about/**', PUBLIC_ROUTE_CACHE],
    ['/buy/**', PUBLIC_ROUTE_CACHE],
    ['/sell/**', PUBLIC_ROUTE_CACHE],
    ['/commercial/**', PUBLIC_ROUTE_CACHE],
    ['/properties/**', PUBLIC_ROUTE_CACHE],
    ['/privacy/**', PUBLIC_ROUTE_CACHE],
    ['/terms/**', PUBLIC_ROUTE_CACHE],
    ['**/*.html', PUBLIC_ROUTE_CACHE],
    ['**/*.txt', PUBLIC_ROUTE_CACHE],
    ['/contact/**', 'no-store'],
    ['/unsubscribe/**', 'no-store'],
    ['/404/**', 'no-store'],
    ['/404.html', 'no-store'],
    ['/_not-found/**', 'no-store'],
]);

const REQUIRED_CSP_SOURCES = new Map([
    ['default-src', ["'self'"]],
    ['base-uri', ["'self'"]],
    ['object-src', ["'none'"]],
    ['frame-ancestors', ["'none'"]],
    ['form-action', ["'self'"]],
    ['script-src', [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        '*.google.com',
        'https://*.ggpht.com',
        '*.googleusercontent.com',
        'blob:',
    ]],
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['img-src', [
        "'self'",
        'https://media.mlspin.com',
        'https://*.googleapis.com',
        'https://*.gstatic.com',
        '*.google.com',
        'https://*.ggpht.com',
        '*.googleusercontent.com',
        'data:',
        'blob:',
    ]],
    ['connect-src', [
        "'self'",
        'https://data.movewithmusto.com',
        'https://*.googleapis.com',
        '*.google.com',
        'https://*.gstatic.com',
        'data:',
        'blob:',
    ]],
    ['font-src', ["'self'", 'https://fonts.gstatic.com', 'data:']],
    ['frame-src', ['*.google.com']],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['upgrade-insecure-requests', []],
]);

function decodeYamlScalar(rawValue) {
    const value = rawValue.trim();
    if (value.startsWith('"')) {
        try {
            return JSON.parse(value);
        } catch {
            throw new Error(`Invalid double-quoted YAML scalar: ${value}`);
        }
    }
    if (value.startsWith("'")) {
        if (!value.endsWith("'")) {
            throw new Error(`Invalid single-quoted YAML scalar: ${value}`);
        }
        return value.slice(1, -1).replaceAll("''", "'");
    }
    return value;
}

export function parseCustomHeaderConfig(source) {
    const entries = [];
    let currentEntry;
    let pendingKey;
    let sawRoot = false;

    for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
        const lineNumber = index + 1;
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        if (line === 'customHeaders:') {
            if (sawRoot) throw new Error('customHttp.yml contains more than one customHeaders root.');
            sawRoot = true;
            continue;
        }

        const patternMatch = line.match(/^- pattern:\s*(.+)$/);
        if (patternMatch) {
            if (pendingKey) {
                throw new Error(`Header ${pendingKey} is missing a value before line ${lineNumber}.`);
            }
            currentEntry = {
                pattern: decodeYamlScalar(patternMatch[1]),
                headers: new Map(),
            };
            entries.push(currentEntry);
            continue;
        }

        if (line === 'headers:') {
            if (!currentEntry) throw new Error(`headers appears before a pattern on line ${lineNumber}.`);
            continue;
        }

        const keyMatch = line.match(/^- key:\s*(.+)$/);
        if (keyMatch) {
            if (!currentEntry) throw new Error(`Header key appears before a pattern on line ${lineNumber}.`);
            if (pendingKey) throw new Error(`Header ${pendingKey} is missing a value before line ${lineNumber}.`);
            pendingKey = decodeYamlScalar(keyMatch[1]);
            continue;
        }

        const valueMatch = line.match(/^value:\s*(.+)$/);
        if (valueMatch) {
            if (!currentEntry || !pendingKey) {
                throw new Error(`Header value appears without a key on line ${lineNumber}.`);
            }
            if (currentEntry.headers.has(pendingKey)) {
                throw new Error(`Pattern ${currentEntry.pattern} repeats header ${pendingKey}.`);
            }
            currentEntry.headers.set(pendingKey, decodeYamlScalar(valueMatch[1]));
            pendingKey = undefined;
            continue;
        }

        throw new Error(`Unsupported customHttp.yml syntax on line ${lineNumber}: ${line}`);
    }

    if (!sawRoot) throw new Error('customHttp.yml is missing the customHeaders root.');
    if (pendingKey) throw new Error(`Header ${pendingKey} is missing a value.`);
    if (entries.length === 0) throw new Error('customHttp.yml does not define any header patterns.');
    return entries;
}

function parseCsp(value) {
    const directives = new Map();
    for (const rawDirective of value.split(';')) {
        const parts = rawDirective.trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) continue;
        const [name, ...sources] = parts;
        if (directives.has(name)) throw new Error(`Content-Security-Policy repeats ${name}.`);
        directives.set(name, sources);
    }
    return directives;
}

function requireExactHeader(headers, key, expectedValue, pattern) {
    const value = headers.get(key);
    if (value !== expectedValue) {
        throw new Error(
            `${pattern} must set ${key} to ${JSON.stringify(expectedValue)}; received ${JSON.stringify(value)}.`,
        );
    }
}

export function validateCustomHeaderConfig(source) {
    const entries = parseCustomHeaderConfig(source);
    const entriesByPattern = new Map();
    for (const entry of entries) {
        if (entriesByPattern.has(entry.pattern)) {
            throw new Error(`customHttp.yml repeats pattern ${entry.pattern}.`);
        }
        entriesByPattern.set(entry.pattern, entry);
    }

    const globalHeaders = entriesByPattern.get('**')?.headers;
    if (!globalHeaders) throw new Error("customHttp.yml must define the global '**' security-header pattern.");
    for (const [key, expectedValue] of SECURITY_HEADERS) {
        requireExactHeader(globalHeaders, key, expectedValue, '**');
    }

    const cspValue = globalHeaders.get('Content-Security-Policy');
    if (!cspValue) throw new Error('The global header policy is missing Content-Security-Policy.');
    const csp = parseCsp(cspValue);
    for (const [directive, requiredSources] of REQUIRED_CSP_SOURCES) {
        const actualSources = csp.get(directive);
        if (!actualSources) throw new Error(`Content-Security-Policy is missing ${directive}.`);
        const missingSources = requiredSources.filter((sourceValue) => !actualSources.includes(sourceValue));
        if (missingSources.length > 0) {
            throw new Error(`Content-Security-Policy ${directive} is missing ${missingSources.join(', ')}.`);
        }
    }
    if ([...csp.values()].some((sources) => sources.includes('*'))) {
        throw new Error("Content-Security-Policy must not use an unrestricted '*' source.");
    }
    if ([...csp.values()].some((sources) => sources.some((sourceValue) => sourceValue === 'http:' || sourceValue.startsWith('http://')))) {
        throw new Error('Content-Security-Policy must not permit insecure HTTP sources.');
    }

    for (const [pattern, expectedValue] of CACHE_POLICIES) {
        const headers = entriesByPattern.get(pattern)?.headers;
        if (!headers) throw new Error(`customHttp.yml is missing cache pattern ${pattern}.`);
        requireExactHeader(headers, 'Cache-Control', expectedValue, pattern);
    }

    const htmlRuleIndex = entries.findIndex((entry) => entry.pattern === '**/*.html');
    const textRuleIndex = entries.findIndex((entry) => entry.pattern === '**/*.txt');
    for (const privatePattern of ['/contact/**', '/unsubscribe/**', '/404/**', '/404.html', '/_not-found/**']) {
        const privateIndex = entries.findIndex((entry) => entry.pattern === privatePattern);
        if (privateIndex < htmlRuleIndex || privateIndex < textRuleIndex) {
            throw new Error(`${privatePattern} must appear after general HTML and text cache rules.`);
        }
    }

    return entries;
}

export function validateCustomRules(customRules) {
    if (!Array.isArray(customRules) || customRules.length !== 1) {
        throw new Error('Amplify custom rules must contain only the canonical-host redirect.');
    }

    const [canonicalRedirect] = customRules;
    if (
        canonicalRedirect.source !== 'https://www.movewithmusto.com' ||
        canonicalRedirect.target !== 'https://movewithmusto.com' ||
        canonicalRedirect.status !== '301' ||
        Object.hasOwn(canonicalRedirect, 'condition')
    ) {
        throw new Error('The first Amplify rule must permanently redirect www to the apex domain.');
    }

    if (customRules.some((rule) => rule.source === '/<*>' || rule.status === '200' || rule.status === '404-200')) {
        throw new Error('Static export hosting must not include a catch-all redirect or rewrite.');
    }

    return customRules;
}

export async function validateAmplifyHostingConfig({
    headerConfigPath = defaultHeaderConfigPath,
    redirectConfigPath = defaultRedirectConfigPath,
} = {}) {
    validateCustomHeaderConfig(await readFile(headerConfigPath, 'utf8'));

    let customRules;
    try {
        customRules = JSON.parse(await readFile(redirectConfigPath, 'utf8'));
    } catch (error) {
        throw new Error(
            `Could not parse Amplify custom rules: ${error instanceof Error ? error.message : error}`,
            { cause: error },
        );
    }
    validateCustomRules(customRules);

    return { headerConfigPath, redirectConfigPath };
}

async function requireExportFile(outputDirectory, relativePath) {
    const path = resolve(outputDirectory, relativePath);
    const file = await stat(path).catch(() => undefined);
    if (!file?.isFile() || file.size === 0) {
        throw new Error(`Static export is missing required file ${relativePath}.`);
    }
}

export async function validateStaticExport(outputDirectory = resolve(repoRoot, 'out')) {
    await access(outputDirectory, constants.W_OK);
    await requireExportFile(outputDirectory, 'index.html');
    await requireExportFile(outputDirectory, '404.html');
    const nextStatic = await stat(resolve(outputDirectory, '_next/static')).catch(() => undefined);
    if (!nextStatic?.isDirectory()) {
        throw new Error('Static export is missing the _next/static asset directory.');
    }
}

export async function applyPublicRouteVisibility(outputDirectory = resolve(repoRoot, 'out')) {
    const commercialEntryPath = resolve(outputDirectory, 'commercial/index.html');
    const commercialHtml = await readFile(commercialEntryPath, 'utf8').catch(() => '');
    const buildPublishedCommercial = commercialHtml.includes(
        '<link rel="canonical" href="https://movewithmusto.com/commercial/"',
    ) && commercialHtml.includes('A clear starting point for your next commercial move.');

    if (buildPublishedCommercial) {
        return;
    }

    await Promise.all([
        rm(resolve(outputDirectory, 'commercial'), { recursive: true, force: true }),
        rm(resolve(outputDirectory, 'images/commercial'), { recursive: true, force: true }),
    ]);
}

export async function stageAmplifyHostingConfig(outputDirectory = resolve(repoRoot, 'out')) {
    await validateAmplifyHostingConfig();
    await applyPublicRouteVisibility(outputDirectory);
    await validateStaticExport(outputDirectory);
    await copyFile(defaultHeaderConfigPath, resolve(outputDirectory, 'customHttp.yml'));
}

async function main() {
    const shouldStage = process.argv.includes('--stage');
    if (shouldStage) {
        await stageAmplifyHostingConfig();
        console.log('Amplify hosting policy validated and staged in out/customHttp.yml.');
        return;
    }

    await validateAmplifyHostingConfig();
    console.log('Amplify hosting policy is valid.');
}

const isDirectExecution = process.argv[1] &&
    resolve(process.argv[1]) === resolve(repoRoot, 'scripts/check-amplify-hosting-config.mjs');

if (isDirectExecution) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    });
}
