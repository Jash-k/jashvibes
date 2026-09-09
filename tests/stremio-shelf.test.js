import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {
  SELECTED_KEY,
  SHELF_MAX_PAGES,
  activeFilterCount,
  buildRuler,
  buildShelfQuery,
  catalogKey,
  defaultFilters,
  emptyShelfEntry,
  fetchCatalogPage,
  getDefaultPins,
  markShelfError,
  mergeItems,
  normalizeCatalog,
  readCatalogOptions,
  reduceShelfPage,
  rowKey,
  safeFilters,
  shelfLine,
  supportsExtra,
} from '../lib/stremioShelf.js';

/**
 * The Catalog Shelf (/stremio), built from the picked mock (docs/concepts/stremio-redesign.html, idea 1).
 *
 * The mock's whole argument is that a tab and its chips must describe the same thing the addon was asked
 * for, so these tests measure three things and nothing else:
 *
 *   1. a tab's count is what this device has loaded, never a promised total;
 *   2. a filter is only ever sent when the catalog declares it, and when it is not sent the reason comes
 *      back as `ignored` so the page can say it out loud (this is the old page's real bug: it applied
 *      search/genre/language to every catalog and a catalog that ignored one returned an unfiltered list
 *      under chips that claimed otherwise);
 *   3. one page per press — the loop below drives the same `fetchCatalogPage` the page calls, over HTTP,
 *      against a fixture that behaves like an addon: 25 per page, `hasMore` until the end.
 *
 * The last group pins the shape of the page itself: the ruler is the control surface, the old chrome
 * (addon hero card, select+Add picker, five-field form, chip row with × remove, horizontal rails, embed
 * provider tabs, Home chip, BrandLogo) is gone rather than hidden, and the shelf's dark surface declares
 * its own colours so day mode cannot wash it out.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const MANIFEST = {
  name: 'Fixture Addon',
  version: '9.9.9',
  catalogs: [
    { id: 'tam_movies', type: 'movie', name: 'Tamil Movies', extraSupported: ['skip', 'search', 'genre', 'language', 'sort'] },
    { id: 'tam_series', type: 'series', name: 'Tamil Series', extraSupported: ['skip', 'genre'] },
    { id: 'tel_movies', type: 'movie', name: 'Telugu Movies', extraSupported: [] },
    { id: 'eng_movies', type: 'movie', name: 'English Movies', extraSupported: ['skip', 'sort'] },
    { id: 'weird', type: 'other', name: 'Ignored Type', extraSupported: ['skip'] },
    { id: '', type: 'movie', name: 'No Id', extraSupported: ['skip'] },
    { id: 'tam_movies', type: 'movie', name: 'Tamil Movies Again', extra: [{ name: 'Search' }] },
  ],
};

/* ------------------------------------------------------------------ the manifest, read honestly */

test('only movie and series catalogs survive, de-duplicated, with extras lower-cased', () => {
  const options = readCatalogOptions(MANIFEST.catalogs);
  assert.deepEqual(options.map(catalogKey), ['movie:tam_movies', 'series:tam_series', 'movie:tel_movies', 'movie:eng_movies']);
  assert.equal(options.length, 4, 'a duplicate type:id must not produce a second tab');
  assert.deepEqual(options[0].extraSupported, ['skip', 'search', 'genre', 'language', 'sort']);
});

test('an addon that spells extras as extra:[{name}] is still understood', () => {
  const catalog = normalizeCatalog({ id: 'x', type: 'movie', name: 'X', extra: [{ name: 'Search' }, null, { name: 'skip' }] });
  assert.deepEqual(catalog.extraSupported, ['search', 'skip']);
  assert.equal(normalizeCatalog({ id: 'y', type: 'tv' }).type, 'movie', 'anything but series is a movie to this API');
});

