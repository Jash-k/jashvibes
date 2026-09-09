/**
 * The maths behind ReTro's Decade Room.
 *
 * The page used to be a grid that showed 24 rows of whatever the first page held, with a decade chip
 * that only narrowed the same page — so "1980s" looked like it had 24 films when the archive had 118,
 * and the default source was `Aha`, which hid every ErosNow title outright. These functions are the
 * part worth trusting: bucketing years into decades, building the query a decade means, walking pages
 * until the shelf is empty, and saying plainly whether everything arrived.
 *
 * Nothing here touches the network or React, so `tests/classics-decade.test.js` runs the same code the
 * page runs.
 */

/** `/api/vod` clamps `limit` to 60; asking for more is silently refused, so we page instead. */
export const DECADE_PAGE_LIMIT = 60;
/** 25 pages × 60 = 1500 rows. A ceiling only to stop a bad `total` from looping forever. */
export const DECADE_MAX_PAGES = 25;

const MIN_REAL_YEAR = 1000;

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
 */
export function buildDecades(facets = {}, { filteredTotal = 0, archiveTotal = 0 } = {}) {
  const rows = Array.isArray(facets?.years) ? facets.years : [];
  const buckets = new Map();
  let undated = 0;

  for (const row of rows) {
    const count = Math.max(0, Number(row?.count) || 0);
    if (!count) continue;
    const decade = decadeOf(row?.year);
    if (decade === null) {
      undated += count;
      continue;
    }
    const entry = buckets.get(decade) || { decade, count: 0, years: [] };
    entry.count += count;
    const year = Number(row.year);
    entry.years.push({ year, count });
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
  return {
    decades,
    undated,
    dated,
    accounted,
    // Titles the histogram cannot place next to the count the same filter reported. Non-zero here
    // means the shelf and the ruler disagree, which the page shows instead of hiding.
    unaccounted: Math.max(0, (Number(filteredTotal) || 0) - accounted),
    archiveTotal: Number(archiveTotal) || 0,
  };
}

/** One place that decides what "the 1980s, from these sources, in this order" means as a query. */
export function buildShelfQuery({ filters = {}, decade = 'all', page = 1, limit = DECADE_PAGE_LIMIT } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  params.set('sort', filters.sort || 'year.asc');

  const q = String(filters.q || '').trim();
  if (q) params.set('q', q);
  if (filters.source && filters.source !== 'all') params.set('source', filters.source);
  if (filters.genre && filters.genre !== 'all') params.set('genre', filters.genre);
  if (filters.minRating) params.set('minRating', String(filters.minRating));
  if (filters.type && filters.type !== 'all') params.set('type', filters.type);

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
 * Read a shelf to the end.
 *
 * `fetchPage` is injected — the page passes its own `fetch`, tests pass a fake — so what is covered
 * here is the real loop: it stops only when the API says `hasMore` is false, it does not double-count a
 * row that shifts between pages, and it refuses to claim completeness unless the row count matches
 * `total`. `isCurrent` lets a superseded request finish harmlessly instead of painting an old decade.
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

    onProgress?.({ loaded: items.length, total, page });

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
 * Rows grouped by release year, oldest or newest first, so the decade reads as a timeline.
 * Titles with no year are kept in a visible "No year" group — they are in the archive, and a decade
 * view that quietly drops them is how "it doesn't show all my movies" gets reported.
 */
export function groupRowsByYear(items = [], { sort = 'year.asc' } = {}) {
  const descending = String(sort).endsWith('.desc');
  const byYear = new Map();
  const undated = [];

  for (const item of Array.isArray(items) ? items : []) {
    const year = Number(item?.year);
    if (!Number.isFinite(year) || year < MIN_REAL_YEAR) {
      undated.push(item);
      continue;
    }
    const bucket = byYear.get(year) || [];
    bucket.push(item);
    byYear.set(year, bucket);
  }

  const byRating = (a, b) => (Number(b?.rating) || 0) - (Number(a?.rating) || 0) || String(a?.title || '').localeCompare(String(b?.title || ''));
  const groups = [...byYear.entries()]
    .sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]))
    .map(([year, rows]) => ({ year, label: String(year), count: rows.length, items: rows.slice().sort(byRating) }));

  if (undated.length) {
    groups.push({ year: null, label: 'No year', count: undated.length, items: undated.slice().sort(byRating) });
  }
  return groups;
}

/** The one sentence that tells you whether the decade is fully on screen. */
export function shelfStatus({ loaded = 0, total = 0, complete = false, truncated = false, loading = false } = {}) {
  if (loading) return { tone: 'muted', resumable: false, text: `Reading the shelf · ${loaded} of ${total || '?'} so far` };
  if (!total) return { tone: 'empty', resumable: false, text: 'Nothing here for this slice — another decade, or clear a filter.' };
  if (complete && loaded === total) return { tone: 'ok', resumable: false, text: `All ${total} loaded — nothing from this decade is hidden behind a page` };
  const missing = Math.max(0, total - loaded);
  if (truncated) {
    return { tone: 'warn', resumable: true, text: `${loaded} of ${total} loaded — that is the ${DECADE_MAX_PAGES}-page ceiling, press to keep going` };
  }
  return { tone: 'warn', resumable: true, text: `${loaded} of ${total} loaded · ${missing} still to fetch` };
}
