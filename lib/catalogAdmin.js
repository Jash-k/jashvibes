import dbConnect from '@/lib/db';
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
  const docs = await CatalogOverride.find({}).lean().catch(() => []);
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
export async function listAdminCatalog({ q = '', filter = 'all', page = 1, pageSize = 25 } = {}) {
  const mongoose = await dbConnect();
  const doc = await mongoose.connection.db.collection('tamilmv_scrapes').findOne({ key: 'latest' });
  const overrideMap = await loadOverrideMap();

  const rows = [];
  for (const type of ['movies', 'series']) {
    for (const item of doc?.[type] || []) {
      const typed = { ...item, type: type === 'series' ? 'series' : 'movie' };
      const key = itemKey(typed);
      const override = overrideMap.get(key) || null;
      const decorated = decorate(typed, overrideMap).item;
      const needle = String(q || '').trim().toLowerCase();
      const haystack = `${decorated.title} ${decorated.rawTitle || ''} ${decorated.year || ''}`.toLowerCase();
      if (needle && !haystack.includes(needle)) continue;
      if (!matchesFilter(decorated, override, filter)) continue;
      rows.push({
        key,
        title: decorated.title || decorated.rawTitle || '',
        rawTitle: decorated.rawTitle || '',
        type: decorated.type,
        year: decorated.year || '',
        qualityTier: decorated.qualityTier || '',
        tmdbId: decorated.tmdbId || null,
        posterUrl: decorated.posterUrl || '',
        hidden: Boolean(override?.hidden),
        pinned: Boolean(override?.pinned),
        overridden: Boolean(override?.titleOverride || override?.yearOverride || override?.qualityOverride),
        updatedAt: override?.updatedAt || null,
      });
    }
  }

  rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || String(a.title).localeCompare(String(b.title)));

  const total = rows.length;
  const pageSafe = Math.max(1, Number(page) || 1);
  const start = (pageSafe - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total,
    page: pageSafe,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    updatedAt: doc?.refreshedAt || doc?.updatedAt || null,
    counts: {
      total: (doc?.movies?.length || 0) + (doc?.series?.length || 0),
      matched: rows.filter((row) => row.tmdbId).length,
      hidden: rows.filter((row) => row.hidden).length,
      pinned: rows.filter((row) => row.pinned).length,
    },
  };
}
