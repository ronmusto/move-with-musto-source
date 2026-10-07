import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMERCIAL_UPDATE_FILES, CORE_UPDATE_FILES } from '../handlers/constants.mjs';
import {
    assertTransition,
    buildCanonicalManifest,
    ClientError,
    createRunId,
    operatorIdentity,
    validateUploadFiles,
} from '../handlers/domain.mjs';
import {
    COORDINATE_EXPIRY_MARGIN_MS,
    pruneCoordinateDocument,
    publicManifestNeedsCoordinateReconciliation,
    withCoordinateCount,
} from '../handlers/coordinate-retention.mjs';
import {
    activePublicationAgeHours,
    activePublicationKeys,
    createCurrentPointer,
    parseCurrentPointer,
    validateActiveManifest,
} from '../handlers/publication-pointer.mjs';
import {
    activeCommercialPublicationKeys,
    createCommercialCurrentPointer,
    parseCommercialCurrentPointer,
    validateCommercialManifest,
} from '../handlers/commercial-publication-pointer.mjs';
import {
    codeBuildLookupId,
    exactGeocodingCeilingAcknowledged,
    isPinnedSourceRevision,
    normalizeSourceRevision,
    validationCostAcknowledgement,
} from '../handlers/build-source.mjs';
import { IncrementalSha256 } from '../portal/hash-worker.js';

const checksum = {
    sha256: '0'.repeat(64),
    checksumSha256: `${'A'.repeat(43)}=`,
};

test('operator identity accepts exact Cognito group claims in API Gateway representations', () => {
    const eventFor = (groups) => ({
        requestContext: {
            authorizer: {
                jwt: {
                    claims: {
                        sub: 'operator-subject',
                        email: 'operator@example.com',
                        'cognito:groups': groups,
                    },
                },
            },
        },
    });

    for (const groups of [
        ['mls-operators'],
        'mls-operators',
        'other-group, mls-operators',
        '["other-group","mls-operators"]',
        '[other-group, mls-operators]',
    ]) {
        assert.deepEqual(operatorIdentity(eventFor(groups)), {
            subject: 'operator-subject',
            email: 'operator@example.com',
        });
    }

    for (const groups of [
        'mls-operators-admin',
        'not-mls-operators',
        '["mls-operator"]',
        '[mls-operators-admin]',
        ['other-group,mls-operators'],
    ]) {
        assert.throws(
            () => operatorIdentity(eventFor(groups)),
            (error) => error instanceof ClientError && error.code === 'FORBIDDEN',
        );
    }
});

test('publication source revisions are immutable commit identifiers and build lookups normalize ARNs', () => {
    const revision = 'A'.repeat(40);
    assert.equal(normalizeSourceRevision(`  ${revision}  `), revision.toLowerCase());
    assert.equal(isPinnedSourceRevision(revision), true);
    assert.equal(isPinnedSourceRevision('main'), false);
    assert.equal(
        codeBuildLookupId('arn:aws:codebuild:us-east-1:123456789012:build/project-name:1234'),
        'project-name:1234',
    );
});

test('validation cost acknowledgement records the authenticated operator and hard ceiling', () => {
    const operator = { subject: 'operator-subject', email: 'operator@example.com' };
    assert.equal(validationCostAcknowledgement({ acknowledged: false, maxRequests: 1200, now: 0, operator }), null);
    assert.deepEqual(validationCostAcknowledgement({
        acknowledged: true,
        maxRequests: 1200,
        now: Date.parse('2026-07-13T12:00:00.000Z'),
        operator,
    }), {
        acknowledgedAt: '2026-07-13T12:00:00.000Z',
        acknowledgedBy: operator,
        maxRequests: 1200,
        grossListPriceMaximumUsd: 6,
    });
    assert.equal(exactGeocodingCeilingAcknowledged(1200, 1200), true);
    assert.equal(exactGeocodingCeilingAcknowledged(1000, 1200), false);
    assert.equal(exactGeocodingCeilingAcknowledged('1200', 1200), false);
    assert.doesNotThrow(() => validationCostAcknowledgement({
        acknowledged: true,
        maxRequests: 1200,
        now: 0,
        operator,
    }));
    assert.throws(() => validationCostAcknowledgement({
        acknowledged: true,
        maxRequests: 1201,
        now: 0,
        operator,
    }), /integer from -1 through 1200/u);
});

