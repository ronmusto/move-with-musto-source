import {
    DeleteObjectCommand,
    DeleteObjectsCommand,
    GetObjectCommand,
    ListObjectVersionsCommand,
    ListObjectsV2Command,
    PutObjectCommand,
} from '@aws-sdk/client-s3';
import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { PublishCommand } from '@aws-sdk/client-sns';
import { aws, requiredEnvironment } from './aws.mjs';
import { reconcileBuild } from './build-events.mjs';
import { RUN_RECORD_TTL_DAYS, RUN_STATES } from './constants.mjs';
import {
    pruneCoordinateDocument,
    publicCoordinateCount,
    publicManifestNeedsCoordinateReconciliation,
    withCoordinateCount,
} from './coordinate-retention.mjs';
import {
    activePublicationAgeHours,
    activePublicationKeys,
    parseCurrentPointer,
    PUBLIC_CURRENT_KEY,
    validateActiveManifest,
} from './publication-pointer.mjs';
import {
    summarizeCoordinateCache,
    validateReviewedCoordinateCacheObject,
} from './coordinate-cache-provenance.mjs';

const tableName = requiredEnvironment('RUNS_TABLE_NAME');
const rawBucketName = requiredEnvironment('RAW_BUCKET_NAME');
const coordinateCacheBucketName = requiredEnvironment('COORDINATE_CACHE_BUCKET_NAME');
const deliveryBucketName = requiredEnvironment('DELIVERY_BUCKET_NAME');
const deliveryDistributionId = requiredEnvironment('DELIVERY_DISTRIBUTION_ID');
const alertsTopicArn = requiredEnvironment('ALERTS_TOPIC_ARN');
const freshnessHours = Number(process.env.FRESHNESS_HOURS ?? 60);
const WHOLE_OBJECT_FALLBACK_AGE_MS = 28 * 24 * 60 * 60 * 1000;
const PUBLIC_FRESHNESS_HOURS = 72;

async function readJsonObject(bucket, key) {
    const object = await aws.s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ChecksumMode: 'ENABLED',
    }));
    const body = await object.Body?.transformToString('utf8');
    if (!body) {
        throw new Error(`JSON object s3://${bucket}/${key} is empty.`);
    }
    return {
        document: JSON.parse(body),
        body,
        etag: object.ETag,
        lastModified: object.LastModified,
        objectResponse: {
            ETag: object.ETag,
            ChecksumSHA256: object.ChecksumSHA256,
            ContentLength: object.ContentLength,
            Metadata: object.Metadata,
        },
    };
}

async function writeJsonObject(bucket, key, value, etag, { body, metadata } = {}) {
    await aws.s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body ?? `${JSON.stringify(value)}\n`,
        ContentType: 'application/json',
        ChecksumAlgorithm: 'SHA256',
        ...(metadata ? { Metadata: metadata } : {}),
        ...(etag ? { IfMatch: etag } : {}),
    }));
}

async function deleteRunObjects(runId) {
    let continuationToken;
    do {
        const page = await aws.s3.send(new ListObjectsV2Command({
            Bucket: rawBucketName,
            Prefix: `incoming/${runId}/`,
            ContinuationToken: continuationToken,
        }));
        const objects = (page.Contents ?? []).map(({ Key }) => ({ Key }));
        if (objects.length > 0) {
            await aws.s3.send(new DeleteObjectsCommand({
                Bucket: rawBucketName,
                Delete: { Objects: objects, Quiet: true },
            }));
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
}

async function expireAbandonedUploads(now) {
    const cutoff = new Date(now - (24 * 60 * 60 * 1000)).toISOString();
    const abandoned = [];
    let exclusiveStartKey;
    do {
        const result = await aws.dynamo.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: exclusiveStartKey,
            FilterExpression: '#state = :pending AND createdAt < :cutoff',
            ProjectionExpression: 'runId, #state, createdAt',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
                ':pending': RUN_STATES.UPLOAD_PENDING,
                ':cutoff': cutoff,
            },
        }));
        abandoned.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    for (const item of abandoned) {
        await deleteRunObjects(item.runId);
        await aws.dynamo.send(new UpdateCommand({
            TableName: tableName,
            Key: { runId: item.runId },
            ConditionExpression: '#state = :pending',
            UpdateExpression: 'SET #state = :expired, updatedAt = :now, expirationReason = :reason',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
                ':pending': RUN_STATES.UPLOAD_PENDING,
                ':expired': RUN_STATES.EXPIRED,
                ':now': new Date(now).toISOString(),
                ':reason': 'Upload was not completed within 24 hours.',
            },
        }));
    }
    return abandoned.length;
}