test('the default pins are the addon\'s Tamil pair, and nothing when there is none', () => {
  const options = readCatalogOptions(MANIFEST.catalogs);
  const pins = getDefaultPins(options, { movie: 'tam_movies', series: 'tam_series' });
  assert.deepEqual(pins.map((c) => c.id), ['tam_movies', 'tam_series']);
  assert.deepEqual(getDefaultPins([], {}), []);
  const noNames = [{ id: 'zz', type: 'movie', name: 'Z', extraSupported: [] }];
  assert.deepEqual(getDefaultPins(noNames, {}).map((c) => c.id), ['zz'], 'a single movie catalog is still a tab');
});

test('a row key falls back to a title-derived id so two sources of the same film stay distinct', () => {
  assert.equal(rowKey({ type: 'movie', id: 'tt1' }), 'movie:tt1');
  assert.equal(rowKey({ id: 'tt2' }), 'movie:tt2');
  assert.equal(rowKey({}), 'movie:', 'no id, no row');
});

/* ------------------------------------------------------------------ what a catalog accepts */

test('a filter is supported only under the name the catalog declared, aliases included', () => {
  const full = readCatalogOptions(MANIFEST.catalogs)[0];
  const series = readCatalogOptions(MANIFEST.catalogs)[1];
  const bare = readCatalogOptions(MANIFEST.catalogs)[2];
  assert.equal(supportsExtra(full, 'search').supported, true);
  assert.equal(supportsExtra(full, 'language').supported, true);
  assert.equal(supportsExtra(series, 'search').supported, false, 'Tamil Series declared only skip and genre');
  assert.equal(supportsExtra(series, 'genre').supported, true);
  assert.deepEqual(supportsExtra(bare, 'sort'), { supported: false, declared: false }, 'no extras at all is "unknown", and that is a different answer');
  assert.equal(supportsExtra({ extraSupported: ['query'] }, 'search').supported, true, 'search is also spelled query');
  assert.equal(supportsExtra({ extraSupported: ['lang'] }, 'language').supported, true);
  assert.equal(supportsExtra({ extraSupported: ['order'] }, 'sort').supported, true);
  assert.equal(supportsExtra({ extraSupported: ['genres'] }, 'genre').supported, true);
});

test('the query for a page sends the catalog, the skip, and only accepted filters', () => {
  const options = readCatalogOptions(MANIFEST.catalogs);
  const { query, ignored } = buildShelfQuery({
    catalog: options[0],
    skip: 50,
    filters: { sort: 'Highest Rated', language: 'Tamil', genre: 'Crime', search: 'vikram' },
  });
  const params = new URLSearchParams(query);
  assert.equal(params.get('source'), 'catalog');
  assert.equal(params.get('type'), 'movie');
  assert.equal(params.get('catalog'), 'tam_movies');
  assert.equal(params.get('skip'), '50');
  assert.equal(params.get('sort'), 'Highest Rated');
  assert.equal(params.get('genre'), 'Crime');
  assert.equal(params.get('search'), 'vikram');
  assert.deepEqual(ignored, [], 'this catalog declared every one of those');
});

test('the default sort is not sent, because the shelf does not know how to sort what the addon orders', () => {
  const { query } = buildShelfQuery({ catalog: readCatalogOptions(MANIFEST.catalogs)[0], skip: 0, filters: defaultFilters() });
  assert.ok(!query.includes('sort='), `unsorted must mean silent, got ${query}`);
  assert.ok(!query.includes('search='));
  assert.ok(!query.includes('genre='));
});

test('a filter the catalog cannot honour is refused, reported, and never smuggled into the URL', () => {
  const series = readCatalogOptions(MANIFEST.catalogs)[1];
  const { query, ignored } = buildShelfQuery({ catalog: series, skip: 0, filters: { sort: 'Highest Rated', language: 'Tamil', genre: 'Drama', search: 'suzhal' } });
  const params = new URLSearchParams(query);
  assert.equal(params.get('genre'), 'Drama');
  assert.equal(params.get('sort'), null, 'Tamil Series declares no sort');
  assert.equal(params.get('language'), null, '...nor a language');
  assert.equal(params.get('search'), null, '...nor a search');
  assert.deepEqual(ignored.sort(), ['language', 'search', 'sort'].sort());
});

