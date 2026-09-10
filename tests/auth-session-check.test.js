/*
 * tests/auth-session-check.test.js — reloading the app must not cost you the app.
 *
 * The unlock screen verifies the saved session on every load. It used to do that with a POST to the same endpoint
 * the password brute-force limiter guards (12 per 5 minutes), so a handful of reloads on a phone could lock the
 * owner out of their own single-tenant app. The check is a cookie-only GET now, and the limiter counts POSTs.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const route = read('app/api/auth/route.js');
const middleware = read('middleware.js');
const gate = read('components/AuthGate.js');

test('GET /api/auth answers only about the cookie', () => {
  assert.match(route, /export async function GET\(request\)/);
  const body = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(body, /request\.cookies\.get\(SESSION_COOKIE\)/);
  assert.match(body, /isValidAccessToken\(token\)/);
  assert.ok(!/getConfiguredPassword|getTvPanelPassword|safeEqual|body\(\)/.test(body),
    'it takes no password and reads no body, so there is nothing to brute force through it');
  assert.match(body, /status: 401/, 'and it says no with a real status code');
});

test('the brute-force budget is spent on password attempts, not on page loads', () => {
  const rule = middleware.match(/prefix: '\/api\/auth'[^\n]*/)[0];
  assert.match(rule, /limit: 12/);
  assert.match(rule, /methods: \['POST'\]/);
  assert.match(middleware, /if \(rule\.methods && !rule\.methods\.includes\(request\.method\)\) continue;/,
    'the skip has to happen before the bucket is charged');
});

test('the unlock screen asks the cheap question first and falls back', () => {
  assert.match(gate, /fetch\('\/api\/auth', \{ method: 'GET', cache: 'no-store' \}\)/);
  assert.match(gate, /body: JSON\.stringify\(\{ token: savedToken \}\)/, 'the token POST is still the fallback');
  assert.match(gate, /if \(data\.token\) window\.localStorage\.setItem\(STORAGE_KEY, data\.token\)/,
    'a GET that returns no new token must not blank the stored one');
});
