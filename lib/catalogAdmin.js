import { scrapeCollection } from '@/lib/tamilmvPayload';
import CatalogOverride from '@/models/CatalogOverride';

/**
 * Admin-side catalog logic shared by the public TamilMV read (filtering) and
 * the admin panel (listing + overrides). One Mongo lookup decorates the whole
 * cached payload: hidden rows drop out, pinned rows float, manual corrections
 * (title / year / quality) are applied at read time.
 */

/** Stable cross-sync identity of a catalog row: its type + the RAW scraped title. */
export function itemKey(item = {}) {
  const raw = String(item.rawTitle || item.parsedSource || item.title || '').trim();
  return `${item.type === 'series' ? 'series' : 'movie'}:${raw.toLowerCase()}`;
}

export async function loadOverrideMap() {
  // No `.limit()` here on purpose. This map decorates EVERY public catalogue read,
  // and a missing override silently drops the owner's correction — a truncated list
  // would be a wrong answer, not a slow one. The projection is the win instead: the
  // doc carries a dozen fields and `decorate` reads six, so on a catalogue with
  // thousands of overrides this cuts the payload without changing a single result.
  const docs = await CatalogOverride.find({})
    .select('key hidden pinned titleOverride yearOverride qualityOverride')
    .lean()
    .catch(() => []);
  return new Map(docs.map((doc) => [doc.key, doc]));
}

function decorate(item, overrideMap) {
  const key = itemKey(item);
  const override = overrideMap.get(key);
  if (!override) return { item, key, override: null };
  const next = { ...item };
  if (override.titleOverride) next.title = override.titleOverride;
  if (override.yearOverride) next.year = override.yearOverride;
  if (override.qualityOverride) {
    next.qualityTier = override.qualityOverride;
    next.qualityOverrideApplied = true;
  }
  next.adminHidden = Boolean(override.hidden);
  next.adminPinned = Boolean(override.pinned);
  return { item: next, key, override };
}

/**
 * Apply the owner's overrides to a cached payload.
 * Returns the shaped payload for public reads (hidden removed, pinned first).
 */
export function applyOverridesToPayload(payload, overrideMap) {
  const shape = (list = [], type) => {
    const decorated = list.map((item) => {
      const withType = { ...item, type: item.type || type };
      return decorate(withType, overrideMap);
    });
    const visible = decorated.filter((row) => !row.override?.hidden);
    visible.sort((a, b) => Number(Boolean(b.override?.pinned)) - Number(Boolean(a.override?.pinned)));
    return {
      items: visible.map((row) => ({ ...row.item, adminPinned: Boolean(row.override?.pinned) })),
      hiddenCount: decorated.length - visible.length,
    };
  };

  const movies = shape(payload?.movies, 'movie');
  const series = shape(payload?.series, 'series');
  return {
    ...payload,
    movies: movies.items,
    series: series.items,
    items: [...movies.items, ...series.items],
    adminHiddenCount: movies.hiddenCount + series.hiddenCount,
  };
}

function matchesFilter(item, override, filter) {
  const matched = Boolean(item.tmdbId);
  if (filter === 'matched') return matched;
  if (filter === 'unmatched') return !matched;
  if (filter === 'hidden') return Boolean(override?.hidden);
  if (filter === 'pinned') return Boolean(override?.pinned);
  return true; // 'all'
}

/**
 * Admin listing: the raw cache plus every override, with search + filter +
 * paging. Hidden rows are INCLUDED here (that is the point of the panel).
 */
/**
 * The order a viewer actually sees: scraped order per section, with pinned rows floated to the
 * top (stable, so pins keep their relative scraped order). Mirrors `applyOverridesToPayload`
 * exactly — if those two ever disagree, the admin panel starts lying about the home page.
 */
function homeComparator(a, b) {
  // Boolean() both sides: a row that simply lacks the field must not turn the whole comparison
  // into NaN (which sort() reads as "equal" and silently leaves the pin where it was).
  return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.sourceIndex - b.sourceIndex;
}

