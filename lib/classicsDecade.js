/**
 * The maths behind ReTro's Decade Room.
 *
 * The page used to be a grid that showed 24 rows of whatever the first page held, with a decade chip
 * that only narrowed the same page — so "1980s" looked like it had 24 films when the archive had 118,
 * and the default source was `Aha`, which hid every ErosNow title outright. These functions are the
 * part worth trusting: bucketing years into decades, building the query a decade means, reading the
 * shelf page by page while it paints, and saying plainly whether everything has arrived.
 *
 * Nothing here touches the network or React, so `tests/classics-decade.test.js` runs the same code the
 * page runs — including against a 532-title fixture served over HTTP.
 */

/** `/api/vod` clamps `limit` to 60; asking for more is silently refused, so we page instead. */
export const DECADE_PAGE_LIMIT = 60;
/** 25 pages × 60 = 1500 rows. A ceiling only to stop a bad `total` from looping forever. */
export const DECADE_MAX_PAGES = 25;
/** The first request is a probe for the ruler: one row, all the counts. */
export const FACET_PROBE_LIMIT = 1;

const MIN_REAL_YEAR = 1000;
export const FALLBACK_FACETS = { sources: [], genres: [], years: [], minYear: null, maxYear: null };

/**
 * What makes two rows the same title. Mongo ids when they are there, and a title+year pair when a
 * source is mid-sync and has no id yet — the same rule for the fetch loop and the rendered list, so a
 * row that shifts between pages cannot be counted twice or rendered twice.
 */
export function rowKey(row = {}) {
  return String(row?.id ?? row?._id ?? `${row?.title}::${row?.year ?? ''}`);
}

/** The decade a year belongs to, or `null` when there is no usable year. */
export function decadeOf(year) {
  const numeric = Number(year);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.floor(numeric);
  if (rounded < MIN_REAL_YEAR) return null;
  return Math.floor(rounded / 10) * 10;
}

export function decadeLabel(decade) {
  return Number.isFinite(Number(decade)) ? `${decade}s` : decade === 'all' ? 'Everything' : 'No year';
}

/** The inclusive year window a decade asks the API for. */
export function decadeRange(decade) {
  const start = Number(decade);
  if (!Number.isFinite(start)) return null;
  return { from: start, to: start + 9 };
}

/**
 * Turn the API's `{ year, count }` histogram into ruler entries.
 *
 * Every gap between the oldest and newest title is kept as a zero — a decade that is really empty
 * should read as empty rather than disappear, and that is also what makes "did we show them all?"
 * answerable: `dated + undated` has to equal what the filtered shelf holds.
 *
 * `landing` is where the page opens. It is the newest decade that has titles, because "Everything" on
 * a 765-title archive is thirteen requests and a decade is two or three — you asked for the decade to
 * be the front door, so it is.
 */
export function buildDecades(facets = {}, { filteredTotal = null, archiveTotal = 0 } = {}) {
  const rows = Array.isArray(facets?.years) ? facets.years : [];
  const buckets = new Map();
  const realYears = [];
  let undated = 0;

  for (const row of rows) {
    const count = Math.max(0, Number(row?.count) || 0);
    if (!count) continue;
    const decade = decadeOf(row?.year);
    if (decade === null) {
      undated += count;
      continue;
    }
    realYears.push(Number(row.year));
    const entry = buckets.get(decade) || { decade, count: 0, years: [] };
    entry.count += count;
    entry.years.push({ year: Number(row.year), count });
    buckets.set(decade, entry);
  }

  const present = [...buckets.keys()].sort((a, b) => a - b);
  const decades = [];
  if (present.length) {
    for (let decade = present[0]; decade <= present[present.length - 1]; decade += 10) {
      const entry = buckets.get(decade);
      decades.push({
        decade,
        label: decadeLabel(decade),
        count: entry?.count || 0,
        empty: !entry,
        years: (entry?.years || []).slice().sort((a, b) => a.year - b.year),
      });
    }
  }

  const dated = decades.reduce((sum, entry) => sum + entry.count, 0);
  const accounted = dated + undated;
  const filled = decades.filter((entry) => entry.count > 0);
  return {
    decades,
    undated,
    dated,
    accounted,
    minYear: realYears.length ? Math.min(...realYears) : (Number(facets?.minYear) || null),
    maxYear: realYears.length ? Math.max(...realYears) : (Number(facets?.maxYear) || null),
    landing: filled.length ? filled[filled.length - 1].decade : 'all',
    // Titles the histogram cannot place next to the count the same filter reported. Non-zero here
    // means the shelf and the ruler disagree, and the page shows that instead of hiding it.
    unaccounted: filteredTotal === null || filteredTotal === undefined ? 0 : Math.max(0, Number(filteredTotal) - accounted),
    archiveTotal: Number(archiveTotal) || 0,
  };
}

