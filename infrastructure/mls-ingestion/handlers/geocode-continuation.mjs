import { createHash } from 'node:crypto';
import { StartBuildCommand, StopBuildCommand } from '@aws-sdk/client-codebuild';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { s3SourceArtifactEnvironment } from './build-source.mjs';

export function validatedGeocodeBatch(summary, build, item) {
    const env = (name) => build.environment?.environmentVariables?.find((entry) => entry.name === name)?.value;
    if (env('MAX_GEOCODE_REQUESTS_PER_RUN') !== '-1') return null;
    const batch = summary?.geocodeBatch;
    const index = Number(env('MLS_GEOCODE_BATCH_INDEX') ?? '0');
    if (!batch || batch.schemaVersion !== 1 || batch.buildId !== build.id ||
        batch.size !== 900 || !Number.isSafeInteger(batch.index) || batch.index !== index ||
        !Number.isSafeInteger(batch.count) || batch.count < 1 || batch.index < 0 || batch.index >= batch.count ||
        !/^[a-f0-9]{64}$/.test(batch.fingerprint ?? '') ||
        item.geocodingCostAcknowledgement?.maxRequests !== -1 ||
        (batch.index > 0 && (item.geocodeBatchIndex !== batch.index || item.geocodeBatchFingerprint !== batch.fingerprint || item.geocodeBatchCount !== batch.count))) {
        throw new Error('The uncapped import has missing, stale, or inconsistent geocoding batch evidence.');
    }
    return batch;
}

export async function continueGeocodeBuild({ aws, tableName, build, item, batch, sourceArtifact, now = Date.now() }) {
    const previous = build.arn;
    const priorRequest = item.geocodeContinuationRequest;
    if (priorRequest?.fromBuild === previous && now - priorRequest.requestedAt >= 240000) {
        // CodeBuild idempotency expires after five minutes. Never blindly create
        // a second paid job after an ambiguous StartBuild response.
        throw new Error('Continuation dispatch is ambiguous; reconcile its AWS build before retrying.');
    }
    const request = priorRequest?.fromBuild === previous ? priorRequest : {
        fromBuild: previous, requestedAt: now,
        token: createHash('sha256').update(`mls-continuation:${previous}`).digest('hex'),
    };
    if (request !== priorRequest) {
        try {
            await aws.dynamo.send(new UpdateCommand({
                TableName: tableName, Key: { runId: item.runId },
                ConditionExpression: '#state = :pending AND buildId = :previous AND (attribute_not_exists(geocodeContinuationRequest) OR geocodeContinuationRequest.fromBuild <> :previous)',
                UpdateExpression: 'SET geocodeContinuationRequest = :request',
                ExpressionAttributeNames: { '#state': 'state' },
                ExpressionAttributeValues: { ':pending': 'VALIDATING', ':previous': previous, ':request': request },
            }));
        } catch (error) {
            if (error.name === 'ConditionalCheckFailedException') return { reconciled: false, reason: 'continuation-already-claimed' };
            throw error;
        }
    }
    const result = await aws.codeBuild.send(new StartBuildCommand({
        projectName: build.projectName,
        sourceTypeOverride: 'S3', sourceLocationOverride: `${sourceArtifact.bucket}/${sourceArtifact.key}`,
        sourceVersion: sourceArtifact.versionId, timeoutInMinutesOverride: 45,
        idempotencyToken: request.token,
        environmentVariablesOverride: [
            { name: 'RUN_ID', type: 'PLAINTEXT', value: item.runId },
            { name: 'PIPELINE_ACTION', type: 'PLAINTEXT', value: 'VALIDATE' },
            { name: 'INCLUDES_COMMERCIAL', type: 'PLAINTEXT', value: item.includesCommercial ? 'true' : 'false' },
            { name: 'MAX_GEOCODE_REQUESTS_PER_RUN', type: 'PLAINTEXT', value: '-1' },
            { name: 'MLS_GEOCODE_BATCH_INDEX', type: 'PLAINTEXT', value: String(batch.index + 1) },
            { name: 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY', type: 'PLAINTEXT', value: 'false' },
            ...s3SourceArtifactEnvironment(sourceArtifact),
        ],
    }));
    const next = result.build;
    if (!next?.id || next.arn !== `arn:${previous.split(':')[1]}:codebuild:${previous.split(':')[3]}:${previous.split(':')[4]}:build/${next.id}` ||
        next.projectName !== build.projectName || !next.id.startsWith(`${build.projectName}:`) ||
        !Number.isInteger(next.timeoutInMinutes) || next.timeoutInMinutes < 45) {
        if (next?.id) await aws.codeBuild.send(new StopBuildCommand({ id: next.id }));
        throw new Error('Continuation build did not return a safe identity and runtime.');
    }
    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName, Key: { runId: item.runId },
        ConditionExpression: '#state = :pending AND buildId = :previous',
        UpdateExpression: 'SET buildId = :next, buildAction = :action, updatedAt = :now, buildLogsUrl = :logs, geocodeBatchIndex = :index, geocodeBatchCount = :count, geocodeBatchFingerprint = :fingerprint',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
            ':pending': 'VALIDATING', ':previous': previous, ':next': next.arn, ':action': 'VALIDATE',
            ':now': new Date(now).toISOString(), ':logs': next.logs?.deepLink ?? '',
            ':index': batch.index + 1, ':count': batch.count, ':fingerprint': batch.fingerprint,
        },
    }));
    return { reconciled: true, runId: item.runId, state: 'VALIDATING', nextBatch: batch.index + 1 };
}
