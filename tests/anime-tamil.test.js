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
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers || {} });
    for (const [key, body] of routes) {
      if (String(url).includes(key)) return { ok: true, status: 200, async text() { return body; } };
    }
    return { ok: false, status: 404, async text() { return ''; } };
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
    assert.deepEqual(view.playerLineup(episode.playable), [{ url: 'https://x/a.m3u8', label: 'Vidmoly', format: 'HLS', warn: '' }]);
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

  test('the source link is offered wherever a row cannot play', () => {
    assert.match(component, /open on PirateXPlay/);
    assert.match(component, /watch it on the source/);
    assert.match(component, /unavailableNote/);
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
