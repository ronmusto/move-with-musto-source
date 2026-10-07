import { StartBuildCommand, StopBuildCommand } from '@aws-sdk/client-codebuild';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { aws, requiredEnvironment } from './aws.mjs';
import { RUN_STATES } from './constants.mjs';
import {
    codeBuildLookupId,
    exactGeocodingCeilingAcknowledged,
    normalizeS3SourceArtifact,
    s3SourceArtifactEnvironment,
    SOURCE_ARTIFACT_SCHEMA,
    validationCostAcknowledgement,
} from './build-source.mjs';
import {
    assertTransition,
    ClientError,
    jsonResponse,
    operatorIdentity,
    parseJsonBody,
    safeRunId,
} from './domain.mjs';

const tableName = requiredEnvironment('RUNS_TABLE_NAME');
const rawBucketName = requiredEnvironment('RAW_BUCKET_NAME');
const buildProjectName = requiredEnvironment('BUILD_PROJECT_NAME');
const maxGeocodeRequestsPerRun = Number(requiredEnvironment('MAX_GEOCODE_REQUESTS_PER_RUN'));
const configuredSourceArtifact = normalizeS3SourceArtifact({
    bucket: requiredEnvironment('PIPELINE_SOURCE_BUCKET_NAME'),
    key: requiredEnvironment('PIPELINE_SOURCE_OBJECT_KEY'),
    versionId: requiredEnvironment('PIPELINE_SOURCE_VERSION_ID'),
    gitCommit: requiredEnvironment('PIPELINE_SOURCE_COMMIT_SHA'),
    sha256: requiredEnvironment('PIPELINE_SOURCE_SHA256'),
    contentLength: requiredEnvironment('PIPELINE_SOURCE_CONTENT_LENGTH'),
});
const MAX_RUNS_RETURNED = 50;
const BUILD_TIMEOUT_MINUTES = 45;
const PRESENTABLE_BUILD_STATUSES = new Set([
    'SUCCEEDED',
    'FAILED',
    'FAULT',
    'STOPPED',
    'TIMED_OUT',
    'SOURCE_ARTIFACT_UNAVAILABLE',
    'SOURCE_ARTIFACT_MISMATCH',
    'BUILD_TIMEOUT_CONFIGURATION_INVALID',
    'BUILD_IDENTITY_CONFIGURATION_INVALID',
]);

if (!Number.isInteger(maxGeocodeRequestsPerRun) || maxGeocodeRequestsPerRun < -1 || maxGeocodeRequestsPerRun > 1200) {
    throw new Error('MAX_GEOCODE_REQUESTS_PER_RUN must be an integer from -1 through 1200 (-1 means all needed addresses).');
}

export function isRunRecord(item) {
    return Boolean(item)
        && typeof item.runId === 'string'
        && Object.values(RUN_STATES).includes(item.state)
        && typeof item.createdAt === 'string'
        && Number.isFinite(Date.parse(item.createdAt));
}

function presentBuildStatus(value) {
    const status = String(value ?? '').trim().toUpperCase();
    return PRESENTABLE_BUILD_STATUSES.has(status) ? status : undefined;
}

export function presentRun(item, { includeFiles = false } = {}) {
    const buildStatus = presentBuildStatus(item.lastBuildStatus);
    return {
        runId: item.runId,
        state: item.state,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        uploadedAt: item.uploadedAt,
        review: item.review,
        summary: item.summary,
        geocodeBatch: Number.isInteger(item.geocodeBatchIndex) ? { index: item.geocodeBatchIndex, count: item.geocodeBatchCount } : undefined,
        build: item.buildId || buildStatus ? {
            id: item.buildId,
            action: item.buildAction,
            status: buildStatus,
            logsUrl: item.buildLogsUrl,
            failure: item.buildFailure,
        } : undefined,
        totalBytes: item.totalBytes,
        fileCount: item.files?.length ?? 0,
        files: includeFiles
            ? item.files?.map(({ name, size, sourceModifiedAt }) => ({ name, size, sourceModifiedAt }))
            : undefined,
        usesCurrentReferences: Boolean(item.usesCurrentReferences),
        includesCommercial: Boolean(item.includesCommercial),
        missingReferences: item.missingReferences ?? [],
        manifestSha256: item.manifestSha256,
        sourceRevision: item.validatedSourceVersion,
        note: item.note,
        publishedAt: item.publishedAt,
    };
}

