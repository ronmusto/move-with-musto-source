import { BatchGetBuildsCommand } from '@aws-sdk/client-codebuild';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand } from '@aws-sdk/client-sns';
import { aws, requiredEnvironment } from './aws.mjs';
import { RUN_STATES } from './constants.mjs';
import { validatedGeocodeBatch, continueGeocodeBuild } from './geocode-continuation.mjs';
import {
    codeBuildLookupId,
    normalizeS3SourceArtifact,
    sameS3SourceArtifact,
    s3SourceArtifactFromEnvironment,
} from './build-source.mjs';

const tableName = requiredEnvironment('RUNS_TABLE_NAME');
const rawBucketName = requiredEnvironment('RAW_BUCKET_NAME');
const alertsTopicArn = requiredEnvironment('ALERTS_TOPIC_ARN');
const TERMINAL_BUILD_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT']);

function environmentValue(build, name) {
    return build?.environment?.environmentVariables?.find((entry) => entry.name === name)?.value;
}

async function readValidationSummary(runId) {
    try {
        const result = await aws.s3.send(new GetObjectCommand({
            Bucket: rawBucketName,
            Key: `reviewed/${runId}/review/portal-summary.json`,
        }));
        const text = await result.Body.transformToString('utf8');
        const report = JSON.parse(text);
        if (report.schemaVersion !== 'move-with-musto.mls-portal-summary.v1') {
            throw new Error('Unexpected portal summary schema.');
        }
        return report;
    } catch (error) {
        console.error(JSON.stringify({
            event: 'mls_validation_summary_unavailable',
            runId,
            errorName: error?.name ?? 'Error',
        }));
        return {
            summaryUnavailable: true,
            message: 'Open the full report before approving this import.',
        };
    }
}

async function notifyFailure({ runId, action, status, logsUrl }) {
    await aws.sns.send(new PublishCommand({
        TopicArn: alertsTopicArn,
        Subject: `Move With Musto MLS ${action.toLowerCase()} failed`,
        Message: [
            `Import: ${runId}`,
            `Action: ${action}`,
            `Status: ${status}`,
            logsUrl ? `AWS build log: ${logsUrl}` : '',
            'The currently published listing data was not replaced.',
        ].filter(Boolean).join('\n'),
    }));
}

