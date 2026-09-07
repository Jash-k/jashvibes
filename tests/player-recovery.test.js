import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_LADDER,
  LADDER_MAX_MS,
  RUNGS,
  RUNG_LABELS,
  capabilitiesFor,
  nextRecoveryAction,
} from '../lib/player/recovery.js';

const ALL_CAPS = {
  canRetryStreaming: true,
  canReanchor: true,
  canReload: true,
  hasDrm: true,
  hasFallbackSources: true,
  hasPolicyRecovery: true,
  live: true,
  errorKind: 'network',
};

const fresh = (over = {}) => ({ rungIndex: -1, attemptCounts: {}, startedAt: 1000, now: 1000, reloadAttempts: 0, ...over });

test('the ladder runs in order and says so in the user’s language', () => {
  const first = nextRecoveryAction(fresh(), ALL_CAPS, DEFAULT_LADDER);
  assert.equal(first.rung, RUNGS.RETRY_STREAMING);
  assert.equal(first.message, RUNG_LABELS[RUNGS.RETRY_STREAMING]);
  assert.equal(first.delayMs, 250);
  assert.equal(first.positionPreserved, true);

  const second = nextRecoveryAction(fresh({ rungIndex: 0, attemptCounts: { [RUNGS.RETRY_STREAMING]: 1 } }), ALL_CAPS, DEFAULT_LADDER);
  assert.equal(second.rung, RUNGS.REANCHOR);

  const third = nextRecoveryAction(fresh({ rungIndex: 1, attemptCounts: { [RUNGS.RETRY_STREAMING]: 2, [RUNGS.REANCHOR]: 1 } }), ALL_CAPS, DEFAULT_LADDER);
  assert.equal(third.rung, RUNGS.RELOAD);
  assert.equal(third.positionPreserved, false, 'a reload must not try to preserve a position it cannot reach');
});

test('per-rung budgets are enforced, then the rung is skipped not repeated', () => {
  const spent = nextRecoveryAction(
    fresh({ rungIndex: 0, attemptCounts: { [RUNGS.RETRY_STREAMING]: 2 } }),
    ALL_CAPS,
    DEFAULT_LADDER,
  );
  assert.equal(spent.rung, RUNGS.REANCHOR, 'retryStreaming is capped at 2 attempts');
});

test('reload backs off 1s → 2s → 4s', () => {
  const base = { rungIndex: 1, attemptCounts: { [RUNGS.RETRY_STREAMING]: 2, [RUNGS.REANCHOR]: 2 } };
  const delays = [0, 1, 2].map((reloadAttempts) =>
    nextRecoveryAction(fresh({ ...base, reloadAttempts }), ALL_CAPS, DEFAULT_LADDER).delayMs,
  );
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test('capabilities decide which rungs exist at all', () => {
  const noEngine = { ...ALL_CAPS, canRetryStreaming: false, live: false, canReanchor: false, hasDrm: false, hasFallbackSources: false, hasPolicyRecovery: false };
  const only = nextRecoveryAction(fresh(), noEngine, DEFAULT_LADDER);
  assert.equal(only.rung, RUNGS.RELOAD, 'plain native playback can only reload');

  const nothing = nextRecoveryAction(fresh(), { ...noEngine, canReload: false }, DEFAULT_LADDER);
  assert.equal(nothing, null, 'no rung applies → give up honestly');
});

test('a cancelled load is never fought, and offline waits instead of burning retries', () => {
  assert.equal(nextRecoveryAction(fresh(), { ...ALL_CAPS, aborted: true }, DEFAULT_LADDER), null);
  const held = nextRecoveryAction(fresh(), { ...ALL_CAPS, offline: true }, DEFAULT_LADDER);
  assert.equal(held.hold, true);
  assert.equal(held.rung, RUNGS.RELOAD);
  assert.match(held.message, /Offline/);
});

test('the whole episode is budgeted, so a dead source cannot retry forever', () => {
  assert.equal(LADDER_MAX_MS, 12_000);
  assert.equal(nextRecoveryAction(fresh({ startedAt: 0, now: 0 }), ALL_CAPS, DEFAULT_LADDER) !== null, true);
  assert.equal(nextRecoveryAction(fresh({ startedAt: 1000, now: 1000 + LADDER_MAX_MS + 1 }), ALL_CAPS, DEFAULT_LADDER), null);
});

test('transient network errors get one extra soft rotate before giving up', () => {
  const exhausted = {
    [RUNGS.RETRY_STREAMING]: 2,
    [RUNGS.REANCHOR]: 2,
    [RUNGS.RELOAD]: 2,
    [RUNGS.DROP_DRM]: 1,
    [RUNGS.ROTATE_SOURCE]: 3,
    [RUNGS.POLICY_RECOVER]: 2,
  };
  const soft = nextRecoveryAction(fresh({ rungIndex: 5, attemptCounts: exhausted, now: 1000 + 2000 }), ALL_CAPS, DEFAULT_LADDER);
  assert.equal(soft.rung, RUNGS.ROTATE_SOURCE);
  assert.equal(soft.soft, true);
  assert.equal(soft.delayMs, 1500);

  const too = nextRecoveryAction(
    fresh({ rungIndex: 5, attemptCounts: { ...exhausted, [RUNGS.ROTATE_SOURCE]: 4 }, now: 1000 + 2000 }),
    { ...ALL_CAPS, hasFallbackSources: false, canReanchor: false },
    DEFAULT_LADDER,
  );
  assert.equal(too, null);
});

test('the ladder can be shortened per source (live TV must not stall on DRM)', () => {
  const liveLadder = [RUNGS.RETRY_STREAMING, RUNGS.RELOAD, RUNGS.ROTATE_SOURCE, RUNGS.POLICY_RECOVER];
  const step = nextRecoveryAction(fresh({ rungIndex: 0, attemptCounts: { [RUNGS.RETRY_STREAMING]: 2 } }), ALL_CAPS, liveLadder);
  assert.equal(step.rung, RUNGS.RELOAD);
});

test('capabilitiesFor derives availability from what is actually in front of us', () => {
  const caps = capabilitiesFor({
    engine: { retryStreaming() {} },
    url: 'https://cdn/x.m3u8',
    hasDrm: false,
    fallbackUrls: ['https://cdn/x.m3u8'],
    policy: null,
    live: true,
    model: { canSeek: false },
    error: { kind: 'network' },
  });
  assert.equal(caps.canRetryStreaming, true);
  assert.equal(caps.canReanchor, true, 'live-only is enough to re-anchor');
  assert.equal(caps.hasDrm, false);
  assert.equal(caps.hasPolicyRecovery, false);
  assert.equal(caps.errorKind, 'network');
  assert.equal(caps.aborted, false);

  const offline = capabilitiesFor({ engine: null, url: '', hasDrm: false, fallbackUrls: [], policy: { recover() {} }, live: false, model: null, error: { kind: 'offline' } });
  assert.equal(offline.offline, true);
  assert.equal(offline.canRetryStreaming, false);
  assert.equal(offline.canReload, false, 'no URL → nothing to reload');
  assert.equal(offline.hasPolicyRecovery, true);
});

test('every rung has copy, and the default ladder contains only real rungs', () => {
  for (const rung of DEFAULT_LADDER) {
    assert.ok(Object.values(RUNGS).includes(rung), `${rung} is a declared rung`);
    assert.ok(RUNG_LABELS[rung]?.length > 8, `${rung} needs user-facing copy`);
    assert.notEqual(rung, RUNGS.GIVE_UP, 'giving up is not something to retry');
  }
});
