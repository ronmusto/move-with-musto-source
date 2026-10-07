const SOURCE_REVISION_PATTERN = /^[a-f0-9]{40,64}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const S3_VERSION_ID_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,1024}$/u;
export const SOURCE_ARTIFACT_SCHEMA = 'move-with-musto.pipeline-source.v1';

export const SOURCE_ARTIFACT_ENVIRONMENT_NAMES = Object.freeze({
    bucket: 'PIPELINE_SOURCE_BUCKET_NAME',
    key: 'PIPELINE_SOURCE_OBJECT_KEY',
    versionId: 'PIPELINE_SOURCE_VERSION_ID',
    gitCommit: 'PIPELINE_SOURCE_COMMIT_SHA',
    sha256: 'PIPELINE_SOURCE_SHA256',
    contentLength: 'PIPELINE_SOURCE_CONTENT_LENGTH',
});

export function normalizeSourceRevision(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function isPinnedSourceRevision(value) {
    return SOURCE_REVISION_PATTERN.test(normalizeSourceRevision(value));
}

function normalizedS3Key(value) {
    const key = String(value ?? '').trim();
    const segments = key.split('/');
    if (
        !key ||
        key.length > 1024 ||
        key.startsWith('/') ||
        key.includes('\\') ||
        /[\u0000-\u001f\u007f]/u.test(key) ||
        segments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
        throw new Error('The CodeBuild S3 source key is invalid.');
    }
    return key;
}

export function normalizeS3SourceArtifact(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The CodeBuild S3 source artifact is missing.');
    }
    const versionId = String(value.versionId ?? '').trim();
    const bucket = String(value.bucket ?? '').trim().toLowerCase();
    const sha256 = String(value.sha256 ?? '').trim().toLowerCase();
    const gitCommit = normalizeSourceRevision(value.gitCommit);
    const contentLength = Number(value.contentLength);
    if (!S3_VERSION_ID_PATTERN.test(versionId) || versionId === 'null') {
        throw new Error('The CodeBuild S3 source VersionId is invalid.');
    }
    if (!SHA256_PATTERN.test(sha256)) {
        throw new Error('The CodeBuild S3 source SHA-256 is invalid.');
    }
    if (!isPinnedSourceRevision(gitCommit)) {
        throw new Error('The CodeBuild S3 source originating git commit is invalid.');
    }
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
        throw new Error('The CodeBuild S3 source content length is invalid.');
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket) || bucket.includes('..')) {
        throw new Error('The CodeBuild S3 source bucket is invalid.');
    }
    return {
        type: 'S3',
        bucket,
        key: normalizedS3Key(value.key),
        versionId,
        sha256,
        gitCommit,
        contentLength,
    };
}

export function sameS3SourceArtifact(left, right) {
    try {
        const normalizedLeft = normalizeS3SourceArtifact(left);
        const normalizedRight = normalizeS3SourceArtifact(right);
        return Object.keys(normalizedLeft).every(
            (field) => normalizedLeft[field] === normalizedRight[field],
        );
    } catch {
        return false;
    }
}

export function s3SourceArtifactEnvironment(artifact) {
    const normalized = normalizeS3SourceArtifact(artifact);
    return Object.entries(SOURCE_ARTIFACT_ENVIRONMENT_NAMES).map(([field, name]) => ({
        name,
        type: 'PLAINTEXT',
        value: String(normalized[field]),
    }));
}

export function s3SourceArtifactFromEnvironment(environmentValue) {
    return normalizeS3SourceArtifact(Object.fromEntries(
        Object.entries(SOURCE_ARTIFACT_ENVIRONMENT_NAMES)
            .map(([field, name]) => [field, environmentValue(name)]),
    ));
}

export function codeBuildLookupId(buildArn) {
    const value = String(buildArn ?? '').trim();
    const marker = ':build/';
    const markerIndex = value.indexOf(marker);
    return markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
}

export function exactGeocodingCeilingAcknowledged(acknowledgedMaxRequests, maxRequests) {
    return Number.isInteger(acknowledgedMaxRequests)
        && Number.isInteger(maxRequests)
        && acknowledgedMaxRequests === maxRequests;
}

export function validationCostAcknowledgement({ acknowledged, maxRequests, now, operator }) {
    if (acknowledged !== true) return null;
    if (!Number.isInteger(maxRequests) || maxRequests < -1 || maxRequests > 1200) {
        throw new Error('The geocoding request ceiling must be an integer from -1 through 1200 (-1 means all needed addresses).');
    }
    return {
        acknowledgedAt: new Date(now).toISOString(),
        acknowledgedBy: operator,
        maxRequests,
        grossListPriceMaximumUsd: maxRequests === -1 ? null : Number((maxRequests * 0.005).toFixed(2)),
    };
}
