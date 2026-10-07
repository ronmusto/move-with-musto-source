import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appSource = await readFile(new URL('../portal/app.js', import.meta.url), 'utf8');
const portalHtml = await readFile(new URL('../portal/index.html', import.meta.url), 'utf8');

function sourceFunction(name) {
    const start = appSource.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist in the portal source`);
    const openingBrace = appSource.indexOf('{', start);
    let depth = 0;
    for (let index = openingBrace; index < appSource.length; index += 1) {
        if (appSource[index] === '{') depth += 1;
        if (appSource[index] === '}') depth -= 1;
        if (depth === 0) {
            return Function(`"use strict"; return (${appSource.slice(start, index + 1)});`)();
        }
    }
    throw new Error(`${name} is incomplete`);
}

test('AWS log links accept only credential-free HTTPS AWS console hosts', () => {
    const trustedAwsConsoleLogUrl = sourceFunction('trustedAwsConsoleLogUrl');

    assert.equal(
        trustedAwsConsoleLogUrl('https://console.aws.amazon.com/codesuite/codebuild/projects/example'),
        'https://console.aws.amazon.com/codesuite/codebuild/projects/example',
    );
    assert.equal(
        trustedAwsConsoleLogUrl('https://us-east-1.console.aws.amazon.com/codesuite/codebuild/projects/example'),
        'https://us-east-1.console.aws.amazon.com/codesuite/codebuild/projects/example',
    );
    for (const rejected of [
        'http://console.aws.amazon.com/codesuite/codebuild/projects/example',
        'https://console.aws.amazon.com.example.test/codesuite/codebuild/projects/example',
        'https://evilconsole.aws.amazon.com/codesuite/codebuild/projects/example',
        'https://operator:secret@console.aws.amazon.com/codesuite/codebuild/projects/example',
        'https://console.aws.amazon.com:444/codesuite/codebuild/projects/example',
        'javascript:alert(1)',
    ]) {
        assert.equal(trustedAwsConsoleLogUrl(rejected), null, rejected);
    }
});

test('failed-run diagnostics use safe text, accessible links, and block configuration retries', () => {
    assert.match(appSource, /safeBuildStatusCode\(run\.build\)/u);
    assert.match(appSource, /run-diagnostic-message'\)\.textContent/u);
    assert.doesNotMatch(appSource, /\.textContent\s*=\s*run\.build\?\.(?:failure|status)/u);
    assert.match(appSource, /trustedAwsConsoleLogUrl\(run\.build\?\.logsUrl\)/u);
    assert.match(appSource, /BUILD_TIMEOUT_CONFIGURATION_INVALID/u);
    assert.match(appSource, /AWS returned an effective timeout below the required 45-minute minimum/u);
    assert.match(appSource, /BUILD_IDENTITY_CONFIGURATION_INVALID/u);
    assert.match(appSource, /&& !retryBlocked/u);
    assert.match(portalHtml, /class="run-diagnostic notice notice-error" role="status" hidden/u);
    assert.match(portalHtml, /class="run-log-link" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" hidden/u);
    assert.match(portalHtml, /class="visually-hidden"> \(opens in a new tab\)/u);
});