test('a catalog that declares nothing is read raw, with every active filter reported as ignored', () => {
  const bare = readCatalogOptions(MANIFEST.catalogs)[2];
  const { query, ignored } = buildShelfQuery({ catalog: bare, skip: 0, filters: { language: 'Telugu', genre: 'Drama', search: '', sort: 'IMDb' } });
  assert.ok(!/[?&](search|genre|language|sort)=/.test(`?${query}`), `no filter may be sent: ${query}`);
  assert.ok(ignored.includes('language') && ignored.includes('genre'));
});

test('skipping is never negative and never fractional', () => {
  const { query } = buildShelfQuery({ catalog: { id: 'a', type: 'movie', extraSupported: [] }, skip: -12.7, filters: {} });
  assert.equal(new URLSearchParams(query).get('skip'), '0');
});

test('the filter count is what the chips print, and the default sort is not a filter', () => {
  assert.equal(activeFilterCount(defaultFilters()), 0);
  assert.equal(activeFilterCount({ language: 'Tamil' }), 1);
  assert.equal(activeFilterCount({ language: 'Tamil', genre: 'Drama', search: 'x', sort: 'Highest Rated' }), 4);
  assert.deepEqual(safeFilters({ sort: 42, genre: null, language: undefined, search: 7 }), defaultFilters(), 'junk in localStorage must not become a query');
});

/* ------------------------------------------------------------------ paging state */

test('a page replaces for the first fetch and appends without duplicating across skip boundaries', () => {
  const page1 = { items: [{ id: 'a', type: 'movie' }, { id: 'b', type: 'movie' }], count: 2, hasMore: true, catalogName: 'Tamil Movies' };
  const page2 = { items: [{ id: 'b', type: 'movie' }, { id: 'c', type: 'movie' }], count: 2, hasMore: false };
  let entry = reduceShelfPage(emptyShelfEntry(), page1, { append: false });
  assert.equal(entry.items.length, 2);
  assert.equal(entry.skip, 2, 'the next request asks for what we hold, not what the addon counted');
  assert.equal(entry.pages, 1);
  assert.equal(entry.fetched, true);
  entry = reduceShelfPage(entry, page2, { append: true });
  assert.deepEqual(entry.items.map((item) => item.id), ['a', 'b', 'c'], 'a repeated id must not paint a second card');
  assert.equal(entry.hasMore, false);
  assert.equal(entry.pages, 2);
  const replaced = reduceShelfPage(entry, page1, { append: false });
  assert.deepEqual(replaced.items.map((item) => item.id), ['a', 'b'], 'reload means back to page one');
  assert.equal(replaced.pages, 1);
});

test('a failed reload keeps the rows already on screen', () => {
  const good = reduceShelfPage(emptyShelfEntry(), { items: [{ id: 'x', type: 'movie' }], count: 1, hasMore: true }, { append: false });
  const broken = markShelfError(good, 'gateway timeout');
  assert.deepEqual(broken.items.map((item) => item.id), ['x'], 'an error must not empty the shelf');
  assert.equal(broken.error, 'gateway timeout');
  assert.equal(broken.loading, false);
  assert.deepEqual(mergeItems([{ id: 'a', type: 'movie' }], [{}, { id: 'b', type: 'movie' }]).map((i) => i.id), ['a', 'b']);
});

test('a tab counts what is loaded here and says more only when the addon said more', () => {
  const pinned = readCatalogOptions(MANIFEST.catalogs).slice(0, 3);
  const shelf = {
    'movie:tam_movies': { items: new Array(50).fill(0).map((_, index) => ({ id: `tt${index}`, type: 'movie' })), hasMore: true, fetched: true, loading: false, error: '' },
    'series:tam_series': { items: [], hasMore: false, fetched: true, loading: false, error: 'catalog unavailable' },
  };
  const tabs = buildRuler({ pinned, shelf });
  assert.deepEqual(tabs.map((tab) => [tab.label, tab.count, tab.more, tab.fetched]), [
    ['Tamil Movies', 50, true, true],
    ['Tamil Series', 0, false, true],
    ['Telugu Movies', 0, false, false],
  ], 'a pinned catalog nobody pressed is 0 and not-read, never a blank tab');
  assert.equal(tabs[1].error, 'catalog unavailable');
});