async function getRun(runId, consistentRead = false) {
    const result = await aws.dynamo.send(new GetCommand({
        TableName: tableName,
        Key: { runId },
        ConsistentRead: consistentRead,
    }));
    if (!result.Item) {
        throw new ClientError(404, 'This import could not be found.', 'RUN_NOT_FOUND');
    }
    return result.Item;
}

async function listRuns() {
    const items = [];
    let exclusiveStartKey;
    do {
        const result = await aws.dynamo.send(new ScanCommand({
            TableName: tableName,
            Limit: 100,
            ExclusiveStartKey: exclusiveStartKey,
            FilterExpression: 'attribute_exists(#state) AND attribute_exists(createdAt)',
            ProjectionExpression: 'runId, #state, createdAt, updatedAt, uploadedAt, review, summary, buildId, buildAction, buildLogsUrl, buildFailure, lastBuildStatus, totalBytes, files, usesCurrentReferences, includesCommercial, missingReferences, manifestSha256, validatedSourceVersion, note, publishedAt',
            ExpressionAttributeNames: { '#state': 'state' },
        }));
        items.push(...(result.Items ?? []).filter(isRunRecord));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    const runs = items
        .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
        .slice(0, MAX_RUNS_RETURNED)
        .map((item) => presentRun(item));
    return jsonResponse(200, { runs });
}

async function readRun(event) {
    const runId = safeRunId(event?.pathParameters?.runId);
    return jsonResponse(200, { run: presentRun(await getRun(runId), { includeFiles: true }) });
}

async function createReportUrl(event) {
    const runId = safeRunId(event?.pathParameters?.runId);
    const item = await getRun(runId);
    if (![RUN_STATES.AWAITING_REVIEW, RUN_STATES.APPROVED, RUN_STATES.REJECTED,
        RUN_STATES.PUBLISHING, RUN_STATES.PUBLISH_FAILED, RUN_STATES.PUBLISHED].includes(item.state)) {
        throw new ClientError(409, 'The review report is not ready yet.', 'REPORT_NOT_READY');
    }
    const signedReportUrl = (key) => getSignedUrl(aws.s3, new GetObjectCommand({
        Bucket: rawBucketName,
        Key: key,
        ResponseContentType: 'application/json',
    }), { expiresIn: 5 * 60 });
    const [url, commercialUrl] = await Promise.all([
        signedReportUrl(`reviewed/${runId}/review/mls-ingestion-report.json`),
        item.includesCommercial
            ? signedReportUrl(`reviewed/${runId}/commercial/review/commercial-cleaner-report.json`)
            : Promise.resolve(undefined),
    ]);
    return jsonResponse(200, {
        url,
        commercialUrl,
        expiresAt: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
    });
}

async function updateSimpleTransition({ action, body, item, operator, transition }) {
    if (action === 'approve' && body.acknowledge !== true) {
        throw new ClientError(400, 'Confirm that you reviewed the import summary before approving it.', 'REVIEW_CONFIRMATION_REQUIRED');
    }
    const now = new Date().toISOString();
    const review = {
        decision: action === 'approve' ? 'APPROVED' : 'REJECTED',
        decidedAt: now,
        decidedBy: operator,
        note: String(body.note ?? '').trim().slice(0, 500),
    };
    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId: item.runId },
        ConditionExpression: '#state = :expected',
        UpdateExpression: 'SET #state = :nextState, updatedAt = :now, review = :review',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
            ':expected': item.state,
            ':nextState': transition.pending,
            ':now': now,
            ':review': review,
        },
    }));
    return jsonResponse(200, { runId: item.runId, state: transition.pending, review });
}