test('the portal streaming SHA-256 implementation matches standard vectors across chunk boundaries', () => {
    const encoder = new TextEncoder();
    const hasher = new IncrementalSha256();
    hasher.update(encoder.encode('a'));
    hasher.update(encoder.encode('bc'));
    const digest = [...hasher.digest()]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    const boundaryHasher = new IncrementalSha256();
    const boundaryInput = new Uint8Array(65).fill(0x61);
    boundaryHasher.update(boundaryInput.subarray(0, 63));
    boundaryHasher.update(boundaryInput.subarray(63));
    assert.equal(
        Buffer.from(boundaryHasher.digest()).toString('hex'),
        '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0',
    );
});

function file(name, overrides = {}) {
    return {
        name,
        size: 100,
        sourceModifiedAt: '2026-07-13T04:00:00.000Z',
        ...checksum,
        ...overrides,
    };
}

test('normal update packages may reuse the current reference tables', () => {
    const result = validateUploadFiles(CORE_UPDATE_FILES.map((name) => file(name)));
    assert.equal(result.files.length, CORE_UPDATE_FILES.length);
    assert.equal(result.usesCurrentReferences, true);
    assert.deepEqual(result.missingReferences, ['areas.txt', 'counties.txt', 'field_reference.txt', 'towns.txt']);
});

test('first import requires all reference tables when reuse is disabled', () => {
    assert.throws(
        () => validateUploadFiles(CORE_UPDATE_FILES.map((name) => file(name)), { useCurrentReferences: false }),
        (error) => error instanceof ClientError && error.code === 'REFERENCE_FILES_MISSING',
    );
});

test('commercial exports are optional as a complete all-three-or-none package', () => {
    const residentialOnly = validateUploadFiles(CORE_UPDATE_FILES.map((name) => file(name)));
    assert.equal(residentialOnly.includesCommercial, false);

    const complete = validateUploadFiles([
        ...CORE_UPDATE_FILES.map((name) => file(name)),
        ...COMMERCIAL_UPDATE_FILES.map((name) => file(name)),
    ]);
    assert.equal(complete.includesCommercial, true);

    for (const partial of [
        [COMMERCIAL_UPDATE_FILES[0]],
        COMMERCIAL_UPDATE_FILES.slice(0, 2),
    ]) {
        assert.throws(
            () => validateUploadFiles([
                ...CORE_UPDATE_FILES.map((name) => file(name)),
                ...partial.map((name) => file(name)),
            ]),
            (error) => error instanceof ClientError && error.code === 'COMMERCIAL_PACKAGE_INCOMPLETE',
        );
    }
});

test('server never issues upload permission for unknown or duplicate names', () => {
    assert.throws(
        () => validateUploadFiles([...CORE_UPDATE_FILES.map((name) => file(name)), file('NordPassSetup.exe')]),
        (error) => error instanceof ClientError && error.code === 'FILE_NOT_ALLOWED',
    );
    assert.throws(
        () => validateUploadFiles([...CORE_UPDATE_FILES.map((name) => file(name)), file('idx_sf.txt')]),
        (error) => error instanceof ClientError && error.code === 'DUPLICATE_FILE',
    );
});