test('the caption may claim exactly three things', () => {
  const shelf = {
    'movie:a': { items: new Array(25).fill(0).map((_, index) => ({ id: `i${index}`, type: 'movie' })), hasMore: true, fetched: true },
    'movie:b': { items: new Array(25).fill(0).map((_, index) => ({ id: `i${index}`, type: 'movie' })), hasMore: false, fetched: true },
    'movie:c': { items: [], fetched: true },
    'movie:d': { items: [], fetched: false },
  };
  const tab = (key) => buildRuler({ pinned: [{ id: key.split(':')[1], type: 'movie', name: key, extraSupported: [] }], shelf })[0];
  assert.equal(shelfLine({ tab: tab('movie:a') }).text, '25 loaded · more');
  assert.equal(shelfLine({ tab: tab('movie:b') }).text, '25 loaded · end of catalog');
  assert.equal(shelfLine({ tab: tab('movie:c') }).text, 'nothing back from this catalog');
  assert.equal(shelfLine({ tab: tab('movie:d') }).text, 'not read yet');
  assert.equal(shelfLine({ tab: tab('movie:a'), ignored: ['genre'] }).text, '25 loaded · more · genre ignored here');
  assert.equal(shelfLine({ tab: tab('movie:b') }).resumable, false, 'no more pages means no more button');
  assert.equal(shelfLine({ tab: tab('movie:a') }).resumable, true);
  const missing = shelfLine({ tab: null });
  assert.deepEqual([missing.tone, missing.text], ['muted', 'no catalog pinned']);
});

/* ------------------------------------------------------------------ the whole path over HTTP */

const TOTALS = { tam_movies: 60, tam_series: 30, tel_movies: 25, eng_movies: 12 };
const PAGE = 25;

function titleFor(catalogId, index) {
  return {
    id: `${catalogId}-${index}`,
    type: catalogId === 'tam_series' ? 'series' : 'movie',
    title: `Title ${index}`,
    releaseInfo: String(1970 + (index % 40)),
    rating: (6 + (index % 20) / 10).toFixed(1),
    genres: ['Drama'],
    posterUrl: '',
    synopsis: '',
  };
}

async function startFixture() {
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    seen.push(url.search.slice(1));
    if (url.pathname === '/api/stremio/manifest') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, manifest: MANIFEST, tamilCatalogs: { movie: 'tam_movies', series: 'tam_series' } }));
      return;
    }
    if (url.pathname === '/api/stremio/catalog') {
      const catalogId = url.searchParams.get('catalog');
      const skip = Number(url.searchParams.get('skip') || 0);
      const search = url.searchParams.get('search') || '';
      const genre = url.searchParams.get('genre') || '';
      const declared = (MANIFEST.catalogs.find((entry) => entry.id === catalogId)?.extraSupported || []);
      const names = new Set(declared.map((name) => name.toLowerCase()));
      const total = TOTALS[catalogId] || 0;
      let items = [];
      for (let index = skip; index < Math.min(total, skip + PAGE); index += 1) items.push(titleFor(catalogId, index));
      // An addon that does not declare an extra ignores it — that is the whole reason the shelf must not
      // send one and then describe the list as if it had worked.
      if (search && names.has('search')) items = items.filter((_, index) => (skip + index) % 2 === 0);
      if (genre && names.has('genre')) items = items.slice(0, 4);
      // The last page of the movies catalog repeats two ids it already served, like a real skip boundary.
      if (catalogId === 'tam_movies' && skip === 50) items = [...items, titleFor(catalogId, 48), titleFor(catalogId, 49)];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ items, count: items.length, hasMore: skip + PAGE < total, catalogName: catalogId }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no such route' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port, seen };
}

function makeFetchPage(port, seen) {
  return async (query) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/stremio/catalog?${query}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data?.error) throw new Error(data?.error || 'Catalog failed');
    return data;
  };
}

