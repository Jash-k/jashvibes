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
// Unicode-safe exact normalization: preserves sequel numbers and decimal titles.
export function vaultTitleKey(value = '') {
  return String(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '')
    .replace(/(?<=\d)\.(?=\d)/g, 'decimalpoint')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
const imdb = value => /^tt\d+$/i.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : '';
const yearOf = value => Number(value) > 0 ? Number(value) : 0;
const yearsOf = item => [yearOf(item.year), yearOf(item.originalYear)].filter(Boolean);
const aliasesOf = item => [item.title, item.originalTitle, item.tmdbTitle, ...(item.aliases || [])].filter(Boolean);
function pickIdentity(list, query) {
  if (!list.length) return null;
  const season = Number(query.season) || 0;
  if (season) {
    const sameSeason = list.filter(m => m.embeds?.some(e => Number(e.season) === season));
    if (!sameSeason.length) return null;
    list = sameSeason;
  }
  const year = yearOf(query.year);
  const exactYear = list.filter(m => yearsOf(m).includes(year));
  if (year && exactYear.length) list = exactYear;
  // Multiple rows may be season-specific records of the same TMDB show.
  // Prefer the current/latest season instead of arbitrary JSON insertion order.
  return list.slice().sort((a,b) => (yearOf(b.year)-yearOf(a.year)) ||
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) || String(a.id).localeCompare(String(b.id)))[0];
}
export function matchVaultMovie(movies = [], query = {}) {
  const series = query.type === 'series' || query.type === 'tv';
  const list = (Array.isArray(movies) ? movies : []).filter(m => !query.type || Boolean(m.isSeries || m.kind === 'series') === series);
  const id = Number(query.tmdbId) || 0;
  if (id) {
    const hit = pickIdentity(list.filter(m => Number(m.tmdbId) === id),query);
    if (hit) return { ...hit, matchedBy: 'tmdb' };
  }
  const wantedImdb = imdb(query.imdbId);
  if (wantedImdb) {
    const hit = pickIdentity(list.filter(m => imdb(m.imdbId) === wantedImdb),query);
    if (hit) return { ...hit, matchedBy: 'imdb' };
  }
  const key = vaultTitleKey(query.title);
  if (!key) return null;
  const candidates = list.filter(m => aliasesOf(m).some(t => vaultTitleKey(t) === key));
  const year = yearOf(query.year);
  if (year) {
    const exact = candidates.filter(m => yearsOf(m).includes(year));
    if (exact.length === 1) return { ...exact[0], matchedBy: 'title-year' };
    if (exact.length > 1) return null;
    const near = candidates.filter(m => yearsOf(m).some(y => Math.abs(y-year) <= 1));
    if (near.length === 1) return { ...near[0], matchedBy: 'title-year-soft' };
    const unknown = candidates.filter(m => !yearsOf(m).length);
    return !near.length && unknown.length === 1 ? { ...unknown[0], matchedBy: 'title' } : null;
  }
  return candidates.length === 1 ? { ...candidates[0], matchedBy: 'title' } : null;
}

/** Build the instant vault player deep-link. */
export function vaultPlayHref(movie) {
  if (!movie?.id) return '';
  return watchHref(movie, 'vault');
}
