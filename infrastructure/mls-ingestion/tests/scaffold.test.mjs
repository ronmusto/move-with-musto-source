import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (name) => readFile(path.join(root, name), 'utf8');

test('template isolates coordinate data and blocks public storage access', async () => {
    const template = await read('template.yaml');
    const coordinateSection = template.slice(
        template.indexOf('  CoordinateCacheBucket:'),
        template.indexOf('  DeliveryBucket:'),
    );
    assert.doesNotMatch(coordinateSection, /VersioningConfiguration:/u);
    assert.match(coordinateSection, /ExpirationInDays: 29/u);
    assert.match(template, /KeepCoordinateBucketNonVersioned/u);
    assert.match(template, /BlockPublicAcls: true/u);
    assert.match(template, /OriginAccessControlOriginType: s3/u);
    assert.match(template, /AllowCloudFrontReadOnly/u);
    assert.match(template, /s3:DeleteObjectVersion/u);
    assert.match(template, /s3:ListBucketVersions/u);
    assert.match(template, /MaintenanceRole:[\s\S]*?Action: \[s3:ListBucket, s3:ListBucketVersions\][\s\S]*?Resource: !GetAtt DeliveryBucket\.Arn[\s\S]*?s3:prefix: \[mls\/generations\/\*\/mls-coordinate-index\.json\]/u);
});

test('validation cannot persist coordinate sidecars in raw reviewed storage', async () => {
    const buildspec = await read('buildspec.yml');
    assert.match(buildspec, /--exclude "mls-coordinate-index\.json"/u);
    assert.match(buildspec, /COORDINATE_CACHE_BUCKET_NAME\}\/runs\/\$\{RUN_ID\}\/mls-coordinate-index\.json/u);
    assert.match(buildspec, /aws kms verify/u);
    assert.match(buildspec, /npm run check:mls:live/u);
    assert.match(buildspec, /checksum-algorithm SHA256/u);
    assert.match(buildspec, /--preferred-only/u);
    assert.match(buildspec, /post_build:[\s\S]*?set -euo pipefail/u);
    assert.match(buildspec, /rm -rf public\/mls[\s\S]*?aws s3 sync[\s\S]*?--delete/u);
    assert.match(buildspec, /persist-coordinate-cache\.mjs "\$CACHE_PROVENANCE_LEDGER_SHA256"/u);
    assert.doesNotMatch(buildspec, /CACHE_PUT_ARGS\+=\(--if-none-match/u);
    assert.match(buildspec, /node scripts\/archive-geocode-audit\.mjs/u);
    assert.match(buildspec, /AUDIT_CHECKSUM_NAME/u);
    assert.ok(buildspec.indexOf('AUDIT_PREFIX="geocoding/') < buildspec.indexOf('node infrastructure/mls-ingestion/persist-coordinate-cache.mjs'));
});

test('coordinate cache base and identity survive phase shells for conditional merge', async () => {
    const buildspec = await read('buildspec.yml');
    const postBuildBoundary = buildspec.indexOf('  post_build:');
    const beforePostBuild = buildspec.slice(0, postBuildBoundary);
    const postBuild = buildspec.slice(postBuildBoundary);
    const reloadEtag = postBuild.indexOf('CACHE_ETAG=$(cat "$CACHE_ETAG_FILE")');
    const reloadProvenance = postBuild.indexOf(
        'CACHE_PROVENANCE_LEDGER_SHA256=$(cat "$CACHE_PROVENANCE_LEDGER_SHA256_FILE")',
    );
    const auditOverride = postBuild.indexOf('CACHE_PROVENANCE_LEDGER_SHA256="$AUDIT_SHA256"');
    const cachePut = postBuild.indexOf('node infrastructure/mls-ingestion/persist-coordinate-cache.mjs');

    assert.ok(postBuildBoundary >= 0);
    assert.match(beforePostBuild, /printf '%s' "\$CACHE_ETAG" > "\$CACHE_ETAG_FILE"/u);
    assert.match(
        beforePostBuild,
        /printf '%s' "\$CACHE_PROVENANCE_LEDGER_SHA256" > "\$CACHE_PROVENANCE_LEDGER_SHA256_FILE"/u,
    );
    assert.match(postBuild, /test -s "\$CACHE_ETAG_FILE"/u);
    assert.match(postBuild, /test -s "\$CACHE_PROVENANCE_LEDGER_SHA256_FILE"/u);
    assert.match(postBuild, /CACHE_ETAG=\$\(cat "\$CACHE_ETAG_FILE"\)[\s\S]*?test -n "\$CACHE_ETAG"/u);
    assert.match(
        postBuild,
        /CACHE_PROVENANCE_LEDGER_SHA256=\$\(cat "\$CACHE_PROVENANCE_LEDGER_SHA256_FILE"\)[\s\S]*?test -n "\$CACHE_PROVENANCE_LEDGER_SHA256"/u,
    );
    assert.ok(reloadEtag >= 0);
    assert.ok(reloadProvenance >= 0);
    assert.ok(reloadEtag < auditOverride);
    assert.ok(reloadProvenance < auditOverride);
    assert.ok(auditOverride < cachePut);
    assert.match(beforePostBuild, /cp "\$CACHE_FILE" "\$\{CACHE_FILE\}\.base"/u);
    const persistence = await read('persist-coordinate-cache.mjs');
    assert.match(persistence, /'--if-match', expected/u);
    assert.match(persistence, /validateReviewedCoordinateCacheObject/u);
    assert.doesNotMatch(
        postBuild,
        /s3api (?:get-object|head-object)[\s\S]*?cache\/google-geocoding-cache\.json/u,
    );
});

