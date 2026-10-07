import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    BUILD_PROJECT_NAME: 'test-build',
    MAX_GEOCODE_REQUESTS_PER_RUN: '-1',
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

const runId = '20260813152724-82582778-6dc7-4d41-a051-7c48f32c0045';
const buildArn = 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:123';
const buildId = 'test-build:123';
const validHeadResponse = {
    VersionId: '3Lg_example-version',
    ChecksumSHA256: Buffer.from('a'.repeat(64), 'hex').toString('base64'),
    ContentLength: 12345,
    Metadata: {
        'source-sha256': 'a'.repeat(64),
        'git-commit': '0123456789abcdef0123456789abcdef01234567',
        'source-schema': 'move-with-musto.pipeline-source.v1',
    },
};

test('Runs API configuration rejects a geocoding ceiling above 1,200', () => {
    const result = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', "import('./handlers/runs.mjs')"],
        {
            cwd: fileURLToPath(new URL('..', import.meta.url)),
            env: { ...process.env, MAX_GEOCODE_REQUESTS_PER_RUN: '1201' },
            encoding: 'utf8',
        },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /must be an integer from -1 through 1200/u);
});

function validationRequest() {
    return {
        action: 'validate',
        body: {
            acknowledgeGeocodingCost: true,
            acknowledgedGeocodingRequestCap: -1,
        },
        item: {
            runId,
            state: 'UPLOADED',
            includesCommercial: true,
        },
        operator: { subject: 'operator-123', email: 'operator@example.com' },
        transition: { pending: 'VALIDATING', buildAction: 'VALIDATE' },
    };
}

function mockAws(t, buildResponse, { stopError, terminalStateError } = {}) {
    const originals = {
        s3: aws.s3.send,
        codeBuild: aws.codeBuild.send,
        dynamo: aws.dynamo.send,
    };
    const calls = { s3: [], codeBuild: [], dynamo: [], sequence: [] };
    aws.s3.send = async (command) => {
        calls.s3.push(command);
        calls.sequence.push('s3');
        return validHeadResponse;
    };
    aws.codeBuild.send = async (command) => {
        calls.codeBuild.push(command);
        calls.sequence.push(command.constructor.name);
        if (command.constructor.name === 'StopBuildCommand') {
            if (stopError) throw stopError;
            return { build: { ...buildResponse, buildStatus: 'STOPPED' } };
        }
        return { build: buildResponse };
    };
    aws.dynamo.send = async (command) => {
        calls.dynamo.push(command);
        calls.sequence.push('dynamo');
        if (terminalStateError && calls.dynamo.length === 2) throw terminalStateError;
        return {};
    };
    t.after(() => {
        aws.s3.send = originals.s3;
        aws.codeBuild.send = originals.codeBuild;
        aws.dynamo.send = originals.dynamo;
    });
    return calls;
}

test('validation links a fully identified build with the minimum 45-minute effective timeout', async (t) => {
    const calls = mockAws(t, {
        arn: buildArn,
        id: buildId,
        projectName: 'test-build',
        timeoutInMinutes: 45,
    });

    const response = await startPipelineBuild(validationRequest());

    assert.equal(response.statusCode, 202);
    assert.equal(calls.codeBuild.length, 1);
    assert.equal(calls.dynamo.length, 2);
    assert.equal(calls.dynamo[1].input.ExpressionAttributeValues[':buildId'], buildArn);
});

test('validation links a fully identified build with a 600-minute effective timeout', async (t) => {
    const calls = mockAws(t, {
        arn: buildArn,
        id: buildId,
        projectName: 'test-build',
        timeoutInMinutes: 600,
    });

    const response = await startPipelineBuild(validationRequest());

    assert.equal(response.statusCode, 202);
    assert.equal(calls.codeBuild.length, 1);
    assert.equal(calls.dynamo.length, 2);
    assert.equal(calls.dynamo[1].input.ExpressionAttributeValues[':buildId'], buildArn);
});