/** One place that decides what "the 1980s, in this order" means as a query. */
export function buildShelfQuery({ filters = {}, decade = 'all', page = 1, limit = DECADE_PAGE_LIMIT } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sort', filters.sort || 'year.asc');

  if (filters.source && filters.source !== 'all') params.set('source', filters.source);
  if (filters.genre && filters.genre !== 'all') params.set('genre', filters.genre);
  if (filters.minRating) params.set('minRating', String(filters.minRating));

  if (decade === 'undated') {
    params.set('undated', '1');
  } else {
    const range = decadeRange(decade);
    if (range) {
      params.set('yearFrom', String(range.from));
      params.set('yearTo', String(range.to));
    }
  }
  return params.toString();
}

/**
 * Read a shelf all the way to the end, painting as it goes.
 *
 * `fetchPage` is injected — the page passes its own `fetch`, tests pass a fake — so what is covered
 * here is the real loop. `onProgress` receives the rows collected so far after every page, which is
 * what keeps the first 60 titles on screen after one request instead of after thirteen; the walk then
 * continues underneath. It refuses to claim completeness unless the row count matches `total`.
 * `isCurrent` lets a superseded request stop at the next page instead of painting an old decade.
 */
export async function loadAllPages({
  fetchPage,
  decade = 'all',
  filters = {},
  limit = DECADE_PAGE_LIMIT,
  maxPages = DECADE_MAX_PAGES,
  isCurrent = () => true,
  onProgress = null,
} = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('loadAllPages needs a fetchPage function');

  const items = [];
  const seen = new Set();
  let total = 0;
  let pages = 0;
  let complete = false;
  let truncated = false;

  for (let page = 1; page <= maxPages; page += 1) {
    const data = await fetchPage(buildShelfQuery({ filters, decade, page, limit }));
    if (!isCurrent()) return { stale: true, items: [], total: 0, pages, complete: false, truncated: false };

    const rows = Array.isArray(data?.items) ? data.items : [];
    pages = page;
    total = Number.isFinite(Number(data?.total)) ? Number(data.total) : total;

    for (const row of rows) {
      const key = rowKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(row);
    }

    onProgress?.({ loaded: items.length, total, page, items: items.slice() });

    if (!data?.hasMore) {
      complete = true;
      break;
    }
    // A page that answers with nothing while promising more would otherwise burn all 25 requests.
    if (!rows.length) break;
    if (page === maxPages) truncated = true;
  }

  // "Complete" is a claim about the count, not about the loop finishing: a sync landing mid-walk can
  // move `total`, and then the honest answer is "not everything yet, press the button".
  if (complete && total && items.length !== total) complete = false;

  return { stale: false, items, total, pages, complete, truncated };
}

/**
 * The one small request that makes the ruler exist: page 1 at `limit=1` returns the facets, the
 * windowed total and the archive total, and from those we know which decade to open on. Without this
 * the page has no `facets.years` and the ruler silently shows only "Everything" — which is the exact
 * regression this function and its test were written to prevent.
 */
export async function readFacets({ fetchPage, filters = {}, isCurrent = () => true } = {}) {
  const data = await fetchPage(buildShelfQuery({ filters, decade: 'all', page: 1, limit: FACET_PROBE_LIMIT }));
  if (!isCurrent()) return null;
  const facets = data?.facets || FALLBACK_FACETS;
  return {
    facets,
    total: Number(data?.total) || 0,
    archiveTotal: Number(data?.archiveTotal) || 0,
    needsSync: Boolean(data?.needsSync),
    ruler: buildDecades(facets, { filteredTotal: null, archiveTotal: data?.archiveTotal }),
  };
}

/** The chip that tells you whether the decade is fully on screen. Short, because it sits in a row. */
export function shelfStatus({ loaded = 0, total = 0, complete = false, truncated = false, loading = false } = {}) {
  if (!total) return { tone: 'empty', resumable: false, text: loading ? 'reading…' : 'nothing here' };
  if (complete && loaded === total) return { tone: 'ok', resumable: false, text: `all ${total} loaded` };
  const missing = Math.max(0, total - loaded);
  if (loading) return { tone: 'muted', resumable: false, text: `${loaded} / ${total} · ${missing} to go` };
  if (truncated) return { tone: 'warn', resumable: true, text: `${loaded} / ${total} · page cap` };
  return { tone: 'warn', resumable: true, text: `${loaded} / ${total} · ${missing} to fetch` };
}