test('each Google request is mirrored off-instance before network transmission', async () => {
    const [buildspec, template] = await Promise.all([
        read('buildspec.yml'),
        read('template.yaml'),
    ]);
    assert.match(
        buildspec,
        /IMMUTABLE_AUDIT_EVENT_PREFIX="geocoding\/\$\{RUN_ID\}\/\$\{CODEBUILD_BUILD_NUMBER\}\/events"/u,
    );
    assert.match(buildspec, /--immutable-audit-bucket "\$IMMUTABLE_AUDIT_BUCKET_NAME"/u);
    assert.match(buildspec, /--immutable-audit-prefix "\$IMMUTABLE_AUDIT_EVENT_PREFIX"/u);
    assert.match(
        template,
        /Action: \[s3:GetObject, s3:PutObject\][\s\S]{0,160}?ImmutableAuditBucketName\}\/geocoding\/\*/u,
    );
});

test('publication uploads and verifies an immutable generation before switching one pointer', async () => {
    const buildspec = await read('buildspec.yml');
    const generationUpload = buildspec.indexOf('GENERATION_PREFIX="mls/generations/${RUN_ID}"');
    const remoteComparison = buildspec.indexOf('diff -qr public/mls "$REMOTE_VERIFY_DIR"');
    const pointerBuild = buildspec.indexOf('write-current-pointer.mjs');
    const pointerUpload = buildspec.indexOf('aws s3 cp "$CURRENT_POINTER_FILE"');

    assert.ok(generationUpload >= 0);
    assert.ok(generationUpload < remoteComparison);
    assert.ok(remoteComparison < pointerBuild);
    assert.ok(pointerBuild < pointerUpload);
    assert.match(buildspec, /if \[ "\$EXISTING_GENERATION_OBJECTS" = "0" \]; then/u);
    assert.match(buildspec, /if ! diff -qr public\/mls "\$REMOTE_VERIFY_DIR"; then/u);
    assert.match(buildspec, /read-current-generation\.mjs/u);
    assert.match(buildspec, /test "\$ACTIVE_GENERATION" != "\$RUN_ID"/u);
    assert.match(buildspec, /aws s3 rm "s3:\/\/\$\{DELIVERY_BUCKET_NAME\}\/\$\{GENERATION_PREFIX\}\/" --recursive/u);
    assert.match(buildspec, /--cache-control "no-store, max-age=0"/u);
    assert.ok(buildspec.indexOf('CANDIDATE_COUNT=') < pointerBuild);
    assert.match(buildspec, /--max-keys 1 --query 'length\(Contents \|\| `\[\]`\)' --output text/u);
    assert.doesNotMatch(buildspec, /--query KeyCount --output text/u);
    assert.doesNotMatch(buildspec, /cloudfront create-invalidation[\s\S]*?\/mls\/current\.json/u);
    assert.doesNotMatch(buildspec, /DELIVERY_BUCKET_NAME\}\/mls\/" --delete/u);
});

