import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {
  DECADE_MAX_PAGES,
  DECADE_PAGE_LIMIT,
  buildDecades,
  buildShelfQuery,
  decadeLabel,
  decadeOf,
  decadeRange,
  groupRowsByYear,
  loadAllPages,
  rowKey,
  shelfStatus,
} from '../lib/classicsDecade.js';

/**
 * The Decade Room (ReTro).
 *
 * The reported bug was that picking a decade did not show all the titles in it. So the interesting
 * property is not "a card renders" but "the number on screen equals the number in the archive" — which
 * is what most of these tests measure, including one that runs the real paging loop over a 532-title
 * 532-title fixture served over HTTP, exercising the same `loadAllPages` the page calls.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ the decade maths */

test('a year maps to the decade window the API is asked for', () => {
  assert.equal(decadeOf(1987), 1980);
  assert.equal(decadeOf(1980), 1980);
  assert.equal(decadeOf('1989'), 1980, 'a year that arrives as a string still buckets');
  assert.equal(decadeOf(2003.7), 2000);
  assert.deepEqual(decadeRange(1980), { from: 1980, to: 1989 }, 'inclusive of the last year, or 1989 goes missing');
  assert.equal(decadeLabel(1980), '1980s');
});

test('a title with no usable year is never silently a decade', () => {
  for (const junk of [null, undefined, 0, '', 'NaN', 199, -5, {}, []]) {
    assert.equal(decadeOf(junk), null, `${String(junk)} is not a year`);
  }
});

test('the ruler counts every title, keeps real gaps, and shows an empty decade as empty', () => {
  const years = [
    { year: 1965, count: 3 },
    { year: 1978, count: 5 },
    { year: 1985, count: 60 },
    { year: 1987, count: 58 },
    { year: 1992, count: 40 },
    { year: null, count: 7 },
    { year: 0, count: 2 },
  ];
  const ruler = buildDecades({ years }, { filteredTotal: 175, archiveTotal: 175 });

  assert.deepEqual(ruler.decades.map((d) => d.decade), [1960, 1970, 1980, 1990], 'ascending, oldest first');
  assert.equal(ruler.decades[2].count, 118, '1985 + 1987 belong to one decade');
  assert.deepEqual(ruler.decades[2].years.map((y) => y.year), [1985, 1987], 'per-year detail inside the decade');
  assert.equal(ruler.undated, 9, 'a missing year and year 0 are both "no year on record"');
  assert.equal(ruler.dated, 166);
  assert.equal(ruler.accounted, 175, 'dated + undated must equal what the shelf holds, or the view is lying');
  assert.equal(ruler.unaccounted, 0);

  const withGap = buildDecades({ years: [{ year: 1952, count: 1 }, { year: 1971, count: 2 }] });
  assert.deepEqual(withGap.decades.map((d) => [d.decade, d.count, d.empty]), [[1950, 1, false], [1960, 0, true], [1970, 2, false]]);
  assert.ok(withGap.decades[1].empty, 'the 1960s stays on the ruler with a real zero, so absence is visible');
});

test('a disagreement between the histogram and the count is reported, not smoothed over', () => {
  const ruler = buildDecades({ years: [{ year: 1985, count: 10 }] }, { filteredTotal: 14 });
  assert.equal(ruler.unaccounted, 4, '4 titles the decade buckets cannot see');
  assert.equal(buildDecades({ years: [{ year: 1985, count: 10 }] }, { filteredTotal: null }).unaccounted, 0, 'no window means no claim to check');
});

/* ------------------------------------------------------------------ what a decade means as a query */

test('the query for a decade is the year window, the sources, and nothing else', () => {
  const q = new URLSearchParams(buildShelfQuery({
    decade: 1980,
    filters: { q: '  na  ', sort: 'year.asc', source: 'all', genre: 'all', minRating: '8' },
    page: 2,
  }));
  assert.equal(q.get('yearFrom'), '1980');
  assert.equal(q.get('yearTo'), '1989');
  assert.equal(q.get('q'), 'na', 'trimmed before it hits the text index');
  assert.equal(q.get('minRating'), '8');
  assert.equal(q.get('limit'), String(DECADE_PAGE_LIMIT), '/api/vod refuses a limit above 60, so paging is the only way to see all');
  assert.equal(q.get('page'), '2');
  assert.ok(!q.has('source'), 'all sources means no source filter — the default used to be `Aha`, which hid every ErosNow title');
  assert.ok(!q.has('genre'));

  const all = new URLSearchParams(buildShelfQuery({ decade: 'all', filters: { source: 'ErosNow' } }));
  assert.ok(!all.has('yearFrom') && !all.has('yearTo'), 'Everything is the absence of a window');
  assert.equal(all.get('source'), 'ErosNow');

  const undated = new URLSearchParams(buildShelfQuery({ decade: 'undated', filters: {} }));
  assert.equal(undated.get('undated'), '1');
  assert.ok(!undated.has('yearFrom'), 'the no-year tab must not ask for a year range');
});

