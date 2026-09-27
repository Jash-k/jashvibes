/**
 * moviesda background index — v10.6.0.
 *
 * The watch page asks (in the background, never blocking playback) whether the
 * current title exists in the scraper's committed data files. Matching is by
 * tmdbId when the scraper had the TMDB secret, else normalized title + year.
 * No MongoDB involved: this reads the raw GitHub files with a 30-minute cache.
 *
 * Only the STABLE identifiers ever come from here — the pageUrl. Playable
 * links are minted on demand by lib/moviesda/resolve.js.
 */
import { slugify } from '@/lib/slug';

const JSON_URL = process.env.MOVIESDA_JSON_URL || 'https://raw.githubusercontent.com/Jash-k/mv_scrapper/refs/heads/main/data/moviesda.json';
const EMBEDS_URL = process.env.MOVIESDA_EMBEDS_URL || 'https://raw.githubusercontent.com/Jash-k/mv_scrapper/refs/heads/main/data/embeds.json';
const INDEX_TTL_MS = Number(process.env.MOVIESDA_INDEX_TTL_MS || 30 * 60 * 1000);

const indexCache = { at: 0, entries: [] };

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; JaSH-ViBeS/10.6)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** Load + cache the moviesda index (best-effort: failures give an empty list). */
export async function getMoviesdaIndex() {
  if (indexCache.at && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.entries;
  const [mp4Res, embedRes] = await Promise.allSettled([fetchJson(JSON_URL), fetchJson(EMBEDS_URL)]);
  const mp4List = mp4Res.status === 'fulfilled' && Array.isArray(mp4Res.value) ? mp4Res.value : [];
  const embedList = embedRes.status === 'fulfilled' && Array.isArray(embedRes.value) ? embedRes.value : [];

  const byId = new Map();
  const absorb = (list, kind) => {
    for (const movie of list) {
      if (!movie?.pageUrl || !movie?.titleGuess) continue;
      const id = String(movie.id || `${slugify(movie.titleGuess)}-${movie.yearGuess || ''}`);
      const entry = byId.get(id) || {
        id,
        title: String(movie.titleGuess).trim(),
        year: Number(movie.yearGuess) || 0,
        tmdbId: Number(movie.tmdbId) || 0,
        pageUrl: String(movie.pageUrl),
        mp4Count: 0,
        embedCount: 0,
      };
      if (kind === 'mp4') entry.mp4Count += (movie.qualities || []).filter((q) => q.type !== 'iframe').length;
      else entry.embedCount += (movie.qualities || []).filter((q) => q.type === 'iframe').length;
      if (!entry.tmdbId && movie.tmdbId) entry.tmdbId = Number(movie.tmdbId) || 0;
      byId.set(id, entry);
    }
  };
  absorb(mp4List, 'mp4');
  absorb(embedList, 'embed');

  indexCache.entries = [...byId.values()];
  indexCache.at = Date.now();
  return indexCache.entries;
}

/**
 * Match a TMDB-known title against the index.
 * Exact tmdbId wins; otherwise normalized title (+ year when both sides know
 * it). Returns null when nothing matches or when year contradicts.
 */
export async function matchMoviesda({ tmdbId, title, year } = {}) {
  const entries = await getMoviesdaIndex();
  if (!entries.length) return null;

  const wantedId = Number(tmdbId) || 0;
  if (wantedId) {
    const byId = entries.find((entry) => entry.tmdbId && entry.tmdbId === wantedId);
    if (byId) return byId;
  }

  const wantedSlug = slugify(String(title || ''));
  if (!wantedSlug) return null;
  const wantedYear = Number(year) || 0;
  const byTitle = entries.filter((entry) => slugify(entry.title) === wantedSlug);
  if (!byTitle.length) return null;
  if (wantedYear && byTitle.some((entry) => entry.year)) {
    return byTitle.find((entry) => entry.year === wantedYear) || null;
  }
  return byTitle[0] || null;
}