const SORTS = {
  // What the viewer gets. The default, because anything else is a debugging view.
  home: homeComparator,
  az: (a, b) => String(a.title).localeCompare(String(b.title)) || homeComparator(a, b),
  newest: (a, b) => String(b.year || '').localeCompare(String(a.year || '')) || homeComparator(a, b),
  edited: (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || homeComparator(a, b),
  pinned: (a, b) => Number(b.pinned) - Number(a.pinned) || homeComparator(a, b),
};

export const CATALOG_SORTS = Object.keys(SORTS);
export const CATALOG_SECTIONS = ['all', 'movies', 'series'];
const SECTIONS = new Set(CATALOG_SECTIONS);

/**
 * `position` = home position, computed over the WHOLE catalogue and never over the filtered view,
 * so a row keeps saying "I am 34th on the home page" while you are looking at a search result.
 * Mutates the rows it is given; called once, before any filtering.
 */
export function assignHomePositions(rows = []) {
  for (const type of ['movies', 'series']) {
    rows.filter((row) => row.section === type).sort(homeComparator)
      .forEach((row, index) => { row.position = index + 1; });
  }
  return rows;
}

/**
 * The listing: `section` restricts the rows, then `sort` orders them. With `section: 'all'` the
 * sections stay split (movies, then series) because that is how home renders; inside one section
 * the chosen sort applies.
 *
 * It filters as well as orders on purpose. The caller (`listAdminCatalog`) has already applied the
 * section, so this is idempotent there — but a function that accepted `section: 'series'` and
 * returned movies would be a trap for the next reader, and the failure would look like a wrong
 * order rather than a missing filter.
 */
export function orderCatalogRows(rows = [], { sort = 'home', section = 'all' } = {}) {
  const compare = SORTS[sort] || SORTS.home;
  const sectionKey = SECTIONS.has(section) ? section : 'all';
  return rows
    .filter((row) => sectionKey === 'all' || row.section === sectionKey)
    .slice()
    .sort((a, b) => {
      if (sectionKey === 'all' && a.section !== b.section) return a.section === 'movies' ? -1 : 1;
      return compare(a, b);
    });
}

/**
 * Admin listing: the raw cache plus every override, with search + filter + section + sort + paging.
 * Hidden rows are INCLUDED here (that is the point of the panel).
 *
 * `position` is always the HOME position (1-based, within its own section), whatever the current
 * sort is — so a row can be read as "this is 34th on the home page" no matter how the list is
 * ordered on screen. `counts` are measured over the whole catalogue, and `view` is what the current
 * search/filter/section left behind, so the numbers no longer change meaning as you filter.
 */
export async function listAdminCatalog({ q = '', filter = 'all', page = 1, pageSize = 25, sort = 'home', section = 'all' } = {}) {
  const doc = await (await scrapeCollection()).findOne({ key: 'latest' });
  const overrideMap = await loadOverrideMap();
  const needle = String(q || '').trim().toLowerCase();
  const sortKey = SORTS[sort] ? sort : 'home';
  const sectionKey = SECTIONS.has(section) ? section : 'all';

  const all = [];
  for (const type of ['movies', 'series']) {
    (doc?.[type] || []).forEach((item, sourceIndex) => {
      const typed = { ...item, type: type === 'series' ? 'series' : 'movie' };
      const key = itemKey(typed);
      const override = overrideMap.get(key) || null;
      // The DECORATED row, not the raw one: the panel must show the same title/year/quality the
      // viewer sees, or a correction looks like it did not apply.
      const decorated = decorate(typed, overrideMap).item;
      all.push({
        key,
        title: decorated.title || decorated.rawTitle || '',
        rawTitle: decorated.rawTitle || '',
        type: decorated.type,
        section: type,
        sourceIndex,
        year: decorated.year || '',
        qualityTier: decorated.qualityTier || '',
        tmdbId: decorated.tmdbId || null,
        posterUrl: decorated.posterUrl || '',
        hidden: Boolean(override?.hidden),
        pinned: Boolean(override?.pinned),
        overridden: Boolean(override?.titleOverride || override?.yearOverride || override?.qualityOverride),
        updatedAt: override?.updatedAt || null,
      });
    });
  }

  assignHomePositions(all);

  const counts = {
    total: all.length,
    matched: all.filter((row) => row.tmdbId).length,
    hidden: all.filter((row) => row.hidden).length,
    pinned: all.filter((row) => row.pinned).length,
    movies: all.filter((row) => row.section === 'movies').length,
    series: all.filter((row) => row.section === 'series').length,
  };

  const rows = all.filter((row) => {
    if (sectionKey === 'movies' && row.section !== 'movies') return false;
    if (sectionKey === 'series' && row.section !== 'series') return false;
    if (needle && !`${row.title} ${row.rawTitle} ${row.year}`.toLowerCase().includes(needle)) return false;
    // `matchesFilter` reads tmdbId/hidden/pinned, all of which the row carries itself.
    return matchesFilter(row, row, filter);
  });

  const total = rows.length;
  const pageSafe = Math.max(1, Number(page) || 1);
  const start = (pageSafe - 1) * pageSize;
  return {
    rows: orderCatalogRows(rows, { sort: sortKey, section: sectionKey }).slice(start, start + pageSize),
    total,
    page: pageSafe,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    sort: sortKey,
    section: sectionKey,
    updatedAt: doc?.refreshedAt || doc?.updatedAt || null,
    counts: { ...counts, view: total },
  };
}
