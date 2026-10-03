/**
 * Watch-entry policy tests (lib/watch/policy.js).
 *
 * These are the rules every catalogue links through: which provider gets tried
 * first for a given origin, how a pasted TMDB/IMDb reference is parsed, and what
 * the generated /watch URL looks like. A regression here does not throw — it
 * silently sends the player at the wrong provider or the wrong title.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../lib/watch/policy.js');

test('provider order leads with the surface you came from', async () => {
  const { providerOrder } = await load();
  assert.deepEqual(providerOrder('home'), ['vault', 'stremio', 'mp4', 'mirchi']);
  assert.deepEqual(providerOrder(), ['vault', 'stremio', 'mp4', 'mirchi']);
  assert.deepEqual(providerOrder('retro'), ['retro', 'vault', 'stremio', 'mp4', 'mirchi']);
  // Stremio is already in the base list, so it must appear once and first.
  assert.deepEqual(providerOrder('stremio'), ['stremio', 'vault', 'mp4', 'mirchi']);
});

test('pasted references are parsed into identity', async () => {
  const { parseIdentity } = await load();
  assert.deepEqual(parseIdentity('tt1234567'), { tmdbId: null, imdbId: 'tt1234567', type: '' });
  assert.deepEqual(parseIdentity('597'), { tmdbId: 597, imdbId: '', type: '' });
  assert.deepEqual(parseIdentity('tmdb:597'), { tmdbId: 597, imdbId: '', type: '' });
  assert.deepEqual(parseIdentity('https://www.themoviedb.org/movie/597'), { tmdbId: 597, imdbId: '', type: '' });
  // A /tv/ URL additionally decides the media type.
  assert.deepEqual(parseIdentity('https://www.themoviedb.org/tv/1396'), { tmdbId: 1396, imdbId: '', type: 'series' });
  assert.deepEqual(parseIdentity('   '), { tmdbId: null, imdbId: '', type: '' });
  assert.deepEqual(parseIdentity('not a reference'), { tmdbId: null, imdbId: '', type: '' });
});

test('resolution detection prefers the explicit p-suffix and understands 4K', async () => {
  const { resolutionOf } = await load();
  assert.equal(resolutionOf({ quality: '1080p' }), '1080p');
  assert.equal(resolutionOf({ name: '720P WEB-DL' }), '720p');
  assert.equal(resolutionOf({ label: 'Movie 4K UHD' }), '2160p');
  assert.equal(resolutionOf({}), '');
  // An explicit "p" token outranks a bare "4k" in the same string.
  assert.equal(resolutionOf({ label: '1080p web-dl 4k master' }), '1080p');
});

test('candidates are cleaned, de-duplicated and ordered best-quality-first', async () => {
  const { normalizeCandidates } = await load();
  const raw = [
    { url: 'https://cdn.example/low.mp4', quality: '480p' },
    { url: 'not-a-url' },
    { url: 'https://cdn.example/high.mp4', label: '1080p' },
    { url: 'https://cdn.example/low.mp4', quality: '480p' }, // duplicate URL
  ];
  const out = normalizeCandidates(raw, 'mp4');
  assert.equal(out.length, 2, 'invalid and duplicate entries are dropped');
  assert.deepEqual(out.map((item) => item.quality), ['1080p', '480p']);
  assert.ok(out.every((item) => item.provider === 'mp4'));
  assert.ok(out.every((item) => typeof item.label === 'string' && item.label.length > 0));
  assert.ok(out.every((item) => item.kind !== 'embed'));
});

test('vault and iframe sources are marked as embeds', async () => {
  const { normalizeCandidates } = await load();
  assert.equal(normalizeCandidates([{ url: 'https://v.example/1' }], 'vault')[0].kind, 'embed');
  assert.equal(normalizeCandidates([{ url: 'https://v.example/2', type: 'iframe' }], 'mp4')[0].kind, 'embed');
  assert.equal(normalizeCandidates([{ url: 'https://v.example/3', kind: 'embed' }], 'mp4')[0].kind, 'embed');
});

test('mirror selection falls back to the first candidate', async () => {
  const { chooseCandidate } = await load();
  const items = [{ quality: '1080p' }, { quality: '720p' }];
  assert.equal(chooseCandidate(items, '720p'), 1);
  assert.equal(chooseCandidate(items, '480p'), 0);
  assert.equal(chooseCandidate(items, ''), 0);
});

test('generated watch links carry the origin and stay parseable', async () => {
  const { watchHref } = await load();
  const parse = (href) => {
    const [path, query] = href.split('?');
    return { path, q: new URLSearchParams(query) };
  };

  const home = parse(watchHref({ tmdbId: 597, title: 'Kaithi', year: '2019' }, 'home'));
  assert.equal(home.path, '/watch/movie/597');
  assert.equal(home.q.get('origin'), 'home');
  assert.equal(home.q.get('title'), 'Kaithi');
  assert.equal(home.q.get('year'), '2019');
  assert.equal(home.q.get('mediaType'), 'movie');

  const series = parse(watchHref({ tmdbId: 1396, type: 'series' }, 'home'));
  assert.equal(series.path, '/watch/series/1396');
  assert.equal(series.q.get('mediaType'), 'series');

  // Vault / ReTro / Stremio keep their own namespaced route segment.
  assert.equal(parse(watchHref({ id: 'abc 123' }, 'vault')).path, '/watch/vault/abc%20123');
  assert.equal(parse(watchHref({ id: 'r-9' }, 'retro')).path, '/watch/retro/r-9');
  assert.equal(parse(watchHref({ id: 'tt123', type: 'series' }, 'stremio')).path, '/watch/stremio-series/tt123');
  assert.equal(parse(watchHref({ id: 'tt123' }, 'stremio')).path, '/watch/stremio-movie/tt123');

  // Nothing identifiable yet — the link still resolves somewhere honest.
  assert.equal(parse(watchHref({}, 'home')).path, '/watch/home/unmatched');
});

test('watchHref prefers a release date for the year when there is no year field', async () => {
  const { watchHref } = await load();
  const query = new URLSearchParams(watchHref({ tmdbId: 1, releaseDate: '2019-07-19' }, 'home').split('?')[1]);
  assert.equal(query.get('year'), '2019');
});
