/**
 * The anime catalogue: TMDB's Animation genre, page by page, with a process cache.
 *
 * Why this exists as its own thing: the daily 1tamilmv scrape carries no genre information, so there is
 * nothing on the catalog side to filter — an "Anime" destination has to ask TMDB for the genre directly.
 * The same `discover` helper the Tamil listings use does it in one request.
 *
 * Free-tier shape, same rules as `lib/liveEpg.js`: one upstream call per (type, page) per 30 minutes,
 * single-flight so two taps on "Load more" cannot stack, cached in `globalThis` so a dev reload does not
 * look like a memory leak, and a failed refresh keeps serving the last good page instead of erroring.
 * Nothing is written to MongoDB — a genre listing is derived data, so a restart just refetches it.
 */
import { fetchTMDB, mapTMDBMovie, mapTMDBSeries } from '@/lib/tmdb';

export const ANIMATION_GENRE_ID = 16;
export const CACHE_TTL_MS = 30 * 60 * 1000;
// TMDB's discover endpoint stops answering past page 500 and starts returning empty pages long
// before that; 10 pages is 200 titles, which is more than anyone scrolls on a phone.
export const MAX_PAGE = 10;

const store = () => {
  if (typeof globalThis === 'undefined') return {};
  if (!globalThis.__jashAnimeCatalog) globalThis.__jashAnimeCatalog = new Map();
  return globalThis.__jashAnimeCatalog;
};

export function clampDiscoverPage(page) {
  const value = Math.floor(Number(page));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(value, MAX_PAGE);
}

/** Public so the params are testable without a network call — `with_original_language` is the same
 *  knob `lib/tmdb.js` already uses for the Tamil listings, and it is what keeps "anime" meaning
 *  Japanese animation instead of every animated children's film in the index. */
export function buildDiscoverParams({ type = 'movie', page = 1 } = {}) {
  const isSeries = type === 'series';
  return {
    with_genres: ANIMATION_GENRE_ID,
    with_original_language: 'ja',
    sort_by: 'popularity.desc',
    include_adult: 'false',
    page: clampDiscoverPage(page),
    ...(isSeries ? { watch_region: 'IN' } : {}),
  };
}

export function normalizeDiscoverPage(payload, { type = 'movie' } = {}) {
  const map = type === 'series' ? mapTMDBSeries : mapTMDBMovie;
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return {
    items: results.map(map),
    page: Number(payload?.page) || clampDiscoverPage(1),
    totalPages: Number(payload?.total_pages) || 0,
  };
}

export async function getAnimeTitles({ type = 'movie', page = 1 } = {}) {
  const kind = type === 'series' ? 'series' : 'movie';
  const targetPage = clampDiscoverPage(page);
  const key = `${kind}:${targetPage}`;
  const cache = store();
  const hit = cache.get?.(key);
  const now = Date.now();

  if (hit?.promise) return hit.promise;
  if (hit?.data && now - hit.at < CACHE_TTL_MS) return { ...hit.data, cached: true };

  const request = (async () => {
    try {
      const payload = await fetchTMDB(kind === 'series' ? 'discover/tv' : 'discover/movie', buildDiscoverParams({ type: kind, page: targetPage }));
      const data = normalizeDiscoverPage(payload, { type: kind });
      cache.set?.(key, { at: Date.now(), data });
      return { ...data, cached: false };
    } catch (error) {
      if (hit?.data) return { ...hit.data, cached: true, stale: true, warning: String(error?.message || error).slice(0, 200) };
      throw error;
    } finally {
      const current = cache.get?.(key);
      if (current?.promise === request) cache.delete?.(key);
    }
  })();

  cache.set?.(key, { at: now, data: hit?.data || null, promise: request });
  return request;
}
