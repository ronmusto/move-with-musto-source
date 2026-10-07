import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    BUILD_PROJECT_NAME: 'test-build',
    MAX_GEOCODE_REQUESTS_PER_RUN: '1200',
    PIPELINE_SOURCE_BUCKET_NAME: 'deployment-artifacts-example',
    PIPELINE_SOURCE_OBJECT_KEY: 'pipeline/source.zip',
    PIPELINE_SOURCE_VERSION_ID: '3Lg_example-version',
    PIPELINE_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    PIPELINE_SOURCE_SHA256: 'a'.repeat(64),
    PIPELINE_SOURCE_CONTENT_LENGTH: '12345',
});

const [{ startPipelineBuild }, { aws }] = await Promise.all([
    import('../handlers/runs.mjs'),
    import('../handlers/aws.mjs'),
]);

const artifact = {
    type: 'S3',
    bucket: 'deployment-artifacts-example',
    key: 'pipeline/source.zip',
    versionId: '3Lg_example-version',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    sha256: 'a'.repeat(64),
    contentLength: 12345,
};

function transition() {
    return {
        pending: 'PUBLISHING',
        buildAction: 'PUBLISH',
    };
}

function item() {
    return {
        runId: '20260813152724-82582778-6dc7-4d41-a051-7c48f32c0045',
        state: 'APPROVED',
        validatedSourceArtifact: artifact,
        includesCommercial: false,
    };
}

function mockCalls(t, headResponse) {
    const originals = {
        s3: aws.s3.send,
        codeBuild: aws.codeBuild.send,
        dynamo: aws.dynamo.send,
    };
    const calls = { s3: [], codeBuild: [], dynamo: [] };
    aws.s3.send = async (command) => {
        calls.s3.push(command);
        return headResponse;
    };
    aws.codeBuild.send = async (command) => {
        calls.codeBuild.push(command);
        return {
            build: {
                arn: 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:123',
                id: 'test-build:123',
                projectName: 'test-build',
                timeoutInMinutes: 600,
            },
        };
    };
    aws.dynamo.send = async (command) => {
        calls.dynamo.push(command);
        return {};
    };
    t.after(() => {
        aws.s3.send = originals.s3;
        aws.codeBuild.send = originals.codeBuild;
        aws.dynamo.send = originals.dynamo;
    });
    return calls;
}

function validHeadResponse(overrides = {}) {
    return {
        VersionId: artifact.versionId,
        ChecksumSHA256: Buffer.from(artifact.sha256, 'hex').toString('base64'),
        ContentLength: 12345,
        Metadata: {
            'source-sha256': artifact.sha256,
            'git-commit': artifact.gitCommit,
            'source-schema': 'move-with-musto.pipeline-source.v1',
        },
        ...overrides,
    };
}

test('source preflight binds exact S3 version, checksum, and commit before state transition', async (t) => {
    const calls = mockCalls(t, validHeadResponse());

    await startPipelineBuild({
        action: 'publish',
        body: {},
        item: item(),
        operator: 'test-operator',
        transition: transition(),
    });

    assert.equal(calls.s3.length, 1);
    assert.deepEqual(calls.s3[0].input, {
        Bucket: artifact.bucket,
        Key: artifact.key,
        VersionId: artifact.versionId,
        ChecksumMode: 'ENABLED',
    });
    assert.equal(calls.dynamo.length, 2);
    assert.equal(calls.codeBuild.length, 1);
});

test('source preflight checksum mismatch prevents state transition and CodeBuild start', async (t) => {
    const calls = mockCalls(t, validHeadResponse({
        ChecksumSHA256: Buffer.alloc(32).toString('base64'),
    }));

    await assert.rejects(
        startPipelineBuild({
            action: 'publish',
            body: {},
            item: item(),
            operator: 'test-operator',
            transition: transition(),
        }),
        (error) => error.code === 'SOURCE_ARTIFACT_INVALID',
    );
    assert.equal(calls.dynamo.length, 0);
    assert.equal(calls.codeBuild.length, 0);
});

test('missing source checksum prevents state transition and CodeBuild start', async (t) => {
    const calls = mockCalls(t, validHeadResponse({ ChecksumSHA256: undefined }));

    await assert.rejects(
        startPipelineBuild({
            action: 'publish',
            body: {},
            item: item(),
            operator: 'test-operator',
            transition: transition(),
        }),
        (error) => error.code === 'SOURCE_ARTIFACT_INVALID',
    );
    assert.equal(calls.dynamo.length, 0);
    assert.equal(calls.codeBuild.length, 0);
});

test('source length or schema mismatch prevents state transition and CodeBuild start', async (t) => {
    const calls = mockCalls(t, validHeadResponse({
        ContentLength: artifact.contentLength + 1,
        Metadata: {
            'source-sha256': artifact.sha256,
            'git-commit': artifact.gitCommit,
            'source-schema': 'unexpected',
        },
    }));

    await assert.rejects(
        startPipelineBuild({
            action: 'publish',
            body: {},
            item: item(),
            operator: 'test-operator',
            transition: transition(),
        }),
        (error) => error.code === 'SOURCE_ARTIFACT_INVALID',
    );
    assert.equal(calls.dynamo.length, 0);
    assert.equal(calls.codeBuild.length, 0);
});

test('unavailable source version prevents state transition and CodeBuild start', async (t) => {
    const calls = mockCalls(t, undefined);
    const originalS3Send = aws.s3.send;
    aws.s3.send = async (command) => {
        calls.s3.push(command);
        throw new Error('AccessDenied');
    };
    t.after(() => {
        aws.s3.send = originalS3Send;
    });

    await assert.rejects(
        startPipelineBuild({
            action: 'publish',
            body: {},
            item: item(),
            operator: 'test-operator',
            transition: transition(),
        }),
        (error) => error.code === 'SOURCE_ARTIFACT_UNAVAILABLE',
    );
    assert.equal(calls.dynamo.length, 0);
    assert.equal(calls.codeBuild.length, 0);
});
