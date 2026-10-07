#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => readFile(path.join(root, name), 'utf8');
const [
    template,
    buildspec,
    portal,
    hashWorker,
    runs,
    buildSource,
    cacheSeed,
    cacheSeedValidator,
] = await Promise.all([
    read('template.yaml'),
    read('buildspec.yml'),
    read('portal/app.js'),
    read('portal/hash-worker.js'),
    read('handlers/runs.mjs'),
    read('handlers/build-source.mjs'),
    read('seed-coordinate-cache.mjs'),
    read('validate-coordinate-cache-seed.mjs'),
]);

const requiredPatterns = [
    [template, /AllowAdminCreateUserOnly:\s*true/u, 'Cognito public signup is disabled'],
    [template, /MfaConfiguration:\s*'ON'/u, 'Cognito MFA is mandatory'],
    [template, /EnabledMfas:\s*\[SOFTWARE_TOKEN_MFA\]/u, 'Cognito software-token MFA is enabled'],
    [template, /UserPoolTags:[\s\S]*?Application:\s*MoveWithMustoMlsIngestion/u, 'Cognito user pool is tagged for scoped operator administration'],
    [template, /Type:\s*AWS::Serverless::HttpApi/u, 'JWT HTTP API exists'],
    [template, /ContactOriginRequestPolicy:[\s\S]*?HeaderBehavior:\s*whitelist\s+Headers:\s*\[Origin, Content-Type, Access-Control-Request-Headers, Access-Control-Request-Method, CloudFront-Viewer-Address\]/u, 'CloudFront contact origin headers use the required direct array'],
    [template, /JwtConfiguration:/u, 'JWT authorizer exists'],
    [template, /OriginAccessControlOriginType:\s*s3/u, 'CloudFront OAC exists'],
    [template, /Aliases:\s*\[!Ref DataDomainName\]/u, 'CloudFront uses the data custom domain'],
    [template, /PipelineSourceObjectKey:[\s\S]*?AllowedValues: \[mls-pipeline-source\/source\.zip\]/u, 'pipeline source uses the stable retained private S3 key'],
    [template, /Source:\s+Type: S3\s+Location: !Sub '\$\{PipelineSourceBucketName\}\/\$\{PipelineSourceObjectKey\}'[\s\S]*?SourceVersion: !Ref PipelineSourceVersionId/u, 'CodeBuild uses an immutable versioned S3 source archive'],
    [template, /Action: \[s3:GetObject, s3:GetObjectVersion\]\s+Resource: !Sub 'arn:\$\{AWS::Partition\}:s3:::\$\{PipelineSourceBucketName\}\/mls-pipeline-source\/\*'/u, 'runtime roles can read only retained pipeline source versions'],
    [template, /AcmCertificateArn:\s*!Ref DataDomainCertificateArn/u, 'CloudFront uses the ACM certificate'],
    [template, /Type:\s*AAAA/u, 'Route 53 has IPv6 alias routing'],
    [template, /HardDeleteAllCoordinateDataBeforeThirtyDays[\s\S]*?ExpirationInDays:\s*29/u, 'coordinate lifecycle is below 30 days'],
    [template, /KeepCoordinateBucketNonVersioned[\s\S]*?s3:PutBucketVersioning/u, 'coordinate versioning is denied'],
    [template, /s3:DeleteObjectVersion/u, 'public coordinate history can be hard-deleted'],
    [template, /s3:ListBucketVersions/u, 'public coordinate history can be enumerated'],
    [template, /CurrentPointerCachePolicy:[\s\S]*?DefaultTTL:\s*0[\s\S]*?MaxTTL:\s*0/u, 'current MLS pointer bypasses CloudFront caching'],
    [template, /ExpireSupersededMlsGenerations[\s\S]*?Prefix:\s*mls\/generations\//u, 'old MLS generations have bounded retention'],
    [template, /RemoveUnselectedReferenceCandidates[\s\S]*?Prefix:\s*references\/candidate\/[\s\S]*?ExpirationInDays:\s*14/u, 'unselected reference candidates expire'],
    [template, /LogGroupName: !Sub '\/aws\/lambda\/\$\{AWS::StackName\}-maintenance'[\s\S]*?RetentionInDays:\s*30/u, 'named Lambda logs expire after 30 days'],
    [buildspec, /--exclude "mls-coordinate-index\.json"/u, 'raw reviewed storage excludes the coordinate sidecar'],
    [buildspec, /COORDINATE_CACHE_BUCKET_NAME\}\/runs\/\$\{RUN_ID\}/u, 'run coordinate sidecar uses temporary storage'],
    [buildspec, /--preferred-only/u, 'geocoding is limited to the service area'],
    [buildspec, /--immutable-audit-bucket "\$IMMUTABLE_AUDIT_BUCKET_NAME"/u, 'request evidence uses the immutable audit bucket'],
    [buildspec, /--immutable-audit-prefix "\$IMMUTABLE_AUDIT_EVENT_PREFIX"/u, 'request evidence uses unique run and build keys'],
    [template, /Action:\s*\[s3:GetObject, s3:PutObject\][\s\S]{0,160}?ImmutableAuditBucketName\}\/geocoding\/\*/u, 'CodeBuild can conditionally verify immutable request evidence'],
    [portal, /new Worker\('\/portal\/hash-worker\.js', \{ type: 'module' \}\)/u, 'browser checksums run in a worker'],
    [hashWorker, /chunkBytes = 4 \* 1024 \* 1024/u, 'browser checksums use bounded chunks'],
    [portal, /code_challenge_method:\s*'S256'/u, 'OAuth uses PKCE'],
    
    [buildspec, /node scripts\/archive-geocode-audit\.mjs/u, 'geocode ledger uses the archive validator'],
    [buildspec, /AUDIT_CHECKSUM_NAME/u, 'geocode ledger checksum is archived'],
    [buildspec, /GENERATION_PREFIX="mls\/generations\/\$\{RUN_ID\}"/u, 'publication uses a unique generation prefix'],
    [buildspec, /diff -qr public\/mls "\$REMOTE_VERIFY_DIR"[\s\S]*?write-current-pointer\.mjs/u, 'generation bytes are verified before pointer creation'],
    [buildspec, /read-current-generation\.mjs[\s\S]*?test "\$ACTIVE_GENERATION" != "\$RUN_ID"[\s\S]*?aws s3 rm/u, 'retry cleanup cannot delete the selected generation'],
    [buildspec, /Pointer replacement is deliberately the final failure-capable[\s\S]*?s3 cp "\$CURRENT_POINTER_FILE"/u, 'atomic current pointer is the final publication action'],
    [buildspec, /UNCONFIGURED_REPLACE_WITH_RESTRICTED_GOOGLE_GEOCODING_KEY/u, 'placeholder Google key blocks validation'],
    [buildspec, /s3api get-object[\s\S]*?cache\/google-geocoding-cache\.json[\s\S]*?--checksum-mode ENABLED/u, 'validation requires the exact checksum-enabled cache object'],
    [buildspec, /validate-coordinate-cache-seed\.mjs[\s\S]*?npm run mls:geocode/u, 'reviewed cache validation precedes paid geocoding'],
    [buildspec, /printf '%s' "\$CACHE_ETAG" > "\$CACHE_ETAG_FILE"/u, 'reviewed cache ETag is handed across build phases'],
    [buildspec, /printf '%s' "\$CACHE_PROVENANCE_LEDGER_SHA256" > "\$CACHE_PROVENANCE_LEDGER_SHA256_FILE"/u, 'reviewed cache provenance is handed across build phases'],
    [buildspec, /post_build:[\s\S]*?CACHE_ETAG=\$\(cat "\$CACHE_ETAG_FILE"\)[\s\S]*?test -n "\$CACHE_ETAG"/u, 'post-build reloads and requires the reviewed cache ETag'],
    [buildspec, /post_build:[\s\S]*?CACHE_PROVENANCE_LEDGER_SHA256=\$\(cat "\$CACHE_PROVENANCE_LEDGER_SHA256_FILE"\)[\s\S]*?test -n "\$CACHE_PROVENANCE_LEDGER_SHA256"/u, 'post-build reloads and requires reviewed cache provenance'],
    [buildspec, /persist-coordinate-cache\.mjs "\$CACHE_PROVENANCE_LEDGER_SHA256"/u, 'cache updates use reviewed conditional merge and durable checkpoints'],
    [buildspec, /cp "\$CACHE_FILE" "\$\{CACHE_FILE\}\.base"/u, 'conditional merge preserves the original cache snapshot'],
    [template, /MaxGeocodeRequestsPerRun:[\s\S]*?Default:\s*-1[\s\S]*?MaxValue:\s*1200/u, 'cloud geocoding defaults to all needed addresses with bounded recovery support'],
    [template, /Use -1 to process all missing, changed, or expired service-area addresses/u, 'cloud geocoding documents uncapped urgent work'],
    [template, /TimeoutInMinutes:\s*45/u, 'the CodeBuild project uses the requested 45-minute runtime'],
    
    
    
    
    
    [buildspec, /MAX_GEOCODE_REQUESTS_PER_RUN must be an integer from -1 through 1200/u, 'the buildspec enforces the uncapped -1 policy and bounded 0 through 1,200 recovery range'],
    [buildspec, /Emergency urgent-only geocoding requires MAX_GEOCODE_REQUESTS_PER_RUN <= 1,200/u, 'emergency geocoding enforces the 1,200-request ceiling'],
    [portal, /config\.maxGeocodeRequestsPerRun <= 1200/u, 'the portal rejects request ceilings above 1,200'],
    [portal, /configured Google request ceiling is 1,200 or lower/u, 'the portal documents the emergency 1,200-request ceiling'],
    [runs, /Number\.isInteger\(maxGeocodeRequestsPerRun\)[^\n]+maxGeocodeRequestsPerRun > 1200/u, 'the Runs API enforces the uncapped -1 policy and bounded 0 through 1,200 recovery range'],
    [runs, /const BUILD_TIMEOUT_MINUTES = 45[\s\S]*?timeoutInMinutesOverride: BUILD_TIMEOUT_MINUTES/u, 'the Runs API requests a 45-minute timeout override'],
    [runs, /Number\.isInteger\(identity\.timeoutInMinutes\)[\s\S]{0,120}?identity\.timeoutInMinutes >= BUILD_TIMEOUT_MINUTES/u, 'the Runs API accepts only integer effective timeouts of at least 45 minutes'],
    [buildSource, /Number\.isInteger\(maxRequests\)[^\n]+maxRequests > 1200/u, 'cost acknowledgements enforce the uncapped -1 policy and bounded 0 through 1,200 recovery range'],
    [portal, /acknowledgeGeocodingCost/u, 'portal asks for geocoding ceiling acknowledgement'],
    [runs, /GEOCODING_COST_ACKNOWLEDGEMENT_REQUIRED/u, 'API requires geocoding ceiling acknowledgement'],
    [template, /BuildEventsDeadLetterQueue:[\s\S]*?MessageRetentionPeriod:\s*1209600/u, 'terminal build events have a retained DLQ'],
    [template, /Schedule:\s*rate\(15 minutes\)/u, 'pending builds are periodically reconciled'],
    [template, /PermissionsBoundary:\s*!Ref StackRolePermissionsBoundary/u, 'runtime roles use a permissions boundary'],
    
    
    
    
    [cacheSeed, /coordinateIsInMassachusetts/u, 'initial cache seed rejects coordinates outside Massachusetts'],
    [cacheSeed, /MAX_CACHE_TTL_MS/u, 'initial cache seed enforces the 30-day entry TTL'],
    
    
    
    
    
    
    
    
    
    
    
    
    
    
];

