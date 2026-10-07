import assert from 'node:assert/strict';
import test from 'node:test';
import { validatedGeocodeBatch, continueGeocodeBuild } from '../handlers/geocode-continuation.mjs';

const build = {
    arn: 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:old',
    id: 'test-build:old', projectName: 'test-build',
    environment: { environmentVariables: [{ name: 'MAX_GEOCODE_REQUESTS_PER_RUN', value: '-1' }] },
};
const batch = { schemaVersion: 1, buildId: build.id, index: 0, count: 2, size: 900, fingerprint: 'a'.repeat(64) };
const item = { runId: 'run', includesCommercial: true, geocodingCostAcknowledgement: { maxRequests: -1 } };
const sourceArtifact = { type: 'S3', bucket: 'source-bucket', key: 'source.zip', versionId: 'version', gitCommit: 'b'.repeat(40), sha256: 'c'.repeat(64), contentLength: 123 };
const next = { arn: 'arn:aws:codebuild:us-east-1:123456789012:build/test-build:new', id: 'test-build:new', projectName: 'test-build', timeoutInMinutes: 45 };

function fakeAws({ claimError, returnedBuild = next } = {}) {
    const calls = [];
    return { calls, dynamo: { send: async (command) => {
        calls.push(command);
        if (claimError && calls.length === 1) throw claimError;
        return {};
    } }, codeBuild: { send: async (command) => { calls.push(command); return { build: returnedBuild }; } } };
}

test('batch evidence is bound to this build, acknowledgement, inventory and part', () => {
    assert.deepEqual(validatedGeocodeBatch({ geocodeBatch: batch }, build, item), batch);
    for (const changed of [{ buildId: 'other' }, { count: 0 }, { index: 1 }, { size: 1200 }, { fingerprint: 'bad' }]) {
        assert.throws(() => validatedGeocodeBatch({ geocodeBatch: { ...batch, ...changed } }, build, item));
    }
    assert.throws(() => validatedGeocodeBatch({}, build, item));
    assert.throws(() => validatedGeocodeBatch({ geocodeBatch: batch }, build, { ...item, geocodingCostAcknowledgement: { maxRequests: 1200 } }));
    const laterBuild = { ...build, environment: { environmentVariables: [...build.environment.environmentVariables, { name: 'MLS_GEOCODE_BATCH_INDEX', value: '1' }] } };
    assert.throws(() => validatedGeocodeBatch({ geocodeBatch: { ...batch, index: 1 } }, laterBuild, item));
    assert.equal(validatedGeocodeBatch({ geocodeBatch: { ...batch, index: 1 } }, laterBuild, { ...item, geocodeBatchIndex: 1, geocodeBatchCount: 2, geocodeBatchFingerprint: batch.fingerprint }).index, 1);
});

test('continuation pins the signed source and starts the next part without unlocking review', async () => {
    const aws = fakeAws();
    const result = await continueGeocodeBuild({ aws, tableName: 'runs', build, item, batch, sourceArtifact, now: 1000 });
    assert.equal(result.state, 'VALIDATING');
    assert.deepEqual(aws.calls.map((call) => call.constructor.name), ['UpdateCommand', 'StartBuildCommand', 'UpdateCommand']);
    const start = aws.calls[1].input;
    assert.equal(start.sourceVersion, sourceArtifact.versionId);
    assert.equal(start.sourceLocationOverride, 'source-bucket/source.zip');
    assert.equal(start.timeoutInMinutesOverride, 45);
    assert.equal(start.environmentVariablesOverride.find((env) => env.name === 'MLS_GEOCODE_BATCH_INDEX').value, '1');
    assert.equal(start.environmentVariablesOverride.find((env) => env.name === 'MAX_GEOCODE_REQUESTS_PER_RUN').value, '-1');
    assert.equal(aws.calls[2].input.ExpressionAttributeValues[':next'], next.arn);
    assert.equal(aws.calls[2].input.ExpressionAttributeValues[':fingerprint'], batch.fingerprint);
});

test('duplicate events cannot acquire a second continuation claim', async () => {
    const aws = fakeAws({ claimError: Object.assign(new Error('claimed'), { name: 'ConditionalCheckFailedException' }) });
    const result = await continueGeocodeBuild({ aws, tableName: 'runs', build, item, batch, sourceArtifact, now: 1000 });
    assert.equal(result.reconciled, false);
    assert.equal(aws.calls.length, 1);
});

test('dispatch retries reuse the saved idempotency token; expired ambiguity never starts paid work', async () => {
    const retryItem = { ...item, geocodeContinuationRequest: { fromBuild: build.arn, requestedAt: 1000, token: 'saved-token' } };
    const aws = fakeAws();
    await continueGeocodeBuild({ aws, tableName: 'runs', build, item: retryItem, batch, sourceArtifact, now: 2000 });
    assert.equal(aws.calls[0].input.idempotencyToken, 'saved-token');
    const expired = fakeAws();
    await assert.rejects(continueGeocodeBuild({ aws: expired, tableName: 'runs', build, item: retryItem, batch, sourceArtifact, now: 241000 }), /ambiguous/);
    assert.equal(expired.calls.length, 0);
});

test('an unsafe continuation build is stopped and never linked', async () => {
    const aws = fakeAws({ returnedBuild: { ...next, timeoutInMinutes: 10 } });
    await assert.rejects(continueGeocodeBuild({ aws, tableName: 'runs', build, item, batch, sourceArtifact, now: 1000 }), /safe identity/);
    assert.deepEqual(aws.calls.map((call) => call.constructor.name), ['UpdateCommand', 'StartBuildCommand', 'StopBuildCommand']);
});