test('one press reads one page, and the URL on the wire is the URL the shelf claimed', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const catalog = readCatalogOptions(MANIFEST.catalogs)[0];
    const filters = { sort: 'Latest Added', language: '', genre: '', search: '' };
    const first = await fetchCatalogPage({ fetchPage, catalog, filters, current: emptyShelfEntry() });
    assert.equal(seen.length, 1, 'a single tab press is a single request');
    assert.equal(first.entry.items.length, 25);
    assert.equal(first.entry.skip, 25);
    assert.equal(first.hasMore, undefined, 'the shape that leaves the lib is entry/ignored/query only');
    assert.equal(first.entry.hasMore, true);
    assert.deepEqual(first.ignored, []);
    assert.match(first.query, /source=catalog/);
    assert.match(first.query, /type=movie/);
    assert.match(first.query, /catalog=tam_movies/);
    assert.match(first.query, /skip=0/);
    assert.ok(!first.query.includes('sort='), 'the default sort must not be sent as if it were applied');
  } finally {
    server.close();
  }
});

test('walking the catalog by pressing load more ends with every title once, and knows it is at the end', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const catalog = readCatalogOptions(MANIFEST.catalogs)[0];
    const first = await fetchCatalogPage({ fetchPage, catalog, filters: defaultFilters(), current: emptyShelfEntry() });
    let entry = first.entry;
    let pages = 1;
    while (entry.hasMore && pages < SHELF_MAX_PAGES) {
      const result = await fetchCatalogPage({ fetchPage, catalog, filters: defaultFilters(), append: true, current: entry });
      entry = result.entry;
      pages += 1;
    }
    assert.equal(pages, 3, '60 titles at 25 a page is three requests, no more');
    assert.equal(seen.length, 3, 'and exactly three requests went out');
    assert.equal(entry.items.length, TOTALS.tam_movies, 'the overlapping skip boundary must not add or lose a row');
    assert.equal(new Set(entry.items.map((item) => item.id)).size, 60);
    assert.equal(entry.hasMore, false);
    assert.equal(entry.pages, 3);
    const ruler = buildRuler({ pinned: [catalog], shelf: { [catalogKey(catalog)]: entry } });
    assert.deepEqual([ruler[0].count, ruler[0].more], [60, false]);
    assert.equal(shelfLine({ tab: ruler[0] }).text, '60 loaded · end of catalog', 'the shelf never claims a total it was not given');
  } finally {
    server.close();
  }
});

test('a filter the focused catalog refuses never reaches the wire, and the reason survives the round trip', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const series = readCatalogOptions(MANIFEST.catalogs)[1];
    const filters = { sort: 'Highest Rated', language: 'Tamil', genre: 'Drama', search: 'suzhal' };
    const { query, ignored, entry } = await fetchCatalogPage({ fetchPage, catalog: series, filters, current: emptyShelfEntry() });
    assert.match(query, /genre=Drama/, 'Tamil Series declares genre, so it is asked for');
    assert.ok(!/search=|language=|sort=/.test(query), `refused extras must not be sent: ${query}`);
    assert.deepEqual(ignored.sort(), ['language', 'search', 'sort'].sort());
    assert.equal(entry.items.length, 4, 'the fixture slices a genre page, so this proves genre really was applied');
    const ruler = buildRuler({ pinned: [series], shelf: { [catalogKey(series)]: entry } });
    assert.match(shelfLine({ tab: ruler[0], ignored }).text, /language \+ search \+ sort ignored here|search \+ language \+ sort ignored here/);
  } finally {
    server.close();
  }
});

test('a search a catalog does accept does reach the wire, and narrows what is on screen', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const catalog = readCatalogOptions(MANIFEST.catalogs)[0];
    const { query, ignored, entry } = await fetchCatalogPage({ fetchPage, catalog, filters: { ...defaultFilters(), search: 'vikram' }, current: emptyShelfEntry() });
    assert.match(query, /search=vikram/);
    assert.deepEqual(ignored, []);
    assert.equal(entry.items.length, 13, 'the fixture keeps every other title when search is honoured');
  } finally {
    server.close();
  }
});

