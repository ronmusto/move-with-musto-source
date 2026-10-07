import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContactEmail, parseContactPayload } from '../handlers/contact-domain.mjs';
import { createContactHandler } from '../handlers/contact.mjs';

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
            requestId: 'request-123',
            http: { method: 'POST', sourceIp: '203.0.113.4' },
        },
        ...overrides,
    };
}

process.env.CONTACT_ORIGIN_TOKEN = 'test-origin-token';

const basePayload = Object.freeze({
    name: 'Jamie Visitor',
    email: 'Jamie@Example.com',
    message: 'I would like to talk about a move.',
    source: 'move-with-musto-contact-inquiry',
    termsAccepted: true,
    privacyAccepted: true,
    termsVersion: '2026-07-13',
    privacyVersion: '2026-07-13',
    website: '',
});

test('normalizes an inquiry and builds a fixed-purpose plaintext notification', () => {
    const inquiry = parseContactPayload(basePayload);
    const email = buildContactEmail(inquiry);

    assert.equal(inquiry.email, 'jamie@example.com');
    assert.match(email.subject, /^\[Move With Musto website\]/u);
    assert.match(email.body, /Jamie Visitor/u);
    assert.match(email.body, /No marketing subscription was created/u);
    assert.doesNotMatch(email.body, /undefined|\[object Object\]/u);
});

test('requires explicit versioned terms and privacy consent', () => {
    assert.throws(() => parseContactPayload({ ...basePayload, termsVersion: '' }), /termsVersion is required/u);
    assert.throws(() => parseContactPayload({ ...basePayload, privacyAccepted: false }), /consent are required/u);
});

test('preserves selected-home order and refuses more than twenty attachments', () => {
    const attachments = [
        { listingNumber: '2', title: '2 Main St', town: 'Burlington', status: 'Active', priceLabel: '$800,000', detailUrl: 'https://movewithmusto.com/buy/properties/?listing=2' },
        { listingNumber: '1', title: '1 Main St', town: 'Woburn', status: 'Active', priceLabel: '$700,000', detailUrl: 'https://movewithmusto.com/buy/properties/?listing=1' },
    ];
    const inquiry = parseContactPayload({
        ...basePayload,
        source: undefined,
        schemaVersion: 'move-with-musto.search-consult-lead.v1',
        requestType: 'send_selected_homes',
        attachedListings: attachments,
    });
    const body = buildContactEmail(inquiry).body;

    assert.ok(body.indexOf('2 Main St') < body.indexOf('1 Main St'));
    assert.throws(() => parseContactPayload({
        ...basePayload,
        source: undefined,
        schemaVersion: 'move-with-musto.search-consult-lead.v1',
        requestType: 'send_selected_homes',
        attachedListings: Array.from({ length: 21 }, (_, index) => ({
            listingNumber: String(index),
            title: `${index} Main St`,
            detailUrl: `/buy/properties/?listing=${index}`,
        })),
    }), /No more than 20 homes/u);
});

test('rejects arbitrary auto-linked hosts while allowing site detail URLs and plain addresses', () => {
    assert.throws(() => parseContactPayload({
        ...basePayload,
        propertyLink: 'https://attacker.example/phish',
    }), /Move With Musto website/u);
    assert.throws(() => parseContactPayload({
        ...basePayload,
        propertyLink: 'mailto:attacker@example.com',
    }), /Move With Musto website/u);

    const inquiry = parseContactPayload({
        ...basePayload,
        propertyLink: '22 Main Street, Burlington',
        sourcePage: '/buy/properties/',
    });
    assert.equal(inquiry.propertyLink, '22 Main Street, Burlington');
    assert.equal(inquiry.sourcePage, '/buy/properties/');
});

test('accepts a valid public inquiry without logging visitor PII', async () => {
    const deliveries = [];
    const logs = [];
    const originalInfo = console.info;
    console.info = (message) => logs.push(String(message));
    try {
        let rateLimitedIp = '';
        const handler = createContactHandler({
            consumeLimit: async ({ ipAddress }) => { rateLimitedIp = ipAddress; return true; },
            verifyChallenge: async () => true,
            sendEmail: async (inquiry) => deliveries.push(inquiry),
        });
        const result = await handler(eventFor(basePayload));

        assert.equal(result.statusCode, 202);
        assert.equal(deliveries.length, 1);
        assert.equal(rateLimitedIp, '203.0.113.4');
        assert.equal(deliveries[0].email, 'jamie@example.com');
        assert.equal(logs.length, 1);
        assert.doesNotMatch(logs[0], /Jamie|example\.com|talk about a move/iu);
    } finally {
        console.info = originalInfo;
    }
});