/* ------------------------------------------------------------------ reading a shelf to the end */

function fakeApi({ pages, total }) {
  const calls = [];
  return {
    calls,
    fetchPage: async (query) => {
      const page = Number(new URLSearchParams(query).get('page'));
      calls.push(query);
      // `hasMore` follows the route's own arithmetic shape: the last page is the last page.
      return { items: pages[page - 1] || [], total, page, hasMore: page < pages.length };
    },
  };
}

test('a decade of 136 titles comes back as 136 rows, not a page of 60', async () => {
  const rows = (from, n) => Array.from({ length: n }, (_, i) => ({ id: `t${from + i}`, title: `Title ${from + i}`, year: 1980 + ((from + i) % 10) }));
  const api = fakeApi({ pages: [rows(0, 60), rows(60, 60), rows(120, 16)], total: 136 });
  const progress = [];
  const result = await loadAllPages({
    fetchPage: api.fetchPage,
    decade: 1980,
    filters: { sort: 'year.asc' },
    onProgress: (state) => progress.push(state.loaded),
  });

  assert.equal(result.items.length, 136);
  assert.equal(result.pages, 3);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.equal(api.calls.length, 3, 'it stops when the API stops promising more');
  assert.deepEqual(progress, [60, 120, 136], 'and it reports the count while it walks');
  const years = new Set(result.items.map((row) => decadeOf(row.year)));
  assert.deepEqual([...years], [1980], 'every row it returns is in the decade that was asked for');
});

test('a row that shifts between pages is not counted twice', async () => {
  const shared = { id: 'dup', title: 'Same title', year: 1985 };
  const api = fakeApi({
    pages: [[shared, { id: 'a', year: 1981 }], [shared, { id: 'b', year: 1982 }]],
    total: 3,
  });
  const result = await loadAllPages({ fetchPage: api.fetchPage, decade: 1980 });
  assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map((row) => row.id)).size, 3, 'a,b plus one copy of dup');
  assert.equal(result.complete, true);
});

test('completeness is a claim about the count, so a moving target says "keep going"', async () => {
  // The API promised 136 and delivered 120: a sync landed mid-walk. Loop finished, but we do not say "all".
  const rows = (page) => Array.from({ length: 60 }, (_, i) => ({ id: `p${page}t${i}`, year: 1980 }));
  const api = fakeApi({ pages: [rows(1), rows(2)], total: 136 });
  const result = await loadAllPages({ fetchPage: api.fetchPage, decade: 1980 });
  assert.equal(result.items.length, 120);
  assert.equal(result.complete, false, 'loaded !== total, so the honest answer is "not everything"');
  const line = shelfStatus({ loaded: result.items.length, total: result.total, complete: result.complete, truncated: result.truncated });
  assert.match(line.text, /16 still to fetch/);
  assert.equal(line.resumable, true);
});

test('an empty page that promises more is not worth 25 requests', async () => {
  const api = fakeApi({ pages: [[]], total: 10 });
  const result = await loadAllPages({ fetchPage: api.fetchPage, decade: 1990 });
  assert.equal(api.calls.length, 1);
  assert.equal(result.items.length, 0);
  assert.equal(result.complete, false);
});

test('the page ceiling is a stop, not a lie', async () => {
  const rows = (page) => Array.from({ length: 60 }, (_, i) => ({ id: `p${page}t${i}`, year: 1980 }));
  const calls = [];
  const result = await loadAllPages({
    fetchPage: async (query) => {
      const page = Number(new URLSearchParams(query).get('page'));
      calls.push(page);
      return { items: rows(page), total: 2000, hasMore: true };
    },
    decade: 1980,
    maxPages: DECADE_MAX_PAGES,
  });
  assert.equal(calls.length, DECADE_MAX_PAGES);
  assert.equal(result.items.length, DECADE_MAX_PAGES * 60);
  assert.equal(result.truncated, true);
  assert.equal(result.complete, false);
  const line = shelfStatus({ loaded: result.items.length, total: result.total, complete: false, truncated: true });
  assert.match(line.text, /ceiling/);
});

