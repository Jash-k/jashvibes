/**
 * Session-token contract tests.
 *
 * These guard the invariant that locks people out when it drifts: a token is
 * `v1.issued.expiry.hmac` signed over `${realm}:${body}`, and the edge runtime
 * (proxy.js) recomputes the same HMAC by hand because it cannot import
 * lib/signedSession.js. Format, realm separation and expiry rules are therefore
 * contract, not implementation detail.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'jash-theatre:test-password';
const ADMIN_SECRET = 'jash-admin:test-password::';
/** Must match the regex in proxy.js verifyEdgeSession(). */
const TOKEN_SHAPE = /^v1\.\d+\.\d+\.[a-f0-9]{64}$/;

const load = () => import('../lib/signedSession.js');

test('a fresh token has the shape the edge middleware expects', async () => {
  const { issueSession } = await load();
  const token = issueSession(SECRET, 'theatre', 3600);
  assert.match(token, TOKEN_SHAPE);
  const [version, issued, expiry, signature] = token.split('.');
  assert.equal(version, 'v1');
  assert.ok(Number(expiry) > Number(issued), 'expiry must be after issue time');
  assert.equal(signature.length, 64);
});

test('a token verifies only in the realm that minted it', async () => {
  const { issueSession, verifySession } = await load();
  const viewer = issueSession(SECRET, 'theatre', 3600);
  assert.equal(verifySession(viewer, SECRET, 'theatre', 3600), true);
  // Cross-realm replay must fail: this is what keeps a viewer cookie from
  // opening the owner panel (and vice versa).
  assert.equal(verifySession(viewer, SECRET, 'admin', 3600), false);
  assert.equal(verifySession(viewer, ADMIN_SECRET, 'theatre', 3600), false);
});

test('changing the session secret (epoch rotation) invalidates old tokens', async () => {
  const { issueSession, verifySession } = await load();
  const before = issueSession(`${SECRET}:epoch-a`, 'theatre', 3600);
  assert.equal(verifySession(before, `${SECRET}:epoch-a`, 'theatre', 3600), true);
  assert.equal(verifySession(before, `${SECRET}:epoch-b`, 'theatre', 3600), false);
});

test('expired and future-dated tokens are refused', async () => {
  const { issueSession, verifySession } = await load();
  const issuedAt = 1_700_000_000_000;
  const token = issueSession(SECRET, 'theatre', 3600, issuedAt);
  const inWindow = issuedAt + 60_000;
  const afterExpiry = issuedAt + 3600_000 + 10_000;
  assert.equal(verifySession(token, SECRET, 'theatre', 3600, inWindow), true);
  assert.equal(verifySession(token, SECRET, 'theatre', 3600, afterExpiry), false);
});

test('tampering with any part of the token fails verification', async () => {
  const { issueSession, verifySession } = await load();
  const token = issueSession(SECRET, 'theatre', 3600);
  const [version, issued, expiry, signature] = token.split('.');
  const cases = {
    'tampered issued': `v1.${Number(issued) - 100}.${expiry}.${signature}`,
    'tampered expiry': `v1.${issued}.${Number(expiry) + 9999}.${signature}`,
    'flipped signature': `v1.${issued}.${expiry}.${'a'.repeat(64)}`,
    'wrong version': `v2.${issued}.${expiry}.${signature}`,
    'missing part': `v1.${issued}.${expiry}`,
    'not a token': 'nonsense',
    'empty': '',
    'null': null,
  };
  for (const [label, candidate] of Object.entries(cases)) {
    assert.equal(verifySession(candidate, SECRET, 'theatre', 3600), false, `${label} must not verify`);
  }
});

test('an empty secret never issues or verifies anything', async () => {
  const { issueSession, verifySession } = await load();
  assert.equal(issueSession('', 'theatre', 3600), '');
  assert.equal(verifySession(issueSession(SECRET, 'theatre', 3600), '', 'theatre', 3600), false);
});

test('cross-origin mutations are refused, same-origin are allowed', async () => {
  const { rejectCrossOriginMutation } = await load();
  const make = (method, origin, url = 'https://jashvibes.example/api/stremio/pins') => ({
    method,
    url,
    headers: { get: (name) => (name === 'origin' ? origin : name === 'host' ? 'jashvibes.example' : null) },
  });
  assert.equal(rejectCrossOriginMutation(make('PUT', 'https://evil.example')), true);
  assert.equal(rejectCrossOriginMutation(make('PUT', 'https://jashvibes.example')), false);
  // A read is never a CSRF risk, and a non-browser caller has no Origin header
  // (it still needs a signed token, which is checked separately).
  assert.equal(rejectCrossOriginMutation(make('GET', 'https://evil.example')), false);
  assert.equal(rejectCrossOriginMutation(make('PUT', null)), false);
});