test('canonical manifest is deterministic and preserves original timestamps', () => {
    const packageData = validateUploadFiles(CORE_UPDATE_FILES.map((name) => file(name)));
    const input = {
        runId: '20260713040000-11111111-1111-4111-8111-111111111111',
        createdAt: '2026-07-13T04:00:00.000Z',
        completedAt: '2026-07-13T04:01:00.000Z',
        createdBy: { subject: 'operator-subject', email: 'operator@example.com' },
        packageData,
    };
    const first = buildCanonicalManifest(input);
    const second = buildCanonicalManifest(input);
    assert.equal(first.body, second.body);
    assert.equal(first.sha256, second.sha256);
    assert.match(first.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(first.manifest.sourcePackage.files[0].sourceModifiedAt, '2026-07-13T04:00:00.000Z');
    assert.deepEqual(
        Object.keys(first.manifest.sourcePackage.files[0]),
        ['name', 'size', 'sha256', 'checksumSha256', 'sourceModifiedAt'],
    );
    assert.doesNotMatch(first.body, /"(?:lat|lng|address|remarks)"/iu);
    assert.equal(first.manifest.sourcePackage.includesCommercial, false);
});

test('commercial publication pointers use an isolated namespace and validate totals', () => {
    const generation = '20260808141521-92d08dce-7f74-497e-95d2-20c219d381df';
    const manifest = {
        schemaVersion: 2,
        generatedAt: '2026-08-08T14:15:21.000Z',
        totalListingCount: 42,
        index: { file: 'commercial-search-index.json', listingCount: 42 },
    };
    assert.equal(validateCommercialManifest(manifest, Date.parse('2026-08-08T14:16:00.000Z')), manifest);
    const pointer = createCommercialCurrentPointer(
        generation,
        manifest,
        Date.parse('2026-08-08T14:16:00.000Z'),
    );
    assert.deepEqual(parseCommercialCurrentPointer(
        pointer,
        Date.parse('2026-08-08T14:16:00.000Z'),
    ), pointer);
    assert.deepEqual(activeCommercialPublicationKeys(pointer), {
        prefix: `commercial/generations/${generation}`,
        manifestKey: `commercial/generations/${generation}/commercial-search-manifest.json`,
        indexKey: `commercial/generations/${generation}/commercial-search-index.json`,
    });
    assert.throws(
        () => validateCommercialManifest({ ...manifest, totalListingCount: 41 }),
        /failed schema validation/u,
    );
});

test('review and publication state transitions are explicit', () => {
    assert.equal(assertTransition('validate', 'UPLOADED').pending, 'VALIDATING');
    assert.equal(assertTransition('approve', 'AWAITING_REVIEW').pending, 'APPROVED');
    assert.equal(assertTransition('publish', 'APPROVED').pending, 'PUBLISHING');
    assert.throws(
        () => assertTransition('publish', 'UPLOADED'),
        (error) => error instanceof ClientError && error.code === 'INVALID_STATE_TRANSITION',
    );
});

test('run identifiers are chronological and unguessable', () => {
    assert.match(
        createRunId(new Date('2026-07-13T04:00:00.000Z')),
        /^20260713040000-[0-9a-f-]{36}$/u,
    );
});

test('daily retention removes near-expiry and malformed private geocode cache entries', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    const retainedExpiry = new Date(now + COORDINATE_EXPIRY_MARGIN_MS + 1).toISOString();
    const source = {
        schemaVersion: 'move-with-musto.google-geocode-cache.v1',
        updatedAt: '2026-07-12T12:00:00.000Z',
        entries: {
            retained: {
                lat: 42.5,
                lng: -71.2,
                geocodedAt: '2026-07-01T12:00:00.000Z',
                expiresAt: retainedExpiry,
            },
            expiresBeforeNextMaintenance: {
                lat: 42.4,
                lng: -71.1,
                geocodedAt: '2026-06-14T12:00:00.000Z',
                expiresAt: new Date(now + COORDINATE_EXPIRY_MARGIN_MS).toISOString(),
            },
            invalidThirtyDayWindow: {
                lat: 42.3,
                lng: -71,
                geocodedAt: '2026-07-01T12:00:00.000Z',
                expiresAt: '2026-08-01T12:00:00.001Z',
            },
        },
    };

    const result = pruneCoordinateDocument(source, now);
    assert.equal(result.kind, 'private-cache');
    assert.equal(result.removedCount, 2);
    assert.equal(result.remainingCount, 1);
    assert.deepEqual(Object.keys(result.document.entries), ['retained']);
    assert.equal(result.document.updatedAt, '2026-07-13T12:00:00.000Z');
    assert.equal(Object.keys(source.entries).length, 3);
});