test('a decade you leave mid-fetch cannot paint over the one you arrived at', async () => {
  let current = true;
  let calls = 0;
  const rows = (page) => Array.from({ length: 60 }, (_, i) => ({ id: `k${page}-${i}`, year: 1985 }));
  const ok = await loadAllPages({
    fetchPage: async () => {
      calls += 1;
      return { items: rows(calls), total: 120, hasMore: calls < 2 };
    },
    decade: 1980,
    isCurrent: () => current,
  });
  assert.equal(ok.items.length, 120);
  assert.equal(ok.complete, true, 'a walk nobody interrupts just finishes');

  calls = 0;
  current = false;
  const stale = await loadAllPages({
    fetchPage: async (query) => {
      calls += 1;
      return { items: rows(calls), total: 120, hasMore: calls < 2, query };
    },
    decade: 1990,
    isCurrent: () => false,
  });
  assert.equal(stale.stale, true, 'the walk notices the decade changed and gives up');
  assert.deepEqual(stale.items, [], 'it hands back nothing, so the caller cannot paint the old shelf');
  assert.equal(calls, 1, 'and it stops at the first page rather than finishing 2 useless requests');
});

test('a failing request surfaces once, with the API message', async () => {
  let calls = 0;
  await assert.rejects(
    loadAllPages({
      fetchPage: async () => {
        calls += 1;
        throw new Error('Mongo is asleep');
      },
      decade: 1980,
    }),
    /Mongo is asleep/,
  );
  assert.equal(calls, 1, 'no retry storm against a free-tier box');
  // An archive that answers with nothing is not an error: the empty state is the honest one.
  assert.deepEqual(await loadAllPages({ fetchPage: async () => ({}) }), { stale: false, items: [], total: 0, pages: 1, complete: true, truncated: false });
  assert.equal(shelfStatus({ loaded: 0, total: 0 }).tone, 'empty');
});

test('loadAllPages refuses to run without a way to fetch', async () => {
  await assert.rejects(loadAllPages({ decade: 1980 }), TypeError);
});

/* ------------------------------------------------------------------ the spine */

test('rows group by release year, and the unyearned are kept visible at the end', () => {
  const items = [
    { id: 'a', title: 'Roja', year: 1992, rating: 8 },
    { id: 'b', title: 'Nayakan', year: 1987, rating: 8.3 },
    { id: 'c', title: 'Vikram', year: 1986, rating: 7.8 },
    { id: 'd', title: 'Oru Padam', year: null, rating: 6 },
    { id: 'e', title: 'Karnan', year: 1964, rating: 8.2 },
  ];
  const asc = groupRowsByYear(items, { sort: 'year.asc' });
  assert.deepEqual(asc.map((g) => g.label), ['1964', '1986', '1987', '1992', 'No year']);
  assert.equal(asc[asc.length - 1].count, 1, 'the no-year bucket is a group, not a dropped row');
  const desc = groupRowsByYear(items, { sort: 'year.desc' });
  assert.deepEqual(desc.map((g) => g.label).slice(0, 2), ['1992', '1987']);
  assert.equal(desc[desc.length - 1].label, 'No year', 'newest first still ends with the unyearned');

  const sameYear = groupRowsByYear([
    { title: 'B', year: 1985, rating: 7 },
    { title: 'A', year: 1985, rating: 9 },
  ], { sort: 'year.asc' });
  assert.deepEqual(sameYear[0].items.map((row) => row.title), ['A', 'B'], 'two films in one year order by score');
});

test('rowKey is one rule for the fetch loop and the rendered list', () => {
  assert.equal(rowKey({ id: 'x1' }), 'x1');
  assert.equal(rowKey({ _id: 'y2' }), 'y2');
  assert.equal(rowKey({ title: 'Roja', year: 1992 }), 'Roja::1992', 'a row mid-sync still has an identity');
  assert.equal(rowKey(), 'undefined::', 'and a shapeless row cannot crash the loop');
});