test('optional commercial publication is isolated, all-three-or-none, and never geocoded', async () => {
    const [buildspec, template, constants, domain, portal, runs] = await Promise.all([
        read('buildspec.yml'),
        read('template.yaml'),
        read('handlers/constants.mjs'),
        read('handlers/domain.mjs'),
        read('portal/app.js'),
        read('handlers/runs.mjs'),
    ]);
    const commercialClean = buildspec.indexOf('node scripts/commercial-pin-cleaner.mjs');
    const geocode = buildspec.indexOf('npm run mls:geocode');
    const commercialGeneration = buildspec.indexOf('COMMERCIAL_GENERATION_PREFIX="commercial/generations/${RUN_ID}"');
    const commercialRemoteVerify = buildspec.indexOf('diff -qr "$COMMERCIAL_PUBLIC_DIR" "$COMMERCIAL_REMOTE_VERIFY_DIR"');
    const commercialPointerUpload = buildspec.indexOf(
        'aws s3 cp "$COMMERCIAL_POINTER_FILE" "s3://${DELIVERY_BUCKET_NAME}/commercial/current.json"',
    );
    const residentialPointerUpload = buildspec.indexOf(
        'aws s3 cp "$CURRENT_POINTER_FILE" "s3://${DELIVERY_BUCKET_NAME}/mls/current.json"',
    );

    assert.match(constants, /COMMERCIAL_UPDATE_FILES[\s\S]*?'idx_bu\.txt'[\s\S]*?'idx_ci\.txt'[\s\S]*?'idx_ld\.txt'/u);
    assert.match(domain, /COMMERCIAL_PACKAGE_INCOMPLETE/u);
    assert.match(portal, /commercialSelectedCount === 0 \|\| commercialSelectedCount === commercialFiles\.length/u);
    assert.match(portal, /openReport\(run\.runId, run\.includesCommercial\)/u);
    assert.match(runs, /commercial\/review\/commercial-cleaner-report\.json/u);
    assert.ok(commercialClean >= 0);
    assert.match(buildspec, /--source-manifest "\$REVIEW_DIR\/source-manifest\.json"/u);
    assert.ok(commercialClean < geocode);
    assert.ok(commercialGeneration >= 0);
    assert.ok(commercialGeneration < commercialRemoteVerify);
    assert.ok(commercialRemoteVerify < commercialPointerUpload);
    assert.ok(commercialPointerUpload < residentialPointerUpload);
    assert.match(buildspec, /reviewed\/\$\{RUN_ID\}\/commercial\/public\//u);
    assert.match(buildspec, /write-commercial-current-pointer\.mjs/u);
    assert.match(buildspec, /read-commercial-current-generation\.mjs/u);
    assert.match(buildspec, /test "\$ACTIVE_COMMERCIAL_GENERATION" != "\$RUN_ID"/u);
    assert.doesNotMatch(buildspec, /--query\s+KeyCount/u);
    assert.match(template, /PathPattern: commercial\/current\.json[\s\S]*?CachePolicyId: !Ref CurrentPointerCachePolicy/u);
    assert.match(template, /PathPattern: commercial\/\*/u);
    assert.match(template, /DeliveryBucket\.Arn\}\/commercial\/\*/u);
    assert.match(template, /PublicCommercialBaseUrl:[\s\S]*?\/commercial\//u);
});

test('portal has no embedded secret and presents the complete review workflow', async () => {
    const [app, html, hashWorker, uploads] = await Promise.all([
        read('portal/app.js'),
        read('portal/index.html'),
        read('portal/hash-worker.js'),
        read('handlers/uploads.mjs'),
    ]);
    assert.doesNotMatch(app, /GOOGLE_MAPS_API_KEY|secretAccessKey|aws_secret/iu);
    assert.match(app, /code_challenge_method: 'S256'/u);
    assert.match(app, /crypto\.subtle\.digest\('SHA-256'/u);
    assert.match(app, /Start validation/u);
    assert.match(html, /Review before publishing/u);
    assert.match(html, /idx_bu\.txt[\s\S]*?idx_ci\.txt[\s\S]*?idx_ld\.txt[\s\S]*?never geocoded/u);
    assert.match(app, /Publish to website/u);
    assert.doesNotMatch(app, /file\.arrayBuffer\(\)/u);
    assert.match(app, /new Worker\('\/portal\/hash-worker\.js', \{ type: 'module' \}\)/u);
    assert.match(app, /Checking \$\{index \+ 1\} of \$\{selected\.length\}:[\s\S]*?\$\{percent\}%/u);
    assert.match(hashWorker, /chunkBytes = 4 \* 1024 \* 1024/u);
    assert.match(
        uploads,
        /unhoistableHeaders: new Set\([\s\S]*?Object\.keys\(headers\)\.filter\(\(name\) => name\.startsWith\('x-amz-'\)\)/u,
    );
});

test('template requires private admin-created MFA users and JWT API authorization', async () => {
    const template = await read('template.yaml');
    assert.match(template, /AllowAdminCreateUserOnly: true/u);
    assert.match(template, /MfaConfiguration: 'ON'/u);
    assert.match(template, /EnabledMfas: \[SOFTWARE_TOKEN_MFA\]/u);
    assert.match(template, /UserPoolTags:[\s\S]*?Application: MoveWithMustoMlsIngestion/u);
    assert.match(template, /DefaultAuthorizer: OperatorJwt/u);
    assert.match(template, /JwtConfiguration:/u);
    assert.match(template, /GroupName: mls-operators/u);
});

test('every named Lambda log group has an explicit 30-day retention', async () => {
    const template = await read('template.yaml');
    for (const functionName of ['contact', 'unsubscribe', 'uploads', 'runs', 'build-events', 'maintenance']) {
        assert.match(
            template,
            new RegExp(`LogGroupName: !Sub '/aws/lambda/\\$\\{AWS::StackName\\}-${functionName}'[\\s\\S]{0,80}?RetentionInDays: 30`, 'u'),
        );
    }
    assert.equal((template.match(/DependsOn: (?:Contact|Unsubscribe|Uploads|Runs|BuildEvents|Maintenance)FunctionLogGroup/gu) ?? []).length, 6);
});

test('temporary SES contact delivery is fixed-recipient, throttled, and separate from marketing', async () => {
    const [template, contact, contactDomain] = await Promise.all([
        read('template.yaml'),
        read('handlers/contact.mjs'),
        read('handlers/contact-domain.mjs'),
    ]);

    assert.match(template, /ContactApi:[\s\S]*?ThrottlingRateLimit: 1/u);
    assert.match(template, /ContactRateLimitTable:[\s\S]*?TimeToLiveSpecification:/u);
    assert.match(template, /ContactEmailIdentity:[\s\S]*?EmailIdentity: movewithmusto\.com/u);
    assert.match(template, /ses:FromAddress: !Ref ContactFromEmail/u);
    assert.match(template, /ses:Recipients: !Ref ContactRecipientEmail/u);
    assert.match(template, /ReservedConcurrentExecutions: 1/u);
    assert.match(template, /CONTACT_RATE_LIMIT_HASH_SALT: !Sub '\$\{AWS::StackId\}\/\$\{ContactRateLimitTable\}'/u);
    assert.match(template, /TURNSTILE_SECRET_ARN/u);
    assert.match(template, /PathPattern: inquiries[\s\S]*?TargetOriginId: contact-api/u);
    assert.match(
        template,
        /ContactOriginRequestPolicy:[\s\S]*?HeaderBehavior: whitelist\s+Headers: \[Origin, Content-Type, Access-Control-Request-Headers, Access-Control-Request-Method, CloudFront-Viewer-Address\]/u,
    );
    assert.doesNotMatch(
        template,
        /ContactOriginRequestPolicy:[\s\S]*?HeaderBehavior: whitelist\s+Headers:\s+Items:/u,
    );
    assert.match(template, /ContactNoCachePolicy:[\s\S]*?DefaultTTL: 0[\s\S]*?MaxTTL: 0/u);
    assert.match(template, /PublicInquiryEndpoint:[\s\S]*?https:\/\/\$\{DataDomainName\}\/inquiries/u);
    assert.match(contact, /ReplyToAddresses: \[inquiry\.email\]/u);
    assert.match(contact, /CONTACT_RECIPIENT_EMAIL/u);
    assert.match(contact, /Destination: \{ ToAddresses: \[recipient\] \}/u);
    assert.match(contactDomain, /No marketing subscription was created/u);
});

test('unsubscribe writes only protected identifiers to a retained internal DNC table', async () => {
    const [template, unsubscribe] = await Promise.all([
        read('template.yaml'),
        read('handlers/unsubscribe.mjs'),
    ]);

    assert.match(template, /DoNotContactTable:[\s\S]*?DeletionPolicy: Retain[\s\S]*?PointInTimeRecoveryEnabled: true/u);
    assert.match(template, /UnsubscribeFunctionRole:[\s\S]*?RoleName: !Sub '\$\{AWS::StackName\}-unsubscribe'[\s\S]*?DoNotContactTable\.Arn/u);
    assert.match(template, /PathPattern: unsubscribe[\s\S]*?TargetOriginId: contact-api/u);
    assert.match(template, /Path: \/unsubscribe/u);
    assert.match(template, /PublicUnsubscribeEndpoint:[\s\S]*?https:\/\/\$\{DataDomainName\}\/unsubscribe/u);
    assert.match(template, /DO_NOT_CONTACT_HASH_KEY: !Sub '\{\{resolve:secretsmanager:\$\{ContactOriginSecret\}:SecretString\}\}'/u);
    assert.match(unsubscribe, /createHmac\('sha256', requiredEnvironment\('DO_NOT_CONTACT_HASH_KEY'\)\)/u);
    assert.match(unsubscribe, /Key: \{ emailHash \}/u);
    assert.doesNotMatch(unsubscribe, /Key: \{ email \}|Item: \{[\s\S]{0,120}?email/u);
});



test('delivery uses the exact TLS custom domain for DNS, auth, CORS, and outputs', async () => {
    const template = await read('template.yaml');
    assert.match(template, /Default: data\.movewithmusto\.com/u);
    assert.match(template, /Aliases: \[!Ref DataDomainName\]/u);
    assert.match(template, /AcmCertificateArn: !Ref DataDomainCertificateArn/u);
    assert.match(template, /MinimumProtocolVersion: TLSv1\.2_2021/u);
    assert.match(template, /Type: A[\s\S]*?HostedZoneId: Z2FDTNDATAQYW2/u);
    assert.match(template, /Type: AAAA[\s\S]*?HostedZoneId: Z2FDTNDATAQYW2/u);
    assert.match(template, /CallbackURLs:[\s\S]*?https:\/\/\$\{DataDomainName\}\//u);
    assert.match(template, /PublicMlsBaseUrl:[\s\S]*?https:\/\/\$\{DataDomainName\}\/mls\//u);
});

test('daily maintenance prunes individual expirations and reconciles public metadata', async () => {
    const maintenance = await read('handlers/maintenance.mjs');
    assert.match(maintenance, /pruneCoordinateDocument/u);
    assert.match(maintenance, /updatePublicManifestCoordinateCount/u);
    assert.match(maintenance, /deleteNoncurrentPublicCoordinateVersions/u);
    assert.match(maintenance, /Quantity: 2/u);
    assert.match(maintenance, /PUBLIC_CURRENT_KEY/u);
    assert.match(maintenance, /activePublication\.keys\.coordinateKey/u);
    assert.match(maintenance, /activePublication\.keys\.manifestKey/u);
    assert.match(maintenance, /IfMatch: etag/u);
    assert.match(maintenance, /manifestNeedsReconciliation/u);
    assert.match(maintenance, /if \(!coordinateChanged && !manifestNeedsReconciliation\)/u);
});



test('CloudFront never caches the current pointer and generations age out safely', async () => {
    const template = await read('template.yaml');
    assert.match(template, /CurrentPointerCachePolicy:[\s\S]*?DefaultTTL: 0[\s\S]*?MaxTTL: 0/u);
    const currentPointerPolicy = template.match(/CurrentPointerCachePolicy:([\s\S]*?)ContactNoCachePolicy:/u)?.[1] ?? '';
    const contactNoCachePolicy = template.match(/ContactNoCachePolicy:([\s\S]*?)ContactOriginRequestPolicy:/u)?.[1] ?? '';
    for (const disabledCachePolicy of [currentPointerPolicy, contactNoCachePolicy]) {
        assert.match(disabledCachePolicy, /EnableAcceptEncodingBrotli: false/u);
        assert.match(disabledCachePolicy, /EnableAcceptEncodingGzip: false/u);
        assert.doesNotMatch(disabledCachePolicy, /EnableAcceptEncoding(?:Brotli|Gzip): true/u);
    }
    assert.match(template, /PathPattern: mls\/current\.json[\s\S]*?CachePolicyId: !Ref CurrentPointerCachePolicy/u);
    assert.match(template, /ExpireSupersededMlsGenerations[\s\S]*?Prefix: mls\/generations\/[\s\S]*?ExpirationInDays: 3/u);
    assert.match(template, /mls\/generations\/\*\/mls-search-manifest\.json/u);
    assert.match(template, /mls\/generations\/\*\/mls-coordinate-index\.json/u);
});

test('terminal build events are ARN-linked, retried, dead-lettered, and periodically reconciled', async () => {
    const [handler, runs, maintenance, template] = await Promise.all([
        read('handlers/build-events.mjs'),
        read('handlers/runs.mjs'),
        read('handlers/maintenance.mjs'),
        read('template.yaml'),
    ]);
    assert.match(handler, /if \(!current\.Item\.buildId\)/u);
    assert.match(handler, /attribute_not_exists\(buildId\)/u);
    assert.match(handler, /canonicalBuildArn !== requestedBuildArn/u);
    assert.match(runs, /':buildId': startedBuild\.arn/u);
    assert.match(template, /BuildEventsDeadLetterQueue:/u);
    assert.match(template, /MaximumRetryAttempts: 185/u);
    assert.match(template, /BuildEventsDeadLetterAlarm:/u);
    assert.match(template, /Schedule: rate\(15 minutes\)/u);
    assert.match(maintenance, /reconcilePendingBuilds/u);
});

test('validation pins an S3 artifact and publication requests that exact VersionId', async () => {
    const [handler, runs, template, buildspec] = await Promise.all([
        read('handlers/build-events.mjs'),
        read('handlers/runs.mjs'),
        read('template.yaml'),
        read('buildspec.yml'),
    ]);
    assert.match(handler, /sourceVersion === normalizedExpectedArtifact\.versionId/u);
    assert.match(handler, /validatedSourceVersion = :sourceCommit/u);
    assert.match(handler, /validatedSourceArtifact = :sourceArtifact/u);
    assert.match(handler, /SOURCE_ARTIFACT_MISMATCH/u);
    assert.match(runs, /action === 'publish'[\s\S]*?validatedSourceArtifact/u);
    assert.match(runs, /sourceTypeOverride: 'S3'/u);
    assert.match(runs, /sourceVersion: normalizedSourceArtifact\.versionId/u);
    const sourcePreflight = buildspec.indexOf('aws s3api head-object');
    const dependencyInstall = buildspec.indexOf('npm ci --no-audit --no-fund');
    assert.ok(sourcePreflight >= 0 && sourcePreflight < dependencyInstall);
    assert.ok(buildspec.includes(': "${PIPELINE_SOURCE_CONTENT_LENGTH:?}"'));
    assert.ok(buildspec.includes('test "${CODEBUILD_SOURCE_VERSION:-}" = "$PIPELINE_SOURCE_VERSION_ID"'));
    assert.ok(buildspec.includes('test "${CODEBUILD_SOURCE_REPO_URL:-}" = "${PIPELINE_SOURCE_BUCKET_NAME}/${PIPELINE_SOURCE_OBJECT_KEY}"'));
    assert.ok(buildspec.includes('head-object --bucket "$PIPELINE_SOURCE_BUCKET_NAME" --key "$PIPELINE_SOURCE_OBJECT_KEY" --version-id "$PIPELINE_SOURCE_VERSION_ID" --checksum-mode ENABLED'));
    assert.match(buildspec, /response\.VersionId[\s\S]*?response\.ChecksumSHA256[\s\S]*?response\.ContentLength/u);
    assert.ok(buildspec.includes('/^[a-f0-9]{40,64}$/.test(expectedCommit)'));
    assert.ok(buildspec.includes(`response.Metadata?.['source-schema'] !== 'move-with-musto.pipeline-source.v1'`));
    assert.ok(buildspec.includes(`response.Metadata?.['source-sha256']`));
    assert.ok(buildspec.includes(`response.Metadata?.['git-commit']`));
    assert.match(template, /BUILD_PROJECT_NAME: !Ref IngestionBuildProject/u);
    assert.match(template, /Action: codebuild:BatchGetBuilds[\s\S]{0,180}?Resource:[\s\S]{0,40}?- !GetAtt IngestionBuildProject\.Arn/u);
    assert.ok(template.includes('Location: !Sub'));
    assert.ok(template.includes('${PipelineSourceBucketName}/${PipelineSourceObjectKey}'));
    assert.ok(template.includes('SourceVersion: !Ref PipelineSourceVersionId'));
    assert.match(template, /Action: \[s3:GetObject, s3:GetObjectVersion\][\s\S]*?PipelineSourceBucketName/u);
    assert.match(template, /PIPELINE_SOURCE_CONTENT_LENGTH:\s+!Ref PipelineSourceContentLength/u);
    assert.doesNotMatch(template, /CODECONNECTIONS|RepositoryConnectionArn|codeconnections:/u);
});











test('validation requires a checksum-verified reviewed cache before paid geocoding', async () => {
    const [buildspec, cacheValidator, cacheProvenance] = await Promise.all([
        read('buildspec.yml'),
        read('validate-coordinate-cache-seed.mjs'),
        read('handlers/coordinate-cache-provenance.mjs'),
    ]);
    const cacheDownload = buildspec.indexOf('aws s3api get-object');
    const cacheReview = buildspec.indexOf('validate-coordinate-cache-seed.mjs');
    const paidGeocoder = buildspec.indexOf('npm run mls:geocode');

    assert.ok(cacheDownload >= 0);
    assert.ok(cacheDownload < cacheReview);
    assert.ok(cacheReview < paidGeocoder);
    assert.match(buildspec, /--key "cache\/google-geocoding-cache\.json"[\s\S]*?--checksum-mode ENABLED/u);
    assert.doesNotMatch(buildspec, /CACHE_COUNT=.*list-objects-v2/u);
    assert.match(cacheValidator, /validateCoordinateCacheDocument/u);
    assert.match(cacheValidator, /latest-locked-ledger-sha256/u);
    assert.match(cacheProvenance, /ChecksumSHA256/u);
    assert.doesNotMatch(`${cacheValidator}\n${cacheProvenance}`, /maps\.googleapis\.com|\bfetch\s*\(/u);
});

test('raw staging expires candidates without expiring the selected references', async () => {
    const template = await read('template.yaml');
    assert.match(template, /RemoveUnselectedReferenceCandidates[\s\S]*?Prefix: references\/candidate\/[\s\S]*?ExpirationInDays: 14/u);
    const currentReferences = template.match(/Prefix: references\/current\/[\s\S]{0,120}?ExpirationInDays/gu) ?? [];
    assert.equal(currentReferences.length, 0);
});



test('run listing and maintenance scans consume all DynamoDB pages', async () => {
    const [runs, maintenance] = await Promise.all([
        read('handlers/runs.mjs'),
        read('handlers/maintenance.mjs'),
    ]);
    for (const handler of [runs, maintenance]) {
        assert.match(handler, /ExclusiveStartKey: exclusiveStartKey/u);
        assert.match(handler, /exclusiveStartKey = result\.LastEvaluatedKey/u);
    }
});



test('signed source timestamps drive freshness and pipeline work is serialized', async () => {
    const [verify, template] = await Promise.all([
        read('verify-manifest.mjs'),
        read('template.yaml'),
    ]);
    assert.match(verify, /await utimes\(filePath, modifiedAt, modifiedAt\)/u);
    assert.match(template, /ConcurrentBuildLimit: 1/u);
    assert.match(template, /ReservedConcurrentExecutions: 1/u);
});

test('public source excludes account-specific deployment wrappers', () => {
    for (const name of [
        'deploy.ps1',
        'deploy-portal.ps1',
        'bootstrap-deployment-access.ps1',
        'create-operator.ps1',
        'seed-coordinate-cache.ps1',
    ]) {
        assert.equal(existsSync(path.join(root, name)), false, `${name} must remain outside public source`);
    }
});

test('freshness uses the active manifest and one reminder twelve hours before expiry', async () => {
    const [maintenance, template] = await Promise.all([
        read('handlers/maintenance.mjs'),
        read('template.yaml'),
    ]);
    assert.match(maintenance, /activePublicationAgeHours/u);
    assert.doesNotMatch(maintenance, /HeadObjectCommand/u);
    assert.match(maintenance, /freshnessReminderSentAt/u);
    assert.match(maintenance, /freshness-reminder#/u);
    assert.match(maintenance, /ConsistentRead: true/u);
    assert.match(maintenance, /expires in about 12 hours/u);
    assert.match(maintenance, /event\?\.mode === 'build-reconciliation'[\s\S]*?inspectFreshness\(now, activePublication\)/u);
    assert.match(template, /FreshnessHours:[\s\S]*?Default: 60[\s\S]*?MaxValue: 60/u);
    assert.match(template, /Schedule: rate\(15 minutes\)[\s\S]*?Input: '\{"mode":"build-reconciliation"\}'/u);
    assert.match(template, /Schedule: rate\(1 day\)/u);
});

test('retained build source and canary declare an immutable bounded execution contract', async () => {
    const [template, canary] = await Promise.all([
        read('template.yaml'),
        read('source-canary-buildspec.yml'),
    ]);
    assert.match(template, /IngestionBuildProject:[\s\S]*?UpdateReplacePolicy: Retain/u);
    assert.match(template, /Name: !Sub '\$\{AWS::StackName\}-pipeline-v2'/u);
    assert.match(template, /TimeoutInMinutes: 45/u);
    assert.match(template, /Action: \[codebuild:StartBuild, codebuild:StopBuild\]/u);
    assert.match(template, /IngestionBuildProjectName:[\s\S]*?Value: !Ref IngestionBuildProject/u);
    assert.match(template, /project-name: \[!Ref IngestionBuildProject, !Sub '\$\{AWS::StackName\}-pipeline'\]/u);
    assert.match(template, /Type: S3\s+Location: !Sub '\$\{PipelineSourceBucketName\}\/\$\{PipelineSourceObjectKey\}'/u);
    assert.match(template, /SourceVersion: !Ref PipelineSourceVersionId/u);
    assert.doesNotMatch(template, /GITHUB|CODECONNECTIONS|RepositoryConnectionArn|codeconnections:/u);
    assert.match(canary, /CODEBUILD_SOURCE_VERSION/u);
    assert.match(canary, /PIPELINE_SOURCE_VERSION_ID/u);
    assert.match(canary, /CODEBUILD_SOURCE_REPO_URL/u);
    assert.match(canary, /test "\$\{CODEBUILD_SOURCE_REPO_URL:-\}" = "\$\{PIPELINE_SOURCE_BUCKET_NAME\}\/\$\{PIPELINE_SOURCE_OBJECT_KEY\}"/u);
    assert.doesNotMatch(canary, /npm run mls:geocode|GOOGLE_MAPS|PIPELINE_ACTION/iu);
});

test('all seven runtime roles retain their permissions boundary', async () => {
    const template = await read('template.yaml');
    assert.equal((template.match(/PermissionsBoundary: !Ref StackRolePermissionsBoundary/gu) ?? []).length, 7);
});

test('placeholder geocoding fails closed and retained runtime code enforces cost acknowledgement', async () => {
    const [template, buildspec, portal, runs] = await Promise.all([
        read('template.yaml'),
        read('buildspec.yml'),
        read('portal/app.js'),
        read('handlers/runs.mjs'),
    ]);
    assert.match(template, /SecretString: UNCONFIGURED_REPLACE_WITH_RESTRICTED_GOOGLE_GEOCODING_KEY/u);
    assert.match(template, /GoogleMapsApiKeySecret:[\s\S]*?DeletionPolicy: Retain[\s\S]*?UpdateReplacePolicy: Retain/u);
    assert.match(buildspec, /GOOGLE_MAPS_API_KEY" = "UNCONFIGURED_REPLACE_WITH_RESTRICTED_GOOGLE_GEOCODING_KEY"/u);
    assert.match(buildspec, /MLS_GEOCODE_EMERGENCY_URGENT_ONLY:-false/u);
    assert.match(buildspec, /GEOCODE_ARGS\+=\(--emergency-urgent-only\)/u);
    assert.match(buildspec, /MAX_GEOCODE_REQUESTS_PER_RUN must be an integer from -1 through 1200/u);
    assert.match(buildspec, /MAX_GEOCODE_REQUESTS_PER_RUN" -gt 1200/u);
    assert.match(buildspec, /Emergency urgent-only geocoding requires MAX_GEOCODE_REQUESTS_PER_RUN <= 1,200/u);
    assert.match(buildspec, /MLS_LISTING_ONLY:-false/u);
    assert.match(buildspec, /Listing-only validation requires MAX_GEOCODE_REQUESTS_PER_RUN=0/u);
    assert.match(buildspec, /publishing fresh listing cards with an empty coordinate sidecar/u);
    assert.ok(buildspec.indexOf('UNCONFIGURED_REPLACE_WITH_RESTRICTED') < buildspec.indexOf('npm run mls:geocode'));
    assert.match(template, /MaxGeocodeRequestsPerRun:[\s\S]*?Default: -1[\s\S]*?MaxValue: 1200/u);
    assert.match(template, /Use -1 to process all missing, changed, or expired service-area addresses/u);
    assert.match(template, /TimeoutInMinutes: 45/u);
    assert.match(portal, /config\.maxGeocodeRequestsPerRun <= 1200/u);
    assert.match(portal, /configured Google request ceiling is 1,200 or lower/u);
    assert.match(runs, /Number\.isInteger\(maxGeocodeRequestsPerRun\)[^\n]+maxGeocodeRequestsPerRun > 1200/u);
    assert.match(portal, /at the current list price before any credits/u);
    assert.match(portal, /acknowledgeGeocodingCost/u);
    assert.match(portal, /acknowledgedGeocodingRequestCap = requestCap/u);
    assert.match(runs, /GEOCODING_CEILING_CHANGED/u);
    assert.match(runs, /GEOCODING_COST_ACKNOWLEDGEMENT_REQUIRED/u);
    assert.match(runs, /geocodingCostAcknowledgement = :costAcknowledgement/u);
    assert.match(runs, /FilterExpression: 'attribute_exists\(#state\) AND attribute_exists\(createdAt\)'/u);
    assert.match(runs, /filter\(isRunRecord\)/u);
    assert.match(portal, /filter\(isRenderableRun\)/u);
});

test('retained coordinate-cache seed validates service area and expiry without network access', async () => {
    const seed = await read('seed-coordinate-cache.mjs');
    assert.match(seed, /public\/mls\/mls-search-preferred\.json|--listings/u);
    assert.match(seed, /coordinateIsInMassachusetts/u);
    assert.match(seed, /MAX_CACHE_TTL_MS/u);
    assert.match(seed, /rotationDueAt/u);
    assert.doesNotMatch(seed, /maps\.googleapis\.com|\bfetch\s*\(/u);
});
