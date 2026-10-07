import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    BUILD_PROJECT_NAME: 'test-build',
    MAX_GEOCODE_REQUESTS_PER_RUN: '1200',
    PIPELINE_SOURCE_BUCKET_NAME: 'test-source-bucket',
    PIPELINE_SOURCE_OBJECT_KEY: 'pipeline/source.zip',
    PIPELINE_SOURCE_VERSION_ID: 'version-123',
    PIPELINE_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    PIPELINE_SOURCE_SHA256: 'a'.repeat(64),
    PIPELINE_SOURCE_CONTENT_LENGTH: '12345',
});

const {
    buildPipelineStartRequest,
    isRunRecord,
    presentRun,
    sourceArtifactForAction,
} = await import('../handlers/runs.mjs');

test('run listings exclude internal reminder markers and malformed rows', () => {
    assert.equal(isRunRecord({
        runId: '20260731161919-1df28a05-f803-4ff9-8e74-f78d98972aeb',
        state: 'UPLOADED',
        createdAt: '2026-07-31T16:19:19.000Z',
    }), true);
    assert.equal(isRunRecord({
        runId: 'freshness-reminder#generation',
        recordType: 'FRESHNESS_REMINDER',
        createdAt: '2026-07-31T16:19:19.000Z',
    }), false);
    assert.equal(isRunRecord({ runId: 'missing-date', state: 'UPLOADED' }), false);
    assert.equal(isRunRecord({
        runId: 'bad-date', state: 'UPLOADED', createdAt: 'not-a-date',
    }), false);
    assert.equal(isRunRecord({
        runId: 'bad-state', state: 'UNKNOWN', createdAt: '2026-07-31T16:19:19.000Z',
    }), false);
    assert.equal(isRunRecord(null), false);
});

test('run presentation exposes only allowlisted build status codes', () => {
    const base = {
        runId: '20260731161919-1df28a05-f803-4ff9-8e74-f78d98972aeb',
        state: 'VALIDATION_FAILED',
        createdAt: '2026-07-31T16:19:19.000Z',
    };
    assert.equal(
        presentRun({
            ...base,
            lastBuildStatus: 'BUILD_TIMEOUT_CONFIGURATION_INVALID',
        }).build.status,
        'BUILD_TIMEOUT_CONFIGURATION_INVALID',
    );
    assert.equal(
        presentRun({ ...base, buildId: 'build-id', lastBuildStatus: 'unexpected-detail' }).build.status,
        undefined,
    );
    assert.equal(presentRun({ ...base, lastBuildStatus: 'unexpected-detail' }).build, undefined);
});

test('pipeline starts use normal validation by default and emergency mode only when explicit', () => {
    const sourceArtifact = {
        type: 'S3',
        bucket: 'test-source-bucket',
        key: 'pipeline/source.zip',
        versionId: 'version-123',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        sha256: 'a'.repeat(64),
        contentLength: 12345,
    };
    const validation = buildPipelineStartRequest({
        action: 'validate',
        buildAction: 'VALIDATE',
        runId: '20260804232823-1183158c-3298-4a8b-9513-e33bec7f883e',
        sourceArtifact,
    });
    const emergencyValidation = buildPipelineStartRequest({
        action: 'validate',
        buildAction: 'VALIDATE',
        runId: '20260804232823-1183158c-3298-4a8b-9513-e33bec7f883e',
        sourceArtifact,
        emergencyUrgentOnly: true,
    });
    const publication = buildPipelineStartRequest({
        action: 'publish',
        buildAction: 'PUBLISH',
        runId: '20260804232823-1183158c-3298-4a8b-9513-e33bec7f883e',
        sourceArtifact,
        includesCommercial: true,
    });

    assert.equal(validation.projectName, 'test-build');
    assert.equal(validation.sourceTypeOverride, 'S3');
    assert.equal(validation.sourceLocationOverride, 'test-source-bucket/pipeline/source.zip');
    assert.equal(validation.sourceVersion, 'version-123');
    assert.equal(validation.timeoutInMinutesOverride, 45);
    assert.deepEqual(
        validation.environmentVariablesOverride.find(
            ({ name }) => name === 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY',
        ),
        { name: 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY', type: 'PLAINTEXT', value: 'false' },
    );
    assert.deepEqual(
        emergencyValidation.environmentVariablesOverride.find(
            ({ name }) => name === 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY',
        ),
        { name: 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY', type: 'PLAINTEXT', value: 'true' },
    );

    assert.equal(publication.timeoutInMinutesOverride, 45);
    assert.deepEqual(
        publication.environmentVariablesOverride.find(({ name }) => name === 'INCLUDES_COMMERCIAL'),
        { name: 'INCLUDES_COMMERCIAL', type: 'PLAINTEXT', value: 'true' },
    );
    assert.deepEqual(
        validation.environmentVariablesOverride.find(({ name }) => name === 'INCLUDES_COMMERCIAL'),
        { name: 'INCLUDES_COMMERCIAL', type: 'PLAINTEXT', value: 'false' },
    );
    assert.equal(
        publication.environmentVariablesOverride.some(
            ({ name }) => name === 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY',
        ),
        false,
    );
    assert.deepEqual(
        Object.fromEntries(publication.environmentVariablesOverride
            .filter(({ name }) => name.startsWith('PIPELINE_SOURCE_'))
            .map(({ name, value }) => [name, value])),
        {
            PIPELINE_SOURCE_BUCKET_NAME: 'test-source-bucket',
            PIPELINE_SOURCE_OBJECT_KEY: 'pipeline/source.zip',
            PIPELINE_SOURCE_VERSION_ID: 'version-123',
            PIPELINE_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
            PIPELINE_SOURCE_SHA256: 'a'.repeat(64),
            PIPELINE_SOURCE_CONTENT_LENGTH: '12345',
        },
    );
});

test('publication reuses the exact artifact stored by validation, not the current deployment artifact', () => {
    const validatedSourceArtifact = {
        type: 'S3',
        bucket: 'test-source-bucket',
        key: 'pipeline/previous-source.zip',
        versionId: 'previous-version',
        gitCommit: 'abcdef0123456789abcdef0123456789abcdef01',
        sha256: 'b'.repeat(64),
        contentLength: 54321,
    };

    assert.deepEqual(
        sourceArtifactForAction('publish', { validatedSourceArtifact }),
        validatedSourceArtifact,
    );
    assert.equal(
        sourceArtifactForAction('validate').versionId,
        'version-123',
    );
    assert.throws(
        () => sourceArtifactForAction('publish', {}),
        /source artifact is missing/u,
    );
});