async function reconcilePendingBuilds({ notifyUnlinked = false } = {}) {
    const pending = [];
    let exclusiveStartKey;
    do {
        const result = await aws.dynamo.send(new ScanCommand({
            TableName: tableName,
            ExclusiveStartKey: exclusiveStartKey,
            FilterExpression: '#state IN (:validating, :publishing)',
            ProjectionExpression: 'runId, #state, buildId',
            ExpressionAttributeNames: { '#state': 'state' },
            ExpressionAttributeValues: {
                ':validating': RUN_STATES.VALIDATING,
                ':publishing': RUN_STATES.PUBLISHING,
            },
        }));
        pending.push(...(result.Items ?? []));
        exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);

    let reconciled = 0;
    let unlinked = 0;
    for (const item of pending) {
        if (!item.buildId) {
            unlinked += 1;
            continue;
        }
        try {
            const result = await reconcileBuild(item.buildId);
            if (result.reconciled) {
                reconciled += 1;
            }
        } catch (error) {
            console.error(JSON.stringify({
                event: 'mls_pending_build_reconciliation_failed',
                runId: item.runId,
                errorName: error?.name ?? 'Error',
            }));
        }
    }
    if (notifyUnlinked && unlinked > 0) {
        await aws.sns.send(new PublishCommand({
            TopicArn: alertsTopicArn,
            Subject: 'Move With Musto MLS processing needs attention',
            Message: `${unlinked} MLS processing run(s) are missing their AWS build link. Review the ingestion logs before starting another import.`,
        }));
    }
    return { pending: pending.length, reconciled, unlinked };
}

function isMissingObject(error) {
    return error?.name === 'NotFound' ||
        error?.name === 'NoSuchKey' ||
        error?.$metadata?.httpStatusCode === 404;
}

async function resolveActivePublication(now) {
    try {
        const current = await readJsonObject(deliveryBucketName, PUBLIC_CURRENT_KEY);
        const pointer = parseCurrentPointer(current.document, now);
        const keys = activePublicationKeys(pointer);
        const manifest = await readJsonObject(deliveryBucketName, keys.manifestKey);
        validateActiveManifest(pointer, manifest.document, now);
        return { current, pointer, keys, manifest, error: null };
    } catch (error) {
        return {
            current: null,
            pointer: null,
            keys: null,
            manifest: null,
            error: isMissingObject(error) ? 'missing' : String(error?.message ?? 'invalid'),
        };
    }
}