export function buildPipelineStartRequest({
    action,
    buildAction,
    runId,
    sourceArtifact,
    includesCommercial = false,
    emergencyUrgentOnly = false,
}) {
    const normalizedSourceArtifact = normalizeS3SourceArtifact(sourceArtifact);
    const environmentVariablesOverride = [
        { name: 'RUN_ID', type: 'PLAINTEXT', value: runId },
        { name: 'PIPELINE_ACTION', type: 'PLAINTEXT', value: buildAction },
        { name: 'INCLUDES_COMMERCIAL', type: 'PLAINTEXT', value: includesCommercial ? 'true' : 'false' },
        ...s3SourceArtifactEnvironment(normalizedSourceArtifact),
    ];
    if (action === 'validate') {
        environmentVariablesOverride.push({ name: 'MLS_GEOCODE_BATCH_INDEX', type: 'PLAINTEXT', value: '0' });
        environmentVariablesOverride.push({
            name: 'MAX_GEOCODE_REQUESTS_PER_RUN',
            type: 'PLAINTEXT',
            value: String(maxGeocodeRequestsPerRun),
        });
        environmentVariablesOverride.push({
            name: 'MLS_GEOCODE_EMERGENCY_URGENT_ONLY',
            type: 'PLAINTEXT',
            value: emergencyUrgentOnly ? 'true' : 'false',
        });
    }

    return {
        projectName: buildProjectName,
        sourceTypeOverride: 'S3',
        sourceLocationOverride: `${normalizedSourceArtifact.bucket}/${normalizedSourceArtifact.key}`,
        sourceVersion: normalizedSourceArtifact.versionId,
        timeoutInMinutesOverride: BUILD_TIMEOUT_MINUTES,
        environmentVariablesOverride,
    };
}

export function sourceArtifactForAction(action, item = {}) {
    if (action === 'validate') {
        return configuredSourceArtifact;
    }
    if (action === 'publish') {
        return normalizeS3SourceArtifact(item.validatedSourceArtifact);
    }
    throw new Error('The pipeline action cannot select a source artifact.');
}

export async function verifyS3SourceArtifact(sourceArtifact) {
    const normalized = normalizeS3SourceArtifact(sourceArtifact);
    let object;
    try {
        object = await aws.s3.send(new HeadObjectCommand({
            Bucket: normalized.bucket,
            Key: normalized.key,
            VersionId: normalized.versionId,
            ChecksumMode: 'ENABLED',
        }));
    } catch {
        throw new ClientError(
            409,
            'The processing source archive is unavailable. Ask an administrator to verify its retained S3 version and access policy.',
            'SOURCE_ARTIFACT_UNAVAILABLE',
        );
    }
    const expectedChecksum = Buffer.from(normalized.sha256, 'hex').toString('base64');
    const metadata = object?.Metadata;
    if (
        object?.VersionId !== normalized.versionId ||
        object?.ChecksumSHA256 !== expectedChecksum ||
        metadata?.['source-sha256'] !== normalized.sha256 ||
        String(metadata?.['git-commit'] ?? '').toLowerCase() !== normalized.gitCommit ||
        object?.ContentLength !== normalized.contentLength ||
        metadata?.['source-schema'] !== SOURCE_ARTIFACT_SCHEMA
    ) {
        throw new ClientError(
            409,
            'The processing source archive failed its version, checksum, or provenance check. Ask an administrator to rebuild the deployment artifact.',
            'SOURCE_ARTIFACT_INVALID',
        );
    }
    return normalized;
}

function startedBuildIdentity(build) {
    return {
        arn: String(build?.arn ?? '').trim(),
        id: String(build?.id ?? '').trim(),
        projectName: String(build?.projectName ?? '').trim(),
        timeoutInMinutes: build?.timeoutInMinutes,
    };
}

