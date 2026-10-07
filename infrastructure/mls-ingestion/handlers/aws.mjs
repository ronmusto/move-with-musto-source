import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { KMSClient } from '@aws-sdk/client-kms';
import { S3Client } from '@aws-sdk/client-s3';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: {
        removeUndefinedValues: true,
    },
});

export const aws = Object.freeze({
    codeBuild: new CodeBuildClient({}),
    cloudFront: new CloudFrontClient({}),
    dynamo: documentClient,
    kms: new KMSClient({}),
    s3: new S3Client({}),
    secrets: new SecretsManagerClient({}),
    ses: new SESv2Client({}),
    sns: new SNSClient({}),
});

export function requiredEnvironment(name) {
    const value = String(process.env[name] ?? '').trim();
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}