test('daily retention prunes the public sidecar and reconciles its manifest count', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    const result = pruneCoordinateDocument({
        schemaVersion: 1,
        generatedAt: '2026-07-13T04:00:00.000Z',
        coordinates: {
            expiredSoon: {
                lat: 42.5,
                lng: -71.2,
                expiresAt: '2026-07-14T12:00:00.000Z',
            },
            retained: {
                lat: 42.4,
                lng: -71.1,
                expiresAt: '2026-07-14T12:00:00.001Z',
            },
        },
    }, now);
    assert.equal(result.removedCount, 1);
    assert.equal(result.remainingCount, 1);
    assert.deepEqual(Object.keys(result.document.coordinates), ['retained']);

    const manifest = withCoordinateCount({
        generatedAt: '2026-07-13T04:00:00.000Z',
        coordinateIndex: { file: 'mls-coordinate-index.json', coordinateCount: 2 },
    }, result.remainingCount);
    assert.equal(manifest.coordinateIndex.coordinateCount, 1);
    assert.equal(manifest.generatedAt, result.document.generatedAt);
});

test('current publication pointers resolve only one validated immutable generation', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    const generation = '20260713040000-11111111-1111-4111-8111-111111111111';
    const manifest = {
        schemaVersion: 1,
        generatedAt: '2026-07-13T04:00:00.000Z',
        coordinateIndex: { file: 'mls-coordinate-index.json', coordinateCount: 7 },
    };
    const pointer = createCurrentPointer(generation, manifest, now);

    assert.deepEqual(parseCurrentPointer(pointer, now), pointer);
    assert.deepEqual(activePublicationKeys(pointer), {
        prefix: `mls/generations/${generation}`,
        manifestKey: `mls/generations/${generation}/mls-search-manifest.json`,
        coordinateKey: `mls/generations/${generation}/mls-coordinate-index.json`,
    });
    assert.equal(validateActiveManifest(pointer, manifest, now), manifest);
    assert.equal(activePublicationAgeHours(pointer, manifest, now), 8);
});

test('current publication pointer validation rejects path injection and manifest drift', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    const generation = '20260713040000-11111111-1111-4111-8111-111111111111';
    const manifest = {
        schemaVersion: 1,
        generatedAt: '2026-07-13T04:00:00.000Z',
        coordinateIndex: { file: 'mls-coordinate-index.json', coordinateCount: 7 },
    };
    const pointer = createCurrentPointer(generation, manifest, now);

    assert.throws(() => parseCurrentPointer({ ...pointer, generation: '../live' }, now));
    assert.throws(() => parseCurrentPointer({ ...pointer, unexpected: true }, now));
    assert.throws(() => validateActiveManifest(pointer, {
        ...manifest,
        generatedAt: '2026-07-13T05:00:00.000Z',
    }, now));
    assert.throws(() => validateActiveManifest(pointer, {
        ...manifest,
        coordinateIndex: { file: '../coordinates.json', coordinateCount: 7 },
    }, now));
});

test('a prior sidecar-only retention write is detected and can self-heal its manifest', () => {
    const sidecar = {
        schemaVersion: 1,
        generatedAt: '2026-07-13T04:00:00.000Z',
        coordinates: { retained: { lat: 42.4, lng: -71.1, expiresAt: '2026-07-20T00:00:00.000Z' } },
    };
    const staleManifest = {
        generatedAt: sidecar.generatedAt,
        coordinateIndex: { file: 'mls-coordinate-index.json', coordinateCount: 2 },
    };

    assert.equal(publicManifestNeedsCoordinateReconciliation(staleManifest, sidecar), true);
    const healedManifest = withCoordinateCount(staleManifest, 1);
    assert.equal(publicManifestNeedsCoordinateReconciliation(healedManifest, sidecar), false);
});


test('uncapped policy is explicitly acknowledged without inventing a maximum cost', () => {
    const acknowledgement = validationCostAcknowledgement({
        acknowledged: true, maxRequests: -1, now: 0, operator: { subject: 'operator' },
    });
    assert.equal(acknowledgement.maxRequests, -1);
    assert.equal(acknowledgement.grossListPriceMaximumUsd, null);
    assert.equal(exactGeocodingCeilingAcknowledged(-1, -1), true);
    assert.equal(exactGeocodingCeilingAcknowledged(1200, -1), false);
    assert.equal(exactGeocodingCeilingAcknowledged('-1', -1), false);
    assert.throws(() => validationCostAcknowledgement({ acknowledged: true, maxRequests: -2 }), /integer/u);
});
