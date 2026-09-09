import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {
  DECADE_MAX_PAGES,
  DECADE_PAGE_LIMIT,
  FACET_PROBE_LIMIT,
  buildDecades,
  buildShelfQuery,
  decadeLabel,
  decadeOf,
  decadeRange,
  loadAllPages,
  readFacets,
  rowKey,
  shelfStatus,
} from '../lib/classicsDecade.js';

/**
 * The Decade Room (ReTro).
 *
 * Two complaints shaped this file. The first was "the filter doesn't show all my movies" — so most of
 * these tests measure whether the number on screen equals the number in the archive. The second was
 * "this is not what I picked": the ruler showed only `Everything` because the page never stored the
 * facets it was given, so the decade numerals the mock is built around could not render. Both failure
 * modes have a test here, including one that runs the real paging loop over a 490-title fixture
 * served over HTTP, using the same `loadAllPages` and `readFacets` the page calls.
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
    { year: 1930, count: 1 },
    { year: 1965, count: 3 },
    { year: 1978, count: 5 },
    { year: 1985, count: 60 },
    { year: 1987, count: 58 },
    { year: 1992, count: 40 },
    { year: null, count: 7 },
    { year: 0, count: 2 },
  ];
  const ruler = buildDecades({ years, minYear: 1930, maxYear: 1992 }, { filteredTotal: 176, archiveTotal: 176 });

  assert.deepEqual(ruler.decades.map((d) => d.decade), [1930, 1940, 1950, 1960, 1970, 1980, 1990], 'ascending, oldest first, gaps filled');
  assert.equal(ruler.decades[1].decade, 1940);
  assert.equal(ruler.decades[1].count, 0, 'the 1940s and 1950s stay on the ruler with a real zero, so absence is visible');
  assert.equal(ruler.decades[2].empty, true);
  assert.equal(ruler.decades[5].count, 118, '1985 + 1987 belong to one decade');
  assert.deepEqual(ruler.decades[5].years.map((y) => y.year), [1985, 1987], 'per-year detail inside the decade');
  assert.equal(ruler.undated, 9, 'a missing year and year 0 are both "no year on record"');
  assert.equal(ruler.dated, 167);
  assert.equal(ruler.accounted, 176, 'dated + undated must equal what the shelf holds, or the view is lying');
  assert.equal(ruler.unaccounted, 0);
  assert.equal(ruler.minYear, 1930, 'the span next to the heading comes from the histogram, not a guess');
  assert.equal(ruler.maxYear, 1992);
  assert.equal(ruler.landing, 1990, 'and the page opens on the newest decade that has titles');

  const empty = buildDecades({ years: [] });
  assert.deepEqual(empty.decades, [], 'no years means no decades — the ruler is then just Everything');
  assert.equal(empty.landing, 'all', 'and there is nothing to land on, so it opens on Everything');
  assert.equal(empty.minYear, null);
});

test('a disagreement between the histogram and the count is reported, not smoothed over', () => {
  const ruler = buildDecades({ years: [{ year: 1985, count: 10 }] }, { filteredTotal: 14 });
  assert.equal(ruler.unaccounted, 4, '4 titles the decade buckets cannot see');
  assert.equal(buildDecades({ years: [{ year: 1985, count: 10 }] }, { filteredTotal: null }).unaccounted, 0, 'no window means no claim to check');
});

/* ------------------------------------------------------------------ what a decade means as a query */

