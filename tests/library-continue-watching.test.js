import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Continue Watching is for on-demand titles. A live channel has nothing to resume, and one row per
 * channel-switch (usually titled "Untitled", because live surfaces have no TMDB metadata) eats the
 * 60-row history budget and pushes real titles out. So: live keys are refused on write, filtered on
 * read, and pruned out of storage written by earlier builds.
 *
 * The store is localStorage-backed, which is what makes it free-tier friendly — and what makes it
 * testable with nothing but a Map for a window.
 */

const HISTORY_KEY = 'jash:library:continue:v1';

function fakeWindow(seed = {}) {
  const items = new Map(Object.entries(seed));
  return {
    localStorage: {
      getItem: (key) => (items.has(key) ? items.get(key) : null),
      setItem: (key, value) => items.set(key, String(value)),
      removeItem: (key) => items.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
    __items: items,
  };
}

/**
 * A fresh module instance per case: `cache` is module state by design (it is what keeps six components
 * in sync without a context), and a query-string specifier is how you get an isolated copy in Node.
 */
async function loadStore(seed) {
  globalThis.window = fakeWindow(seed);
  return import(`../lib/watchStore.js?case=${Math.random().toString(36).slice(2)}`);
}

test('on-demand titles are recorded and read back with progress', async () => {
  const store = await loadStore();
  store.upsertHistoryEntry({ key: 'movie:603', title: 'V for Vendetta', type: 'movie', href: '/watch/movie/603', progress: 120, duration: 600 });
  const history = store.getHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'V for Vendetta');
  assert.equal(history[0].progress, 120, 'progress is stored so the row can draw its bar');
  assert.equal(store.makeWatchKey({ type: 'series', tmdbId: 1399 }), 'series:1399', 'series stay in the list too');
});

test('a live channel never enters the history, whatever the page asks for', async () => {
  const store = await loadStore();
  store.upsertHistoryEntry({ key: 'live:jio-144-0', title: 'Colors HD', href: '/live', progress: 900, duration: 1800 });
  store.saveOrUpsertProgress({ key: 'live:sun-1', title: 'Sun News' }, 400, 900);
  store.saveWatchProgress('live:jio-144-0', 500, 900);
  assert.equal(store.getHistory().length, 0, 'nothing was written for the channel');
  assert.equal(store.getHistoryEntry('live:jio-144-0'), null, 'and there is no row to resume from');
  const raw = JSON.parse(globalThis.window.localStorage.getItem(HISTORY_KEY) || '[]');
  assert.equal(raw.length, 0, 'the localStorage payload itself stays clean, not just the view');
});

test('rows left behind by older builds are pruned once and persisted', async () => {
  const legacy = [
    { key: 'live:jio-144-0', title: 'Untitled', progress: 900, updatedAt: 30 },
    { key: 'match:fancode-1', title: 'India vs Australia', progress: 40, updatedAt: 29 },
    { key: 'ott:some-title', title: 'OTT thing', progress: 10, updatedAt: 28 },
    { key: 'movie:603', title: 'V for Vendetta', progress: 100, updatedAt: 27 },
    { key: 'series:1399', title: 'Game of Thrones', progress: 200, updatedAt: 26 },
  ];
  const store = await loadStore({ [HISTORY_KEY]: JSON.stringify(legacy) });
  const history = store.getHistory();
  // `getHistory` sorts by `updatedAt`, so the two surviving rows keep the recency order of the seed.
  assert.deepEqual(history.map((item) => item.key), ['movie:603', 'series:1399'], 'live and match rows are gone, on-demand rows keep their recency order');
  const raw = JSON.parse(globalThis.window.localStorage.getItem(HISTORY_KEY));
  // `ott:` rows stay: they are hidden by a read filter of their own, and this prune is only about live
  // broadcasts, so it must not quietly change what another feature can still look up.
  assert.deepEqual(raw.map((item) => item.key).sort(), ['movie:603', 'ott:some-title', 'series:1399'], 'the prune is written back, so the 60-row budget is not silently spent on ghosts');
});

test('My List drops the same rows, so a channel cannot hide in the other tab', async () => {
  const store = await loadStore();
  store.toggleFavoriteItem({ key: 'movie:603', title: 'V for Vendetta' });
  assert.equal(store.toggleFavoriteItem({ key: 'live:jio-144-0', title: 'Colors HD' }), false, 'adding a channel to My List is refused outright');
  assert.equal(store.getFavorites().length, 1, 'so the list only ever holds on-demand titles');
  assert.equal(store.isFavoriteItem('movie:603'), true);
  assert.equal(store.isFavoriteItem('live:jio-144-0'), false, 'and it is not counted as saved when the button is drawn');
});

test('the live key space is defined in one place', async () => {
  const store = await loadStore();
  for (const key of ['live:x', 'tv:x', 'channel:x', 'match:x', 'sports:x']) {
    assert.equal(store.isLiveHistoryKey(key), true, `${key} is live`);
  }
  for (const key of ['movie:603', 'series:1399', 'stremio:movie:tt123:0:0']) {
    assert.equal(store.isLiveHistoryKey(key), false, `${key} is on-demand`);
  }
  assert.equal(store.isLiveHistoryKey(''), false, 'an empty key is not a live row');
});

test('both live surfaces opt out of persistence at the source, not only in the store', () => {
  const livePage = fs.readFileSync(new URL('../app/live/page.js', import.meta.url), 'utf8');
  const engine = fs.readFileSync(new URL('../components/player/usePlaybackEngine.js', import.meta.url), 'utf8');
  assert.match(livePage, /library=\{\{ watchKey: `live:\$\{active\.id\}`, persist: false \}\}/);
  assert.match(engine, /if \(!el \|\| playingLive\(el\)\) return;/, 'the flush path refuses a live element');
  assert.match(engine, /if \(!persistRef\.current \|\| !watchKey \|\| playingLive\(videoRef\.current\)\) return;/, 'and so does the periodic writer');
  assert.match(engine, /derivePlaybackModel\(el\)\.live/, 'liveness comes from the same model the UI reads, not a second guess');
});
