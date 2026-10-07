import assert from 'node:assert/strict';
import test from 'node:test';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    ALERTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:test-alerts',
});

const [{ reconcileBuild }, { aws }, { RUN_STATES }, {
    s3SourceArtifactEnvironment,
}] = await Promise.all([
    import('../handlers/build-events.mjs'),
    import('../handlers/aws.mjs'),
    import('../handlers/constants.mjs'),
    import('../handlers/build-source.mjs'),
]);

const BUILD_ARN = 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:11111111-2222-4333-8444-555555555555';
const RUN_ID = '20260813152724-82582778-6dc7-4d41-a051-7c48f32c0045';
const artifact = {
    type: 'S3',
    bucket: 'deployment-artifacts-example',
    key: 'pipeline/source.zip',
    versionId: '3Lg_example-version',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    sha256: 'a'.repeat(64),
    contentLength: 12345,
};

function build({
    sourceVersion = artifact.versionId,
    action = 'VALIDATE',
    environmentArtifact = artifact,
} = {}) {
    return {
        arn: BUILD_ARN,
        buildStatus: 'SUCCEEDED',
        source: {
            type: 'S3',
            location: `${artifact.bucket}/${artifact.key}`,
        },
        sourceVersion,
        resolvedSourceVersion: undefined,
        environment: {
            environmentVariables: [
                { name: 'RUN_ID', value: RUN_ID },
                { name: 'PIPELINE_ACTION', value: action },
                ...s3SourceArtifactEnvironment(environmentArtifact),
            ],
        },
        logs: { deepLink: 'https://console.aws.amazon.com/codebuild/test' },
    };
}

function mockServices(t, returnedBuild, {
    state = RUN_STATES.VALIDATING,
    sourceField = 'requestedSourceArtifact',
    itemOverrides = {},
    summary = { schemaVersion: 'move-with-musto.mls-portal-summary.v1' },
} = {}) {
    const originals = {
        codeBuild: aws.codeBuild.send,
        dynamo: aws.dynamo.send,
        s3: aws.s3.send,
        sns: aws.sns.send,
    };
    const updates = [];
    const notifications = [];
    const starts = [];
    aws.codeBuild.send = async (command) => {
        if (command.constructor.name === 'StartBuildCommand') {
            starts.push(command);
            return { build: { id: 'test-build:next', arn: 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:next', projectName: 'test-build', timeoutInMinutes: 45 } };
        }
        return { builds: [returnedBuild] };
    };
    aws.dynamo.send = async (command) => {
        if (command.constructor.name === 'GetCommand') {
            return {
                Item: {
                    runId: RUN_ID,
                    state,
                    buildId: BUILD_ARN,
                    [sourceField]: artifact,
                    ...itemOverrides,
                },
            };
        }
        updates.push(command);
        return {};
    };
    aws.s3.send = async () => ({
        Body: {
            transformToString: async () => JSON.stringify(summary),
        },
    });
    aws.sns.send = async (command) => {
        notifications.push(command);
        return {};
    };
    t.after(() => {
        aws.codeBuild.send = originals.codeBuild;
        aws.dynamo.send = originals.dynamo;
        aws.s3.send = originals.s3;
        aws.sns.send = originals.sns;
    });
    return { updates, notifications, starts };
}

test('successful S3 validation pins VersionId, checksum, key, bucket, and originating commit', async (t) => {
    const { updates, notifications } = mockServices(t, build());

    const result = await reconcileBuild(BUILD_ARN);

    assert.equal(result.state, RUN_STATES.AWAITING_REVIEW);
    assert.equal(updates.length, 1);
    const values = updates[0].input.ExpressionAttributeValues;
    assert.equal(values[':sourceCommit'], artifact.gitCommit);
    assert.deepEqual(values[':sourceArtifact'], artifact);
    assert.equal(values[':status'], 'SUCCEEDED');
    assert.equal(notifications.length, 0);
});

test('S3 validation fails closed when CodeBuild reports a different object VersionId', async (t) => {
    const { updates, notifications } = mockServices(t, build({
        sourceVersion: 'different-version',
    }));

    const result = await reconcileBuild(BUILD_ARN);

    assert.equal(result.state, RUN_STATES.VALIDATION_FAILED);
    assert.equal(updates.length, 1);
    const values = updates[0].input.ExpressionAttributeValues;
    assert.equal(values[':status'], 'SOURCE_ARTIFACT_MISMATCH');
    assert.match(values[':failure'], /SOURCE_ARTIFACT_MISMATCH/u);
    assert.equal(notifications.length, 1);
});

test('publication succeeds only from the exact artifact pinned by validation', async (t) => {
    const { updates, notifications } = mockServices(t, build({
        action: 'PUBLISH',
    }), {
        state: RUN_STATES.PUBLISHING,
        sourceField: 'validatedSourceArtifact',
    });

    const result = await reconcileBuild(BUILD_ARN);

    assert.equal(result.state, RUN_STATES.PUBLISHED);
    const values = updates[0].input.ExpressionAttributeValues;
    assert.equal(values[':sourceCommit'], artifact.gitCommit);
    assert.deepEqual(values[':sourceArtifact'], artifact);
    assert.equal(values[':status'], 'SUCCEEDED');
    assert.equal(notifications.length, 0);
});

test('publication rejects trusted environment identity drift from the validated artifact', async (t) => {
    const { updates, notifications } = mockServices(t, build({
        action: 'PUBLISH',
        environmentArtifact: { ...artifact, sha256: 'b'.repeat(64) },
    }), {
        state: RUN_STATES.PUBLISHING,
        sourceField: 'validatedSourceArtifact',
    });

    const result = await reconcileBuild(BUILD_ARN);

    assert.equal(result.state, RUN_STATES.PUBLISH_FAILED);
    assert.equal(
        updates[0].input.ExpressionAttributeValues[':status'],
        'SOURCE_ARTIFACT_MISMATCH',
    );
    assert.equal(notifications.length, 1);
});


for (const index of [0, 1]) {
    test(`uncapped part ${index + 1} ${index ? 'unlocks review only after the last part' : 'continues without unlocking review'}`, async (t) => {
        const returned = build();
        returned.id = BUILD_ARN.split(':build/')[1];
        returned.projectName = 'test-build';
        returned.environment.environmentVariables.push(
            { name: 'MAX_GEOCODE_REQUESTS_PER_RUN', value: '-1' },
            { name: 'MLS_GEOCODE_BATCH_INDEX', value: String(index) },
        );
        const { updates, starts } = mockServices(t, returned, {
            itemOverrides: { geocodingCostAcknowledgement: { maxRequests: -1 }, geocodeBatchIndex: index, geocodeBatchCount: 2, geocodeBatchFingerprint: 'f'.repeat(64) },
            summary: { schemaVersion: 'move-with-musto.mls-portal-summary.v1', geocodeBatch: {
                schemaVersion: 1, buildId: returned.id, index, size: 900, count: 2, fingerprint: 'f'.repeat(64),
            } },
        });
        const result = await reconcileBuild(BUILD_ARN);
        assert.equal(result.state, index ? RUN_STATES.AWAITING_REVIEW : RUN_STATES.VALIDATING);
        assert.equal(starts.length, index ? 0 : 1);
        assert.equal(updates.at(-1).input.ExpressionAttributeValues[':nextState'], index ? RUN_STATES.AWAITING_REVIEW : undefined);
    });
}
