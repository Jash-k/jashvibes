import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINISHED_RATIO,
  NEVER_RESUME_KEY,
  PERSIST_INTERVAL_MS,
  RESUME_END_MARGIN_SECONDS,
  RESUME_MIN_SECONDS,
  clearResumeSuppression,
  createProgressWriter,
  isResumeSuppressed,
  planResume,
  readNeverResume,
  resumeToastValue,
  suppressResume,
} from '../lib/player/resume.js';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    dump: () => data,
  };
}

test('nothing to resume when the store has no usable position', () => {
  assert.deepEqual(planResume({}, null), { seek: false, target: 0, reason: 'no-saved-position' });
  assert.equal(planResume({ progress: 0 }, null).reason, 'no-saved-position');
  assert.equal(planResume({ progress: NaN }, { start: 0, end: 100 }).seek, false);
});

test('a few seconds in is noise, and a finished title replays from the top', () => {
  assert.equal(planResume({ progress: 12, duration: 3000 }, null).reason, 'too-early');
  assert.equal(planResume({ progress: 20, duration: 3000 }, null).seek, true, 'the 20 s floor is inclusive');
  assert.equal(planResume({ progress: 2850, duration: 3000 }, null).reason, 'finished');
  assert.equal(FINISHED_RATIO, 0.95);
  assert.equal(RESUME_MIN_SECONDS, 20);
});

test('resuming into the last few seconds gets refused', () => {
  assert.equal(planResume({ progress: 187, duration: 200 }, null).reason, 'too-late');
  assert.equal(RESUME_END_MARGIN_SECONDS, 15);
});

test('the target is expressed inside the current seek window and never past its end', () => {
  // DVR windows start at a wall-clock-ish offset, not 0.
  const plan = planResume({ progress: 120 }, { start: 5000, end: 6000 });
  assert.equal(plan.seek, true);
  assert.equal(plan.target, 5120);

  const clipped = planResume({ progress: 100 }, { start: 0, end: 20 }, { forceSeek: true });
  assert.equal(clipped.target, 19.75);
});

test('an explicit "Resume" press ignores the politeness thresholds', () => {
  const plan = planResume({ progress: 5, duration: 200 }, { start: 0, end: 200 }, { forceSeek: true });
  assert.deepEqual(plan, { seek: true, target: 5, reason: 'user' });
});

test('duration falls back to the saved value when the element has no window', () => {
  assert.equal(planResume({ progress: 600, duration: 1000 }, null).seek, true);
  assert.equal(planResume({ progress: 600, duration: 400 }, null).reason, 'finished');
});

test('the toast only ever claims a position that exists', () => {
  assert.equal(resumeToastValue({ progress: 40 }, 100), 40);
  assert.equal(resumeToastValue({ progress: 100 }, 100), 99, 'never promises the final frame');
  assert.equal(resumeToastValue({ progress: 0 }, 100), 0);
  assert.equal(resumeToastValue({ progress: 500 }), 500);
});

test('progress writes are throttled to one per interval, and flush() is immediate', () => {
  let clock = 0;
  const written = [];
  const writer = createProgressWriter({
    onChange: (payload) => written.push(payload),
    intervalMs: PERSIST_INTERVAL_MS,
    now: () => clock,
  });
  const el = { currentTime: 0, duration: 0 };

  assert.equal(writer.tick(el), false, 'nothing recorded at 0 s');
  el.currentTime = 12;
  el.duration = 100.6;
  clock = 1000;
  assert.equal(writer.tick(el), false, 'still inside the 5 s window');
  clock = 6000;
  assert.equal(writer.tick(el), true);
  assert.deepEqual(written, [{ progress: 12, duration: 101 }], 'rounded seconds, one write');
  clock = 6500;
  assert.equal(writer.tick(el), false, 'second tick inside the window is skipped');
  assert.equal(writer.flush(el), true, 'pause/pagehide flushes immediately');
  assert.deepEqual(written.at(-1), { progress: 12, duration: 101 });
  assert.equal(PERSIST_INTERVAL_MS, 5000);
});

test('flush without an element writes the last seen state', () => {
  let clock = 0;
  const written = [];
  const writer = createProgressWriter({ onChange: (payload) => written.push(payload), now: () => clock });
  clock = 1_000; // inside the interval: tick records state but must not write
  writer.tick({ currentTime: 42, duration: 300 });
  assert.deepEqual(written, []);
  writer.flush();
  assert.deepEqual(written, [{ progress: 42, duration: 300 }]);
});

// ---------------------------------------------------------------------------
// Per-title "Never for this title" (chrome toast -> engine -> localStorage)
// ---------------------------------------------------------------------------

test('the per-title opt-out round-trips and is keyed per watchKey', () => {
  const store = memoryStore();
  assert.equal(isResumeSuppressed('movie:603', store), false, 'nothing suppressed on a fresh device');
  suppressResume('movie:603', store);
  assert.equal(isResumeSuppressed('movie:603', store), true);
  assert.equal(isResumeSuppressed('movie:604', store), false, 'the next film still asks');
  assert.deepEqual(JSON.parse(store.dump().get(NEVER_RESUME_KEY)), ['movie:603']);
  assert.deepEqual(clearResumeSuppression('movie:603', store), []);
  assert.equal(isResumeSuppressed('movie:603', store), false);
});

test('suppressing is idempotent, newest-first and capped', () => {
  const store = memoryStore();
  suppressResume('a', store);
  suppressResume('b', store);
  assert.deepEqual(readNeverResume(store), ['b', 'a'], 're-tapping does not duplicate, newest leads');
  suppressResume('a', store);
  assert.deepEqual(readNeverResume(store), ['a', 'b']);
  for (let i = 0; i < 250; i += 1) suppressResume(`title:${i}`, store);
  const list = readNeverResume(store);
  assert.equal(list.length, 200, 'the queue is bounded so it cannot grow forever');
  assert.equal(list[0], 'title:249');
});

test('a corrupt queue or a missing watchKey never breaks playback', () => {
  const broken = memoryStore({ [NEVER_RESUME_KEY]: '{not json' });
  assert.deepEqual(readNeverResume(broken), []);
  assert.equal(isResumeSuppressed('x', broken), false);
  assert.deepEqual(suppressResume('x', broken), ['x'], 'a write repairs the queue');

  const notObj = memoryStore({ [NEVER_RESUME_KEY]: '{"a":1}' });
  assert.deepEqual(readNeverResume(notObj), [], 'non-array payloads are dropped');

  const store = memoryStore();
  assert.deepEqual(suppressResume('', store), [], 'no watchKey, nothing stored');
  assert.equal(store.dump().size, 0);
  assert.equal(isResumeSuppressed('', store), false);
  assert.equal(isResumeSuppressed(undefined, store), false);
});

test('planResume is deliberately unaware of the opt-out', () => {
  // The engine skips resume when suppressed; planResume must keep returning a
  // valid plan so "Resume anyway" from My List still works after clearing it.
  const store = memoryStore();
  suppressResume('movie:603', store);
  const plan = planResume({ progress: 600, duration: 1200 }, { start: 0, end: 1200 });
  assert.equal(plan.seek, true);
  clearResumeSuppression('movie:603', store);
  assert.equal(isResumeSuppressed('movie:603', store), false);
});