test('accepts CloudFront viewer addresses for IPv4 and IPv6 without trusting API Gateway sourceIp', async () => {
    const seen = [];
    const handler = createContactHandler({
        consumeLimit: async ({ ipAddress }) => { seen.push(ipAddress); return true; },
        verifyChallenge: async () => true,
        sendEmail: async () => {},
    });
    const originalInfo = console.info;
    console.info = () => {};
    try {
        for (const viewerAddress of [
            '203.0.113.4:53100',
            '[2001:db8::7]:53100',
            '2001:db8::7:53100',
            '2001:db8::7:4430',
            '2001:db8::7:4431',
        ]) {
            const result = await handler(eventFor(basePayload, {
                headers: {
                    origin: 'https://movewithmusto.com',
                    'content-type': 'application/json',
                    'cloudfront-viewer-address': viewerAddress,
                    'x-move-with-musto-origin': 'test-origin-token',
                },
                requestContext: {
                    requestId: 'request-ip-test',
                    http: { method: 'POST', sourceIp: '198.51.100.99' },
                },
            }));
            assert.equal(result.statusCode, 202);
        }
    } finally {
        console.info = originalInfo;
    }

    assert.deepEqual(seen, ['203.0.113.4', ...Array(4).fill('2001:db8::7')]);
});

test('refuses malformed viewer addresses before rate checks or delivery', async () => {
    let calls = 0;
    const handler = createContactHandler({
        consumeLimit: async () => { calls += 1; return true; },
        sendEmail: async () => { calls += 1; },
    });
    for (const value of ['', 'garbage', '203.0.113.4:65536', '[2001:db8::7]:65536', '2001:db8::7:0']) {
        const event = eventFor(basePayload);
        event.headers['cloudfront-viewer-address'] = value;
        event.headers['x-forwarded-for'] = '203.0.113.1';
        assert.equal((await handler(event)).statusCode, 403);
    }
    assert.equal(calls, 0);
});

test('fails closed on unapproved origins, rate limits, and challenge failure', async () => {
    let sends = 0;
    const sendEmail = async () => { sends += 1; };
    const unapproved = createContactHandler({
        consumeLimit: async () => true,
        verifyChallenge: async () => true,
        sendEmail,
    });
    const unapprovedResult = await unapproved(eventFor(basePayload, {
        headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
    }));
    assert.equal(unapprovedResult.statusCode, 403);

    const directResult = await unapproved(eventFor(basePayload, {
        headers: {
            origin: 'https://movewithmusto.com',
            'content-type': 'application/json',
            'cloudfront-viewer-address': '203.0.113.4:53100',
        },
    }));
    assert.equal(directResult.statusCode, 403);

    const limited = createContactHandler({
        consumeLimit: async () => false,
        verifyChallenge: async () => true,
        sendEmail,
    });
    assert.equal((await limited(eventFor(basePayload))).statusCode, 429);

    const challenged = createContactHandler({
        consumeLimit: async () => true,
        verifyChallenge: async () => false,
        sendEmail,
    });
    assert.equal((await challenged(eventFor(basePayload))).statusCode, 403);
    assert.equal(sends, 0);
});

test('honeypot submissions receive the same accepted response without delivery', async () => {
    let rateChecks = 0;
    let sends = 0;
    const handler = createContactHandler({
        consumeLimit: async () => { rateChecks += 1; return true; },
        verifyChallenge: async () => true,
        sendEmail: async () => { sends += 1; },
    });
    const originalInfo = console.info;
    console.info = () => {};
    try {
        const result = await handler(eventFor({ ...basePayload, website: 'spam.example' }));
        assert.equal(result.statusCode, 202);
        assert.equal(rateChecks, 0);
        assert.equal(sends, 0);
    } finally {
        console.info = originalInfo;
    }
});
