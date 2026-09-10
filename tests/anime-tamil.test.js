import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import path from 'node:path';

/**
 * The Tamil anime feed, tested against bytes captured from the real source
 * (`tests/fixtures/piratexplay-*.html`, taken from piratexplay.cc on 2026-09-11) rather than
 * invented markup — a scraper whose fixtures are written by hand proves nothing.
 *
 * The network half is driven by a stub `fetchImpl`, so nothing in this file reaches the internet;
 * what it does prove is that the parse → resolve → playable chain returns a real `.m3u8`, that hosts
 * without a rule are named and refused instead of fetched, and that no ad or shortener domain on those
 * pages is ever requested.
 */

const BASE = 'https://piratexplay.cc';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fixture = (name) => readFileSync(path.join(root, 'tests', 'fixtures', name), 'utf8');

const lib = await import('@/lib/animeTamilFeed.js');
const view = await import('@/lib/animeTamilView.js');
const component = readFileSync(path.join(root, 'components', 'anime', 'AnimeTamil.jsx'), 'utf8');
const css = readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const navItems = readFileSync(path.join(root, 'components', 'navItems.js'), 'utf8');
const dock = readFileSync(path.join(root, 'components', 'MobileDock.jsx'), 'utf8');
const middleware = readFileSync(path.join(root, 'middleware.js'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const envExample = readFileSync(path.join(root, '.env.example'), 'utf8');

// Located from the selector backwards, so a reworded banner comment cannot silently make this `slice(-1)`.
const anCss = css.slice(css.lastIndexOf('/*', css.indexOf('.jv-an-page {')));

/** URL → response body, with every request recorded so a fetch we should not make shows up in a test. */
/**
 * A stand-in for the internet, with the shape this feed actually asks for.
 *
 * A route entry is `[match, body]` or `[match, { body, status, headers }]`. Beyond the list, one default
 * is built in: any `.m3u8` or `.ts` answers the way a CDN that likes browsers does — a well-formed
 * playlist, a segment, and `access-control-allow-origin: *`. Without that, a test of `loadEpisode` would
 * be a test of a stub that refuses to be a CDN, and the "is it really playable" check would fail for the
 * wrong reason. A test that wants a refusal says so by naming that URL itself.
 */
const STUB_MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=877444,RESOLUTION=1280x720\nindex-v1-a1.m3u8\n';
const STUB_VARIANT = '#EXTM3U\n#EXT-X-TARGETDURATION:20\n#EXTINF:10.0,\nseg-1-v1-a1.ts\n';

function response(status, body, headers = {}) {
  const bag = { 'access-control-allow-origin': '*', 'content-type': 'text/html; charset=utf-8', ...headers };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => bag[String(name).toLowerCase()] ?? null },
    async text() { return body; },
  };
}

function stubFetch(routes = []) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, headers: options.headers || {} });
    for (const [key, value] of routes) {
      if (!href.includes(key)) continue;
      return typeof value === 'string' ? response(200, value) : response(value.status ?? 200, value.body ?? '', value.headers);
    }
    if (/master[^/]*\.m3u8/i.test(href)) return response(200, STUB_MASTER, { 'content-type': 'application/vnd.apple.mpegurl' });
    if (/\.m3u8(\?|$)/i.test(href)) return response(200, STUB_VARIANT, { 'content-type': 'application/vnd.apple.mpegurl' });
    if (/\.ts(\?|$)/i.test(href)) return response(206, '\u0000\u0001', { 'content-type': 'video/MP2T' });
    return response(404, '');
  };
  impl.calls = calls;
  return impl;
}