test('validation stops and terminally records a build below the 45-minute minimum', async (t) => {
    const calls = mockAws(t, {
        arn: buildArn,
        id: buildId,
        projectName: 'test-build',
        timeoutInMinutes: 44,
    });

    await assert.rejects(startPipelineBuild(validationRequest()), (error) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.code, 'BUILD_TIMEOUT_CONFIGURATION_INVALID');
        assert.match(error.message, /Do not retry/u);
        return true;
    });

    assert.equal(calls.codeBuild.length, 2);
    assert.equal(calls.codeBuild[1].constructor.name, 'StopBuildCommand');
    assert.deepEqual(calls.codeBuild[1].input, { id: buildId });
    assert.equal(calls.dynamo.length, 2);
    const failureUpdate = calls.dynamo[1].input;
    assert.equal(failureUpdate.ExpressionAttributeValues[':failureState'], 'VALIDATION_FAILED');
    assert.equal(failureUpdate.ExpressionAttributeValues[':failureCode'], 'BUILD_TIMEOUT_CONFIGURATION_INVALID');
    assert.equal(failureUpdate.ExpressionAttributeValues[':observedTimeout'], 44);
    assert.equal(failureUpdate.ExpressionAttributeValues[':buildId'], buildArn);
    assert.match(failureUpdate.ExpressionAttributeValues[':failure'], /required minimum 45-minute runtime/u);
    assert.match(failureUpdate.ExpressionAttributeValues[':failure'], /Do not retry/u);
    assert.deepEqual(calls.sequence, [
        's3',
        'dynamo',
        'StartBuildCommand',
        'dynamo',
        'StopBuildCommand',
    ]);
});

test('validation stops and rejects a build with incomplete identity even at 600 minutes', async (t) => {
    const calls = mockAws(t, {
        id: buildId,
        projectName: 'test-build',
        timeoutInMinutes: 600,
    });

    await assert.rejects(
        startPipelineBuild(validationRequest()),
        (error) => error.code === 'BUILD_IDENTITY_CONFIGURATION_INVALID',
    );

    assert.equal(calls.codeBuild.length, 2);
    assert.equal(calls.codeBuild[1].constructor.name, 'StopBuildCommand');
    assert.deepEqual(calls.codeBuild[1].input, { id: buildId });
    assert.equal(calls.dynamo.length, 2);
    assert.equal(calls.dynamo[1].input.ExpressionAttributeValues[':failureState'], 'VALIDATION_FAILED');
});

test('validation rejects a build identity from any project other than the configured project', async (t) => {
    const calls = mockAws(t, {
        arn: 'arn:aws:codebuild:us-east-1:123456789012:build/other-build:123',
        id: 'other-build:123',
        projectName: 'other-build',
        timeoutInMinutes: 600,
    });

    await assert.rejects(
        startPipelineBuild(validationRequest()),
        (error) => error.code === 'BUILD_IDENTITY_CONFIGURATION_INVALID',
    );

    assert.deepEqual(calls.codeBuild[1].input, { id: 'other-build:123' });
    assert.equal(
        calls.dynamo[1].input.ExpressionAttributeValues[':failureCode'],
        'BUILD_IDENTITY_CONFIGURATION_INVALID',
    );
});

test('an unconfirmed stop still leaves the run terminal with explicit no-retry guidance', async (t) => {
    const calls = mockAws(
        t,
        {
            arn: buildArn,
            id: buildId,
            projectName: 'test-build',
            timeoutInMinutes: 44,
        },
        { stopError: Object.assign(new Error('Access denied'), { name: 'AccessDeniedException' }) },
    );

    await assert.rejects(startPipelineBuild(validationRequest()), (error) => {
        assert.equal(error.code, 'BUILD_TIMEOUT_CONFIGURATION_INVALID');
        assert.match(error.message, /confirms the build is stopped/u);
        return true;
    });

    assert.equal(calls.codeBuild.length, 2);
    assert.equal(calls.dynamo.length, 2);
    assert.equal(calls.dynamo[1].input.ExpressionAttributeValues[':failureState'], 'VALIDATION_FAILED');
});

test('validation still attempts StopBuild when terminal-state persistence fails', async (t) => {
    const terminalStateError = new Error('DynamoDB unavailable');
    const calls = mockAws(
        t,
        {
            arn: buildArn,
            id: buildId,
            projectName: 'test-build',
            timeoutInMinutes: 44,
        },
        { terminalStateError },
    );

    await assert.rejects(startPipelineBuild(validationRequest()), terminalStateError);

    assert.equal(calls.codeBuild.length, 2);
    assert.equal(calls.codeBuild[1].constructor.name, 'StopBuildCommand');
    assert.deepEqual(calls.codeBuild[1].input, { id: buildId });
    assert.deepEqual(calls.sequence, [
        's3',
        'dynamo',
        'StartBuildCommand',
        'dynamo',
        'StopBuildCommand',
    ]);
});
