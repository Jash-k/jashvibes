import assert from 'node:assert/strict';
import test from 'node:test';

import { LEGACY_KEYS, PREFS_KEY, clamp, patchPrefs, readPrefs, writePref } from '../lib/player/prefs.js';
import { PREF_DEFAULTS } from '../lib/player/prefs.js';

class FakeStore {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
    this.removed = [];
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.removed.push(key);
    this.map.delete(key);
  }
}

const withStore = (store) => ({ localStorage: () => store });

test('missing or corrupt storage yields defaults, never a throw', () => {
  assert.deepEqual(readPrefs({ localStorage: () => null }), PREF_DEFAULTS);
  assert.deepEqual(readPrefs({ localStorage: () => undefined }), PREF_DEFAULTS);
  assert.equal(readPrefs(withStore(new FakeStore({ [PREFS_KEY]: 'not json{' }))).volume, 1);
  assert.equal(readPrefs(withStore(new FakeStore({ [PREFS_KEY]: '[1,2]' }))).volume, 1, 'a non-object payload is ignored');
  assert.equal(readPrefs().volume, 1, 'SSR-safe: no localStorage global at all');
});

test('saved values win and unknown keys survive', () => {
  const store = new FakeStore({ [PREFS_KEY]: JSON.stringify({ volume: 0.3, showStats: true, customFlag: 1 }) });
  const prefs = readPrefs(withStore(store));
  assert.equal(prefs.volume, 0.3);
  assert.equal(prefs.showStats, true);
  assert.equal(prefs.customFlag, 1);
  assert.equal(prefs.rate, 1, 'unmentioned prefs keep their defaults');
});

test('legacy per-page keys are lifted once, and a real value always beats them', () => {
  const store = new FakeStore({
    'jb-watch-vol': '0.4',
    'jb-watch-speed': '1.5',
    'jb-watch-ambient': 'on',
    'jash-live-volume': '0.2',
  });
  const prefs = readPrefs(withStore(store));
  assert.equal(prefs.volume, 0.4, 'two legacy keys map to volume: the first lift wins, deterministically');
  assert.equal(prefs.rate, 1.5);
  assert.equal(prefs.ambient, true);
  assert.deepEqual(Object.values(LEGACY_KEYS), ['volume', 'volume', 'rate', 'ambient'], 'the newer key is listed first');

  const newer = new FakeStore({ ...Object.fromEntries(store.map), [PREFS_KEY]: JSON.stringify({ volume: 0.9 }) });
  assert.equal(readPrefs(withStore(newer)).volume, 0.9, 'never overwrite a value the new store owns');
  assert.equal(readPrefs(withStore(new FakeStore({ 'jb-watch-ambient': 'off' }))).ambient, false);
});

test('only known prefs are written, and writing retires the legacy mirrors', () => {
  const store = new FakeStore({ 'jb-watch-vol': '0.4', 'jash-live-volume': '0.2' });
  assert.equal(writePref('volume', 0.65, withStore(store)), 0.65);
  assert.equal(writePref('anythingElse', 'x', withStore(store)), null);
  assert.equal(JSON.parse(store.getItem(PREFS_KEY)).anythingElse, undefined, 'the whitelist is enforced');

  const saved = JSON.parse(store.getItem(PREFS_KEY));
  assert.equal(saved.volume, 0.65);
  assert.ok(saved.updatedAt > 0, 'updatedAt lets other tabs detect a change');
  assert.deepEqual(store.removed.sort(), ['jash-live-volume', 'jb-watch-vol'].sort());
});

test('out-of-range values clamp instead of producing an invisible player', () => {
  assert.equal(clamp('0.5', 1, 0, 1), 0.5);
  assert.equal(clamp(5, 1, 0, 1), 1);
  assert.equal(clamp(-2, 1, 0, 1), 0);
  assert.equal(clamp('nope', 0.75, 0, 1), 0.75);
  assert.equal(clamp(undefined, 16, 0.25, 16), 16);
});

test('patchPrefs writes a group and returns the merged result', () => {
  const store = new FakeStore();
  const next = patchPrefs({ volume: 0.2, rate: 2, brightness: 0.6 }, withStore(store));
  assert.equal(next.volume, 0.2);
  assert.equal(next.rate, 2);
  assert.equal(next.brightness, 0.6);
  assert.equal(next.qualityAuto, true, 'untouched prefs are still defaults');
});