async function rejectUnsafeStartedBuild({ action, build, item, transition }) {
    const identity = startedBuildIdentity(build);
    const identityMatchesProject = Boolean(
        identity.arn &&
        identity.id &&
        identity.projectName === buildProjectName &&
        identity.id.startsWith(`${buildProjectName}:`) &&
        codeBuildLookupId(identity.arn) === identity.id
    );
    if (
        identityMatchesProject &&
        Number.isInteger(identity.timeoutInMinutes) &&
        identity.timeoutInMinutes >= BUILD_TIMEOUT_MINUTES
    ) {
        return identity;
    }

    const buildReference = identity.arn || identity.id;
    const stopBuildId = identity.id || (identity.arn ? codeBuildLookupId(identity.arn) : '');
    const failureState = action === 'validate'
        ? RUN_STATES.VALIDATION_FAILED
        : RUN_STATES.PUBLISH_FAILED;
    const failureCode = !identityMatchesProject
        ? 'BUILD_IDENTITY_CONFIGURATION_INVALID'
        : 'BUILD_TIMEOUT_CONFIGURATION_INVALID';
    const failure = stopBuildId
        ? `AWS did not return a build with the required minimum ${BUILD_TIMEOUT_MINUTES}-minute runtime and complete identity. A stop was requested immediately. Do not retry until an administrator confirms the build is stopped and repairs the processing project.`
        : `AWS did not return a build with the required minimum ${BUILD_TIMEOUT_MINUTES}-minute runtime and a usable identity. Do not retry until an administrator confirms no processing job is running and repairs the processing project.`;
    const now = new Date().toISOString();
    const updateParts = [
        '#state = :failureState',
        'updatedAt = :now',
        'buildFailure = :failure',
        'lastBuildStatus = :failureCode',
        'buildAction = :buildAction',
        'buildStopRequestedAt = :now',
    ];
    const expressionValues = {
        ':expected': transition.pending,
        ':failureState': failureState,
        ':now': now,
        ':failure': failure,
        ':failureCode': failureCode,
        ':buildAction': transition.buildAction,
    };
    if (buildReference) {
        updateParts.push('buildId = :buildId');
        expressionValues[':buildId'] = buildReference;
    }
    if (Number.isInteger(identity.timeoutInMinutes)) {
        updateParts.push('buildObservedTimeoutInMinutes = :observedTimeout');
        expressionValues[':observedTimeout'] = identity.timeoutInMinutes;
    }

    // Persist the no-retry terminal state before requesting the stop so a fast
    // STOPPED event cannot re-link this rejected build as active. StopBuild is
    // still attempted when persistence fails.
    let stateError;
    try {
        await aws.dynamo.send(new UpdateCommand({
            TableName: tableName,
            Key: { runId: item.runId },
            ConditionExpression: '#state = :expected',
            UpdateExpression: `SET ${updateParts.join(', ')}`,
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: expressionValues,
        }));
    } catch (error) {
        stateError = error;
    }
    if (stopBuildId) {
        try {
            await aws.codeBuild.send(new StopBuildCommand({ id: stopBuildId }));
        } catch (error) {
            console.error(JSON.stringify({
                event: 'mls_unsafe_build_stop_unconfirmed',
                runId: item.runId,
                buildId: buildReference,
                errorName: error?.name ?? 'Error',
            }));
        }
    }
    if (stateError) {
        throw stateError;
    }
    throw new ClientError(503, failure, failureCode);
}

