import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MEDIA_ERROR_CODES,
  describeShakaCode,
  isDrmConfigError,
  isTokenRejected,
  mapPlaybackError,
} from '../lib/player/errors.js';

test('Shaka code copy matches the shipped library (the /classics strings did not)', () => {
  assert.equal(describeShakaCode(4012).label, 'RESTRICTIONS_CANNOT_BE_MET');
  assert.equal(describeShakaCode(4012).kind, 'drm');
  assert.equal(describeShakaCode(4012).action, 'drop-drm');
  assert.equal(describeShakaCode(6012).label, 'NO_LICENSE_SERVER_GIVEN');
  assert.equal(describeShakaCode(1001).action, 'rotate-source');
  assert.equal(describeShakaCode(1001).retriable, true);
  assert.equal(describeShakaCode(2012).kind, 'text', 'addTextTrackAsync on a src= element');
  assert.equal(describeShakaCode(4053).message.includes('off air'), true);
});

test('unknown codes fall back to the category, not a blank message', () => {
  const mapped = describeShakaCode(4999);
  assert.equal(mapped.label, 'UNKNOWN');
  assert.equal(mapped.kind, 'manifest');
  assert.equal(mapped.retriable, true);
  const beyond = describeShakaCode(9999);
  assert.equal(beyond.kind, 'player');
  assert.match(beyond.message, /player error 9999/);
});

test('mapPlaybackError normalises every shape the surfaces used to hand-code', () => {
  assert.deepEqual(mapPlaybackError(null), { kind: 'unknown', message: 'Playback failed.', retriable: true, action: 'retry' });
  assert.equal(mapPlaybackError('boom').message, 'boom');
  assert.equal(mapPlaybackError({ code: 1002, category: 1 }).kind, 'network');
  assert.equal(mapPlaybackError({ code: 3015, category: 3 }).action, 'rotate-source');
  assert.equal(mapPlaybackError({ code: 4, message: 'nope' }).label, MEDIA_ERROR_CODES[4].label);
  assert.equal(mapPlaybackError({ code: 4 }).kind, 'codec');
  assert.equal(mapPlaybackError({ code: 4 }).retriable, false);
  assert.equal(mapPlaybackError({ message: 'request timed out' }).kind, 'timeout');
  assert.equal(mapPlaybackError({ message: 'Failed to fetch' }).action, 'rotate-source');
  assert.equal(mapPlaybackError({ message: 'the HEVC codec is not supported' }).action, 'rotate-source');
});

test('autoplay blocks are a user gesture, not a retry loop', () => {
  const mapped = mapPlaybackError({ name: 'NotAllowedError', message: 'play() failed' });
  assert.equal(mapped.kind, 'autoplay');
  assert.equal(mapped.retriable, false);
  assert.equal(mapped.action, 'none');
  assert.match(mapped.message, /muted/);
});

test('expired tokens map to a token refresh, which the chrome can act on', () => {
  const mapped = mapPlaybackError({ message: 'HTTP 401 Unauthorized' });
  assert.equal(mapped.action, 'refresh-token');
  assert.equal(isTokenRejected({ message: 'HTTP 403 Forbidden' }), true);
  assert.equal(isTokenRejected({ message: 'HTTP 451 unavailable' }), true);
  assert.equal(isTokenRejected({ message: 'broken pipe' }), false);
});

test('offline outranks network noise and asks to wait instead of hammering', () => {
  const mapped = mapPlaybackError({ name: 'AbortError', message: 'Aborted' }, { offline: true });
  assert.equal(mapped.kind, 'offline');
  assert.equal(mapped.autoRetry, true);
  assert.equal(mapped.action, 'none');
  assert.equal(mapPlaybackError({ name: 'AbortError' }, { offline: false }).kind, 'aborted');
  assert.equal(mapPlaybackError({ code: 1002, category: 1 }, { offline: true }).kind, 'offline');
});

test('isDrmConfigError keeps the live page’s 6001/category-6 rule', () => {
  assert.equal(isDrmConfigError({ code: 6001, category: 6 }), true);
  assert.equal(isDrmConfigError({ code: 1002, category: 6 }), true);
  assert.equal(isDrmConfigError({ code: 4012, category: 4 }), true);
  assert.equal(isDrmConfigError({ code: 1002, category: 1 }), false);
  assert.equal(isDrmConfigError(null), false);
});