test('the query for a decade is the year window and the order, and nothing else', () => {
  const q = new URLSearchParams(buildShelfQuery({ decade: 1980, filters: { sort: 'rating.desc' }, page: 2 }));
  assert.equal(q.get('yearFrom'), '1980');
  assert.equal(q.get('yearTo'), '1989');
  assert.equal(q.get('sort'), 'rating.desc');
  assert.equal(q.get('limit'), String(DECADE_PAGE_LIMIT), '/api/vod refuses a limit above 60, so paging is the only way to see all');
  assert.equal(q.get('page'), '2');
  assert.ok(!q.has('source'), 'no source filter at all — the old default of `Aha` hid every ErosNow title');
  assert.ok(!q.has('genre') && !q.has('minRating') && !q.has('q'), 'the decade is the only filter on this page');

  const all = new URLSearchParams(buildShelfQuery({ decade: 'all', filters: {} }));
  assert.ok(!all.has('yearFrom') && !all.has('yearTo'), 'Everything is the absence of a window');
  assert.equal(all.get('sort'), 'year.asc', 'oldest first is the default reading order for an archive');

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
      calls.push(query);
      const page = Number(new URLSearchParams(query).get('page'));
      // `hasMore` follows the route's own arithmetic shape: the last page is the last page.
      return { items: pages[page - 1] || [], total, page, hasMore: page < pages.length };
    },
  };
}

test('a decade of 136 titles comes back as 136 rows, and paints after the first request', async () => {
  const rows = (from, n) => Array.from({ length: n }, (_, i) => ({ id: `t${from + i}`, title: `Title ${from + i}`, year: 1980 + ((from + i) % 10) }));
  const api = fakeApi({ pages: [rows(0, 60), rows(60, 60), rows(120, 16)], total: 136 });
  const progress = [];
  const result = await loadAllPages({
    fetchPage: api.fetchPage,
    decade: 1980,
    onProgress: (state) => progress.push(state),
  });

  assert.equal(result.items.length, 136);
  assert.equal(result.pages, 3);
  assert.equal(result.complete, true);
  assert.equal(result.truncated, false);
  assert.equal(api.calls.length, 3, 'it stops when the API stops promising more');
  assert.deepEqual(progress.map((p) => p.loaded), [60, 120, 136], 'it reports the count as it walks');
  assert.equal(progress[0].items.length, 60, 'the first 60 rows are handed over after request one — this is the fix for "initial loading takes more time"');
  assert.equal(progress[2].items.length, 136);
  const decades = new Set(result.items.map((row) => decadeOf(row.year)));
  assert.deepEqual([...decades], [1980], 'every row it returns is in the decade that was asked for');
});

test('a row that shifts between pages is not counted twice', async () => {
  const shared = { id: 'dup', title: 'Same title', year: 1985 };
  const api = fakeApi({ pages: [[shared, { id: 'a', year: 1981 }], [shared, { id: 'b', year: 1982 }]], total: 3 });
  const result = await loadAllPages({ fetchPage: api.fetchPage, decade: 1980 });
  assert.equal(result.items.length, 3);
  assert.equal(new Set(result.items.map((row) => row.id)).size, 3, 'a, b plus one copy of dup');
  assert.equal(result.complete, true);
});

test('completeness is a claim about the count, so a moving target says "keep going"', async () => {
  const rows = (page) => Array.from({ length: 60 }, (_, i) => ({ id: `p${page}t${i}`, year: 1980 }));
  const api = fakeApi({ pages: [rows(1), rows(2)], total: 136 });
  const result = await loadAllPages({ fetchPage: api.fetchPage, decade: 1980 });
  assert.equal(result.items.length, 120);
  assert.equal(result.complete, false, 'loaded !== total, so the honest answer is "not everything"');
  const line = shelfStatus({ loaded: result.items.length, total: result.total, complete: result.complete, truncated: result.truncated });
  assert.match(line.text, /16 to fetch/);
  assert.equal(line.resumable, true);
  assert.equal(line.tone, 'warn');
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
  assert.match(line.text, /page cap/);
});

