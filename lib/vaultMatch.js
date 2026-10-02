import { watchHref } from '@/lib/watch/policy';
/**
 * Vault match helpers — shared by /api/vault/match and the homepage click path.
 *
 * Cascade (locked):
 *   1. TMDB id
 *   2. IMDb id
 *   3. normalized title + year
 *
 * Movies and series both match the same way. Series records carry kind:'series'
 * and still open the vault embed player with the episode picker.
 */
import { slugify } from '@/lib/slug';

function normImdb(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.startsWith('tt') ? raw : `tt${raw.replace(/^tt/i, '')}`;
}

function yearOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {Array} movies  normalized vault catalogue (from loadVault /api/vault)
 * @param {{ tmdbId?, imdbId?, title?, year? }} query
 * @returns {object|null} matched vault movie (full record) or null
 */
export function matchVaultMovie(movies = [], query = {}) {
  const series = query.type === 'series' || query.type === 'tv';
  const list = (Array.isArray(movies) ? movies : []).filter((m) => !query.type || Boolean(m.isSeries || m.kind === 'series') === series);
  if (!list.length) return null;

  const wantedTmdb = Number(query.tmdbId) || 0;
  if (wantedTmdb) {
    const byTmdb = list.find((entry) => Number(entry.tmdbId) === wantedTmdb);
    if (byTmdb) return { ...byTmdb, matchedBy: 'tmdb' };
  }

  const wantedImdb = normImdb(query.imdbId);
  if (wantedImdb) {
    const byImdb = list.find((entry) => normImdb(entry.imdbId) === wantedImdb);
    if (byImdb) return { ...byImdb, matchedBy: 'imdb' };
  }

  const wantedSlug = slugify(String(query.title || ''));
  if (!wantedSlug) return null;
  const wantedYear = yearOf(query.year);

  const byTitle = list.filter((entry) => slugify(entry.title) === wantedSlug);
  if (!byTitle.length) return null;

  if (wantedYear) {
    const exactYear = byTitle.find((entry) => yearOf(entry.year) === wantedYear);
    if (exactYear) return { ...exactYear, matchedBy: 'title-year' };
    // Soft year tolerance ±1 (common vault/TMDB drift)
    const near = byTitle.find((entry) => {
      const y = yearOf(entry.year);
      return y && Math.abs(y - wantedYear) <= 1;
    });
    if (near) return { ...near, matchedBy: 'title-year-soft' };
    // If vault entries for this title have no year, still allow the hit
    const noYear = byTitle.find((entry) => !yearOf(entry.year));
    if (noYear) return { ...noYear, matchedBy: 'title' };
    return null;
  }

  return byTitle.length === 1 ? { ...byTitle[0], matchedBy: 'title' } : null;
}

/** Build the instant vault player deep-link. */
export function vaultPlayHref(movie) {
  if (!movie?.id) return '';
  return watchHref(movie, 'vault');
}