export async function inspectFreshness(now, activePublication, { notifyMissing = false } = {}) {
    if (!activePublication.pointer || !activePublication.manifest) {
        if (notifyMissing) {
            await aws.sns.send(new PublishCommand({
                TopicArn: alertsTopicArn,
                Subject: 'Move With Musto MLS update is due',
                Message: 'No valid active MLS generation pointer and manifest were found. Complete and publish an import from the ingestion portal.',
            }));
        }
        return {
            stale: true,
            ageHours: Number.POSITIVE_INFINITY,
            notified: notifyMissing,
        };
    }

    const ageHours = activePublicationAgeHours(
        activePublication.pointer,
        activePublication.manifest.document,
        now,
    );
    if (ageHours < freshnessHours) {
        return { stale: false, ageHours, notified: false };
    }

    const generation = activePublication.pointer.generation;
    const reminderRunId = `freshness-reminder#${generation}`;
    let reminder = await aws.dynamo.send(new GetCommand({
        TableName: tableName,
        Key: { runId: reminderRunId },
        ProjectionExpression: 'freshnessReminderSentAt',
        ConsistentRead: true,
    }));
    if (!reminder.Item) {
        reminder = await aws.dynamo.send(new GetCommand({
            TableName: tableName,
            Key: { runId: generation },
            ProjectionExpression: 'freshnessReminderSentAt',
            ConsistentRead: true,
        }));
    }
    if (reminder.Item?.freshnessReminderSentAt) {
        return { stale: true, ageHours, notified: false };
    }

    const generatedAt = Date.parse(activePublication.manifest.document.generatedAt);
    const expiresAt = new Date(generatedAt + (PUBLIC_FRESHNESS_HOURS * 60 * 60 * 1000));
    const hoursRemaining = Math.max(0, PUBLIC_FRESHNESS_HOURS - ageHours);
    const sentAt = new Date(now).toISOString();
    await aws.sns.send(new PublishCommand({
        TopicArn: alertsTopicArn,
        Subject: 'Move With Musto MLS data expires in about 12 hours',
        Message: [
            `The active MLS generation ${generation} is ${Math.floor(ageHours)} hours old.`,
            `It is expected to stop appearing on the public site at ${expiresAt.toISOString()} (about ${Math.ceil(hoursRemaining)} hours remaining).`,
            'Sign in to the ingestion portal and publish the next MLS PIN package before that time.',
        ].join(' '),
    }));
    await aws.dynamo.send(new UpdateCommand({
        TableName: tableName,
        Key: { runId: reminderRunId },
        UpdateExpression: 'SET recordType = :recordType, generation = :generation, freshnessReminderSentAt = :sentAt, createdAt = if_not_exists(createdAt, :sentAt), updatedAt = :sentAt, expiresAtEpoch = if_not_exists(expiresAtEpoch, :expiresAtEpoch)',
        ExpressionAttributeValues: {
            ':recordType': 'FRESHNESS_REMINDER',
            ':generation': generation,
            ':sentAt': sentAt,
            ':expiresAtEpoch': Math.floor(now / 1000) + (RUN_RECORD_TTL_DAYS * 24 * 60 * 60),
        },
    }));
    return { stale: true, ageHours, notified: true };
}