test('a decade you leave mid-fetch cannot paint over the one you arrived at', async () => {
  const rows = (page) => Array.from({ length: 60 }, (_, i) => ({ id: `k${page}-${i}`, year: 1985 }));
  let current = true;
  let calls = 0;
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
    fetchPage: async () => {
      calls += 1;
      return { items: rows(calls), total: 120, hasMore: calls < 2 };
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
});

test('loadAllPages refuses to run without a way to fetch', async () => {
  await assert.rejects(loadAllPages({ decade: 1980 }), TypeError);
});

/* ------------------------------------------------------------------ the probe that makes the ruler exist */

test('one tiny request buys the whole ruler, and decides where the page lands', async () => {
  const years = [{ year: 1930, count: 1 }, { year: 1992, count: 40 }, { year: null, count: 3 }];
  const calls = [];
  const found = await readFacets({
    fetchPage: async (query) => {
      calls.push(query);
      return { items: [{ id: 'only' }], total: 44, archiveTotal: 44, facets: { years, minYear: 1930, maxYear: 1992 }, sources: [], genres: [] };
    },
  });
  const q = new URLSearchParams(calls[0]);
  assert.equal(calls.length, 1, 'a decade list is not worth two requests before first paint');
  assert.equal(q.get('limit'), String(FACET_PROBE_LIMIT), 'limit 1: we want the counts, not the rows');
  assert.ok(!q.has('yearFrom'), 'and no window, so the ruler sees every decade at once');

  assert.deepEqual(found.facets.years, years, 'the page stores what came back — this is the line that was missing when only Everything showed');
  assert.equal(found.total, 44);
  assert.equal(found.ruler.decades.length, 7, '1930s through 1990s, gaps included');
  assert.equal(found.ruler.accounted, 44);
  assert.equal(found.ruler.landing, 1990);
  assert.equal(found.needsSync, false);

  const sleeping = await readFacets({ fetchPage: async () => ({ items: [], total: 0, needsSync: true, facets: { years: [] } }) });
  assert.equal(sleeping.needsSync, true, 'an unseeded archive is reported, not rendered as an empty decade');
  assert.deepEqual(sleeping.facets.years, []);
});

test('rowKey is one rule for the fetch loop and the rendered list', () => {
  assert.equal(rowKey({ id: 'x1' }), 'x1');
  assert.equal(rowKey({ _id: 'y2' }), 'y2');
  assert.equal(rowKey({ title: 'Roja', year: 1992 }), 'Roja::1992', 'a row mid-sync still has an identity');
  assert.equal(rowKey(), 'undefined::', 'and a shapeless row cannot crash the loop');
});

test('the status chip says exactly what it means', () => {
  assert.deepEqual(shelfStatus({ loaded: 118, total: 118, complete: true }), { tone: 'ok', resumable: false, text: 'all 118 loaded' });
  assert.equal(shelfStatus({ loaded: 0, total: 0 }).text, 'nothing here');
  assert.equal(shelfStatus({ loaded: 0, total: 0, loading: true }).text, 'reading…');
  assert.equal(shelfStatus({ loaded: 60, total: 118 }).resumable, true);
  assert.match(shelfStatus({ loaded: 60, total: 118 }).text, /58 to fetch/);
  assert.equal(shelfStatus({ loaded: 60, total: 118, loading: true }).resumable, false, 'no button while it is still walking');
  assert.match(shelfStatus({ loaded: 60, total: 118, loading: true }).text, /60 \/ 118/);
});

/* ------------------------------------------------------------------ end to end over a fixture archive */

const FIXTURE = (() => {
  const SOURCES = [['Aha'], ['ErosNow'], ['Aha', 'ErosNow']];
  const items = [];
  // 490 titles: 481 dated across 1930—2009 plus 9 with no year at all. Deterministic, so the numbers
  // asserted below are the fixture, not a print-out.
  let n = 0;
  for (let year = 1930; year <= 2009; year += 1) {
    const perYear = 1 + ((year * 7) % 11);
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
    const minRating = Number(get('minRating') || 0);
    const yearFrom = Number(get('yearFrom') || 0);
    const yearTo = Number(get('yearTo') || 0);
    const undated = get('undated') === '1';
    const sort = get('sort') || 'rating.desc';

    const matches = (row, withWindow) => {
      if (source !== 'all' && !(row.sources || []).includes(source)) return false;
      if (minRating > 0 && !(row.rating >= minRating)) return false;
      if (!withWindow) return true;
      if (undated) return !row.year;
      if (yearFrom > 0 && !(row.year >= yearFrom)) return false;
      if (yearTo > 0 && !(row.year <= yearTo)) return false;
      return true;
    };

    const rows = FIXTURE.filter((row) => matches(row, true)).sort((a, b) => {
      if (sort === 'year.asc') return (a.year || 9999) - (b.year || 9999) || b.rating - a.rating;
      if (sort === 'year.desc') return (b.year || 0) - (a.year || 0) || b.rating - a.rating;
      if (sort === 'title.asc') return a.title.localeCompare(b.title);
      return b.rating - a.rating;
    });

    const total = rows.length;
    const items = rows.slice((page - 1) * limit, (page - 1) * limit + limit);

    // The year histogram the route computes over the filter *without* the window.
    const hist = new Map();
    for (const row of FIXTURE.filter((entry) => matches(entry, false))) hist.set(row.year || null, (hist.get(row.year || null) || 0) + 1);
    const datedYears = [...hist.keys()].filter((year) => Number.isFinite(year)).sort((a, b) => a - b);

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
        minYear: datedYears[0] ?? null,
        maxYear: datedYears[datedYears.length - 1] ?? null,
        years: [...hist.entries()]
          .map(([year, count]) => ({ year, count }))
          .sort((a, b) => (a.year ?? 0) - (b.year ?? 0)),
      },
    }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('over a 490-title archive, every decade tab shows every title in it', async () => {
  const { server, port } = await startApiServer();
  const fetchPage = async (query) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/vod?${query}`, { cache: 'no-store' });
    return response.json();
  };
  try {
    assert.ok(EXPECTED_TOTAL > 480, `fixture is ${EXPECTED_TOTAL} titles`);

    // The paint order the page depends on: probe (1 request) → ruler → decade walk.
    const found = await readFacets({ fetchPage });
    assert.equal(found.ruler.accounted, EXPECTED_TOTAL, 'decade counts + the no-year bucket = the archive');
    assert.equal(found.ruler.unaccounted, 0);
    assert.equal(found.ruler.undated, EXPECTED_UNDATED);
    assert.equal(found.ruler.minYear, 1930);
    assert.equal(found.ruler.maxYear, 2009);
    assert.deepEqual(found.ruler.decades.map((d) => d.decade), [1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000], 'no gaps in this span, and none invented');
    assert.ok(found.ruler.decades.every((d) => d.count > 0), 'this fixture has something in every decade');

    // Everything: the whole archive, in one walk.
    const everything = await loadAllPages({ fetchPage, decade: 'all', filters: { sort: 'year.asc' } });
    assert.equal(everything.items.length, EXPECTED_TOTAL, 'all 523 dated + the 9 with no year');
    assert.equal(everything.total, EXPECTED_TOTAL);
    assert.equal(everything.complete, true);
    assert.ok(everything.pages >= 9, `${everything.pages} requests for the whole shelf — this is why the page lands on a decade`);
    assert.equal(new Set(everything.items.map((row) => row.id)).size, EXPECTED_TOTAL, 'nothing duplicated across pages');

    // Each decade really contains each decade.
    for (const entry of found.ruler.decades) {
      const result = await loadAllPages({ fetchPage, decade: entry.decade, filters: { sort: 'year.asc' } });
      const expected = FIXTURE.filter((row) => row.year && decadeOf(row.year) === entry.decade);
      assert.equal(result.items.length, expected.length, `the ${entry.decade}s shows all ${expected.length}`);
      assert.equal(result.total, entry.count, 'and its count agrees with the ruler');
      assert.equal(result.complete, true);
      assert.deepEqual(
        [...result.items].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id),
        [...expected].sort((a, b) => a.id.localeCompare(b.id)).map((row) => row.id),
        `the ${entry.decade}s row set is exactly the fixture slice`,
      );
    }

    // Sum of decades equals the archive, which is the whole complaint in one line.
    const fromDecades = found.ruler.decades.reduce((sum, entry) => sum + entry.count, 0) + found.ruler.undated;
    assert.equal(fromDecades, EXPECTED_TOTAL, 'no title lives outside every tab');

    // The newest decade is the landing spot, and it is a real one.
    const landing = await loadAllPages({ fetchPage, decade: found.ruler.landing, filters: { sort: 'year.asc' } });
    assert.equal(found.ruler.landing, 2000);
    assert.equal(landing.complete, true);
    assert.ok(landing.items.every((row) => decadeOf(row.year) === 2000), 'the page opens inside a decade that has titles');

    // A decade is two or three requests, not thirteen.
    const busy = await loadAllPages({ fetchPage, decade: 1980, filters: { sort: 'year.asc' } });
    assert.ok(busy.pages <= 3, `the 1980s took ${busy.pages} requests`);
    assert.equal(busy.complete, true);

    // The no-year tab is not empty and not part of any decade.
    const orphan = await loadAllPages({ fetchPage, decade: 'undated', filters: { sort: 'year.asc' } });
    assert.equal(orphan.items.length, EXPECTED_UNDATED);
    assert.ok(orphan.items.every((row) => !row.year));
    assert.equal(orphan.complete, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the rows the page renders are the rows the archive has, in the order it claims', async () => {
  const { server, port } = await startApiServer();
  const fetchPage = async (query) => (await fetch(`http://127.0.0.1:${port}/api/vod?${query}`, { cache: 'no-store' })).json();
  try {
    const asc = await loadAllPages({ fetchPage, decade: 1950, filters: { sort: 'year.asc' } });
    const years = asc.items.map((row) => row.year);
    assert.deepEqual([...years].sort((a, b) => a - b), years, 'oldest first really is ascending — the spine has no other structure now');

    const desc = await loadAllPages({ fetchPage, decade: 1950, filters: { sort: 'rating.desc' } });
    const ratings = desc.items.map((row) => row.rating);
    assert.deepEqual([...ratings].sort((a, b) => b - a), ratings, 'and the rating chip sorts by rating');

    // Every row carries what the gutter prints, so a title is never rendered without its year or source.
    for (const row of desc.items.slice(0, 12)) {
      assert.ok(row.title && row.year && row.sources.length, `${row.title} is complete enough to render`);
    }

    // Sorting does not change the size of the decade.
    assert.equal(asc.items.length, desc.items.length);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a source filter would still not hide anything, because the page sends none', async () => {
  const { server, port } = await startApiServer();
  const fetchPage = async (query) => (await fetch(`http://127.0.0.1:${port}/api/vod?${query}`, { cache: 'no-store' })).json();
  try {
    const decade = await loadAllPages({ fetchPage, decade: 1990, filters: { sort: 'year.asc' } });
    const expected = FIXTURE.filter((row) => decadeOf(row.year) === 1990);
    assert.equal(decade.items.length, expected.length);
    assert.ok(decade.items.some((row) => row.sources.includes('ErosNow')), 'ErosNow titles are here — the old default was `Aha` only');
    assert.ok(decade.items.some((row) => row.sources.includes('Aha')), 'alongside Aha');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ------------------------------------------------------------------ the page and the route it calls */

test('the page stores the facets it is given, or the ruler has no decades', () => {
  const page = read('../app/classics/page.js');
  // The regression: `setFacets` was only ever called from the session-cache restore, so on a fresh
  // load `facets.years` stayed empty and the ruler printed one lonely `Everything` tab.
  assert.match(page, /if \(data\?\.facets\) setFacets\(data\.facets\);/, 'facets come from the response, not from a guess');
  assert.match(page, /setFacets\(found\.facets\);/, 'and the probe path stores them too');
  assert.match(page, /const found = await readFacets\(\{/, 'the probe is the tested function, not an inline fetch');
  assert.match(page, /setDecade\(\(current\) => \(current === null \? found\.ruler\.landing : current\)\)/, 'it lands on the newest decade, and only when nothing is chosen yet');
  assert.match(page, /onProgress: \(\{ loaded: count, total: countTotal, items: rows \}\) => \{[\s\S]{0,160}setItems\(rows\);/, 'paints each page as it lands');
  assert.match(page, /items\.map\(\(item\) => <TitleRow key=\{rowKey\(item\)\} item=\{item\} \/>\)/, 'the rendered keys are the loop keys');
  assert.match(page, /href=\{`\/classics\/\$\{item\.id\}`\}/, 'a row is the player page');
  assert.match(page, /fetch\('\/api\/vod\/sync'/, 'and the only manual sync entry point in the app stays here');
  assert.match(page, /setBudget\(DECADE_MAX_PAGES\)/, 'switching decades resets the budget instead of inheriting a bigger one');
  assert.ok(!/setInterval|new Worker/.test(page), 'no timer, no background worker: one probe plus a decade walk');
  assert.ok(!/eslint-disable/.test(page), 'and no rule had to be muted to get there');
});

test('the page is the mock: rail, big numerals, ghost decade, year in the gutter', () => {
  const page = read('../app/classics/page.js');
  assert.match(page, /import RailNav from '@\/components\/rail\/RailNav'/, 'the nav bar from the mock, on this page');
  assert.match(page, /<RailNav \/>/, 'rendered, not merely imported');
  assert.match(page, /className="jv-dec-page jv-rail-shift"/, 'and the page pays for the rail it now shows');
  assert.match(page, /<h1 className="jv-dec-heading">\s*Choose a decade\s*<span className="jv-dec-span">· \{span\}<\/span>/, 'the heading is the mock’s, with the year span beside it');
  assert.match(page, /jv-dec-ghost/, 'the decade written again behind the rows');
  assert.match(page, /jv-dec-gutter-year/, 'every row carries its year');
  assert.match(page, /jv-dec-gutter-src/, 'and its source');
  assert.match(page, /jv-dec-score/, 'the big amber score');
  for (const gone of ['jv-dec-search', 'jv-dec-tool', 'jv-dec-group', 'jv-dec-thumb', 'max-w-7xl', 'BrandLogo', 'DEFAULT_FILTERS', "source: 'all'", 'IntersectionObserver', 'sentinelRef']) {
    assert.ok(!page.includes(gone), `${gone} belongs to the version you rejected`);
  }
  assert.ok(!/<select|<input/.test(page), 'no native selects and no search box — three chips are the whole control surface');
});

test('the ruler is the mock’s numerals, and it is keyboard-first', () => {
  const page = read('../app/classics/page.js');
  assert.match(page, /role="tablist" aria-label="Decade"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /tabIndex=\{active \? 0 : -1\}/, 'Tab leaves the ruler after one stop instead of walking 8 decades');
  assert.match(page, /ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs\.length - 1 - index/);
  assert.match(page, /disabled=\{Boolean\(tab\.empty\)\}/, 'an empty decade is shown and disabled, so the zero is not a bug you have to discover');
  assert.match(page, /jv-dec-tab-\$\{next\.decade\}`\)\?\.focus\(\)/, 'focus follows the decade you chose');
  assert.match(page, /id="jv-dec-shelf"/);
  const css = read('../app/globals.css');
  const ruler = css.slice(css.indexOf('.jv-dec-tab {'), css.indexOf('.jv-dec-tab-label {'));
  assert.match(ruler, /border-bottom: 2px solid transparent;/);
  assert.match(css, /\.jv-dec-tab-on \{ border-bottom-color: var\(--dec-amber/, 'the active decade gets the amber underline from the mock, not a filled pill');
  assert.match(css, /\.jv-dec-tab-label \{ font-size: clamp\(1\.18rem, 2\.1vw, 1\.85rem\); font-weight: 900/, 'numerals, not labels — that is what makes it look like the mock at a glance');
});

test('day mode cannot wash this surface, because nothing here inherits a colour it does not declare', () => {
  const css = read('../app/globals.css');
  const block = css.slice(css.indexOf('.jv-dec-page {'));
  assert.ok(block.length > 4000, 'the decade room has its own stylesheet block');

  // The lesson from the hero: `html.day-mode main { color: … !important }` wins over any declaration on
  // the element itself, so the page must restate its own background in day mode, and every piece of
  // text must set its own colour rather than inheriting from main.
  assert.match(css, /html\.day-mode \.jv-dec-page \{[\s\S]{0,120}background: #08080b;/, 'day mode keeps the archive dark, like the banner');
  const textRules = [];
  for (const rule of block.split('}')) {
    const selector = rule.slice(0, rule.indexOf('{')).trim();
    if (rule.includes('@media') || rule.includes('min-width')) continue; // responsive overrides, not new colours
    if (!/^\.jv-dec/.test(selector)) continue;
    if (!/font-size:|[^-]font:/.test(rule)) continue;
    textRules.push(selector.replace(/\s*\{.*$/, ''));
    if (!/color:/.test(rule)) {
      assert.fail(`${selector.trim()} sizes text but sets no colour — day mode's blanket would paint it dark-on-dark`);
    }
  }
  assert.ok(textRules.length >= 12, `only ${textRules.length} text-bearing rules were checked — the guard is meant to cover the block`);

  const page = read('../app/classics/page.js');
  for (const utility of ['text-white', 'text-zinc', 'bg-black', 'bg-zinc', 'bg-[#', 'border-white/']) {
    assert.ok(!page.includes(utility), `${utility} would be grabbed by a day-mode blanket and repainted`);
  }
  const art = block.slice(block.indexOf('.jv-dec-art {'), block.indexOf('.jv-dec-art-none'));
  assert.match(art, /background: #14141c/, 'a poster keeps a dark backing in both themes, so a slow image is never a white hole');

  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-dec-row,'));
  assert.match(motion, /\.jv-dec-skel-row \{ animation: none; \}/, 'the skeleton shimmer stops when motion is unwanted');
  assert.match(motion, /\.jv-dec-row,\n\s*\.jv-dec-art,/, 'row and art transitions off too');
});

test('the route still answers what the ruler needs', () => {
  const route = read('../app/api/vod/route.js');
  const shelfBlock = route.slice(route.indexOf('const shelfFilter = {}'), route.indexOf('const filter = { ...shelfFilter }'));
  assert.ok(!/yearFrom|yearTo|undated/.test(shelfBlock), 'the base filter that feeds the histogram must ignore the window, or every other decade reads zero');
  assert.match(shelfBlock, /shelfFilter\.sources = source/, 'and a source filter still narrows the counts, if anything ever sends one');
  assert.match(route, /filter\.year = \{ \$in: \[null, 0\] \}/, 'the no-year tab is a real query, not a client-side filter');
  assert.match(route, /\{ \$match: shelfFilter \},\s*\{ \$group: \{ _id: '\$year', count: \{ \$sum: 1 \} \} \}/, 'the histogram is the whole shelf, per year');
  assert.match(route, /const \[facets, yearRows\] = await Promise\.all/, 'one round trip for both');
  assert.match(route, /archiveTotal: totalDbCount/);
  assert.ok(/limit'\), 24, 1, 60/.test(route), 'the 60 ceiling is what makes paging necessary — if this changes, so does the loop');
  const yearsShape = route.slice(route.indexOf('years: (yearRows'), route.indexOf('years: (yearRows') + 300);
  assert.match(yearsShape, /Number\.isFinite\(row\?\._id\)/, 'a null year stays null so the page can call it undated');
  assert.match(yearsShape, /row\.count > 0/, 'zero-count buckets are not sent');
});