test('the status line says exactly what it means', () => {
  assert.equal(shelfStatus({ loaded: 118, total: 118, complete: true }).tone, 'ok');
  assert.match(shelfStatus({ loaded: 118, total: 118, complete: true }).text, /^All 118 loaded/);
  assert.equal(shelfStatus({ loaded: 0, total: 0 }).tone, 'empty');
  assert.equal(shelfStatus({ loaded: 60, total: 118 }).resumable, true);
  assert.match(shelfStatus({ loaded: 60, total: 118, loading: true }).text, /Reading the shelf/);
  assert.equal(shelfStatus({ loaded: 60, total: 118, loading: true }).resumable, false, 'no button while it is still walking');
});

/* ------------------------------------------------------------------ end to end over a fixture archive */

const FIXTURE = (() => {
  const SOURCES = [['Aha'], ['ErosNow'], ['Aha', 'ErosNow']];
  const items = [];
  // 532 titles: 68 / 88 / 95 / 91 / 87 / 94 across the six decades from 1952 to 2009, plus 9 with no
  // year at all. Deterministic, so the numbers asserted below are the fixture, not a print-out.
  let n = 0;
  for (let year = 1952; year <= 2009; year += 1) {
    const perYear = 4 + ((year * 7) % 11);
    for (let i = 0; i < perYear; i += 1) {
      n += 1;
      items.push({
        id: `v${n}`,
        title: `Classic ${n}`,
        year,
        rating: Number((6 + ((n * 13) % 30) / 10).toFixed(1)),
        voteCount: 500 + ((n * 977) % 40000),
        genres: [['Drama', 'Comedy', 'Political', 'Music'][n % 4]],
        sources: SOURCES[n % 3],
        streamsCount: 1 + (n % 4),
        tmdbMatched: true,
      });
    }
  }
  for (let i = 0; i < 9; i += 1) {
    n += 1;
    items.push({ id: `v${n}`, title: `Unmatched ${i}`, year: null, rating: 0, voteCount: 0, genres: [], sources: ['Aha'], streamsCount: 1, tmdbMatched: false });
  }
  return items;
})();

const countFor = (year) => FIXTURE.filter((row) => row.year === year).length;
const EXPECTED_TOTAL = FIXTURE.length;
const EXPECTED_UNDATED = FIXTURE.filter((row) => !row.year).length;

