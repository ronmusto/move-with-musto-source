import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SignCommand } from '@aws-sdk/client-kms';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { aws, requiredEnvironment } from './aws.mjs';
import { RUN_STATES, UPLOAD_URL_TTL_SECONDS } from './constants.mjs';
import {
    buildCanonicalManifest,
    ClientError,
    createRunId,
    jsonResponse,
    operatorIdentity,
    parseJsonBody,
    runExpiresAtEpoch,
    safeRunId,
    validateUploadFiles,
} from './domain.mjs';

const tableName = requiredEnvironment('RUNS_TABLE_NAME');
const rawBucketName = requiredEnvironment('RAW_BUCKET_NAME');
const immutableAuditBucketName = requiredEnvironment('IMMUTABLE_AUDIT_BUCKET_NAME');
const manifestSigningKeyId = requiredEnvironment('MANIFEST_SIGNING_KEY_ID');

function objectKey(runId, fileName) {
    return `incoming/${runId}/${fileName}`;
}

async function createUpload(event) {
    const operator = operatorIdentity(event);
    const body = parseJsonBody(event);
    const packageData = validateUploadFiles(body.files, {
        useCurrentReferences: body.useCurrentReferences !== false,
    });
    const now = new Date();
    const runId = createRunId(now);
    const createdAt = now.toISOString();
    const expiresAtEpoch = runExpiresAtEpoch(now.getTime());

    const item = {
        runId,
        state: RUN_STATES.UPLOAD_PENDING,
        createdAt,
        updatedAt: createdAt,
        createdBy: operator,
        files: packageData.files,
        totalBytes: packageData.totalBytes,
        missingReferences: packageData.missingReferences,
        usesCurrentReferences: packageData.usesCurrentReferences,
        includesCommercial: packageData.includesCommercial,
        note: String(body.note ?? '').trim().slice(0, 500),
        expiresAtEpoch,
    };

    await aws.dynamo.send(new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(runId)',
    }));

    const uploads = await Promise.all(packageData.files.map(async (file) => {
        const headers = {
            'content-type': 'text/plain',
            'x-amz-checksum-sha256': file.checksumSha256,
            'x-amz-meta-run-id': runId,
            'x-amz-meta-source-modified-at': file.sourceModifiedAt,
            'x-amz-meta-source-sha256': file.sha256,
            'x-amz-server-side-encryption': 'AES256',
        };
        const command = new PutObjectCommand({
            Bucket: rawBucketName,
            Key: objectKey(runId, file.name),
            Body: undefined,
            ChecksumSHA256: file.checksumSha256,
            ContentType: 'text/plain',
            Metadata: {
                'source-modified-at': file.sourceModifiedAt,
                'source-sha256': file.sha256,
                'run-id': runId,
            },
            ServerSideEncryption: 'AES256',
        });
        return {
            name: file.name,
            url: await getSignedUrl(aws.s3, command, {
                expiresIn: UPLOAD_URL_TTL_SECONDS,
                unhoistableHeaders: new Set(
                    Object.keys(headers).filter((name) => name.startsWith('x-amz-')),
                ),
            }),
            headers,
        };
    }));

    return jsonResponse(201, {
        runId,
        state: item.state,
        uploadExpiresAt: new Date(now.getTime() + (UPLOAD_URL_TTL_SECONDS * 1000)).toISOString(),
        usesCurrentReferences: item.usesCurrentReferences,
        includesCommercial: item.includesCommercial,
        missingReferences: item.missingReferences,
        uploads,
    });
}

async function assertUploadedFile(runId, file) {
    let object;
    try {
        object = await aws.s3.send(new HeadObjectCommand({
            Bucket: rawBucketName,
            Key: objectKey(runId, file.name),
            ChecksumMode: 'ENABLED',
        }));
    } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') {
            throw new ClientError(409, `${file.name} has not finished uploading.`, 'UPLOAD_INCOMPLETE');
        }
        throw error;
    }

    if (Number(object.ContentLength) !== file.size) {
        throw new ClientError(409, `${file.name} does not match the selected file size.`, 'UPLOAD_SIZE_MISMATCH');
    }
    if (object.ChecksumSHA256 !== file.checksumSha256) {
        throw new ClientError(409, `${file.name} failed its checksum verification.`, 'UPLOAD_CHECKSUM_MISMATCH');
    }
    if (object.Metadata?.['source-modified-at'] !== file.sourceModifiedAt
        || object.Metadata?.['source-sha256'] !== file.sha256
        || object.Metadata?.['run-id'] !== runId) {
        throw new ClientError(409, `${file.name} is missing its source evidence.`, 'UPLOAD_METADATA_MISMATCH');
    }
}

