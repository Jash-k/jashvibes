const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = (body, status = 200) => ({ ok: status < 400, status, headers: new Headers(), json: async () => body });
(async () => {
  const { createLyricsController } = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '../lib/lyricsController.js'), 'utf8')).toString('base64'));
  let calls = [], states = [], pending = [];
  const controller = createLyricsController({ onChange: value => states.push(value), retryDelays: [2, 3], requestTimeout: 100,
    fetcher: (url, opts) => { calls.push({ url, opts }); return new Promise(resolve => pending.push(resolve)); } });
  const select = (key, ready = true, extra = '') => controller.select({ key, ready, signature: key + extra, params: { title: key } });
  select('A', false); assert.equal(calls.length, 0); assert.equal(states.at(-1).status, 'loading');
  select('A'); select('A'); select('A', false); controller.refresh({ force: true });
  assert.equal(calls.length, 1, 'one owner, deduped manual refresh/readiness regression');
  select('B'); select('C'); assert(calls[0].opts.signal.aborted); assert(calls[1].opts.signal.aborted);
  pending[2](reply({ plainLyrics: 'C text' })); await pause(0);
  pending[0](reply({ plainLyrics: 'A stale' })); pending[1](reply({ plainLyrics: 'B stale' })); await pause(0);
  assert.equal(states.at(-1).lyrics, 'C text');
  select('A', false); select('C'); assert.equal(calls.length, 3, 'back uses positive cache');
  const refresh = controller.refresh({ force: true }); assert.equal(states.at(-1).lyrics, 'C text');
  pending[3](reply({ source: 'none' })); await refresh; assert.equal(states.at(-1).lyrics, 'C text', 'empty refresh preserves good lyrics');
  select('C', true, ':newMetadata'); pending[4](reply({ source: 'none' })); await pause(0);
  assert.equal(states.at(-1).status, 'not-found');
  select('D'); controller.dispose(); pending[5](reply({ plainLyrics: 'unmounted' })); await pause(0);
  assert.notEqual(states.at(-1).lyrics, 'unmounted');

  let count = 0; const recovered = [];
  const retry = createLyricsController({ onChange: s => recovered.push(s), retryDelays: [2, 3], fetcher: async () => ++count === 1 ? reply({ retryable: true }, 503) : reply({ plainLyrics: 'Recovered' }) });
  retry.select({ key: 'R', signature: 'R', ready: true, params: {} }); await pause(20);
  assert.equal(count, 2); assert.equal(recovered.at(-1).status, 'ready'); assert(!recovered.some(s => s.status === 'not-found' || s.status === 'error'));
  retry.dispose();
  const failed = []; count = 0;
  const outage = createLyricsController({ onChange: s => failed.push(s), retryDelays: [2, 3], fetcher: async () => { count++; throw new Error('offline'); } });
  outage.select({ key: 'F', signature: 'F', ready: true, params: {} }); await pause(30);
  assert.equal(count, 3); assert.equal(failed.at(-1).status, 'error'); assert(!failed.some(s => s.status === 'not-found')); outage.dispose();
  count = 0;
  const cooldown = createLyricsController({ onChange() {}, retryDelays: [2], fetcher: async () => { count++; return reply({ retryable: true, retryAfter: 1 }, 503); } });
  cooldown.select({ key: 'X', signature: 'X', ready: true, params: {} }); await pause(30); cooldown.refresh({ force: true });
  assert.equal(count, 1, 'manual refresh must not bypass Retry-After'); cooldown.dispose(); await pause(10); assert.equal(count, 1);
  console.log('PASS controller: metadata readiness, dedupe, A→B→C late responses, cache, retained refresh, metadata invalidation, unmount, automatic recovery, bounded failure, cooldown cancellation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