test('a press on an unread tab is the only thing that reads it — pinning costs nothing', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const options = readCatalogOptions(MANIFEST.catalogs);
    const pinned = getDefaultPins(options, { movie: 'tam_movies', series: 'tam_series' });
    assert.equal(pinned.length, 2);
    assert.equal(seen.length, 0, 'building tabs must not fetch a single page');
    const shelf = {};
    for (const catalog of pinned) shelf[catalogKey(catalog)] = emptyShelfEntry();
    const tabs = buildRuler({ pinned, shelf });
    assert.deepEqual(tabs.map((tab) => tab.count), [0, 0], 'both tabs honestly say nothing loaded yet');
    const first = await fetchCatalogPage({ fetchPage, catalog: pinned[0], filters: defaultFilters(), current: shelf[catalogKey(pinned[0])] });
    assert.equal(seen.length, 1, 'the tab you pressed is the one page that went out');
    assert.equal(first.entry.items.length, 25);
  } finally {
    server.close();
  }
});

test('a catalog that declares nothing is still walkable, and stays unfiltered', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const bare = readCatalogOptions(MANIFEST.catalogs)[2];
    const { query, ignored, entry } = await fetchCatalogPage({ fetchPage, catalog: bare, filters: { ...defaultFilters(), language: 'Telugu', genre: 'Drama' }, current: emptyShelfEntry() });
    assert.ok(!/language=|genre=/.test(query), `an undeclared extra must not be sent: ${query}`);
    assert.deepEqual(ignored.sort(), ['genre', 'language']);
    assert.equal(entry.items.length, 25, 'so what you get is the addon\'s own order, whole');
  } finally {
    server.close();
  }
});

test('the page cap stops the walk before it becomes a load on the free tier', async () => {
  const { server, port, seen } = await startFixture();
  try {
    const fetchPage = makeFetchPage(port, seen);
    const catalog = { id: 'huge', type: 'movie', name: 'Huge', extraSupported: ['skip'] };
    TOTALS.huge = SHELF_MAX_PAGES * PAGE + 100;
    const first = await fetchCatalogPage({ fetchPage, catalog, filters: defaultFilters(), current: emptyShelfEntry() });
    let entry = first.entry;
    let guard = 1;
    while (entry.hasMore && entry.pages < SHELF_MAX_PAGES && guard < SHELF_MAX_PAGES + 5) {
      const result = await fetchCatalogPage({ fetchPage, catalog, filters: defaultFilters(), append: true, current: entry });
      entry = result.entry;
      guard += 1;
    }
    assert.equal(entry.pages, SHELF_MAX_PAGES, 'the walk stops at the cap, not at the addon\'s patience');
    assert.equal(seen.length, SHELF_MAX_PAGES);
    assert.equal(entry.hasMore, true, 'it says so, rather than pretending the list ended');
    delete TOTALS.huge;
  } finally {
    server.close();
  }
});

/* ------------------------------------------------------------------ the page and its surface */

test('the ruler is the only navigation: the shelf reads its tabs from state and never from the rows', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /<RailNav \/>/, 'the mock has the rail, so the page mounts it');
  assert.match(page, /buildRuler\(\{ pinned, shelf \}\)/, 'a tab is a pinned catalog plus loaded state — never a scan of the returned rows');
  assert.match(page, /role="tab"/);
  assert.match(page, /aria-selected=\{active\}/);
  assert.match(page, /aria-controls="jv-st-shelf"/);
  assert.match(page, /role="tabpanel"/);
  assert.match(page, /tabIndex=\{active \? 0 : -1\}/);
  assert.match(page, /ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs\.length - 1 - index/, 'roving tab order for the TV remote');
  assert.match(page, /document\.getElementById\(tabId\(next\.key\)\)\?\.focus\(\)/, 'and focus follows the tab you moved to');
  assert.match(page, /key=\{rowKey\(item\)\}/, 'rows are keyed by the same key the dedupe uses');
});

