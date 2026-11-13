import assert from 'node:assert/strict';
import { sourceBrowseGroups, resolvedPlaybackChannel } from '@/lib/live/sourceBrowse';
import { normalizeJioCookie } from '@/lib/jioPlayback';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
const sources = [{ id: 'a', label: 'Owner A' }, { id: 'b', label: 'Owner B' }, { id: 'empty', label: 'Empty source' }];
const groups = [
  { logicalId: 'bbc', displayName: 'BBC', variants: [{ channelId: 'bbc-a', sourceId: 'a', language: 'en', name: 'BBC', url: 'https://example.org/bbc.m3u8' }] },
  ...['Sony Vizha', 'Sun TV', 'Star Vijay'].map((name, i) => ({ logicalId: `g${i}`, displayName: name, variants: ['a', 'b', 'disabled'].map(sourceId => ({ channelId: `${i}-${sourceId}`, sourceId, language: 'ta', name, url: 'https://example.org/live.mpd' })) })),
];
const browsed = sourceBrowseGroups(groups, sources);
assert.equal(browsed.length, 7);
assert.equal(browsed[0].displayName, 'Star Vijay');
assert.equal(browsed[2].displayName, 'Sun TV');
assert.equal(browsed[4].displayName, 'Sony Vizha');
assert.equal(browsed.at(-1).displayName, 'BBC');
assert.equal(new Set(browsed.map(g => g.logicalId)).size, browsed.length);
for (const g of browsed) {
  assert.equal(g.sourceIds.length, 1);
  assert.ok(g.variants.every(v => v.sourceId === g.sourceIds[0]));
  assert.ok(!g.variants.some(v => v.sourceId === 'disabled'));
}
const fresh = resolvedPlaybackChannel({ channel: { id: 'fresh', key: 'fresh-key', headers: {}, sourceId: 'b' }, cookie: '', originUrl: 'https://example.org/new.mpd', format: 'dash' }, { key: 'stale', cookie: 'stale', url: 'https://example.org/old' });
assert.equal(fresh.key, 'fresh-key'); assert.equal(fresh.cookie, ''); assert.equal(fresh.sourceId, 'b');
const token = `st=1~exp=${Math.floor(Date.now()/1000)+3600}~acl=/bpk-tv/*~hmac=abcdef`;
const signed = `https://jiotvmblive.cdn.jio.com/bpk-tv/test/manifest.mpd?foo=1&__hdnea__=${encodeURIComponent(token)}`;
assert.equal(normalizeJioCookie(signed), `__hdnea__=${token}`);
assert.equal(normalizeJioCookie('https://example.org/?unrelated=1'), '');
let calls = 0;
const policy = createLiveTvPolicy({ channelId: 'test', sourceId: 'jio-tamil', name: 'Test', url: signed, format: 'dash' }, { fetchImpl: async () => { calls++; throw Error('must not sweep'); } });
const result = await policy.resolve();
assert.ok(result.url.includes('__hdnea__=')); assert.equal(calls, 0);
console.log('PASS source-isolated browsing, admin labels, featured Tamil order, fresh resolve data and signed-URL Jio token regression.');
