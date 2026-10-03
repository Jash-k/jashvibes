/*
 * lib/tamilmvPayload.js — the read-time shaping of the TamilMV catalogue.
 *
 * These helpers used to live inside app/api/tamilmv/route.js. They moved here when
 * the home page began server-rendering its hero banner: the server needs the SAME
 * payload the API serves (title matches merged, quality tagged, owner overrides
 * applied, then paginated), and a second copy of that pipeline is how the hero and
 * the grid start disagreeing about what the catalogue contains.
 *
 * The bodies are unchanged from the route — this moved lines, it did not rewrite
 * them. Both the route and the server-rendered home hero import from here, which is
 * what keeps them one source instead of two that drift.
 */
import dbConnect from '@/lib/db';
import { applyMatchesToItems, findMatchesForItems } from '@/lib/titleMatch';
import { applyOverridesToPayload, loadOverrideMap } from '@/lib/catalogAdmin';
import { parseReleaseQuality } from '@/lib/quality';

export const COLLECTION_NAME = 'tamilmv_scrapes';

export const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export const SYNC_INTERVAL_MS = Number(process.env.TAMILMV_SYNC_INTERVAL_MS || SIX_HOURS_MS);

// Keep the first request light. Lazy loading expands the cache page-by-page up
// to this maximum instead of forcing a large scrape before anything appears.
export const DEFAULT_MAX_CACHE_LIMIT = 90;

export function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function getMaxCacheLimit() {
  return clampNumber(process.env.TAMILMV_CACHE_LIMIT, DEFAULT_MAX_CACHE_LIMIT, DEFAULT_PAGE_LIMIT, 300);
}

export async function getCollection() {
  const mongoose = await dbConnect();
  return mongoose.connection.db.collection(COLLECTION_NAME);
}

/*
 * The whole catalogue cache is ONE row, addressed as { key: 'latest' } from seven
 * call sites across five files — but nothing enforced that it stayed one row.
 * `updateOne(…, { upsert: true })` is not atomic against a concurrent upsert, and
 * two writers exist (the scrape and the cron job). A second row is quiet damage:
 * findOne starts returning an arbitrary one, the admin "force resync" only deletes
 * one of them, and the cron only refreshes one — so the panel silently stops
 * working.
 *
 * Declaring the invariant makes the upsert safe: with a unique index the loser of a
 * concurrent upsert gets a duplicate-key error instead of inserting a second row.
 * If duplicates already exist the index cannot be built, so they are repaired first
 * (keep the freshest, drop the rest) and a failure is never allowed to throw —
 * reads must survive a database that is in any state.
 */
let invariant = null;

async function ensureSingleRow(collection) {
  if (!invariant) {
    invariant = collection
      .createIndex({ key: 1 }, { unique: true })
      .catch(async (error) => {
        console.warn('[tamilmv] unique index on', COLLECTION_NAME, 'unavailable:', error?.message || error);
        try {
          const rows = await collection.find({ key: 'latest' }).sort({ refreshedAt: -1 }).toArray();
          for (const stale of rows.slice(1)) await collection.deleteOne({ _id: stale._id });
          if (rows.length > 1) await collection.createIndex({ key: 1 }, { unique: true });
        } catch (repairError) {
          console.warn('[tamilmv] could not repair duplicate cache rows:', repairError?.message || repairError);
        }
        // Always leave *some* index on the lookup key, even if uniqueness was refused.
        await collection.createIndex({ key: 1 }).catch(() => {});
      });
  }
  await invariant;
  return collection;
}

/** The only sanctioned way to reach the scrape collection. */
export async function scrapeCollection() {
  return ensureSingleRow(await getCollection());
}

export async function getCachedScrape() {
  const collection = await scrapeCollection();
  return collection.findOne({ key: 'latest' });
}

