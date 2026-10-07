import assert from 'node:assert/strict';
import test from 'node:test';

import {
    normalizeS3SourceArtifact,
    sameS3SourceArtifact,
    s3SourceArtifactEnvironment,
    s3SourceArtifactFromEnvironment,
} from '../handlers/build-source.mjs';

const artifact = {
    type: 'S3',
    bucket: 'deployment-artifacts-example',
    key: 'pipeline/source.zip',
    versionId: '3Lg_example-version',
    gitCommit: '0123456789abcdef0123456789abcdef01234567',
    sha256: 'a'.repeat(64),
    contentLength: 12345,
};

test('S3 source artifact identity round-trips through trusted build environment', () => {
    const environment = s3SourceArtifactEnvironment(artifact);
    const values = new Map(environment.map(({ name, value }) => [name, value]));
    const restored = s3SourceArtifactFromEnvironment((name) => values.get(name));

    assert.deepEqual(restored, normalizeS3SourceArtifact(artifact));
    assert.equal(sameS3SourceArtifact(restored, artifact), true);
    assert.equal(environment.every(({ type }) => type === 'PLAINTEXT'), true);
});

test('S3 source artifact identity fails closed on incomplete or unsafe values', () => {
    for (const invalid of [
        { ...artifact, bucket: '' },
        { ...artifact, key: '../source.zip' },
        { ...artifact, versionId: 'null' },
        { ...artifact, gitCommit: 'main' },
        { ...artifact, sha256: 'not-a-hash' },
        { ...artifact, contentLength: 0 },
    ]) {
        assert.throws(() => normalizeS3SourceArtifact(invalid));
        assert.equal(sameS3SourceArtifact(artifact, invalid), false);
    }
});
