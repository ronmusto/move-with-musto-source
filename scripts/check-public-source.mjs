import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readSourceJson(relativePath) {
    const contents = readFileSync(join(sourceRoot, relativePath), 'utf8');
    return JSON.parse(contents.replace(/^\uFEFF/, ''));
}

const excludedPrivatePaths = [
    'Photos',
    'materials',
    'output',
    'MLS PIN Exchange data',
    '.mls-publish',
    '.commercial-mls-publish',
    '.mls-geocode-cache',
    '.mls-geocode-audit',
    'public/mls',
    '.githooks',
    '.github/workflows/deploy-production.yml',
    'scripts/build-private-client-guides.py',
    'scripts/install-git-hooks.mjs',
    'infrastructure/amplify/github-oidc-deploy-role.json',
];

for (const relativePath of excludedPrivatePaths) {
    assert.equal(
        existsSync(join(sourceRoot, relativePath)),
        false,
        `Private or operational file included: ${relativePath}`,
    );
}

assert.deepEqual(readSourceJson('scripts/mls-coordinate-overrides.json'), {
    schemaVersion: 'move-with-musto.reviewed-coordinate-overrides.v1',
    entries: {},
});
assert.deepEqual(readSourceJson('site-mode.json'), { mode: 'full' });

const packageMetadata = readSourceJson('package.json');
assert.equal(packageMetadata.license, 'SEE LICENSE IN LICENSE');
assert.equal(packageMetadata.private, true);
const packageScripts = packageMetadata.scripts;
for (const hook of ['prepare', 'postinstall', 'preinstall']) {
    assert.equal(packageScripts[hook], undefined, `Unexpected install hook ${hook}`);
}
assert.equal(
    Object.keys(packageScripts).some((name) => /governance|:live|deploy/.test(name)),
    false,
);
for (const [name, command] of Object.entries(packageScripts)) {
    assert.doesNotMatch(
        command,
        /aws\s+(?:amplify|cloudformation)|mls:(?:publish|geocode)/,
        `Unsafe convenience command ${name}`,
    );
}

// Dependency/build folders may exist after local validation. Git metadata is
// allowed for a future clone; the separate packaging process excludes it.
const ignoredDirectories = new Set([
    'node_modules',
    '.next',
    'out',
    'coverage',
    'coverage-full',
    '.git',
    'playwright-report',
    'test-results',
]);

function checkSourceTree(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (ignoredDirectories.has(entry.name)) continue;

        const absolutePath = join(directory, entry.name);
        assert.equal(
            lstatSync(absolutePath).isSymbolicLink(),
            false,
            `Source symlink: ${absolutePath}`,
        );

        if (entry.isDirectory()) {
            checkSourceTree(absolutePath);
        } else if (entry.name.startsWith('.env')) {
            assert.equal(
                entry.name,
                '.env.example',
                'Only the documented empty env example may be included',
            );
        }
    }
}

checkSourceTree(sourceRoot);

const placeholderManifest = readSourceJson('docs/placeholder-assets.json');
assert.equal(placeholderManifest.sourceImagePixelsUsed, false);
for (const asset of placeholderManifest.files) {
    const bytes = readFileSync(join(sourceRoot, asset.path));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    assert.equal(sha256, asset.sha256, `Placeholder differs: ${asset.path}`);
}

const requiredNotices = [
    'LICENSE',
    'NOTICE.md',
    'SECURITY.md',
    'docs/MASSGIS-NOTICE.txt',
    'src/app/fonts/Inter-OFL.txt',
    'src/app/fonts/PlayfairDisplay-OFL.txt',
];
for (const relativePath of requiredNotices) {
    assert.equal(
        existsSync(join(sourceRoot, relativePath)),
        true,
        `Missing notice: ${relativePath}`,
    );
}

console.log(
    `Public source boundary checks passed; ${placeholderManifest.files.length} labeled replacement assets verified.`,
);