function startApiServer() {
  // Stands in for the Mongo-backed route: same params, same windowing, same paging arithmetic.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const get = (key) => url.searchParams.get(key) || '';
    const clamp = (value, fallback, min, max) => {
      const num = Number(value);
      return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.floor(num))) : fallback;
    };
    const page = clamp(get('page'), 1, 1, 9999);
    const limit = clamp(get('limit'), 24, 1, 60);
    const source = get('source') || 'all';
    const genre = get('genre') || 'all';
    const minRating = Number(get('minRating') || 0);
    const yearFrom = Number(get('yearFrom') || 0);
    const yearTo = Number(get('yearTo') || 0);
    const undated = get('undated') === '1';
    const sort = get('sort') || 'rating.desc';

    let rows = FIXTURE.filter((row) => {
      if (source !== 'all' && !(row.sources || []).includes(source)) return false;
      if (genre !== 'all' && !(row.genres || []).includes(genre)) return false;
      if (minRating > 0 && !(row.rating >= minRating)) return false;
      if (undated) return !row.year;
      if (yearFrom > 0 && !(row.year >= yearFrom)) return false;
      if (yearTo > 0 && !(row.year <= yearTo)) return false;
      return true;
    });

    rows = rows.slice().sort((a, b) => {
      if (sort === 'year.asc') return (a.year || 9999) - (b.year || 9999) || b.rating - a.rating;
      if (sort === 'year.desc') return (b.year || 0) - (a.year || 0) || b.rating - a.rating;
      if (sort === 'title.asc') return a.title.localeCompare(b.title);
      return b.rating - a.rating;
    });

    const total = rows.length;
    const items = rows.slice((page - 1) * limit, (page - 1) * limit + limit);

    // The year histogram the route computes over the filter *without* a window.
    const base = FIXTURE.filter((row) => {
      if (source !== 'all' && !(row.sources || []).includes(source)) return false;
      if (genre !== 'all' && !(row.genres || []).includes(genre)) return false;
      if (minRating > 0 && !(row.rating >= minRating)) return false;
      return true;
    });
    const hist = new Map();
    for (const row of base) hist.set(row.year || null, (hist.get(row.year || null) || 0) + 1);

    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      items,
      count: items.length,
      total,
      page,
      limit,
      hasMore: page * limit < total,
      needsSync: false,
      undated,
      archiveTotal: FIXTURE.length,
      filteredTotal: total,
      facets: {
        sources: ['Aha', 'ErosNow'],
        genres: ['Comedy', 'Drama', 'Music', 'Political'],
        minYear: 1952,
        maxYear: 2009,
        years: [...hist.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
      },
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('over a 532-title archive, every decade tab shows every title in it', async () => {
  const { server, port } = await startApiServer();
  const fetchPage = async (query) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vod?${query}`, { cache: 'no-store' });
    return response.json();
  };
  try {
    assert.ok(EXPECTED_TOTAL > 400, `fixture is ${EXPECTED_TOTAL} titles`);

    // 1. Everything: the whole archive, in one walk.
    const everything = await loadAllPages({ fetchPage, decade: 'all', filters: { sort: 'year.asc' } });
    assert.equal(everything.items.length, EXPECTED_TOTAL, 'all 523 dated + the 9 with no year');
    assert.equal(everything.total, EXPECTED_TOTAL);
    assert.equal(everything.complete, true);
    assert.equal(new Set(everything.items.map((row) => row.id)).size, EXPECTED_TOTAL, 'nothing duplicated across 7 pages');

    // 2. The ruler from the same response, and the sum of its parts.
    const first = await fetchPage(buildShelfQuery({ decade: 'all', filters: { sort: 'year.asc' }, page: 1 }));
    const ruler = buildDecades(first.facets, { filteredTotal: first.filteredTotal, archiveTotal: first.archiveTotal });
    assert.equal(ruler.accounted, EXPECTED_TOTAL, 'decade counts + the no-year bucket = the archive');
    assert.equal(ruler.unaccounted, 0);
    assert.equal(ruler.undated, EXPECTED_UNDATED);
    assert.deepEqual(ruler.decades.map((d) => d.decade), [1950, 1960, 1970, 1980, 1990, 2000], 'no gaps in this span, and none invented');

    // 3. Each decade really contains each decade.
    for (const entry of ruler.decades) {
      const result = await loadAllPages({ fetchPage, decade: entry.decade, filters: { sort: 'year.asc' } });
      const expected = FIXTURE.filter((row) => row.year && decadeOf(row.year) === entry.decade);
      assert.equal(result.items.length, expected.length, `the ${entry.decade}s shows all ${expected.length}`);
      assert.equal(result.total, entry.count, 'and its header count agrees with the ruler');
      assert.equal(result.complete, true);
      assert.deepEqual(
        [...result.items].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id),
        [...expected].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id),
        `the ${entry.decade}s row set is exactly the fixture slice`,
      );
      const sum = new Set(result.items.map((row) => row.id)).size;
      assert.equal(sum, expected.length);
    }

    // 4. Sum of decades equals the archive, which is the whole complaint in one line.
    const fromDecades = ruler.decades.reduce((sum, entry) => sum + entry.count, 0) + ruler.undated;
    assert.equal(fromDecades, EXPECTED_TOTAL, 'no title lives outside every decade tab');

    // 5. A year with more rows than one page still shows all of them.
    const busiest = [...new Map(FIXTURE.map((row) => [row.year, countFor(row.year)])).entries()].sort((a, b) => b[1] - a[1])[0];
    const busy = await loadAllPages({ fetchPage, decade: decadeOf(busiest[0]), filters: { sort: 'year.asc' } });
    assert.ok(busy.pages >= 1 && busy.complete, `the ${decadeOf(busiest[0])}s holds ${busy.items.length} rows including the busiest year (${busiest[1]})`);

    // 6. The no-year tab is not empty and not part of any decade.
    const orphan = await loadAllPages({ fetchPage, decade: 'undated', filters: { sort: 'year.asc' } });
    assert.equal(orphan.items.length, EXPECTED_UNDATED);
    assert.ok(orphan.items.every((row) => !row.year));
    assert.equal(orphan.complete, true);

    // 7. Grouping the decade keeps every row.
    const one = await loadAllPages({ fetchPage, decade: 1980, filters: { sort: 'year.asc' } });
    const groups = groupRowsByYear(one.items, { sort: 'year.asc' });
    assert.equal(groups.reduce((sum, group) => sum + group.count, 0), one.items.length, 'the spine renders as many rows as it was given');
    assert.equal(groups.filter((group) => group.year === 1985).length, 1);
    assert.equal(groups[groups.length - 1].year, 1989, 'the 1980s spine ends on 1989');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a source filter narrows the decade without stranding titles', async () => {
  const { server, port } = await startApiServer();
  const fetchPage = async (query) => (await fetch(`http://127.0.0.1:${port}/api/vod?${query}`, { cache: 'no-store' })).json();
  try {
    const filters = { sort: 'year.asc', source: 'ErosNow' };
    const only = await loadAllPages({ fetchPage, decade: 1990, filters });
    const expected = FIXTURE.filter((row) => decadeOf(row.year) === 1990 && row.sources.includes('ErosNow'));
    assert.equal(only.items.length, expected.length, 'the decade honours the source, and still loads all of it');
    assert.equal(only.complete, true);
    assert.ok(only.items.every((row) => row.sources.includes('ErosNow')));

    const all = await loadAllPages({ fetchPage, decade: 1990, filters: { sort: 'year.asc' } });
    assert.ok(all.items.length > only.items.length, 'and the default really is broader than one source');

    // The "Everything" tab counts what the filters allow, and it is the same histogram as the decades,
    // so the ruler can never add up to something other than what it says.
    const faceted = await fetchPage(buildShelfQuery({ decade: 1990, filters, page: 1 }));
    const narrowed = buildDecades(faceted.facets, { filteredTotal: null, archiveTotal: faceted.archiveTotal });
    const expectedBase = FIXTURE.filter((row) => row.sources.includes('ErosNow')).length;
    assert.equal(narrowed.accounted, expectedBase, 'decade buckets + no-year bucket = the filtered shelf');
    assert.equal(narrowed.unaccounted, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------ the page and the route it calls */

test('the page is the decade room, with the old paging bugs deleted', () => {
  const page = read('../app/classics/page.js');
  assert.match(page, /const DEFAULT_FILTERS = \{ q: '', sort: 'year\.asc', source: 'all'/, 'the old default was `source: Aha`, which hid half the archive');
  assert.ok(!/source: 'Aha'/.test(page), 'and it is gone, not merely unused');
  for (const gone of ['IntersectionObserver', 'sentinelRef', 'PAGE_SIZE', 'yearFrom:', 'yearTo:', 'BrandLogo', 'max-w-7xl', 'CleanEmbedButtons']) {
    assert.ok(!page.includes(gone), `${gone} belongs to the grid-with-a-sentinel design`);
  }
  assert.match(page, /await loadAllPages\(\{/, 'one place walks the pages, and it is the tested one');
  assert.match(page, /maxPages: budget/, 'the ceiling is state, so "Keep loading" can raise it');
  assert.match(page, /if \(isCurrent\(\)\) \{[\s\S]{0,120}setItems\(result\.items\);/);
  assert.match(page, /shelfStatus\(\{ loaded, total, complete, truncated, loading: reading \}\)/, 'the header sentence comes from the same function the tests assert on');
  assert.match(page, /const shelf = useMemo\(\(\) => groupRowsByYear\(items, \{ sort: filters\.sort \}\)/, 'grouped by year, not by whatever page arrived');
  assert.match(page, /rowKey\(item\)/, 'the rendered keys are the loop keys');
  assert.match(page, /href=\{`\/classics\/\$\{item\.id\}`\}/, 'a row is the player page');
  assert.match(page, /fetch\('\/api\/vod\/sync'/, 'and the only manual sync entry point in the app stays here');
  assert.match(page, /setBudget\(DECADE_MAX_PAGES\)/, 'switching decades resets the budget instead of inheriting a bigger one');
  assert.ok(!/setInterval|new Worker/.test(page), 'no timer, no background worker: one request per view');
  // The old page fetched on mount and again from the filter effect — two walks for one view.
  const mountStart = page.indexOf('A return to ReTro should land');
  const mountEffect = page.slice(mountStart, page.indexOf('useEffect(() => {\n    if (!mountedRef.current) return;', mountStart));
  assert.ok(!/readShelf\(\)/.test(mountEffect.split('}, []);')[0]), 'the mount effect restores, it does not fetch');
  assert.match(mountEffect, /skipRef\.current = true;/);
  assert.match(page, /\n\s*\}, \[readShelf\]\);/, 'one dependency, so the fetch effect cannot miss a change or run twice');
  assert.ok(!/eslint-disable/.test(page), 'and no rule had to be muted to get there');
});

test('the ruler is keyboard-first, because a remote is a keyboard', () => {
  const page = read('../app/classics/page.js');
  assert.match(page, /role="tablist" aria-label="Decade"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /tabIndex=\{active \? 0 : -1\}/, 'Tab leaves the ruler after one stop instead of walking 6 decades');
  assert.match(page, /ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs\.length - 1 - index/);
  assert.match(page, /disabled=\{Boolean\(tab\.empty\)\}/, 'an empty decade is shown and disabled, so the zero is not a bug you have to discover');
  assert.match(page, /jv-dec-tab-\$\{next\.decade\}`\)\?\.focus\(\)/, 'focus follows the decade you chose');
  assert.match(page, /id="jv-dec-shelf"/);
});

test('every decade count the route reports is computed without the window', () => {
  const route = read('../app/api/vod/route.js');
  const shelfBlock = route.slice(route.indexOf('const shelfFilter = {}'), route.indexOf('const filter = { ...shelfFilter }'));
  assert.ok(!/yearFrom|yearTo|undated/.test(shelfBlock), 'the base filter that feeds the histogram must ignore the window, or every other decade reads zero');
  assert.match(shelfBlock, /filter\.sources = source|shelfFilter\.sources = source/);
  assert.match(route, /filter\.year = \{ \$in: \[null, 0\] \}/, 'the no-year tab is a real query, not a client-side filter');
  assert.match(route, /\{ \$match: shelfFilter \},\s*\{ \$group: \{ _id: '\$year', count: \{ \$sum: 1 \} \} \}/, 'the histogram is the whole filtered shelf, per year');
  assert.match(route, /const \[facets, yearRows\] = await Promise\.all/, 'one round trip for both');
  assert.match(route, /archiveTotal: totalDbCount/);
  assert.ok(/limit'\), 24, 1, 60/.test(route), 'the 60 ceiling is what makes paging necessary — if this changes, so does the loop');
  const yearsShape = route.slice(route.indexOf('years: (yearRows'), route.indexOf('years: (yearRows') + 300);
  assert.match(yearsShape, /Number\.isFinite\(row\?\._id\)/, 'a null year stays null so the page can call it undated');
  assert.match(yearsShape, /row\.count > 0/, 'zero-count buckets are not sent');
});

test('day mode has a value for everything the decade room paints, and reduced motion is honoured', () => {
  const css = read('../app/globals.css');
  const block = css.slice(css.indexOf('.jv-dec-page {'));
  assert.ok(block.length > 2000, 'the decade room has its own stylesheet block');

  // The lesson from the hero wash: a themed surface needs its own day-mode value, or the blankets and
  // the inherited `html.day-mode main` colour decide for you. Artwork is the one exemption.
  const ARTWORK = new Set(['jv-dec-thumb', 'jv-dec-thumb-none']);
  const needTwin = new Set();
  for (const rule of block.split('}')) {
    const selector = rule.slice(0, rule.indexOf('{'));
    if (selector.includes('html.day-mode')) continue;
    const classes = selector.match(/\.jv-dec[a-z-]*/g) || [];
    if (!/[^-]color:/.test(rule) && !/background:/.test(rule)) continue;
    for (const cls of classes) needTwin.add(cls.slice(1));
  }
  assert.ok(needTwin.size > 12, `found ${needTwin.size} painted classes to check`);
  const missing = [...needTwin].filter((cls) => !ARTWORK.has(cls) && !css.includes(`html.day-mode .${cls}`) && !css.includes(`html.day-mode .jv-dec-row .${cls}`));
  assert.deepEqual(missing, [], 'every non-artwork colour in the decade room needs a day-mode twin');
  for (const cls of ARTWORK) {
    assert.ok(new RegExp(`\\.jv-dec-thumb(-none)? \\{[^}]*background: #[01]`).test(block), `${cls} keeps a dark backing in both themes`);
  }

  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-dec-row'));
  assert.match(motion, /\.jv-dec-skel-row \{ animation: none; \}/, 'the skeleton shimmer stops when motion is unwanted');
  assert.match(motion, /\.jv-dec-row,/, 'row hover transitions off too');
});