export async function reconcileBuild(buildArn, reportedStatus = '') {
    const requestedBuildArn = String(buildArn ?? '').trim();
    if (!requestedBuildArn) {
        return { reconciled: false, reason: 'missing-build-arn' };
    }
    const builds = await aws.codeBuild.send(new BatchGetBuildsCommand({
        ids: [codeBuildLookupId(requestedBuildArn)],
    }));
    const build = builds.builds?.[0];
    const canonicalBuildArn = String(build?.arn ?? '').trim();
    if (!canonicalBuildArn || canonicalBuildArn !== requestedBuildArn) {
        throw new Error(`CodeBuild did not return the requested build ARN ${requestedBuildArn}.`);
    }
    const status = String(reportedStatus || build?.buildStatus || '').trim().toUpperCase();
    if (!TERMINAL_BUILD_STATUSES.has(status)) {
        return { reconciled: false, reason: 'build-not-terminal' };
    }
    const runId = environmentValue(build, 'RUN_ID');
    const action = String(environmentValue(build, 'PIPELINE_ACTION') ?? '').toUpperCase();
    if (!runId || !['VALIDATE', 'PUBLISH'].includes(action)) {
        console.error(JSON.stringify({ event: 'mls_build_event_missing_context', buildArn: canonicalBuildArn }));
        return { reconciled: false, reason: 'missing-build-context' };
    }

    const current = await aws.dynamo.send(new GetCommand({
        TableName: tableName,
        Key: { runId },
        ConsistentRead: true,
    }));
    const expectedState = action === 'VALIDATE' ? RUN_STATES.VALIDATING : RUN_STATES.PUBLISHING;
    if (!current.Item || current.Item.state !== expectedState) {
        return { reconciled: false, reason: 'run-not-pending' };
    }
    if (!current.Item.buildId) {
        await aws.dynamo.send(new UpdateCommand({
            TableName: tableName,
            Key: { runId },
            ConditionExpression: '#state = :expected AND attribute_not_exists(buildId)',
            UpdateExpression: 'SET buildId = :buildArn, buildAction = :buildAction, updatedAt = :now',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
                ':expected': expectedState,
                ':buildArn': canonicalBuildArn,
                ':buildAction': action,
                ':now': new Date().toISOString(),
            },
        }));
        current.Item.buildId = canonicalBuildArn;
    }
    if (current.Item.buildId !== canonicalBuildArn) {
        return { reconciled: false, reason: 'different-build-linked' };
    }

    const expectedSourceArtifact = action === 'VALIDATE'
        ? current.Item.requestedSourceArtifact
        : current.Item.validatedSourceArtifact;
    let buildSourceArtifact;
    try {
        buildSourceArtifact = s3SourceArtifactFromEnvironment(
            (name) => environmentValue(build, name),
        );
    } catch {
        buildSourceArtifact = null;
    }
    let normalizedExpectedArtifact;
    try {
        normalizedExpectedArtifact = normalizeS3SourceArtifact(expectedSourceArtifact);
    } catch {
        normalizedExpectedArtifact = null;
    }
    const sourceLocation = String(build?.source?.location ?? '').trim();
    const sourceType = String(build?.source?.type ?? '').trim().toUpperCase();
    const sourceVersion = String(build?.sourceVersion ?? '').trim();
    const sourceArtifactAvailable = Boolean(normalizedExpectedArtifact && buildSourceArtifact);
    const sourceArtifactMatches = sourceArtifactAvailable &&
        sameS3SourceArtifact(buildSourceArtifact, normalizedExpectedArtifact) &&
        sourceType === 'S3' &&
        sourceLocation === `${normalizedExpectedArtifact.bucket}/${normalizedExpectedArtifact.key}` &&
        sourceVersion === normalizedExpectedArtifact.versionId;
    const succeeded = status === 'SUCCEEDED' && sourceArtifactMatches;
    const effectiveStatus = status === 'SUCCEEDED' && !sourceArtifactAvailable
        ? 'SOURCE_ARTIFACT_UNAVAILABLE'
        : (status === 'SUCCEEDED' && !sourceArtifactMatches ? 'SOURCE_ARTIFACT_MISMATCH' : status);
    const nextState = succeeded
        ? (action === 'VALIDATE' ? RUN_STATES.AWAITING_REVIEW : RUN_STATES.PUBLISHED)
        : (action === 'VALIDATE' ? RUN_STATES.VALIDATION_FAILED : RUN_STATES.PUBLISH_FAILED);
    const now = new Date().toISOString();
    const logsUrl = build?.logs?.deepLink;
    const summary = succeeded && action === 'VALIDATE'
        ? await readValidationSummary(runId)
        : undefined;

    if (succeeded && action === 'VALIDATE') {
        const batch = validatedGeocodeBatch(summary, build, current.Item);
        if (batch && batch.index + 1 < batch.count) {
            return continueGeocodeBuild({ aws, tableName, build, item: current.Item, batch, sourceArtifact: normalizedExpectedArtifact });
        }
    }

    const updateParts = [
        '#state = :nextState',
        'updatedAt = :now',
        'buildLogsUrl = :logsUrl',
        'lastBuildStatus = :status',
    ];
    const values = {
        ':expected': expectedState,
        ':expectedBuildId': canonicalBuildArn,
        ':nextState': nextState,
        ':now': now,
        ':logsUrl': logsUrl ?? '',
        ':status': effectiveStatus,
    };
    if (summary) {
        updateParts.push('summary = :summary');
        values[':summary'] = summary;
    }
    if (!succeeded) {
        updateParts.push('buildFailure = :failure');
        values[':failure'] = `AWS processing ended with ${effectiveStatus}.`;
    }
    if (succeeded && action === 'VALIDATE') {
        updateParts.push(
            'validatedSourceVersion = :sourceCommit',
            'validatedSourceArtifact = :sourceArtifact',
        );
        values[':sourceCommit'] = normalizedExpectedArtifact.gitCommit;
        values[':sourceArtifact'] = normalizedExpectedArtifact;
    }
    if (succeeded && action === 'PUBLISH') {
        updateParts.push(
            'publishedAt = :now',
            'publishedSourceVersion = :sourceCommit',
            'publishedSourceArtifact = :sourceArtifact',
        );
        values[':sourceCommit'] = normalizedExpectedArtifact.gitCommit;
        values[':sourceArtifact'] = normalizedExpectedArtifact;
    }

    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId },
        ConditionExpression: '#state = :expected AND buildId = :expectedBuildId',
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: values,
    }));

    if (!succeeded) {
        await notifyFailure({ runId, action, status: effectiveStatus, logsUrl });
    }
    return { reconciled: true, runId, state: nextState };
}

export async function handler(event) {
    const buildArn = String(event?.detail?.['build-id'] ?? '').trim();
    const status = String(event?.detail?.['build-status'] ?? '').trim().toUpperCase();
    if (!buildArn || !TERMINAL_BUILD_STATUSES.has(status)) {
        return;
    }
    await reconcileBuild(buildArn, status);
}