export async function saveScrape(payload) {
  const collection = await scrapeCollection();
  await collection.updateOne(
    { key: 'latest' },
    {
      $set: {
        key: 'latest',
        ...payload,
        refreshedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

/** Admin overrides (hide / pin / manual corrections), applied at read time. */
export async function withOverrides(payload) {
  try {
    const overrideMap = await loadOverrideMap();
    if (!overrideMap.size) return payload;
    return applyOverridesToPayload(payload, overrideMap);
  } catch {
    return payload; // overrides must never take the catalog down
  }
}

export function cacheAgeMs(doc) {
  if (!doc?.refreshedAt) return Infinity;
  const time = new Date(doc.refreshedAt).getTime();
  return Number.isFinite(time) ? Date.now() - time : Infinity;
}

export function isSyncDue(doc) {
  return cacheAgeMs(doc) >= SYNC_INTERVAL_MS;
}

// Manual poster matches (title_matches collection) must survive rescrapes, so
// they are merged at read time instead of being baked into the cached scrape.
export function tagItemQuality(item) {
  if (!item) return item;
  const text = item.rawTitle || item.parsedSource || item.synopsis || item.title || '';
  const parsed = parseReleaseQuality(text);
  const tier = parsed.tier || item.qualityTier || '';
  if (!tier) return item;
  const label = parsed.label || item.qualityLabel || tier;
  if (item.qualityTier === tier && item.qualityLabel) return item;
  return { ...item, qualityTier: tier, qualityLabel: label };
}

export function tagListQuality(items = []) {
  return items.map(tagItemQuality);
}

export async function withTitleMatches(payload) {
  const tagged = {
    ...payload,
    movies: tagListQuality(payload?.movies || []),
    series: tagListQuality(payload?.series || []),
  };
  try {
    const docs = await findMatchesForItems([...(payload?.movies || []), ...(payload?.series || [])]);
    if (!docs.length) return tagged;
    // Contract: manual/TMDB matches only enrich (poster, rating, ids) —
    // quality is re-computed on top so it can NEVER be dropped by a match.
    return {
      ...tagged,
      movies: tagListQuality(applyMatchesToItems(tagged.movies, docs)),
      series: tagListQuality(applyMatchesToItems(tagged.series, docs)),
    };
  } catch {
    return tagged;
  }
}

export function paginateList(items = [], paging) {
  return items.slice(paging.start, paging.end);
}

export function pageInfo(items = [], paging, cacheLimit = 0, maxCacheLimit = DEFAULT_MAX_CACHE_LIMIT) {
  const canExpandCache = items.length > 0 && items.length >= cacheLimit && cacheLimit < maxCacheLimit && paging.end >= items.length;
  return {
    page: paging.page,
    limit: paging.limit,
    total: items.length,
    returned: Math.max(0, Math.min(paging.limit, items.length - paging.start)),
    // If the user reached the current cache edge and we have not reached the
    // max cache limit, allow one more lazy request to expand the cache.
    hasMore: paging.end < items.length || canExpandCache,
  };
}

export function paginatePayload(payload, paging, maxCacheLimit = DEFAULT_MAX_CACHE_LIMIT) {
  const allMovies = payload?.movies || [];
  const allSeries = payload?.series || [];
  const movies = paging.group === 'series' ? [] : paginateList(allMovies, paging);
  const series = paging.group === 'movies' ? [] : paginateList(allSeries, paging);

  const cacheLimit = payload?.cacheLimit || payload?.limitPerType || 0;

  return {
    ...payload,
    movies,
    series,
    tvshows: [],
    items: [...movies, ...series],
    count: movies.length + series.length,
    totalCached: allMovies.length + allSeries.length,
    cacheLimit,
    pagination: {
      page: paging.page,
      limit: paging.limit,
      group: paging.group,
      movies: pageInfo(allMovies, paging, cacheLimit, maxCacheLimit),
      series: pageInfo(allSeries, paging, cacheLimit, maxCacheLimit),
    },
  };
}