describe('the listing', () => {
  let parsed;
  before(() => {
    parsed = lib.parseListing(fixture('piratexplay-listing.html'), { base: BASE });
  });

  test('reads the taxonomy grid, and only that grid', () => {
    assert.equal(parsed.items.length, 4 + 2, 'six cards were captured in the list itself');
    assert.ok(parsed.items.every((item) => /^https:\/\/piratexplay\.cc\/(series|movies)\//.test(item.href)));
    assert.equal(parsed.grids, 3, 'the capture keeps the two sidebar widgets so their exclusion is real');
    const titles = parsed.items.map((item) => item.title);
    for (const widget of ['Tomo-chan Is a Girl!', 'Ultraviolet: Code 044', 'The Guardians of Justice', "Hell's Paradise"]) {
      assert.ok(!titles.includes(widget), `${widget} is a rotating widget row, not part of /language/tamil`);
    }
  });

  test('a card carries the fields the grid paints', () => {
    const first = parsed.items[0];
    assert.equal(first.title, 'Clevatess');
    assert.equal(first.kind, 'series');
    assert.equal(first.tmdbId, 258348, 'the trailing number of the slug is the TMDB id');
    assert.equal(first.rating, 8);
    assert.equal(first.path, '/series/clevatess-season-1-258348');
    assert.equal(first.action, 'View Series');
    assert.match(first.poster, /^https:\/\/image\.tmdb\.org\/t\/p\/w342\//, 'art is requested at the size the card uses');
  });

  test('series and films are told apart, and a film keeps its year', () => {
    const films = parsed.items.filter((item) => item.kind === 'movie');
    assert.equal(films.length, 2, 'the taxonomy grid mixes films and series side by side');
    assert.ok(films.every((item) => /^\d{4}$/.test(item.year)), films.map((item) => item.year).join(','));
    assert.ok(parsed.items.filter((item) => item.kind === 'series').every((item) => item.season >= 1));
  });

  test('a card with no title or a foreign target is dropped', () => {
    const junk = lib.parseListing('<ul class="post-lst"><li class="post series"><article class="post"><a href="http://evil.example/series/x" class="lnk-blk"></a></article></li></ul>', { base: BASE });
    assert.equal(junk.items.length, 0);
  });

  test('the pagination hint is read but never trusted as a limit', () => {
    assert.equal(parsed.maxPage, 13, 'the widget says 13 while page 14 exists — so `hasNext` decides');
    assert.ok(parsed.maxPage <= lib.MAX_LISTING_PAGE);
  });

  test('listingUrl: first page, later pages, and a search on the source', () => {
    assert.equal(lib.listingUrl(BASE, 1), 'https://piratexplay.cc/language/tamil');
    assert.equal(lib.listingUrl(BASE, 3), 'https://piratexplay.cc/language/tamil/page/3');
    assert.equal(lib.listingUrl(BASE, 9, 'naruto'), 'https://piratexplay.cc/?s=naruto');
    assert.equal(lib.listingUrl(BASE, 0), 'https://piratexplay.cc/language/tamil');
  });

});

describe('a title', () => {
  let parsed;
  before(() => {
    parsed = lib.parseTitle(fixture('piratexplay-series.html'), { base: BASE, href: '/series/clevatess-season-1-258348' });
  });

  test('the heading, the seasons and every episode row', () => {
    assert.equal(parsed.title, 'Clevatess');
    assert.equal(parsed.seasons.length, 2, 'the season swiper is the only multi-season affordance');
    assert.equal(parsed.episodes.length, 3, 'as many rows as the capture keeps');
    const ep = parsed.episodes[0];
    assert.equal(ep.season, 1);
    assert.equal(ep.episode, 1);
    assert.match(ep.path, /^\/episode\/clevatess-season-1-258348-1x\d\/$/);
    assert.match(ep.still, /image\.tmdb\.org\/t\/p\/w300\//);
    assert.equal(ep.title, 'Clevatess');
  });

  test('the TMDB id is carried through, so art and the aggregate hosts can be keyed on it', () => {
    assert.equal(parsed.tmdbId, 258348);
  });

  test('a film page with no episode list still gets one thing to play', async () => {
    const routes = new Map([['/movies/', '<html><head><meta property="og:title" content="Resident Evil Damnation (2012) - PirateXPlay"/></head><body><h1 class="entry-title">Resident Evil: Damnation (2012)</h1></body></html>']]);
    const out = await lib.loadTitle({ path: '/movies/resident-evil-damnation-2012-133121', fetchImpl: stubFetch(routes), env: { ANIME_TAMIL_BASE_URL: BASE } });
    assert.equal(out.ok, true);
    assert.equal(out.title.episodes.length, 1);
    assert.equal(out.title.kind, 'movie');
    assert.equal(out.title.year, '2012', 'taken from the title when the info block has no year');
  });
});

describe('an episode: its servers', () => {
  let servers;
  before(() => {
    servers = lib.parseServers(fixture('piratexplay-episode.html'), { base: BASE });
  });

  test('every option tab is read, in the source order', () => {
    assert.ok(servers.length >= 10, `got ${servers.length}`);
    assert.ok(servers.every((row) => row.url.startsWith('https://')));
    assert.deepEqual(servers.map((row) => row.type).slice(0, 4), ['wrapped', 'embed', 'multi', 'rotator']);
  });

  test('a host we know is labelled, and the rotator tabs are told apart', () => {
    const names = servers.map((row) => row.label);
    assert.ok(names.includes('Vidmoly'));
    assert.ok(names.includes('TurboVid'));
    assert.ok(names.some((name) => /^PirateXPlay server \d+$/.test(name)), names.join('|'));
  });

  test('the same address twice is one row', () => {
    const urls = servers.map((row) => row.url);
    assert.equal(new Set(urls).size, urls.length);
  });

  test('the language map is decoded and reported, never fetched', () => {
    const multi = servers.find((row) => row.type === 'multi');
    const rows = lib.decodeLanguageMap(multi.url);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((row) => row.language), ['Hindi', 'Tamil', 'Telugu', 'English', 'Japanese']);
    assert.match(rows[1].url, /short\.icu/);
    assert.equal(multi.url.includes('short.icu'), false, 'only the site’s own endpoint is on the row');
  });

  test('ad and tracker hosts on those pages are never turned into rows', () => {
    assert.ok(servers.every((row) => !/short\.icu|googletagmanager|bysezejataos|blurbsoutpry|casteschagoma/i.test(row.url)));
  });
});

describe('resolving a stream', () => {
  test('Vidmoly: the manifest in its page becomes a playable address', () => {
    const out = lib.HOST_RULES.find((rule) => rule.id === 'vidmoly').extract(fixture('vidmoly-player.html'));
    assert.equal(out.ok, true);
    assert.match(out.streams[0].url, /^https:\/\/box-\d+-v\d+\.vmbox\.space\/hls2\/.*master\.m3u8\?/);
    assert.match(out.poster, /vmbox[^"]+\.(jpe?g|png)/);
  });

  test('a Vidmoly page with no manifest is said so, not guessed at', () => {
    const out = lib.HOST_RULES.find((rule) => rule.id === 'vidmoly').extract('<html><body>nothing here</body></html>');
    assert.equal(out.ok, false);
    assert.match(out.note, /no manifest/);
  });

  test('hosts without a rule are not fetched: the site’s own JS-built player is named instead', async () => {
    const fetchImpl = stubFetch([['as-cdn26', '<html></html>']]);
    const row = await lib.resolveServer(
      { index: 0, id: 'opt-0', url: `${BASE}/proxy/play.php?url=https%3A%2F%2Fas-cdn26.top%2Fvideo%2Fabc`, host: 'piratexplay.cc', label: 'PirateXPlay', type: 'wrapped' },
      { fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } },
    );
    assert.equal(row.ok, false);
    assert.match(row.note, /built by that host/);
    assert.equal(fetchImpl.calls.length, 0, 'no request for a host we cannot resolve');
  });

  test('the multi-language tab explains itself and fetches nothing', async () => {
    const fetchImpl = stubFetch([]);
    const row = await lib.resolveServer({ index: 2, id: 'opt-2', type: 'multi', url: `${BASE}/proxy/multi.php?data=W3sibGFuZ3VhZ2UiOiJUYW1pbCIsImxpbmsiOiJodHRwczovL3Nob3J0LmljdS94In1d`, host: 'piratexplay.cc', label: 'PirateXPlay' }, { fetchImpl });
    assert.equal(row.ok, false);
    assert.deepEqual(row.languages.map((entry) => entry.language), ['Tamil']);
    assert.match(row.note, /no longer resolves/);
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('an unknown host gets a plain refusal', async () => {
    const row = await lib.resolveServer({ index: 6, id: 'opt-6', type: 'embed', url: 'https://rubystm.com/e/x.html', host: 'rubystm.com', label: 'RubyStream' }, { fetchImpl: stubFetch([]) });
    assert.equal(row.ok, false);
    assert.match(row.note, /no resolver/);
  });

  test('only hosts with a rule match, and both Vidmoly domains count', () => {
    assert.ok(lib.ruleForHost('vidmoly.net'));
    assert.ok(lib.ruleForHost('vidmoly.biz'));
    assert.ok(lib.ruleForHost('emturbovid.com'));
    assert.equal(lib.ruleForHost('as-cdn26.top'), null);
    assert.equal(lib.ruleForHost('cloudy.upns.one'), null);
  });

  test('two servers of one file collapse to one playable row', () => {
    const rows = lib.dedupeStreams([
      { id: 'a', label: 'TurboVid', streams: [{ url: 'https://x/a.m3u8' }] },
      { id: 'b', label: 'Vidmoly', streams: [{ url: 'https://x/a.m3u8' }] },
      { id: 'c', label: 'Vidmoly', streams: [{ url: 'https://x/c.m3u8', label: 'Playlist 2' }] },
    ]);
    assert.deepEqual(rows.map((row) => row.url), ['https://x/a.m3u8', 'https://x/c.m3u8']);
    assert.equal(rows[1].label, 'Vidmoly · Playlist 2');
  });
});

describe('loadEpisode', () => {
  const episodePage = fixture('piratexplay-episode.html');
  const vidmolyPage = fixture('vidmoly-player.html');

  test('returns playable streams and the reason for every row that is not', async () => {
    const fetchImpl = stubFetch([['/episode/', episodePage], ['vidmoly', vidmolyPage], ['emturbovid', '<html></html>'], ['index11', `<html><body><iframe data-src="https://vidmoly.biz/embed-x.html"></iframe></body></html>`], ['abyssplayer', '<html></html>']]);
    const out = await lib.loadEpisode({ path: '/episode/clevatess-season-1-258348-1x1/', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } });
    assert.equal(out.ok, true);
    assert.ok(out.episode.playable.length >= 1);
    assert.match(out.episode.playable[0].url, /\.m3u8/);
    assert.ok(out.episode.sources.length >= out.episode.playable.length, 'unplayable rows stay visible');
    assert.ok(out.episode.sources.some((row) => row.ok === false && row.note));
    assert.ok(out.episode.open.startsWith(BASE));
  });

  test('a path outside the catalogue is refused before any request', async () => {
    const fetchImpl = stubFetch([]);
    const out = await lib.loadEpisode({ path: 'https://other.example/episode/x/', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'unknown episode');
    assert.equal(fetchImpl.calls.length, 0);

    const internal = await lib.loadEpisode({ path: '/../../etc/passwd', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } });
    assert.equal(internal.ok, false, 'a traversal is not an episode path');
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('the rotator is followed only to hosts with a rule', async () => {
    const fetchImpl = stubFetch([
      ['/episode/', `<html><body><section><div id="options-3" class="video aa-tb hdd on"><iframe data-src="${BASE}/public/player/index11.php?id=q"></iframe></div></section></body></html>`],
      ['index11', '<html><body><a href="https://vidmoly.net/embed-q.html">Vidmoly</a><a href="https://bysezejataos.com/e/ad.html">ad</a></body></html>'],
      ['vidmoly.net', vidmolyPage.replace('ohe1lchzz4ag', 'q')],
    ]);
    const out = await lib.loadEpisode({ path: '/episode/x-1x1/', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } });
    const hosts = fetchImpl.calls.map((call) => new URL(call.url).host);
    assert.ok(!hosts.some((host) => /bysezejataos/.test(host)), hosts.join(','));
    assert.ok(fetchImpl.calls.every((call) => call.headers['user-agent']), 'every read identifies itself');
    assert.equal(out.episode.playable.length, 1);
  });
});
describe('which address is offered first', () => {

  test('the row a browser can actually fetch is offered first', async () => {
    const turbo = '<html><body><a href="https://cdn3.turboviplay.com/data3/abc/abc.m3u8">t</a></body></html>';
    const fetchImpl = stubFetch([
      ['/episode/', fixture('piratexplay-episode.html')],
      ['vidmoly', fixture('vidmoly-player.html')],
      ['emturbovid', turbo],
      ['index11', '<html><body></body></html>'],
      ['abyssplayer', '<html></html>'],
    ]);
    const out = await lib.loadEpisode({ path: '/episode/two-hosts-1x1/', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE } });
    const hosts = out.episode.playable.map((row) => row.via);
    assert.ok(hosts.length >= 2, 'both hosts resolve in this fixture');
    assert.equal(hosts[0], 'vidmoly', `Vidmoly serves the segments with CORS open, order was ${hosts.join(',')}`);
    assert.ok(hosts.indexOf('vidmoly') < hosts.indexOf('turbovid'), 'the Drive-backed playlist is offered, never auto-selected');
  });

  test('rankStreams keeps unknown hosts behind the known-good one', () => {
    const rows = lib.rankStreams([
      { via: 'turbovid', url: 'a' },
      { via: 'something-new', url: 'b' },
      { via: 'vidmoly', url: 'c' },
    ]);
    assert.deepEqual(rows.map((row) => row.url), ['c', 'a', 'b']);
    const worded = lib.rankStreams([
      { label: 'TurboVid', url: 'a', via: 'PirateXPlay server 3 → turbovid' },
      { label: 'Vidmoly', url: 'b', via: 'PirateXPlay server 6 → vidmoly' },
    ]);
    assert.deepEqual(worded.map((row) => row.label), ['Vidmoly', 'TurboVid'],
      'the sort reads the host out of the sentence, not the sentence');
    assert.match(lib.streamWarning({ url: 'https://cdn3.turboviplay.com/data3/a/a.m3u8' }), /manifest but not the segments/);
    assert.equal(lib.streamWarning({ url: 'https://box-1449-v10.vmbox.space/hls2/b/b.m3u8', via: 'vidmoly' }), '',
      'the host that answers a cross-origin read gets no warning');
  });

});

describe('the cache', () => {
  before(() => { lib.store().clear(); });

  test('one load for concurrent callers, and a page inside its window is served from memory', async () => {
    let loads = 0;
    const load = async () => { loads += 1; return { ok: true, items: [{ path: '/series/a' }] }; };
    const args = { ttlMs: lib.TTL_LISTING_MS, failTtlMs: lib.TTL_FAILURE_MS, env: {}, now: 1_000, load };
    const [one, two] = await Promise.all([lib.cached('k', args), lib.cached('k', args)]);
    assert.equal(one.cached, false);
    assert.ok(two, 'the second caller got an answer');
    const again = await lib.cached('k', args);
    assert.equal(again.cached, true);
    assert.equal(again.ttlMs, lib.TTL_LISTING_MS);
    assert.equal(again.generatedAt, 1_000);
    assert.equal(loads, 1, `single-flight should cost exactly one load, saw ${loads}`);
  });

  test('an empty page is a failure: held for the short window, then asked again', async () => {
    lib.store().clear();
    let loads = 0;
    const load = async () => { loads += 1; return { ok: true, empty: true, items: [] }; };
    const out = await lib.cached('empty', { ttlMs: lib.TTL_LISTING_MS, failTtlMs: lib.TTL_FAILURE_MS, env: {}, now: 2_000, load });
    assert.equal(out.ttlMs, lib.TTL_FAILURE_MS, 'an empty answer must not inherit the 6 h success window');

    // Inside the short window the empty answer is served, so a dead source cannot be hammered.
    await lib.cached('empty', { ttlMs: lib.TTL_LISTING_MS, failTtlMs: lib.TTL_FAILURE_MS, env: {}, now: 2_000 + lib.TTL_FAILURE_MS - 1_000, load });
    assert.equal(loads, 1);

    // Past it, the page is read again.
    const again = await lib.cached('empty', { ttlMs: lib.TTL_LISTING_MS, failTtlMs: lib.TTL_FAILURE_MS, env: {}, now: 2_000 + lib.TTL_FAILURE_MS + 1, load });
    assert.equal(loads, 2, 'after the failure window the empty page is re-read, not kept for hours');
    assert.equal(again.ttlMs, lib.TTL_FAILURE_MS);
  });

  test('a failed refresh keeps the last good page and marks it stale', async () => {
    lib.store().clear();
    const good = { ok: true, items: [{ path: '/series/a' }] };
    await lib.cached('keep', { ttlMs: 10, failTtlMs: 5, env: {}, now: 0, load: async () => good });
    const out = await lib.cached('keep', { ttlMs: 10, failTtlMs: 5, env: {}, now: 99, load: async () => { throw new Error('upstream down'); } });
    assert.equal(out.stale, true);
    assert.equal(out.refreshError, 'upstream down');
    assert.deepEqual(out.items, good.items);
  });

  test('listing pages are read one at a time, and the full walk dedupes', async () => {
    lib.store().clear();
    const page1 = fixture('piratexplay-listing.html');
    const one = '<html><body><ul class="post-lst"><li class="post series"><article class="post dfx fcl series"><header class="entry-header"><h2 class="entry-title">Clevatess</h2></header><a href="/series/clevatess-season-1-258348" class="lnk-blk"></a></article></li></ul><ul id="w" class="post-lst"><li class="post series"><article class="post dfx fcl series"><header class="entry-header"><h2 class="entry-title">Widget Only</h2></header><a href="/series/widget-only-999" class="lnk-blk"></a></article></li></ul></body></html>';
    const fetchImpl = stubFetch([
      ['/language/tamil/page/4', '<html><body><ul class="post-lst"></ul></body></html>'],
      ['/language/tamil/page/', one],
      ['/language/tamil', page1],
    ]);
    const env = { ANIME_TAMIL_BASE_URL: BASE };
    const first = await lib.loadListing({ page: 1, fetchImpl, env, now: Date.now() });
    assert.equal(first.items.length, 6);
    assert.equal(first.page, 1);
    assert.ok(first.hasNext);
    assert.ok(first.generatedAt);

    const second = await lib.loadListing({ page: 2, fetchImpl, env, now: Date.now() });
    assert.equal(second.items.length, 1, 'page 2 contributes its own single card');
    assert.equal(second.page, 2);
    assert.ok(second.maxPage >= 2, 'a page beyond the source hint still counts');

    const walk = await lib.loadListing({ all: true, fetchImpl, env, now: Date.now() });
    assert.equal(walk.all, true);
    assert.equal(walk.items.length, 6, 'the duplicate card on page 2 is one title, and the widget grid never counts');
    assert.ok(!walk.items.some((item) => item.title === 'Widget Only'));
    assert.equal(walk.pagesFetched, 3, 'page 4 answered empty, so the walk stopped there and not at the widget’s hint');
    assert.equal(walk.complete, true);
    assert.equal(walk.maxPage, 3, 'the page count it reports is the count it read');
  });
});

describe('the view helpers', () => {
  const episode = {
    sources: [
      { id: 'opt-0', label: 'PirateXPlay CDN', ok: false, note: 'built by script', streams: [] },
      { id: 'opt-12', label: 'Vidmoly', ok: true, streams: [{ url: 'https://x/a.m3u8' }] },
    ],
    playable: [{ id: 'opt-12', label: 'Vidmoly', url: 'https://x/a.m3u8', streams: [{ url: 'https://x/a.m3u8' }], poster: 'https://x/a.jpg' }],
    open: `${BASE}/episode/a-1x1/`,
  };

  test('counts and the filter are over what has loaded', () => {
    const items = [{ kind: 'series' }, { kind: 'series' }, { kind: 'movie' }];
    assert.deepEqual(view.kindCounts(items), { series: 2, movie: 1 });
    assert.equal(view.filterByKind(items, 'movie').length, 1);
    assert.equal(view.filterByKind(items, 'all').length, 3);
    assert.equal(view.filterByKind(items, 'nonsense').length, 3, 'an unknown chip changes nothing');
  });

  test('episodes group by season and are labelled for a screen', () => {
    const groups = view.seasonGroups([
      { id: '1x2', season: 1, episode: 2, title: 'Two' },
      { id: '2x1', season: 2, episode: 1, title: 'One' },
      { id: 'movie', season: 0, episode: 0, title: 'The Film' },
    ]);
    assert.deepEqual(groups.map((row) => row.label), ['Episodes', 'Season 1', 'Season 2']);
    assert.equal(view.episodeTag({ season: 1, episode: 3 }), 'S1 · E3');
    assert.equal(view.episodeLabel({ season: 0, episode: 0, title: 'The Film' }), 'The Film');
  });

  test('every server row is shown, playable or not, and the lineup is only playable ones', () => {
    const rows = view.sourceRows(episode);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].canPlay, false);
    assert.equal(rows[1].canPlay, true);
    assert.deepEqual(view.playerLineup(episode.playable), [{ url: 'https://x/a.m3u8', label: 'Vidmoly', kind: 'hls', format: 'HLS', warn: '' }]);
    assert.deepEqual(view.playerLineup([{ url: 'https://cdn/x.mp4', label: 'Files', kind: 'direct' }]),
      [{ url: 'https://cdn/x.mp4', label: 'Files', kind: 'direct', format: 'Direct file', warn: '' }],
      'a progressive file is not offered to the HLS engine, and the menu does not call it HLS');
    assert.equal(view.playerLineup([{ label: 'broken' }]).length, 0, 'a row with no address is not a source');
    assert.match(view.playerLineup([{ url: 'https://cdn3.turboviplay.com/a/x.m3u8', label: 'TurboVid', warn: 'segments say nothing' }])[0].warn, /segments say nothing/,
      'a host that publishes the manifest but not the segments says so under the player');
    assert.equal(lib.streamWarning({ url: 'https://box-1449-v10.vmbox.space/hls2/a.m3u8', via: 'vidmoly' }), '', 'Vidmoly is not suspected of anything');
    assert.match(lib.streamWarning({ via: 'PirateXPlay server 3 → turbovid' }), /plays on the source page/);
  });

  test('the count line is composed from the grid, not from the last response', () => {
    const items = [
      { kind: 'series', path: '/series/a' }, { kind: 'series', path: '/series/b' }, { kind: 'movie', path: '/movies/c' },
    ];
    const now = Date.parse('2026-09-11T12:00:00Z');
    const plain = view.summaryLine({ items, shown: 3, page: 2, maxPage: 13, generatedAt: now, now });
    assert.equal(plain, '3 titles loaded · 2 series · 1 film · page 2 of ≥13 · read 17:30:00 IST');
    assert.match(view.summaryLine({ items, shown: 1, page: 1, maxPage: 1, generatedAt: now, now }), /3 titles loaded · 1 shown/,
      'a filter chip is reported as what is on screen');
    assert.match(view.summaryLine({ items, page: 14, maxPage: 14, all: true, complete: true, generatedAt: now, now }), /all 14 pages/);
    assert.match(view.summaryLine({ items, page: 60, maxPage: 60, all: true, complete: false, generatedAt: now, now }), /first 60 pages/,
      'an unfinished walk is never called the whole list');
    assert.match(view.summaryLine({ items, page: 1, maxPage: 1, query: 'naruto', generatedAt: now, now }), /search “naruto”/);
    assert.match(view.summaryLine({ items, page: 1, maxPage: 1 }), /read — /);
  });

  test('the resume key and the honest lines', () => {
    assert.equal(view.watchKeyFor('/episode/clevatess-season-1-258348-1x1/'), 'anime-tamil:/episode/clevatess-season-1-258348-1x1/');
    assert.equal(view.watchKeyFor('https://piratexplay.cc/episode/x/'), 'anime-tamil:/episode/x/');
    assert.match(view.pageHint({ page: 2, maxPage: 13, hasNext: true }), /page 2 of ≥13 — more on request/);
    assert.equal(view.pageHint({ all: true, maxPage: 14 }), 'the whole 14-page list');
    assert.match(view.unavailableNote({ sources: [{ id: 'a', ok: false, note: 'no resolver for this host' }] }), /no resolver for this host/);
    assert.match(view.unavailableNote({ sources: [] }), /lists no servers/);
  });
});

describe('the page surface', () => {
  test('a failed address walks the rest of the resolved list instead of dying on screen', () => {
    assert.match(component, /on=\{\{ onError: \(info\) => stepToNextSource\(info\?\.message\) \}\}/);
    assert.match(component, /const remaining = lineup\.filter\(\(entry\) => entry\.url && !triedRef\.current\.includes\(entry\.url\)\)/);
    assert.match(component, /setPlayState\('failed'\)/);
    assert.match(component, /Every address this episode offered was tried/);
  });

  test('nothing on this page is an embed', () => {
    assert.ok(!/<iframe|embedUrl|dangerouslySetInnerHTML/.test(component), 'no iframe, no raw html');
    assert.ok(!/["'`]https?:\/\/piratexplay\.cc/.test(component), 'the grid hardcodes no upstream origin: every address arrives from our own route');
    assert.ok(/JashPlayer/.test(component), 'playback goes through the app’s own player');
    assert.ok(/createDirectPolicy\(playing\.url/.test(component), 'a resolved manifest, no header tricks');
    assert.match(component, /library=\{\{ watchKey: playing\.watchKey, entry: playing\.entry \}\}/, 'resume needs the entry, or the row is titled Untitled');
    assert.match(component, /provider: 'anime-tamil'/);
    assert.match(component, /season: Number\(row\?\.season\) \|\| 0/);
    assert.match(component, /rememberInUrl\(parent\?\.path, row\.path\)/, 'the resume link names the episode');
    assert.ok(!/onPickSource:\s*\(\)\s*=>\s*\{\s*\}/.test(component));
  });

  test('a list of elements is joined by markup, never by Array.join', () => {
    // `{rows.map(el => <a/>).join(' · ')}` renders a sentence of [object Object]s, and no test that only
    // reads the DOM string would notice. Joins in this file may only ever be over filtered strings.
    const joins = component.match(/\.join\(/g) || [];
    const onStrings = component.match(/filter\(Boolean\)\.join\(/g) || [];
    assert.equal(joins.length, onStrings.length, 'a join that is not over strings is stringifying React elements');
    assert.match(component, /\{index \? ' · ' : ''\}/);
  });

  test('the resume owner is the card, because the card is what has a path', () => {
    assert.match(component, /playEpisodeRef\.current\?\.\(wanted, item\)/);
  });

  test('the source is offered in app wherever a row cannot play', () => {
    assert.match(component, /sourceHref\(\)/, 'the sheet hands over an in-app link, not only a tab');
    assert.match(component, /\/anime\/tamil\/source\?u=/);
    assert.match(component, /open their page in app/, 'the exhausted state leads with the frame, not with a dead player');
    assert.match(component, /open raw/, 'and the raw page stays one click away');
    assert.match(component, /unavailableNote/);
  });

  test('the player box has a height that does not depend on goodwill', () => {
    const rule = css.slice(css.indexOf('.jv-an-player {'), css.indexOf('.jv-an-player-el'));
    assert.match(rule, /flex: 0 0 auto/, 'a column flex body resolves an aspect-ratio-only child to 0 px — measured, not theorised');
    assert.match(rule, /min-height: 120px/, 'and the floor means it can never be invisible again');
    assert.match(rule, /aspect-ratio: 16 \/ 9/);
  });

  test('the rail is rendered, not only cleared for', () => {
    assert.match(component, /import RailNav from '@\/components\/rail\/RailNav'/);
    assert.match(component, /<RailNav \/>\n\s*<main className="jv-an-page jv-rail-shift">/, 'the nav sits before the page that reserves space for it');
  });

  test('the rail clearance stays on its own class', () => {
    assert.match(component, /className="jv-an-page jv-rail-shift"/);
    assert.ok(!/\.jv-an-page\s*\{[^}]*padding-left/s.test(anCss), 'a padding-left here would fight .jv-rail-shift');
    assert.ok(!/\.jv-an-page\s*\{[^}]*padding:/s.test(anCss), 'no padding shorthand on that element either');
  });

  test('the stylesheet obeys the house rules', () => {
    assert.ok(anCss.startsWith('/* '), 'the block comment should be found, not the whole file');
    assert.ok(anCss.includes('.jv-an-grid'), 'the anime block should be in globals.css');
    assert.ok(!anCss.includes('.jv-sp-page'), 'and it must stop before the next surface');
    // `html.day-mode main { color:#102018 !important }` beats any inherited colour, so text in this
    // block that stays light-on-dark has to say so itself — otherwise day mode paints it on black.
    for (const sel of ['.jv-an-title', '.jv-an-sheet-title', '.jv-an-kicker', '.jv-an-line', '.jv-an-card', '.jv-an-ep', '.jv-an-src', '.jv-an-h', '.jv-an-note']) {
      const rule = anCss.match(new RegExp(`\\n${sel.replace(/[.]/g, '\\$&')}(?![\\w-])[^{]*\\{([^}]*)\\}`));
      assert.ok(rule, `${sel} should have its own rule`);
      assert.match(rule[1], /color:/, `${sel} must name a colour, or the day-mode blanket paints it dark-on-dark`);
    }

    // Prose in the banner is allowed to say the forbidden word; declarations are not.
    const anCode = anCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!anCode.includes('!important'));
    const sizes = [...anCode.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    assert.ok(sizes.length > 10);
    assert.ok(Math.min(...sizes) >= 11, `smallest font is ${Math.min(...sizes)}px`);
  });

  test('day mode flips the page by flipping its variables', () => {
    // Every rule in the block reads --an-*, so a theme that only recolours the body leaves a white
    // form field floating on a dark board. The flip has to be at the variables, and it has to reach
    // the surfaces (bg/panel/line) as well as the ink.
    const day = css.match(/html\.day-mode \.jv-an-page\s*\{([\s\S]*?)\n\}/);
    assert.ok(day, 'the anime page names its own day-mode variables');
    for (const name of ['--an-bg', '--an-panel', '--an-panel-2', '--an-ink', '--an-dim', '--an-line', '--an-accent']) {
      assert.ok(day[1].includes(`${name}:`), `${name} is missing from the day block`);
    }
    assert.match(day[1], /--an-ink: #[0-3][0-9a-f]/i, 'day ink has to be dark or the text disappears');
    const night = css.match(/^\.jv-an-page \{([\s\S]*?)\n\}/m);
    assert.ok(night && /--an-ink: #[e-f]/i.test(night[1]), 'night ink stays light');
    assert.ok(!/html\.day-mode \.jv-an[^}]*!important/.test(css), 'a day-mode override must win by specificity, not by !important');
  });

  test('the tab exists on both shells, and the dock prints the short name', () => {
    assert.match(navItems, /href: '\/anime\/tamil', label: 'Tamil anime', short: 'Tamil'/);
    assert.match(dock, /\{item\.short \|\| item\.label\}/);
  });

  test('the two new routes are rate limited, the fan-out one tighter', () => {
    assert.match(middleware, /\/api\/anime\/tamil\/play', limit: 30/);
    assert.match(middleware, /\/api\/anime\/tamil', limit: 60/);
    assert.ok(middleware.indexOf('/api/anime/tamil/play') < middleware.indexOf("/api/anime/tamil',"), 'the specific prefix must be tested first');
  });

  test('the new files are inside the linted surface and the base URL is documented', () => {
    assert.match(pkg.scripts['lint:player'], /lib\/animeTamilFeed\.js/);
    assert.match(pkg.scripts['lint:player'], /components\/anime/);
    assert.match(envExample, /ANIME_TAMIL_BASE_URL/);
  });
});

after(() => { lib.store().clear(); 
});

describe('the render path', () => {
  test('a hook dependency never reaches for a const declared below it', () => {
    // The class of bug a unit test cannot see: a dep array is read during render, so
    // `useCallback(fn, [late])` where `late` is declared further down throws before anything paints.
    const lines = component.split('\n');
    const declaredAt = new Map();
    lines.forEach((line, index) => {
      for (const m of line.matchAll(/const (?:\[|\{)?\s*([A-Za-z_$][\w$]*)/g)) {
        if (!declaredAt.has(m[1])) declaredAt.set(m[1], index);
      }
    });
    const offenders = [];
    lines.forEach((line, index) => {
      const deps = line.match(/^\s*\},?\s*\[([^\]]*)\]\s*,?\s*\);?\s*$/);
      if (!deps) return;
      for (const name of deps[1].split(',').map((part) => part.trim()).filter(Boolean)) {
        if (/^\w+$/.test(name) && declaredAt.has(name) && declaredAt.get(name) > index) {
          offenders.push(`${name} used at line ${index + 1}, declared at ${declaredAt.get(name) + 1}`);
        }
      }
    });
    assert.deepEqual(offenders, []);
  });
});

describe('the in-app source view', () => {
  const sourceComponent = readFileSync(path.join(root, 'components', 'anime', 'AnimeTamilSource.jsx'), 'utf8');
  const sourcePage = readFileSync(path.join(root, 'app', 'anime', 'tamil', 'source', 'page.js'), 'utf8');
  const sourceRoute = readFileSync(path.join(root, 'app', 'api', 'anime', 'tamil', 'page', 'route.js'), 'utf8');

  const theirPage = `<html><head>
    <meta property="og:title" content="Clevatess 1x1 | PirateXPlay">
    <meta http-equiv="refresh" content="12;url=https://pop.example/x">
    <script src="https://piratexplay.cc/wp-includes/their-player.js"></script>
    <script src="https://bysezejataos.com/a.js"></script>
    <script>document.write('<iframe src="//pop.example/u"></iframe>');</script>
    <script>window.open('https://ad.example/popup')</script>
  </head><body onbeforeunload="return 'stay'">
    <header class="hdt">their nav and a banner</header>
    <section class="section player"><iframe src="https://vidmoly.net/embed-ohe1lchzz4ag.html"></iframe></section>
    <iframe src="https://pop.example/under"></iframe>
    <a href="/episode/clevatess-season-1-258348-1x1/">next</a>
    <a href="https://piratexplay.cc/series/clevatess-season-1-258348/">series</a>
    <a href="https://tmdb.org/movie/1" target="_blank">tmdb</a>
  </body></html>`;

  test('their ad machinery is gone before the bytes reach the browser', () => {
    const out = lib.sanitizeSourcePage(theirPage, { base: 'https://piratexplay.cc', path: '/episode/x/' });
    assert.match(out.html, /<base href="https:\/\/piratexplay\.cc\/">/, 'relative assets still resolve');
    assert.ok(!/bysezejataos\.com\/a\.js/.test(out.html), 'the ad script tag is dropped');
    assert.ok(!/window\.open\(/.test(out.html), 'the pop-under inline script is dropped');
    assert.ok(!/document\.write\(/.test(out.html), 'the iframe-writing inline script is dropped');
    assert.ok(!/http-equiv=.{0,3}refresh/i.test(out.html), 'a meta refresh cannot bounce our frame');
    assert.ok(!/onbeforeunload/i.test(out.html), 'their "stay on this page" handler is gone');
    assert.ok(!/pop\.example\/under/.test(out.html), 'the framed ad is gone too');
    assert.equal(out.dropped, 4, 'one ad script, one inline popper, one window.open, one ad iframe');
    assert.ok(/vidmoly\.net\/embed-/.test(out.html), 'the player embed is exactly what we came for');
    assert.ok(/their-player\.js/.test(out.html), 'their own script is left alone');
  });

  test('links stay in the app when they are on the site, and honest when they are not', () => {
    const out = lib.sanitizeSourcePage(theirPage, { base: 'https://piratexplay.cc', path: '/episode/x/' });
    assert.equal(out.stats.links, 2, 'the two same-site links are ours to rewrite');
    assert.match(out.html, /href="\/api\/anime\/tamil\/page\?u=%2Fepisode%2Fclevatess-season-1-258348-1x1%2F"/);
    assert.match(out.html, /data-jv-internal="1"/);
    assert.match(out.html, /href="https:\/\/tmdb\.org\/movie\/1"[^>]*target="_blank"/, 'off-site keeps its target but not our frame');
    assert.match(out.html, /data-jv-offsite="1"/);
    assert.match(out.html, /rel="noopener noreferrer nofollow"/);
  });

  test('the chrome we hide is hidden by a stylesheet, and the counter is honest', () => {
    const out = lib.sanitizeSourcePage(theirPage, { base: 'https://piratexplay.cc', path: '/x' });
    assert.match(out.html, /<style>\n\s*\/\* Their chrome/);
    assert.match(out.html, /header,footer,#colophon/);
    assert.match(out.html, /\[class\*="banner"/, 'their ad slots are hidden by name, not by luck');
    assert.match(out.html, /parent\.postMessage\(/, 'the toolbar learns the blocked count from the frame');
    assert.equal(out.title, 'Clevatess 1x1', 'og:title minus their site name');
    assert.ok(out.size > 0 && out.size < theirPage.length + 4000);
  });

  test('a playlist is read line by line, preferring the suffix that means something', () => {
    assert.equal(lib.firstUri('#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nseg-7\n', /\.ts(\?|$)/i), 'seg-7');
    assert.equal(lib.firstUri('#EXTM3U\nindex-v1-a1.m3u8\nseg-1.ts\n', /\.m3u8(\?|$)/i), 'index-v1-a1.m3u8');
    assert.equal(lib.firstUri('#EXTM3U\n'), '', 'a playlist with nothing in it has nothing to fetch');
  });

  test('a row is only playable when a browser could fetch it', async () => {
    const variant = '#EXTM3U\n#EXT-X-TARGETDURATION:20\n#EXTINF:10.0,\nseg-1-v1-a1.ts\n';
    const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=877444,RESOLUTION=1280x720\nindex-v1-a1.m3u8\n';
    const ok = await lib.probeStream('https://cdn.example/hls/a/master.m3u8?t=1', {
      fetchImpl: stubFetch([['master.m3u8', master], ['index-v1-a1.m3u8', variant], ['seg-1-v1-a1.ts', '\u0000']]),
    });
    assert.deepEqual(ok, { ok: true, via: 'hls' });
    const noCors = await lib.probeStream('https://cdn.example/hls/a/master.m3u8', {
      fetchImpl: stubFetch([
        ['master.m3u8', { body: master, headers: { 'access-control-allow-origin': null } }],
        ['index-v1-a1.m3u8', { body: variant, headers: { 'access-control-allow-origin': null } }],
        ['seg-1-v1-a1.ts', { body: '\u0000', headers: { 'access-control-allow-origin': null } }],
      ]),
    });
    assert.equal(noCors.ok, false);
    assert.match(noCors.why, /refuses a cross-origin read/, 'this is the failure that used to look like a player that hangs');
    // The stub answers any plausible playlist on purpose, so a dead stream has to say so itself.
    const dead = await lib.probeStream('https://cdn.example/gone.m3u8', { fetchImpl: stubFetch([['gone.m3u8', { body: '', status: 404 }]]) });
    assert.match(dead.why, /did not answer/);
    // A progressive file is playable too — it just must not be handed to the HLS engine.
    const media = await lib.probeStream('https://cdn.example/files/a.mp4', {
      fetchImpl: stubFetch([['a.mp4', { body: '\u0000\u0001', status: 206 }]]),
    });
    assert.deepEqual(media, { ok: true, via: 'progressive' }, 'one vocabulary: the feed, the probe and the player all say progressive');
    assert.equal(lib.playKindFor({ url: 'https://c/a', proven: 'progressive' }), 'direct');
    assert.equal(lib.playKindFor({ url: 'https://c/a', proven: 'hls' }), 'hls');
  });

  test('one host page is read a few times, and every distinct edge survives', async () => {
    const page = (host) => `<html><body><script>var player=videojs("x");sources:[{file:'https://${host}/hls2/04/01902/ohe1lchzz4ag_n/master.m3u8?t=1&e=43200'}]</script></body></html>`;
    let hit = 0;
    const pages = [page('box-1449-v10.vmbox.space'), page('gate-1-an.vmnow.online'), page('box-1449-v10.vmbox.space')];
    const fetchImpl = async (url) => {
      hit += 1;
      const body = String(url).includes('embed-') ? pages[Math.min(hit - 1, pages.length - 1)] : '';
      return { ok: true, status: 200, headers: { get: () => null }, async text() { return body; } };
    };
    const row = await lib.resolveServer({ id: 'opt-6', url: 'https://vidmoly.net/embed-ohe1lchzz4ag.html', host: 'vidmoly.net', label: 'Vidmoly', type: 'embed' }, { fetchImpl });
    assert.equal(row.ok, true);
    assert.equal(row.streams.length, 2, 'two distinct CDN origins, not three looks at one');
    assert.deepEqual(row.streams.map((stream) => stream.label), ['Edge 1 (HLS)', 'Edge 2 (HLS)'],
      'two CDN origins of one host are two rows the ladder can walk, named as that');
    assert.equal(row.label, 'Vidmoly', 'the host keeps its own name');
    assert.equal(hit, 3, 'it stops probing once the edges run out of budget, not after every page');
  });

  test('a host that never answers is said so, not silently dropped', async () => {
    const row = await lib.resolveServer(
      { id: 'opt-9', url: 'https://vidmoly.net/embed-zzz.html', host: 'vidmoly.net', label: 'Vidmoly', type: 'embed' },
      { fetchImpl: async () => ({ ok: false, status: 503, headers: { get: () => null }, async text() { return ''; } }) },
    );
    assert.equal(row.ok, false);
    assert.match(row.note, /Vidmoly did not answer/);
  });

  test('loadEpisode keeps only what it could fetch, and says what the rest did', async () => {
    // A page of their own shape: two hosts that resolve, two that refuse, one rotator that is refused outright.
    const episode = fixture('piratexplay-episode.html').replace(
      /<div class="option dfx" id="opt-4" data-src="https:\/\/turbovidhls\.com\/t\/[0-9a-f]+"><\/div>/,
      '<div class="option dfx" id="opt-4" data-src="https://turbovidhls.com/t/badbadbaddbadd1/"></div>',
    );
    const good = "<html><body><script>sources:[{file:'https://box-a.vmbox.space/hls2/04/01902/a/master.m3u8?t=1'}]</script></body></html>";
    const bad = "<html><body><script>sources:[{file:'https://box-b.vmbox.space/hls2/04/01902/b/master.m3u8?t=1'}]</script></body></html>";
    const playlist = (name) => `#EXTM3U\n#EXT-X-TARGETDURATION:20\n#EXTINF:10.0,\n${name}\n`;
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes('/episode/')) return { ok: true, status: 200, headers: { get: () => null }, async text() { return episode; } };
      if (href.includes('box-a')) {
        const body = href.includes('seg') ? '\u0000' : (href.includes('index') ? playlist('seg-a.ts') : `#EXTM3U\nindex-a.m3u8\n`);
        return { ok: true, status: 200, headers: { get: (n) => (String(n).toLowerCase() === 'access-control-allow-origin' ? '*' : null) }, async text() { return body; } };
      }
      if (href.includes('vidmoly')) return { ok: true, status: 200, headers: { get: () => null }, async text() { return good; } };
      if (href.includes('turbovid')) return { ok: true, status: 200, headers: { get: () => null }, async text() { return bad; } };
      // box-b answers, but never with a cross-origin header — the shape that used to hang
      if (href.includes('box-b')) return { ok: true, status: 200, headers: { get: () => null }, async text() { return href.includes('seg') ? '\u0000' : (href.includes('index') ? playlist('seg-b.ts') : '#EXTM3U\nindex-b.m3u8\n'); } };
      return { ok: false, status: 404, headers: { get: () => null }, async text() { return ''; } };
    };
    lib.store().clear();
    const out = await lib.loadEpisode({ path: '/episode/verified-only-1x1/', fetchImpl, env: { ANIME_TAMIL_BASE_URL: BASE }, now: Date.now() });
    lib.store().clear();
    assert.equal(out.episode.playable.length, 1, 'only the host whose bytes are fetchable is offered to the player');
    assert.equal(out.episode.playable[0].proven, 'hls');
    const refused = out.episode.sources.find((row) => row.label === 'TurboVid');
    assert.equal(refused.ok, false, 'the row stays listed, with what it did');
    assert.match(refused.note, /cross-origin read/);
    assert.equal(out.episode.needsSourceView, false, 'something plays, so the frame is an option and not the door');
  });

  test('the frame loads a page we sanitized, and refuses anything else', async () => {
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      return { ok: true, status: 200, headers: { get: () => 'text/html; charset=utf-8', ...{} }, async text() { return theirPage; } };
    };
    const first = await lib.loadSourcePage({ path: '/episode/x-1x1/', env: { ANIME_TAMIL_BASE_URL: BASE }, now: Date.now() });
    assert.equal(first.ok, true);
    assert.match(first.html, /<base href=/);
    assert.equal(first.dropped, 4);
    const second = await lib.loadSourcePage({ path: '/episode/x-1x1/', env: { ANIME_TAMIL_BASE_URL: BASE }, now: Date.now() + 1000 });
    assert.equal(second.cached, true, 'one document per window, like everything else here');
    assert.equal(calls, 1, 'the cache is the reason the free tier survives this page');
    const forced = await lib.loadSourcePage({ path: '/episode/x-1x1/', force: true, env: { ANIME_TAMIL_BASE_URL: BASE }, now: Date.now() + 2000 });
    assert.equal(forced.cached, false);
    assert.equal(calls, 2);
    lib.store().clear();
  });

  test('the proxy is not a general URL fetcher, and not a file size contest', async () => {
    const refused = await lib.loadSourcePage({ path: 'https://intranet.example/admin', env: { ANIME_TAMIL_BASE_URL: BASE } });
    assert.equal(refused.ok, false);
    assert.match(refused.error, /only a path on the source site/);
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: { get: (n) => (String(n).toLowerCase() === 'content-length' ? String(2_000_000) : 'text/html') }, async text() { return 'x'.repeat(10); } });
    const huge = await lib.loadSourcePage({ path: '/series/big/', env: { ANIME_TAMIL_BASE_URL: BASE }, now: Date.now() });
    assert.equal(huge.ok, false);
    assert.match(huge.error, /larger than a page should be/);
    lib.store().clear();
  });

  test('the response is framed by us and by nobody else, in an opaque origin', () => {
    assert.match(sourceRoute, /'x-frame-options': 'SAMEORIGIN'/);
    assert.match(sourceRoute, /content-security-policy/, 'the header is the point of this route');
    assert.match(sourceRoute, /sandbox allow-scripts allow-forms allow-pointer-lock/, 'their scripts run as a stranger to our storage');
    assert.match(sourceRoute, /default-src 'none'/, 'nothing loads unless a later directive opens it');
    assert.match(sourceRoute, /frame-src https:/, 'the player embed is allowed, the ad networks are not');
    assert.match(sourceRoute, /form-action 'none'/, 'their forms cannot post to us');
    assert.match(sourceRoute, /frame-ancestors 'self'/, 'and CSP says it too, which is what modern browsers obey');
    assert.ok(!/manifest '/.test(sourceRoute), 'a directive without -src is a console error, not a policy');
    assert.match(sourceRoute, /x-jash-dropped/, 'the toolbar count is carried by the response');
    assert.match(sourceRoute, /escapeHtml\(/, 'the failure note cannot smuggle markup');
  });

  test('the frame itself is only ever our own sanitized document', () => {
    assert.match(sourceComponent, /src=\{src\}/);
    assert.match(sourceComponent, /\/api\/anime\/tamil\/page\?\$\{params\.toString\(\)\}/);
    assert.ok(!/<iframe[^>]*src="https?:/.test(sourceComponent), 'no raw upstream document is ever framed');
    assert.match(sourceComponent, /sandbox="allow-scripts allow-forms allow-pointer-lock"/, 'belt and braces next to the header');
    assert.match(sourceComponent, /event\.origin !== window\.location\.origin && event\.origin !== 'null'/, 'a sandboxed frame speaks from "null"');
    assert.match(sourceComponent, /data\.kind !== 'jv-source'/);
    assert.match(sourceComponent, /import RailNav from '@\/components\/rail\/RailNav'/, 'the rail is here too, which was the request');
    assert.match(sourceComponent, /className="jv-an-page jv-an-source jv-rail-shift"/);
    assert.match(sourceComponent, /open raw <span aria-hidden="true">↗<\/span>/, 'and the unstripped page stays one honest click away');
    assert.ok(!/dangerouslySetInnerHTML|localStorage/.test(sourceComponent), 'the frame never touches our storage from here');
  });

  test('the route validates ?u= before anything is fetched', () => {
    assert.match(sourcePage, /openPath\(wanted, \{ base, kind: 'page' \}\)/);
    assert.match(sourcePage, /: '\/language\/tamil';/, 'a bad or missing u lands on the list, not on an error page');
    assert.match(sourcePage, /import \{ baseUrl, openPath, seasonEpisodeFromHref \} from '@\/lib\/animeTamilFeed'/);
    assert.match(sourcePage, /export const dynamic = 'force-dynamic'/);
  });

  test('the frame is allowed by the app’s own header rules, and only here', () => {
    const config = readFileSync(path.join(root, 'next.config.mjs'), 'utf8');
    assert.ok(config.includes("source: '/api/((?!anime/tamil/page).*)',"), 'the blanket API rule steps aside for the proxy');
    assert.match(config, /source: '\/api\/anime\/tamil\/page'[\s\S]{0,120}key !== 'X-Frame-Options'/, 'and the proxy gets the rest of them');
    assert.ok(!/source: '\/api\/:path\*'/.test(config), 'the old catch-all is gone, or it would beat the route header');
  });

  test('the toolbar says what the row said, not what the slug says', () => {
    assert.match(sourcePage, /seasonEpisodeFromHref/, 'the S·E pair comes from the same parser the grid uses');
    assert.match(sourcePage, /` · S\$\{season\} · E\$\{episode\}`/);
    assert.match(sourcePage, /-\\d\{4,\}\$\(\)?|\/\^?-\\d\{4,\}\$\//, 'the TMDB id is not part of a title');
    assert.match(sourceComponent, /\\b\(\\d\{1,2\}\)x\(\\d\{1,3\}\)\\b/, 'and 1x18 in their own <title> becomes S1 · E18');
  });

  test('“back one page” only ever moves their frame', () => {
    assert.match(sourceComponent, /if \(seenRef\.current\.length < 2\) return;/, 'no frame history, no navigation');
    assert.ok(!/if \(typeof window !== 'undefined'\) window\.history\.back\(\)/.test(sourceComponent),
      'and it must not fall through to the app’s own history');
    assert.match(sourceComponent, /disabled=\{!canStepBack\}/);
    assert.match(sourceComponent, /their page has not moved yet/);
    assert.match(readFileSync(path.join(root, 'lib', 'animeTamilFeed.js'), 'utf8'), /path: location\.search/, 'the frame reports where it is, which is what the depth counts');
  });

  test('a frame that never answers admits it', () => {
    assert.match(sourceComponent, /timedOut: false/);
    assert.match(sourceComponent, /setTimeout\(\(\) => setFrame\(\(previous\) => \(previous\.loaded \? previous : \{ \.\.\.previous, timedOut: true \}\)\), 6000\)/);
    assert.match(sourceComponent, /their page did not reply — if this is blank, their site refused the read/);
    assert.match(sourceComponent, /is their document, not ours/, 'the note states the limit of what we stripped');
    assert.match(css, /\.jv-an-note a \{ color: var\(--an-accent\)/, 'and the link inside it is readable in day mode');
    assert.match(css, /\.jv-an-src-tools \.jv-an-btn:disabled \{ cursor: not-allowed/, 'inert, not loading'); 
  });

  test('the tab, the rate limit and the stylesheet hold the line', () => {
    const nav = readFileSync(path.join(root, 'components', 'navItems.js'), 'utf8');
    assert.match(nav, /emoji: '🏴‍☠️'/, 'the pirate flag is on the Tamil entry');
    assert.ok(!nav.includes('🎌'), 'and the old one is gone, not kept as a fallback');
    const middleware = readFileSync(path.join(root, 'middleware.js'), 'utf8');
    assert.ok(middleware.indexOf("'/api/anime/tamil/page'") < middleware.indexOf("'/api/anime/tamil'"), 'the specific prefix must be tested first');
    assert.match(middleware, /'\/api\/anime\/tamil\/page', limit: 20/);
    const block = css.slice(css.indexOf('.jv-an-src-frame'));
    assert.match(block, /height: clamp\(460px, calc\(100dvh - 190px\), 1200px\)/, 'a frame with no height is a blank box');
    assert.ok(!/!important/.test(block.slice(0, 2400)), 'the house rule still applies here');
  });
});

describe('the browser’s own pre-flight', () => {
  const PROBE = () => import('@/lib/animeTamilProbe.js');

  test('a playlist is walked the way the player will walk it', async () => {
    const { firstUriOfPlaylist } = await PROBE();
    assert.equal(firstUriOfPlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:8\n#EXTINF:8,\nseg-1.ts\n'), 'seg-1.ts');
    assert.equal(firstUriOfPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex-v1.m3u8\n'), 'index-v1.m3u8');
    assert.equal(firstUriOfPlaylist('#EXTM3U\n'), '', 'nothing to fetch is not a guess');
    assert.equal(firstUriOfPlaylist('seg-a\n#EXT-X-ENDLIST\n'), 'seg-a', 'a comment is not a segment');
  });

  test('the request is exactly what a browser would make', async () => {
    const { verifyFromBrowser } = await PROBE();
    const seen = [];
    const ok = await verifyFromBrowser('https://cdn.example/hls/a/master.m3u8', {
      fetchImpl: (url, init) => {
        seen.push({ url, init });
        return Promise.resolve({ ok: true, status: 200, async text() { return '#EXTM3U\n#EXTINF:6,\nseg-1.ts\n'; } });
      },
    });
    assert.equal(ok.ok, true);
    assert.equal(seen.length, 2, 'the manifest and the segment under it — a playlist with an unreadable segment is not playable');
    assert.match(seen[1].url, /seg-1\.ts$/);
    const init = seen[0].init;
    assert.equal(init.mode, 'cors', 'the same mode hls.js uses, so a refusal here is the real one');
    assert.equal(init.credentials, 'omit', 'no cookies are offered to somebody else’s CDN');
    assert.ok(!Object.keys(init.headers || {}).some((name) => /range/i.test(name)),
      'Range would need a preflight, and a preflight refusal is not evidence about the stream');
    assert.ok(init.signal, 'a tab that stops caring stops the fetch');
  });

  test('a refusal, a timeout and a good address are three different answers', async () => {
    const { verifyFromBrowser } = await PROBE();
    const refused = await verifyFromBrowser('https://cdn.example/x.m3u8', {
      fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    assert.equal(refused.ok, false);
    assert.match(refused.why, /not allowed to fetch/);

    const http403 = await verifyFromBrowser('https://cdn.example/x.m3u8', {
      fetchImpl: () => Promise.resolve({ ok: false, status: 403, async text() { return ''; } }),
    });
    assert.match(http403.why, /answered HTTP 403/, 'the token expired, most likely — and that is said');

    let fired = null;
    const slow = await verifyFromBrowser('https://cdn.example/x.m3u8', {
      timeoutMs: 600,
      fetchImpl: (url, init) => new Promise((_resolve, reject) => {
        fired = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal.addEventListener('abort', fired);
      }),
    });
    assert.equal(slow.ok, null, 'a slow answer is not a dead stream, so it must not disqualify the row');
    assert.match(slow.why, /took too long/);

    const nothing = await verifyFromBrowser('', { fetchImpl: () => Promise.resolve({ ok: true, status: 200 }) });
    assert.equal(nothing.ok, false);
  });

  test('the note tells the truth about what was skipped', async () => {
    const { preFlightNote } = await PROBE();
    assert.equal(preFlightNote([]), '', 'when every address answered, nothing is said about it');
    assert.match(preFlightNote([{ label: 'Vidmoly', ok: false, why: 'answered HTTP 403' }], 'TurboVid'),
      /Vidmoly — answered HTTP 403.*TurboVid is being tried/s);
    assert.match(preFlightNote([{ label: 'TurboVid', ok: null, why: 'took too long' }]),
      /did not answer in time/, 'a timeout is reported as a timeout');
  });

  test('a row states how it must be attached, and the player is told the same', async () => {
    const feed = await import('@/lib/animeTamilFeed.js');
    const episode = fixture('piratexplay-episode.html');
    const hlsPage = "<html><script>sources:[{file:'https://box-a.vmbox.space/hls2/a/master.m3u8'}]</script></html>";
    const mp4Page = "<html><script>sources:[{file:'https://box-b.vmbox.space/files/b.mp4'}]</script></html>";
    const R = (cors, body) => ({ ok: true, status: 200, headers: { get: (n) => (String(n).toLowerCase() === 'access-control-allow-origin' ? cors : null) }, async text() { return body; } });
    const out = await feed.loadEpisode({
      path: '/episode/kind-check-1x1/',
      env: { ANIME_TAMIL_BASE_URL: BASE },
      now: Date.now(),
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.includes('/episode/')) return R(null, episode);
        if (href.includes('vidmoly')) return R(null, hlsPage);
        if (href.includes('turbovid')) return R(null, mp4Page);
        if (href.includes('master.m3u8')) return R('*', '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg-1.ts\n');
        if (href.includes('seg-1.ts')) return R('*', '\u0000\u0001');
        if (href.endsWith('b.mp4')) return R('*', '\u0000\u0001');
        return R(null, '');
      },
    });
    const byLabel = Object.fromEntries((out.episode.playable || []).map((row) => [row.label, row]));
    assert.equal(byLabel.Vidmoly.kind, 'hls', 'a manifest goes through the HLS engine');
    assert.equal(byLabel.TurboVid, undefined, 'every host rule here is manifest-only, so a page without one is refused, not guessed at');
    assert.equal(lib.playKindFor({ url: 'https://c/x.m3u8', proven: 'hls' }), 'hls');
    assert.equal(lib.playKindFor({ url: 'https://c/x.mp4', proven: 'media' }), 'direct');
    assert.equal(lib.playKindFor({ url: 'https://c/files/a.mkv' }), 'direct', 'the URL alone is enough, because the player would rather be told');
    lib.store().clear();
  });
});

describe('the sheet plays what it claims', () => {
  test('nothing is mounted until this browser has fetched the address', () => {
    assert.match(component, /await verifyFromBrowser\(entry2\.url, \{ kind: entry2\.kind \}\)/);
    assert.match(component, /setPlayState\('checking'\)/, 'the row says checking…, which is what is happening');
    assert.match(component, /episodePath === row\.path && \(playState === 'loading' \|\| playState === 'checking'\)/);
    assert.match(component, /if \(playTicketRef\.current !== ticket\) return;/, 'a sheet closed mid-check does not start a player behind the user');
    assert.match(component, /verdict\.ok === null && !slowRow/, 'a timeout is kept as a fallback, not treated as a refusal');
    assert.match(component, /subtitle: `\$\{chosen\.row\.label\} · resolved by this app, fetched by this browser, played in JashPlayer`/);
    assert.match(component, /Checking from this browser that the address can actually be fetched/);
  });

  test('the engine is told the row’s kind, never a guess', () => {
    assert.match(component, /source=\{\{ url: playing\.url, kind: playing\.kind \|\| 'auto'/);
    assert.match(component, /playbackPolicy=\{createDirectPolicy\(playing\.url, \{ kind: playing\.kind \|\| undefined \}\)\}/);
    assert.ok(!/kind: 'hls'/.test(component), 'no hardcoded HLS claim anywhere in the sheet');
    assert.match(component, /kind: next\.kind/, 'both the failover ladder and the source menu keep the kind');
    assert.match(component, /\{checkingNote \? <p className="jv-an-note is-warn">\{checkingNote\}<\/p> : null\}/);
    assert.match(component, /\/\/ A source chosen by hand is not a fallback any more, so the pre-flight warning is stale\./);
    assert.equal((component.match(/setCheckingNote\(''\)/g) || []).length, 5,
      'cleared on open, on close, before the loop, on a manual pick and on a failover — a stale warning under a working player is a lie');
  });
});

describe('the anime section is one destination now', () => {
  test('the TMDB catalogue page, its route and its lib are deleted', async () => {
    const { existsSync } = await import('node:fs');
    for (const gone of ['app/anime/page.js', 'app/api/anime/route.js', 'lib/animeCatalog.js', 'tests/anime-catalog.test.js']) {
      assert.ok(!existsSync(path.join(root, gone)), `${gone} must not exist — “remove” means delete`);
    }
    assert.ok(existsSync(path.join(root, 'app', 'anime', 'tamil', 'page.js')), 'Tamil anime stays');
  });

  test('the nav has one anime entry, and the old URL still means something', async () => {
    const { NAV_ITEMS, isNavItemActive } = await import('@/components/navItems.js');
    const anime = NAV_ITEMS.filter((item) => item.href.startsWith('/anime'));
    assert.deepEqual(anime.map((item) => item.href), ['/anime/tamil'], 'one entry, the Tamil one');
    assert.equal(anime[0].emoji, '🏴‍☠️');
    assert.ok(!NAV_ITEMS.some((item) => item.href === '/anime'), 'no 🌸 entry is left to light up next to it');
    assert.deepEqual(NAV_ITEMS.filter((item) => isNavItemActive(item, '/anime')).map((i) => i.href), [],
      'the dead URL lights nothing — it is the redirect that carries it, not the nav');
    const config = readFileSync(path.join(root, 'next.config.mjs'), 'utf8');
    assert.match(config, /source: '\/anime', destination: '\/anime\/tamil', permanent: false/, 'bookmarks and a stale service worker still land somewhere');
    assert.match(config, /\[\.\.\.SPORTS_REDIRECTS, \.\.\.ANIME_REDIRECT\]/);
  });
});