export async function startPipelineBuild({ action, body, item, operator, transition }) {
    const emergencyUrgentOnly = action === 'validate' && body.emergencyUrgentOnly === true;
    if (action === 'validate' &&
        body.emergencyUrgentOnly !== undefined &&
        typeof body.emergencyUrgentOnly !== 'boolean') {
        throw new ClientError(400, 'Emergency validation must be explicitly enabled or disabled.', 'INVALID_VALIDATION_MODE');
    }
    if (emergencyUrgentOnly && (maxGeocodeRequestsPerRun < 0 || maxGeocodeRequestsPerRun > 1200)) {
        throw new ClientError(
            409,
            'Emergency urgent-only validation requires the configured Google request ceiling to be 1,200 or lower.',
            'EMERGENCY_GEOCODING_CEILING_TOO_HIGH',
        );
    }
    if (action === 'validate' && !exactGeocodingCeilingAcknowledged(
        body.acknowledgedGeocodingRequestCap,
        maxGeocodeRequestsPerRun,
    )) {
        throw new ClientError(409, 'The Google request ceiling changed. Refresh the portal and confirm the updated amount.', 'GEOCODING_CEILING_CHANGED');
    }
    const costAcknowledgement = action === 'validate'
        ? validationCostAcknowledgement({
            acknowledged: body.acknowledgeGeocodingCost,
            maxRequests: maxGeocodeRequestsPerRun,
            now: Date.now(),
            operator,
        })
        : null;
    if (action === 'validate' && !costAcknowledgement) {
        throw new ClientError(
            400,
            'Confirm the displayed Google geocoding policy before starting validation.',
            'GEOCODING_COST_ACKNOWLEDGEMENT_REQUIRED',
        );
    }
    let sourceArtifact;
    try {
        sourceArtifact = sourceArtifactForAction(action, item);
    } catch {
        throw new ClientError(
            409,
            'This import must be validated again before it can be published.',
            'VALIDATED_SOURCE_ARTIFACT_MISSING',
        );
    }
    sourceArtifact = await verifyS3SourceArtifact(sourceArtifact);
    const sourceVersion = sourceArtifact.versionId;
    const now = new Date().toISOString();
    const updateParts = [
        '#state = :nextState',
        'updatedAt = :now',
        'actionRequestedAt = :now',
        'actionRequestedBy = :operator',
    ];
    const expressionValues = {
        ':expected': item.state,
        ':nextState': transition.pending,
        ':now': now,
        ':operator': operator,
    };
    if (action === 'validate') {
        updateParts.push('geocodingCostAcknowledgement = :costAcknowledgement');
        expressionValues[':costAcknowledgement'] = costAcknowledgement;
        updateParts.push('requestedSourceArtifact = :sourceArtifact');
        expressionValues[':sourceArtifact'] = sourceArtifact;
    }
    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId: item.runId },
        ConditionExpression: '#state = :expected',
        UpdateExpression: `SET ${updateParts.join(', ')} REMOVE buildFailure, buildId, buildAction, buildLogsUrl, buildSourceVersion, buildSourceArtifact, geocodeBatchIndex, geocodeBatchCount, geocodeBatchFingerprint, geocodeContinuationRequest`,
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: expressionValues,
    }));

    let build;
    try {
        const result = await aws.codeBuild.send(new StartBuildCommand(buildPipelineStartRequest({
            action,
            buildAction: transition.buildAction,
            runId: item.runId,
            sourceArtifact,
            includesCommercial: Boolean(item.includesCommercial),
            emergencyUrgentOnly,
        })));
        build = result.build;
    } catch (error) {
        await aws.dynamo.send(new UpdateCommand({
            TableName: tableName,
            Key: { runId: item.runId },
            ConditionExpression: '#state = :pending',
            UpdateExpression: 'SET #state = :previous, updatedAt = :now, buildFailure = :failure',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
                ':pending': transition.pending,
                ':previous': item.state,
                ':now': new Date().toISOString(),
                ':failure': 'The processing job could not start.',
            },
        }));
        throw error;
    }

    const startedBuild = await rejectUnsafeStartedBuild({
        action,
        build,
        item,
        transition,
    });

    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId: item.runId },
        ConditionExpression: '#state = :expected',
        UpdateExpression: 'SET updatedAt = :now, buildId = :buildId, buildAction = :buildAction, buildSourceVersion = :sourceVersion, buildSourceArtifact = :sourceArtifact',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: {
            ':expected': transition.pending,
            ':now': new Date().toISOString(),
            ':buildId': startedBuild.arn,
            ':buildAction': transition.buildAction,
            ':sourceVersion': sourceVersion,
            ':sourceArtifact': sourceArtifact,
        },
    }));
    return jsonResponse(202, {
        runId: item.runId,
        state: transition.pending,
        message: action === 'validate'
            ? 'Validation has started. You may leave this page and return later.'
            : 'Publication has started. The current site data stays in place until it succeeds.',
    });
}

async function performAction(event) {
    const operator = operatorIdentity(event);
    const runId = safeRunId(event?.pathParameters?.runId);
    const body = parseJsonBody(event);
    const action = String(body.action ?? '').trim().toLowerCase();
    const item = await getRun(runId, true);
    const transition = assertTransition(action, item.state);

    if (!transition.buildAction) {
        return updateSimpleTransition({ action, body, item, operator, transition });
    }
    return startPipelineBuild({ action, body, item, operator, transition });
}

export async function handler(event) {
    try {
        operatorIdentity(event);
        const routeKey = event?.routeKey;
        if (routeKey === 'GET /runs') {
            return await listRuns();
        }
        if (routeKey === 'GET /runs/{runId}') {
            return await readRun(event);
        }
        if (routeKey === 'GET /runs/{runId}/report-url') {
            return await createReportUrl(event);
        }
        if (routeKey === 'POST /runs/{runId}/action') {
            return await performAction(event);
        }
        return jsonResponse(404, { code: 'NOT_FOUND', message: 'The requested action was not found.' });
    } catch (error) {
        if (error instanceof ClientError) {
            return jsonResponse(error.statusCode, { code: error.code, message: error.message });
        }
        console.error(JSON.stringify({
            event: 'mls_runs_handler_failed',
            requestId: event?.requestContext?.requestId,
            errorName: error?.name ?? 'Error',
        }));
        return jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'The request could not be completed. Please try again.' });
    }
}