async function putManifestCopies(runId, manifestBody, signature, manifestSha256) {
    const manifestKey = `incoming/${runId}/source-manifest.json`;
    const signatureKey = `incoming/${runId}/source-manifest.sig`;
    const auditPrefix = `source-manifests/${runId}/${manifestSha256}`;
    const common = {
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
        Metadata: {
            'manifest-sha256': manifestSha256,
            'run-id': runId,
        },
    };
    const signatureCommon = {
        ContentType: 'application/octet-stream',
        ServerSideEncryption: 'AES256',
        Metadata: {
            'manifest-sha256': manifestSha256,
            'run-id': runId,
            'signing-algorithm': 'ECDSA_SHA_256',
        },
    };

    await Promise.all([
        aws.s3.send(new PutObjectCommand({
            Bucket: rawBucketName,
            Key: manifestKey,
            Body: manifestBody,
            ...common,
        })),
        aws.s3.send(new PutObjectCommand({
            Bucket: rawBucketName,
            Key: signatureKey,
            Body: signature,
            ...signatureCommon,
        })),
        aws.s3.send(new PutObjectCommand({
            Bucket: immutableAuditBucketName,
            Key: `${auditPrefix}.json`,
            Body: manifestBody,
            ...common,
        })),
        aws.s3.send(new PutObjectCommand({
            Bucket: immutableAuditBucketName,
            Key: `${auditPrefix}.sig`,
            Body: signature,
            ...signatureCommon,
        })),
    ]);

    return { manifestKey, signatureKey, immutableAuditPrefix: auditPrefix };
}

async function completeUpload(event) {
    const operator = operatorIdentity(event);
    const runId = safeRunId(event?.pathParameters?.runId);
    const result = await aws.dynamo.send(new GetCommand({
        TableName: tableName,
        Key: { runId },
        ConsistentRead: true,
    }));
    const item = result.Item;
    if (!item) {
        throw new ClientError(404, 'This import could not be found.', 'RUN_NOT_FOUND');
    }
    if (item.state !== RUN_STATES.UPLOAD_PENDING) {
        if (item.state === RUN_STATES.UPLOADED) {
            return jsonResponse(200, { runId, state: item.state, manifestSha256: item.manifestSha256 });
        }
        throw new ClientError(409, `This import is already ${item.state}.`, 'INVALID_STATE_TRANSITION');
    }

    await Promise.all(item.files.map((file) => assertUploadedFile(runId, file)));

    const completedAt = new Date().toISOString();
    const canonical = buildCanonicalManifest({
        runId,
        createdAt: item.createdAt,
        completedAt,
        createdBy: item.createdBy,
        packageData: {
            files: item.files,
            totalBytes: item.totalBytes,
            missingReferences: item.missingReferences ?? [],
            usesCurrentReferences: Boolean(item.usesCurrentReferences),
            includesCommercial: Boolean(item.includesCommercial),
        },
    });
    const signed = await aws.kms.send(new SignCommand({
        KeyId: manifestSigningKeyId,
        Message: Buffer.from(canonical.body, 'utf8'),
        MessageType: 'RAW',
        SigningAlgorithm: 'ECDSA_SHA_256',
    }));
    if (!signed.Signature) {
        throw new Error('KMS did not return a source-manifest signature.');
    }
    const evidence = await putManifestCopies(
        runId,
        canonical.body,
        Buffer.from(signed.Signature),
        canonical.sha256,
    );

    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId },
        ConditionExpression: '#state = :expected',
        UpdateExpression: 'SET #state = :state, updatedAt = :now, uploadedAt = :now, completedBy = :operator, manifestSha256 = :sha, manifestKey = :manifestKey, signatureKey = :signatureKey, immutableAuditPrefix = :auditPrefix',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
            ':expected': RUN_STATES.UPLOAD_PENDING,
            ':state': RUN_STATES.UPLOADED,
            ':now': completedAt,
            ':operator': operator,
            ':sha': canonical.sha256,
            ':manifestKey': evidence.manifestKey,
            ':signatureKey': evidence.signatureKey,
            ':auditPrefix': evidence.immutableAuditPrefix,
        },
    }));

    return jsonResponse(200, {
        runId,
        state: RUN_STATES.UPLOADED,
        manifestSha256: canonical.sha256,
        nextStep: 'Start validation when you are ready.',
    });
}

export async function handler(event) {
    try {
        const method = event?.requestContext?.http?.method;
        const routeKey = event?.routeKey;
        if (method === 'POST' && routeKey === 'POST /runs') {
            return await createUpload(event);
        }
        if (method === 'POST' && routeKey === 'POST /runs/{runId}/complete') {
            return await completeUpload(event);
        }
        return jsonResponse(404, { code: 'NOT_FOUND', message: 'The requested action was not found.' });
    } catch (error) {
        if (error instanceof ClientError) {
            return jsonResponse(error.statusCode, { code: error.code, message: error.message });
        }
        console.error(JSON.stringify({
            event: 'mls_upload_handler_failed',
            requestId: event?.requestContext?.requestId,
            errorName: error?.name ?? 'Error',
        }));
        return jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'The upload could not be completed. Please try again.' });
    }
}
