/*
 * tests/auth-token-rotation.test.js — one env var must be able to revoke
 * every session, and no undocumented password may unlock the app.
 *
 * v8.15 shipped two foot-guns this file pins shut:
 *   1. the access token was a bare hash of a fixed prefix + password, so the
 *      only way to log a leaked cookie (or a `?token=` link) out of the app
 *      was to change the password everywhere;
 *   2. the Live TV panel password silently defaulted to 'tv2010' — a value
 *      printed in the README — and a panel login issued the *full* session
 *      token.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccessToken, isValidAccessToken } from '../lib/serverAuth.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const routeSource = read('app/api/auth/route.js');
const middlewareSource = read('middleware.js');
const serverAuthSource = read('lib/serverAuth.js');

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

function withEnv(overrides, run) {
  const keys = ['PASS', 'SESSION_EPOCH', 'SESSION_SECRET', 'SESSION_TTL_DAYS', 'LIVE_TV_PASS', 'TV_PASS'];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, overrides);
  try {
    return run();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('without an epoch the token stays backwards compatible', () => {
  withEnv({ PASS: 'correct horse' }, () => {
    assert.equal(createAccessToken('correct horse'), sha256('jash-theatre:correct horse'));
    assert.equal(isValidAccessToken(sha256('jash-theatre:correct horse')), true);
  });
});

test('setting SESSION_EPOCH revokes every previously issued token at once', () => {
  const oldToken = withEnv({ PASS: 'correct horse' }, () => createAccessToken('correct horse'));

  withEnv({ PASS: 'correct horse', SESSION_EPOCH: '2026-09' }, () => {
    const newToken = createAccessToken('correct horse');
    assert.notEqual(newToken, oldToken, 'the epoch must change the issued token');
    assert.equal(isValidAccessToken(oldToken), false, 'the old cookie is dead');
    assert.equal(isValidAccessToken(newToken), true, 'and the new one unlocks');
  });
});

test('the middleware derives the same token from the same seed', () => {
  // The middleware is edge-runtime and cannot import lib/serverAuth.js, so
  // the two formulas drift by hand. This pins the drift shut: the middleware
  // source must contain the identical seed construction.
  const seedPattern = /String\(process\.env\.SESSION_EPOCH \|\| process\.env\.SESSION_SECRET \|\| ''\)\.trim\(\)/;
  assert.match(serverAuthSource, seedPattern, 'lib/serverAuth.js builds the epoch seed');
  assert.match(middlewareSource, seedPattern, 'middleware.js builds the same epoch seed');
  assert.match(middlewareSource, /sha256Hex\(sessionSeed\(password\)\)/, 'and hashes the seed, not the bare password');
  const epochLine = (src) => src.match(/const epoch = .*;/)[0];
  assert.equal(epochLine(serverAuthSource), epochLine(middlewareSource), 'the seed lines are character-identical');
});

test('the Live TV panel password has no default', () => {
  assert.ok(!/\|\|\s*'tv2010'/.test(routeSource), "the documented 'tv2010' fallback is gone from the code");
  assert.match(routeSource, /process\.env\.LIVE_TV_PASS \|\| process\.env\.TV_PASS \|\| ''/,
    'an unset env var means no panel password');
  assert.match(routeSource, /Boolean\(tvPanelPassword\) && safeEqual\(password, tvPanelPassword\)/,
    'the panel path only compares against a configured password');
});

test('the panel password is documented as opt-in, not defaulted', () => {
  const example = read('.env.example');
  assert.ok(!/^LIVE_TV_PASS=.+/m.test(example), '.env.example ships no filled-in panel password');
  assert.match(example, /NO default/, 'and says why');
});