const failures = requiredPatterns
    .filter(([text, pattern]) => !pattern.test(text))
    .map(([, , description]) => description);

try {
    const syntaxOnlyTemplate = template.replace(
        /!(?:Ref|Sub|GetAtt|Join|If|Equals|Not|And|Or|FindInMap|Select|Split|Base64|ImportValue|GetAZs|Cidr|Transform)\s+/gu,
        '',
    );
    YAML.parse(syntaxOnlyTemplate);
    YAML.parse(buildspec);
} catch (error) {
    failures.push(`template or buildspec YAML is invalid: ${error.message}`);
}

const coordinateSection = template.slice(
    template.indexOf('  CoordinateCacheBucket:'),
    template.indexOf('  DeliveryBucket:'),
);
if (/VersioningConfiguration:/u.test(coordinateSection)) {
    failures.push('coordinate cache bucket must not enable or suspend versioning');
}
if (/GOOGLE_MAPS_API_KEY|secretAccessKey|aws_secret/iu.test(portal)) {
    failures.push('portal source must not contain a Google or AWS secret');
}
if (/ContactOriginRequestPolicy:[\s\S]*?HeaderBehavior:\s*whitelist\s+Headers:\s+Items:/u.test(template)) {
    failures.push('CloudFront OriginRequestPolicy Headers must be a direct array, not an Items object');
}
if (/CODECONNECTIONS|RepositoryConnectionArn|codeconnections:|codestar-connections:/u.test(template)) {
    failures.push('runtime infrastructure must not depend on a GitHub or CodeConnections checkout');
}
if (/maps\.googleapis\.com|\bfetch\s*\(/u.test(cacheSeed)) {
    failures.push('one-time coordinate-cache seed must never call Google or another network endpoint');
}
if (/maps\.googleapis\.com|\bfetch\s*\(/u.test(cacheSeedValidator)) {
    failures.push('reviewed coordinate-cache validation must never call Google or another network endpoint');
}
const cacheDownloadIndex = buildspec.indexOf('aws s3api get-object');
const cacheReviewIndex = buildspec.indexOf('validate-coordinate-cache-seed.mjs');
const paidGeocoderIndex = buildspec.indexOf('npm run mls:geocode');
if (!(cacheDownloadIndex >= 0 && cacheDownloadIndex < cacheReviewIndex && cacheReviewIndex < paidGeocoderIndex)) {
    failures.push('the exact reviewed coordinate cache must be downloaded and validated before paid geocoding');
}
if (/CACHE_COUNT=.*list-objects-v2/u.test(buildspec) || /CACHE_PUT_ARGS\+=\(--if-none-match/u.test(buildspec)) {
    failures.push('cloud validation must not have a missing-cache bootstrap path');
}
const auditArchiveIndex = buildspec.indexOf('node scripts/archive-geocode-audit.mjs');
const auditUploadIndex = buildspec.indexOf('AUDIT_PREFIX="geocoding/');
const cacheUploadIndex = buildspec.indexOf('node infrastructure/mls-ingestion/persist-coordinate-cache.mjs');
if (!(auditArchiveIndex >= 0 && auditArchiveIndex < auditUploadIndex && auditUploadIndex < cacheUploadIndex)) {
    failures.push('immutable ledger archive and checksum upload must precede cache persistence');
}
const postBuildIndex = buildspec.indexOf('  post_build:');
const postBuild = buildspec.slice(postBuildIndex);
const cacheEtagReloadIndex = postBuild.indexOf('CACHE_ETAG=$(cat "$CACHE_ETAG_FILE")');
const cacheProvenanceReloadIndex = postBuild.indexOf(
    'CACHE_PROVENANCE_LEDGER_SHA256=$(cat "$CACHE_PROVENANCE_LEDGER_SHA256_FILE")',
);
const cacheProvenanceOverrideIndex = postBuild.indexOf('CACHE_PROVENANCE_LEDGER_SHA256="$AUDIT_SHA256"');
const postBuildCacheUploadIndex = postBuild.indexOf('node infrastructure/mls-ingestion/persist-coordinate-cache.mjs');
if (!(
    postBuildIndex >= 0
    && cacheEtagReloadIndex >= 0
    && cacheProvenanceReloadIndex >= 0
    && cacheEtagReloadIndex < cacheProvenanceOverrideIndex
    && cacheProvenanceReloadIndex < cacheProvenanceOverrideIndex
    && cacheProvenanceOverrideIndex < postBuildCacheUploadIndex
)) {
    failures.push('post-build must reload the reviewed cache identity before provenance rotation and conditional persistence');
}
if (/s3api (?:get-object|head-object)[\s\S]*?cache\/google-geocoding-cache\.json/u.test(postBuild)) {
    failures.push('post-build must not refetch cache identity after paid geocoding');
}

if (failures.length > 0) {
    console.error(`MLS ingestion scaffold validation failed:\n- ${failures.join('\n- ')}`);
    process.exitCode = 1;
} else {
    console.log('MLS ingestion scaffold security and retention checks passed.');
}