test('every request goes through the lib, so nothing can be sent that the catalog refused', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /fetchCatalogPage\(\{/, 'the page must use the same path the tests drive');
    assert.match(page, /`\/api\/stremio\/catalog\?\$\{query\}`/, 'and build the URL from the query string the lib returned');
  assert.match(page, /\/api\/stremio\/manifest\?source=catalog/);
  assert.match(page, /if \(!response\.ok \|\| data\?\.error\) throw/, 'an addon error is an error, not an empty shelf');
  assert.match(page, /readJsonResponse\(response/, 'and an HTML error page is named as such');
  assert.ok(!page.includes('params.set('), 'the page may not assemble filter params itself');
  assert.ok(!/for \(const catalog of (Array\.)?pinned/.test(page), 'no fan-out over pinned catalogs on mount');
  assert.ok(!/pinned\.forEach\(/.test(page), 'nor in a forEach');
  assert.equal((page.match(/await fetch\(/g) || []).length, 2, 'exactly two endpoints are touched: manifest, then one catalog page');
});

test('a stale answer cannot paint, and a reload cannot wipe the rows', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /const id = \(requestsRef\.current\[key\] \|\| 0\) \+ 1;/);
  assert.match(page, /if \(!mountedRef\.current \|\| requestsRef\.current\[key\] !== id\) return;/, 'the older reply is dropped');
  assert.match(page, /markShelfError\(state\[key\]/, 'and a failure carries the old state in');
  assert.match(page, /useEffect\(\(\) => \(\) => \{ mountedRef\.current = false; \}, \[\]\)/);
  assert.match(page, /current: shelfRef\.current\[key\] \|\| null/, 'skip is read from live state, not a stale closure');
});

test('one tab, one catalog: switching and filtering reset that catalog to page one and touch no other', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /if \(entry && \(entry\.fetched \|\| entry\.loading\)\) return;/, 'a tab that has been read is not re-read on every render');
  assert.match(page, /setShelf\(\(state\) => \(\{ \.\.\.state, \[activeCatalogKey\]: emptyShelfEntry\(\) \}\)\);/);
  assert.match(page, /filtersByCatalog\[activeCatalogKey\]/, 'filters belong to the focused catalog, not to the page');
  assert.match(page, /writeSessionCache\(SHELF_KEY/, 'and they persist locally, never in Mongo');
  assert.match(page, /readSessionCache\(SHELF_KEY/);
  assert.equal(SELECTED_KEY, 'jash:stremio:selectedCatalogs:v2', 'the pinned-catalogs key is the one the old page used, so a shelf survives the change');
  assert.match(page, /SELECTED_KEY/);
  assert.match(page, /window\.localStorage\.setItem\(SELECTED_KEY, JSON\.stringify\(pinned\.map\(catalogKey\)\)\)/);
});

test('the load-more tile, the cap and the notes are all reachable by keyboard and honest about waiting', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /className="jv-st-more"/);
  assert.match(page, /disabled=\{reading\}/, 'waiting is stated, and the button cannot be pressed twice');
  assert.match(page, /\{reading \? 'reading…' : 'load more'\}/);
  assert.match(page, /capped && activeEntry\?\.hasMore/, 'at the cap it says so and points at reload');
  assert.match(page, /SHELF_MAX_PAGES/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /if \(event\.key === 'Escape' && sheet\) setSheet\(''\)/, 'both sheets close on Escape');
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
});

test('the old chrome is deleted, not restyled', () => {
  const page = read('../app/stremio/page.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const gone of [
    'BrandLogo', 'MasonryGrid', 'HorizontalCatalogRow', 'authorized addon', 'Authorized Addon',
    'pickerValue', 'addSelectedCatalog', 'removeSelectedCatalog', 'applyFilters(event)', 'Apply filters',
    '‹', '›', '← Home', 'max-w-7xl', 'text-zinc-', 'bg-zinc-', 'border-white/10', 'IntersectionObserver',
    'loadCatalog', 'scrollBy', 'snap-x', 'aspect-[2/3]', 'line-clamp-2 text-xs font-black',
  ]) {
    assert.ok(!page.includes(gone), `the shelf must not carry "${gone}" back in`);
  }
  assert.match(page, /jv-st-embeds[\s\S]{0,160}<EmbedSiteLinks \/>/, 'the embed providers were not deleted with the hero card — /embed-browser has no other link');
  assert.ok(!/<select/.test(page), 'no dropdown survives the tab ruler');
  assert.ok(!/tab\.empty/.test(page), 'and no tab exists to say "nothing here"');
  const inputs = page.match(/<input/g) || [];
  assert.equal(inputs.length, 1, 'exactly one field remains: the catalog search, inside the sheet');
  assert.match(page, /\/stremio-watch\/\$\{item\.type\}\/\$\{encodeURIComponent\(item\.id\)\}\?source=catalog/, 'the watch link is untouched');
});

