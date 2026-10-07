import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_CONTROL_REQUEST_BYTES, parseJsonBody } from '../handlers/domain.mjs';
import { cloudFrontViewerIp } from '../handlers/viewer-address.mjs';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs', RAW_BUCKET_NAME: 'test-raw',
    IMMUTABLE_AUDIT_BUCKET_NAME: 'test-audit', MANIFEST_SIGNING_KEY_ID: 'test-key',
    BUILD_PROJECT_NAME: 'test-build', MAX_GEOCODE_REQUESTS_PER_RUN: '1200',
    PIPELINE_SOURCE_BUCKET_NAME: 'deployment-artifacts-example',
    PIPELINE_SOURCE_OBJECT_KEY: 'pipeline/source.zip',
    PIPELINE_SOURCE_VERSION_ID: '3Lg_example-version',
    PIPELINE_SOURCE_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    PIPELINE_SOURCE_SHA256: 'a'.repeat(64), PIPELINE_SOURCE_CONTENT_LENGTH: '12345',
});
const [{ handler: uploads }, { handler: runs }, { aws }] = await Promise.all([
    import('../handlers/uploads.mjs'), import('../handlers/runs.mjs'), import('../handlers/aws.mjs'),
]);

test('CloudFront parser accepts trusted address formats and rejects malformed input', () => {
    for (const [input, output] of [
        ['203.0.113.4', '203.0.113.4'], ['203.0.113.4:4430', '203.0.113.4'],
        ['[2001:db8::7]', '2001:db8::7'], ['[2001:db8::7]:4430', '2001:db8::7'],
        ['2001:db8::7:4430', '2001:db8::7'], ['2001:db8::7:53100', '2001:db8::7'],
    ]) assert.equal(cloudFrontViewerIp(input), output);
    for (const input of ['', null, {}, 'garbage', '[::1]:0', '[::1]:65536', '203.0.113.4:abc']) {
        assert.equal(cloudFrontViewerIp(input), '');
    }
});

test('control requests require JSON objects and count bytes in both event encodings', () => {
    assert.deepEqual(parseJsonBody({}), {});
    assert.deepEqual(parseJsonBody({ body: '{"action":"validate"}' }), { action: 'validate' });
    for (const body of ['null', '[]', 'true', '1', '"text"']) {
        assert.throws(() => parseJsonBody({ body }), (error) => error.statusCode === 400 && error.code === 'INVALID_REQUEST');
    }
    assert.throws(() => parseJsonBody({ body: '{' }), (error) => error.code === 'INVALID_JSON');
    for (const isBase64Encoded of [false, true]) {
        const atLimit = JSON.stringify({ note: 'x'.repeat(MAX_CONTROL_REQUEST_BYTES - 11) });
        assert.equal(Buffer.byteLength(atLimit), MAX_CONTROL_REQUEST_BYTES);
        assert.ok(parseJsonBody({ body: isBase64Encoded ? Buffer.from(atLimit).toString('base64') : atLimit, isBase64Encoded }));
        const oversized = JSON.stringify({ note: 'é'.repeat(MAX_CONTROL_REQUEST_BYTES / 2) });
        assert.throws(() => parseJsonBody({
            body: isBase64Encoded ? Buffer.from(oversized).toString('base64') : oversized, isBase64Encoded,
        }), (error) => error.statusCode === 413 && error.code === 'REQUEST_TOO_LARGE');
    }
});

test('authenticated operator routes reject invalid control bodies before any AWS calls', async (t) => {
    let calls = 0;
    for (const client of Object.values(aws)) {
        t.mock.method(client, 'send', async () => { calls += 1; throw new Error('Unexpected AWS call'); });
    }
    const event = {
        pathParameters: { runId: '20260813152724-82582778-6dc7-4d41-a051-7c48f32c0045' },
        requestContext: { http: { method: 'POST' }, authorizer: { jwt: { claims: { sub: 'operator', 'cognito:groups': ['mls-operators'] } } } },
    };
    for (const [handler, routeKey] of [[uploads, 'POST /runs'], [runs, 'POST /runs/{runId}/action']]) {
        for (const body of ['null', '[]', '"text"']) {
            assert.equal((await handler({ ...event, routeKey, body })).statusCode, 400);
        }
        assert.equal((await handler({ ...event, routeKey, body: 'x'.repeat(MAX_CONTROL_REQUEST_BYTES + 1) })).statusCode, 413);
        assert.equal((await handler({ ...event, routeKey, body: 'null', requestContext: { http: { method: 'POST' } } })).statusCode, 403);
    }
    assert.equal(calls, 0);
});
