import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
    RUNS_TABLE_NAME: 'test-runs',
    RAW_BUCKET_NAME: 'test-raw',
    COORDINATE_CACHE_BUCKET_NAME: 'test-coordinates',
    DELIVERY_BUCKET_NAME: 'test-delivery',
    DELIVERY_DISTRIBUTION_ID: 'TESTDIST',
    ALERTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:123456789012:test-alerts',
    FRESHNESS_HOURS: '60',
});

const [{ inspectFreshness }, { aws }] = await Promise.all([
    import('../handlers/maintenance.mjs'),
    import('../handlers/aws.mjs'),
]);

const NOW = Date.parse('2026-07-29T04:33:12.198Z');
const GENERATION_ONE = '20260726165338-f0d10b14-c50e-424c-9d8e-d046ebf7c4a8';
const GENERATION_TWO = '20260726165339-a0d10b14-c50e-424c-9d8e-d046ebf7c4a8';

function activePublication(ageHours, generation = GENERATION_ONE) {
    const generatedAt = new Date(NOW - (ageHours * 60 * 60 * 1000)).toISOString();
    return {
        pointer: {
            schemaVersion: 1,
            generation,
            generatedAt,
            manifestFile: 'mls-search-manifest.json',
        },
        manifest: {
            document: {
                schemaVersion: 1,
                generatedAt,
                coordinateIndex: {
                    file: 'mls-coordinate-index.json',
                    coordinateCount: 1,
                },
            },
        },
    };
}

test('freshness reminder sends once per generation at 60 hours and retries after delivery failure', async (t) => {
    const originalDynamoSend = aws.dynamo.send;
    const originalSnsSend = aws.sns.send;
    t.after(() => {
        aws.dynamo.send = originalDynamoSend;
        aws.sns.send = originalSnsSend;
    });

    let dynamoCommands = [];
    let snsCommands = [];
    aws.dynamo.send = async (command) => {
        dynamoCommands.push(command);
        return {};
    };
    aws.sns.send = async (command) => {
        snsCommands.push(command);
        return { MessageId: 'test-message' };
    };

    const early = await inspectFreshness(NOW, activePublication(59.99));
    assert.equal(early.stale, false);
    assert.equal(early.notified, false);
    assert.equal(dynamoCommands.length, 0);
    assert.equal(snsCommands.length, 0);

    const due = await inspectFreshness(NOW, activePublication(60));
    assert.equal(due.stale, true);
    assert.equal(due.notified, true);
    assert.deepEqual(dynamoCommands.map((command) => command.constructor.name), ['GetCommand', 'GetCommand', 'UpdateCommand']);
    assert.equal(dynamoCommands[2].input.Key.runId, `freshness-reminder#${GENERATION_ONE}`);
    assert.match(dynamoCommands[2].input.UpdateExpression, /freshnessReminderSentAt/u);
    assert.equal(dynamoCommands[2].input.ExpressionAttributeValues[':recordType'], 'FRESHNESS_REMINDER');
    assert.equal(dynamoCommands[2].input.ExpressionAttributeValues[':generation'], GENERATION_ONE);
    assert.equal(snsCommands.length, 1);
    assert.equal(snsCommands[0].input.Subject, 'Move With Musto MLS data expires in about 12 hours');
    assert.match(snsCommands[0].input.Message, /2026-07-29T16:33:12\.198Z/u);

    dynamoCommands = [];
    snsCommands = [];
    aws.dynamo.send = async (command) => {
        dynamoCommands.push(command);
        return { Item: { freshnessReminderSentAt: '2026-07-29T04:33:12.198Z' } };
    };
    const repeated = await inspectFreshness(NOW + 60_000, activePublication(60 + (1 / 60)));
    assert.equal(repeated.notified, false);
    assert.deepEqual(dynamoCommands.map((command) => command.constructor.name), ['GetCommand']);
    assert.equal(snsCommands.length, 0);

    dynamoCommands = [];
    let legacyReadCount = 0;
    aws.dynamo.send = async (command) => {
        dynamoCommands.push(command);
        if (command.constructor.name === 'GetCommand' && ++legacyReadCount === 2) {
            return { Item: { freshnessReminderSentAt: '2026-07-29T04:33:12.198Z' } };
        }
        return {};
    };
    const legacyRepeated = await inspectFreshness(NOW + 60_000, activePublication(60 + (1 / 60)));
    assert.equal(legacyRepeated.notified, false);
    assert.deepEqual(dynamoCommands.map((command) => command.constructor.name), ['GetCommand', 'GetCommand']);
    assert.equal(dynamoCommands[0].input.Key.runId, `freshness-reminder#${GENERATION_ONE}`);
    assert.equal(dynamoCommands[1].input.Key.runId, GENERATION_ONE);
    assert.equal(snsCommands.length, 0);

    dynamoCommands = [];
    aws.dynamo.send = async (command) => {
        dynamoCommands.push(command);
        return {};
    };
    const nextGeneration = await inspectFreshness(NOW, activePublication(60, GENERATION_TWO));
    assert.equal(nextGeneration.notified, true);
    assert.equal(dynamoCommands[2].input.Key.runId, `freshness-reminder#${GENERATION_TWO}`);

    let updateAttempted = false;
    aws.dynamo.send = async (command) => {
        if (command.constructor.name === 'UpdateCommand') updateAttempted = true;
        return {};
    };
    aws.sns.send = async () => {
        throw new Error('simulated SNS failure');
    };
    await assert.rejects(
        inspectFreshness(NOW, activePublication(60, GENERATION_TWO)),
        /simulated SNS failure/u,
    );
    assert.equal(updateAttempted, false);
});

test('15-minute checks suppress missing-publication spam while daily maintenance may alert', async () => {
    const originalSnsSend = aws.sns.send;
    const snsCommands = [];
    aws.sns.send = async (command) => {
        snsCommands.push(command);
        return { MessageId: 'test-message' };
    };
    try {
        const frequent = await inspectFreshness(NOW, { pointer: null, manifest: null });
        assert.equal(frequent.notified, false);
        assert.equal(snsCommands.length, 0);

        const daily = await inspectFreshness(
            NOW,
            { pointer: null, manifest: null },
            { notifyMissing: true },
        );
        assert.equal(daily.notified, true);
        assert.equal(snsCommands.length, 1);
    } finally {
        aws.sns.send = originalSnsSend;
    }
});