test('the sheet offers only what this catalog accepts, and says why the rest is absent', () => {
  const page = read('../app/stremio/page.js');
  assert.match(page, /usable = FILTER_FIELDS\.filter\(\(entry\) => supportsExtra\(catalog, entry\.id\)\.supported\)/);
  assert.match(page, /does not declare/);
  assert.match(page, /declares no extras/);
  assert.match(page, /ignored\.length \? <span className="jv-st-fnote"/, 'the strip prints the refusal next to the chips');
  assert.match(page, /accepts \$\{catalog\.extraSupported\.join\(', '\)\}/, 'the catalog list shows what each catalog takes');
  assert.match(page, /Pinning fetches nothing/);
});

test('the shelf stays dark in day mode and declares every colour it uses', () => {
  const css = read('../app/globals.css');
  assert.match(css, /html\.day-mode \.jv-st-page \{[^}]*background: var\(--st-bg\)/, 'day mode gets the same dark wall, not a light wash');
  assert.match(css, /\.jv-st-page \{[^}]*--st-bg: #07070b/s);
  assert.match(css, /--st-accent: #e879f9/);
  assert.match(css, /\.jv-st-more:disabled/, 'the waiting state has its own look');
  assert.match(css, /\.jv-st-card:focus-visible \{ outline: 2px solid #fff/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.jv-st-skel span \{ animation: none; \}/);
  assert.match(css, /@media \(max-width: 1023px\) \{[\s\S]*?padding-bottom: 104px/, 'the dock must not sit on the last row');
  assert.ok(!/\.jv-st[^{]*\{[^}]*!important/.test(css), 'no !important on this surface - it owns its colours instead');

  // Every rule that sets a size on this surface must also set a colour: html.day-mode main paints
  // `color: #102018 !important` onto <main>, so anything left inheriting goes dark-on-dark.
  const start = css.indexOf('.jv-st-page {');
  const stop = css.indexOf('@media', start);
  const shelf = css.slice(start, stop);
  const rules = [...shelf.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const texty = rules.filter((entry) => entry[1].includes('.jv-st') && /font-size:|font:/.test(entry[2]));
  const missing = texty.filter((entry) => !/color:/.test(entry[2]))
    .map((entry) => entry[1].trim().replace(/\s+/g, ' '));
  assert.ok(texty.length >= 25, `expected the shelf to style its own text in at least 25 rules, saw ${texty.length}`);
  assert.equal(missing.join(' | '), '', 'rules that set a size but no colour inherit the day-mode blanket');
});

test('nothing on the page is a control that controls nothing', () => {
  const page = read('../app/stremio/page.js');
  assert.ok(!/disabled=\{true\}/.test(page));
  assert.ok(!/onClick=\{\(\) => \{\}\}/.test(page));
  assert.ok(!/href="#"/.test(page), 'no placeholder links');
  const ariaPressed = (page.match(/aria-pressed=/g) || []).length;
  assert.ok(ariaPressed >= 2, `pin toggles and filter options must report their state (saw ${ariaPressed})`);
  assert.ok(!/title="Remove/.test(page), 'removal lives in the sheet, not as an × on a tab');
});
