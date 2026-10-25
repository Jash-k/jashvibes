#!/usr/bin/env node
/**
 * test-unlock-decision.mjs — front-door password realm classification.
 *
 * The unlock screen accepts two independent passwords: PASS opens the
 * theatre, ADMIN_PASS opens the theatre AND the owner realm (so /live can
 * show the quick-hide button without a separate /admin login). Pure
 * contracts, no database or cookies here — the route owns issuance.
 */
import assert from 'node:assert/strict';
import { classifyUnlock } from '@/lib/unlockDecision';

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('  PASS', label); };

console.log('1. front-door unlock realm classification');

check('the normal pass unlocks the theatre only — never the admin realm', () => {
  const d = classifyUnlock('viewer-pass', { pass: 'viewer-pass', adminPass: 'owner-pass' });
  assert.deepEqual(d, { ok: true, theatre: true, admin: false });
});

check('the admin pass unlocks BOTH realms in one step', () => {
  const d = classifyUnlock('owner-pass', { pass: 'viewer-pass', adminPass: 'owner-pass' });
  assert.deepEqual(d, { ok: true, theatre: false, admin: true });
  assert.equal(d.ok, true);
});

check('a wrong password opens neither realm', () => {
  const d = classifyUnlock('nope', { pass: 'viewer-pass', adminPass: 'owner-pass' });
  assert.deepEqual(d, { ok: false, theatre: false, admin: false });
});

check('empty input never unlocks, even against an empty config', () => {
  assert.equal(classifyUnlock('', {}).ok, false);
  assert.equal(classifyUnlock('', { pass: '', adminPass: '' }).ok, false);
});

check('when both env passwords happen to match, the single password grants both', () => {
  const d = classifyUnlock('same', { pass: 'same', adminPass: 'same' });
  assert.deepEqual(d, { ok: true, theatre: true, admin: true });
});

check('a custom comparator (constant-time in the route) is honored', () => {
  const calls = [];
  const compare = (a, b) => { calls.push([a, b]); return a === b; };
  const d = classifyUnlock('x', { pass: 'x', adminPass: 'y', compare });
  assert.equal(d.theatre, true);
  assert.equal(d.admin, false);
  assert.ok(calls.length >= 2, 'comparator must be used for both realms');
});

check('non-string input is coerced safely rather than throwing', () => {
  assert.equal(classifyUnlock(undefined, { pass: 'x' }).ok, false);
  assert.equal(classifyUnlock(null, { adminPass: 'x' }).ok, false);
});

console.log(`\n${passed} passed, 0 failed — unlock decision contracts OK.`);