async function hardDeleteOldCoordinateObjects(now) {
    const cutoff = now - WHOLE_OBJECT_FALLBACK_AGE_MS;
    let continuationToken;
    let deleted = 0;
    do {
        const page = await aws.s3.send(new ListObjectsV2Command({
            Bucket: coordinateCacheBucketName,
            ContinuationToken: continuationToken,
        }));
        const objects = (page.Contents ?? [])
            .filter(({ Key, ETag, LastModified }) => (
                Key && ETag && LastModified && LastModified.getTime() <= cutoff
            ));
        for (const object of objects) {
            await aws.s3.send(new DeleteObjectCommand({
                Bucket: coordinateCacheBucketName,
                Key: object.Key,
                IfMatch: object.ETag,
            }));
            deleted += 1;
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
    return deleted;
}

export async function prunePrivateCoordinateObjects(now) {
    let continuationToken;
    let removedEntries = 0;
    let changedObjects = 0;
    do {
        const page = await aws.s3.send(new ListObjectsV2Command({
            Bucket: coordinateCacheBucketName,
            ContinuationToken: continuationToken,
        }));
        const keys = (page.Contents ?? [])
            .map(({ Key }) => Key)
            .filter((key) => key === 'cache/google-geocoding-cache.json' || /^runs\/[^/]+\/(?:mls-coordinate-index\.json|cache-checkpoints\/\d+\.json)$/u.test(key));

        for (const key of keys) {
            const current = await readJsonObject(coordinateCacheBucketName, key);
            const reviewedCache = key === 'cache/google-geocoding-cache.json' || key.includes('/cache-checkpoints/')
                ? validateReviewedCoordinateCacheObject({
                    cacheText: current.body,
                    objectResponse: current.objectResponse,
                    now,
                })
                : null;
            const pruned = pruneCoordinateDocument(current.document, now);
            if (pruned.removedCount > 0) {
                if (pruned.remainingCount === 0) {
                    await aws.s3.send(new DeleteObjectCommand({
                        Bucket: coordinateCacheBucketName,
                        Key: key,
                        IfMatch: current.etag,
                    }));
                } else {
                    const body = `${JSON.stringify(pruned.document)}\n`;
                    const summary = reviewedCache
                        ? summarizeCoordinateCache({
                            cacheText: body,
                            latestLockedLedgerSha256: reviewedCache.latestLockedLedgerSha256,
                            now,
                        })
                        : null;
                    await writeJsonObject(
                        coordinateCacheBucketName,
                        key,
                        pruned.document,
                        current.etag,
                        reviewedCache
                            ? {
                                body,
                                metadata: {
                                    ...current.objectResponse.Metadata,
                                    ...summary.metadata,
                                },
                            }
                            : undefined,
                    );
                }
                removedEntries += pruned.removedCount;
                changedObjects += 1;
            }
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);

    return { changedObjects, removedEntries };
}

async function updatePublicManifestCoordinateCount(activePublication, coordinateCount) {
    const { manifest, keys } = activePublication;
    await writeJsonObject(
        deliveryBucketName,
        keys.manifestKey,
        withCoordinateCount(manifest.document, coordinateCount),
        manifest.etag,
    );
}

async function invalidatePublicCoordinateFiles(activePublication, now) {
    await aws.cloudFront.send(new CreateInvalidationCommand({
        DistributionId: deliveryDistributionId,
        InvalidationBatch: {
            CallerReference: `coordinate-retention-${now}`,
            Paths: {
                Quantity: 2,
                Items: [
                    `/${activePublication.keys.coordinateKey}`,
                    `/${activePublication.keys.manifestKey}`,
                ],
            },
        },
    }));
}

async function deleteNoncurrentPublicCoordinateVersions(activePublication) {
    if (!activePublication.keys) {
        return 0;
    }
    const coordinateKey = activePublication.keys.coordinateKey;
    let keyMarker;
    let versionIdMarker;
    let deleted = 0;
    do {
        const page = await aws.s3.send(new ListObjectVersionsCommand({
            Bucket: deliveryBucketName,
            Prefix: coordinateKey,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
        }));
        const versions = (page.Versions ?? [])
            .filter(({ Key, VersionId, IsLatest }) => (
                Key === coordinateKey && VersionId && !IsLatest
            ))
            .map(({ Key, VersionId }) => ({ Key, VersionId }));
        if (versions.length > 0) {
            await aws.s3.send(new DeleteObjectsCommand({
                Bucket: deliveryBucketName,
                Delete: { Objects: versions, Quiet: true },
            }));
            deleted += versions.length;
        }
        keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
        versionIdMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
    } while (keyMarker);
    return deleted;
}

async function prunePublicCoordinateSidecar(activePublication, now) {
    if (!activePublication.keys) {
        return { changed: false, removedEntries: 0, wholeObjectFallback: false };
    }
    let current;
    try {
        current = await readJsonObject(deliveryBucketName, activePublication.keys.coordinateKey);
    } catch (error) {
        if (isMissingObject(error)) {
            return { changed: false, removedEntries: 0, wholeObjectFallback: false };
        }
        throw error;
    }

    const pruned = pruneCoordinateDocument(current.document, now);
    const wholeObjectFallback = Boolean(
        current.lastModified &&
        now - current.lastModified.getTime() >= WHOLE_OBJECT_FALLBACK_AGE_MS &&
        pruned.remainingCount > 0,
    );
    const nextDocument = wholeObjectFallback
        ? { ...pruned.document, coordinates: {} }
        : pruned.document;
    const removedEntries = wholeObjectFallback
        ? Object.keys(current.document.coordinates ?? {}).length
        : pruned.removedCount;
    const nextCoordinateCount = publicCoordinateCount(nextDocument);
    const coordinateChanged = pruned.removedCount > 0 || wholeObjectFallback;
    const manifestNeedsReconciliation = publicManifestNeedsCoordinateReconciliation(
        activePublication.manifest.document,
        nextDocument,
    );
    if (!coordinateChanged && !manifestNeedsReconciliation) {
        return { changed: false, removedEntries: 0, wholeObjectFallback: false };
    }

    if (coordinateChanged) {
        await writeJsonObject(
            deliveryBucketName,
            activePublication.keys.coordinateKey,
            nextDocument,
            current.etag,
        );
    }
    if (manifestNeedsReconciliation) {
        await updatePublicManifestCoordinateCount(activePublication, nextCoordinateCount);
    }
    await invalidatePublicCoordinateFiles(activePublication, now);

    return {
        changed: true,
        removedEntries,
        wholeObjectFallback,
        manifestReconciled: manifestNeedsReconciliation,
    };
}

export async function handler(event = {}) {
    if (event?.mode === 'build-reconciliation') {
        const now = Date.now();
        const [buildReconciliation, activePublication] = await Promise.all([
            reconcilePendingBuilds(),
            resolveActivePublication(now),
        ]);
        const freshness = await inspectFreshness(now, activePublication);
        console.log(JSON.stringify({
            event: 'mls_scheduled_build_reconciliation_completed',
            ...buildReconciliation,
            activeGeneration: activePublication.pointer?.generation ?? null,
            activePublicationError: activePublication.error,
            stale: freshness.stale,
            ageHours: Number.isFinite(freshness.ageHours) ? Math.round(freshness.ageHours) : null,
            freshnessReminderSent: freshness.notified,
        }));
        return;
    }
    const now = Date.now();
    const activePublication = await resolveActivePublication(now);
    const [expiredUploads, freshness, privateCoordinateRetention, publicCoordinateRetention, buildReconciliation] = await Promise.all([
        expireAbandonedUploads(now),
        inspectFreshness(now, activePublication, { notifyMissing: true }),
        prunePrivateCoordinateObjects(now),
        prunePublicCoordinateSidecar(activePublication, now),
        reconcilePendingBuilds({ notifyUnlinked: true }),
    ]);
    const deletedCoordinateObjects = await hardDeleteOldCoordinateObjects(now);
    const deletedPublicCoordinateVersions = await deleteNoncurrentPublicCoordinateVersions(activePublication);
    console.log(JSON.stringify({
        event: 'mls_daily_maintenance_completed',
        expiredUploads,
        privateCoordinateEntriesRemoved: privateCoordinateRetention.removedEntries,
        privateCoordinateObjectsChanged: privateCoordinateRetention.changedObjects,
        publicCoordinateEntriesRemoved: publicCoordinateRetention.removedEntries,
        publicCoordinateWholeObjectFallback: publicCoordinateRetention.wholeObjectFallback,
        publicManifestReconciled: publicCoordinateRetention.manifestReconciled ?? false,
        pendingBuilds: buildReconciliation.pending,
        buildsReconciled: buildReconciliation.reconciled,
        unlinkedBuilds: buildReconciliation.unlinked,
        deletedCoordinateObjects,
        deletedPublicCoordinateVersions,
        activeGeneration: activePublication.pointer?.generation ?? null,
        activePublicationError: activePublication.error,
        stale: freshness.stale,
        ageHours: Number.isFinite(freshness.ageHours) ? Math.round(freshness.ageHours) : null,
        freshnessReminderSent: freshness.notified,
    }));
}
