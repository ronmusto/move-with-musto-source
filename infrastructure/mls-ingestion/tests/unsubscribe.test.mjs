import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnsubscribeHandler } from '../handlers/unsubscribe.mjs';

process.env.CONTACT_ORIGIN_TOKEN = 'test-origin-token';

function eventFor(payload, overrides = {}) {
    return {
        body: JSON.stringify(payload),
        headers: {
            origin: 'https://movewithmusto.com',
            'content-type': 'application/json',
            'cloudfront-viewer-address': '203.0.113.4:53100',
            'x-move-with-musto-origin': 'test-origin-token',
        },
        requestContext: {
            requestId: 'request-456',
            http: { method: 'POST', sourceIp: '198.51.100.99' },
        },
        ...overrides,
    };
}

test('normalizes the address, records suppression, and logs no PII', async () => {
    const writes = [];
    const logs = [];
    const originalInfo = console.info;
    console.info = (message) => logs.push(String(message));
    try {
        const handler = createUnsubscribeHandler({
            consumeLimit: async ({ ipAddress }) => ipAddress === '203.0.113.4',
            writeSuppression: async (email) => writes.push(email),
        });
        const result = await handler(eventFor({ email: ' Visitor@Example.com ' }));

        assert.equal(result.statusCode, 202);
        assert.deepEqual(JSON.parse(result.body), { ok: true, code: 'accepted' });
        assert.deepEqual(writes, ['visitor@example.com']);
        assert.equal(logs.length, 1);
        assert.doesNotMatch(logs[0], /visitor|example\.com/iu);
    } finally {
        console.info = originalInfo;
    }
});

test('source port changes do not evade unsubscribe IP limits', async (t) => {
    const seen = [];
    t.mock.method(console, 'info', () => {});
    const handler = createUnsubscribeHandler({
        consumeLimit: async ({ ipAddress }) => { seen.push(ipAddress); return true; },
        writeSuppression: async () => {},
    });
    for (const value of ['[2001:db8::7]:4430', '2001:db8::7:4430', '2001:db8::7:4431', '2001:db8::7:53100']) {
        const event = eventFor({ email: 'visitor@example.com' });
        event.headers['cloudfront-viewer-address'] = value;
        assert.equal((await handler(event)).statusCode, 202);
    }
    assert.deepEqual(seen, Array(4).fill('2001:db8::7'));
});

test('invalid viewer addresses cannot fall back to spoofed forwarded IP', async () => {
    let calls = 0;
    const handler = createUnsubscribeHandler({
        consumeLimit: async () => { calls += 1; return true; },
        writeSuppression: async () => { calls += 1; },
    });
    for (const value of ['garbage', '[2001:db8::7]:65536', '203.0.113.4:0']) {
        const event = eventFor({ email: 'visitor@example.com' });
        event.headers['cloudfront-viewer-address'] = value;
        event.headers['x-forwarded-for'] = '203.0.113.1';
        assert.equal((await handler(event)).statusCode, 403);
    }
    assert.equal(calls, 0);
});

test('rejects invalid addresses without writing to the DNC list', async () => {
    let writes = 0;
    const handler = createUnsubscribeHandler({
        consumeLimit: async () => true,
        writeSuppression: async () => { writes += 1; },
    });

    assert.equal((await handler(eventFor({ email: 'not-an-email' }))).statusCode, 400);
    assert.equal((await handler(eventFor({}))).statusCode, 400);
    assert.equal(writes, 0);
});

test('fails closed for direct requests, unapproved origins, and missing viewer addresses', async () => {
    const handler = createUnsubscribeHandler({
        consumeLimit: async () => true,
        writeSuppression: async () => {},
    });

    const direct = await handler(eventFor({ email: 'visitor@example.com' }, {
        headers: {
            origin: 'https://movewithmusto.com',
            'content-type': 'application/json',
            'cloudfront-viewer-address': '203.0.113.4:53100',
        },
    }));
    assert.equal(direct.statusCode, 403);

    const unapproved = await handler(eventFor({ email: 'visitor@example.com' }, {
        headers: {
            origin: 'https://attacker.example',
            'content-type': 'application/json',
            'cloudfront-viewer-address': '203.0.113.4:53100',
            'x-move-with-musto-origin': 'test-origin-token',
        },
    }));
    assert.equal(unapproved.statusCode, 403);

    const noViewer = await handler(eventFor({ email: 'visitor@example.com' }, {
        headers: {
            origin: 'https://movewithmusto.com',
            'content-type': 'application/json',
            'x-move-with-musto-origin': 'test-origin-token',
        },
    }));
    assert.equal(noViewer.statusCode, 403);
});

test('rate limits before recording a suppression', async () => {
    let writes = 0;
    const handler = createUnsubscribeHandler({
        consumeLimit: async () => false,
        writeSuppression: async () => { writes += 1; },
    });
    const result = await handler(eventFor({ email: 'visitor@example.com' }));

    assert.equal(result.statusCode, 429);
    assert.equal(writes, 0);
});
