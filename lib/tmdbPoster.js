/*
 * lib/tmdbPoster.js — right-size TMDB art without an image optimizer.
 *
 * The server builds poster URLs at one fixed size (`…/t/p/w500…`), so every
 * 150-px grid card on a phone was downloading the 500-px original — the
 * single biggest payload on the catalogue. TMDB serves the same asset at
 * every `wNNN` size, so the client can derive a `srcset` from the URL it
 * already has: same file, same cache headers, no proxy, no processing cost
 * on the free instance (which is why this is not `next/image` — the Node
 * image optimizer would spend RAM and disk we don't have on a 512 MB box).
 *
 * Anything that is not an image.tmdb.org URL (Saavn covers, anime source
 * art, addon logos) passes through untouched — callers can use the helpers
 * unconditionally.
 */

const TMDB_IMAGE_HOST = 'image.tmdb.org';
const TMDB_IMAGE_PATH = '/t/p/';

/** Poster card ladder: card widths top out near 230 px, so 2x DPR stops at w500. */
export const POSTER_SRCSET_SIZES = ['w185', 'w342', 'w500', 'w780'];

/** `sizes` for a responsive poster grid: one card per ~45vw on the smallest
 *  phones, then fixed card widths once the grid stops growing. */
export const POSTER_SIZES_ATTR = '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 230px';

/** The library rails render fixed 128–160 px cards — tighter than the grid. */
export const POSTER_ROW_SIZES_ATTR = '128px';

/** Backdrops are shown near full-width: let 2x phones take w1280. */
export const BACKDROP_SRCSET_SIZES = ['w780', 'w1280', 'original'];

/** Split a TMDB image URL into the part before the size and the file path.
 *  Returns null for any non-TMDB URL (callers then keep the original src).
 *  The host must be image.tmdb.org itself — a TMDB URL merely embedded as a
 *  query parameter of some other origin must never be rewritten. */
export function parseTmdbImageUrl(url) {
  const value = String(url || '');
  if (!value.includes(TMDB_IMAGE_HOST) || !value.includes(TMDB_IMAGE_PATH)) return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.hostname !== TMDB_IMAGE_HOST) return null;
  const pathIndex = parsed.pathname.indexOf(TMDB_IMAGE_PATH);
  if (pathIndex !== 0) return null;
  const sizeIndex = TMDB_IMAGE_PATH.length;
  const slash = parsed.pathname.indexOf('/', sizeIndex);
  if (slash === -1 || slash === sizeIndex) return null;
  return {
    prefix: `${parsed.origin}${TMDB_IMAGE_PATH}`,
    path: parsed.pathname.slice(slash) + parsed.search,
  };
}

/** Rewrite one TMDB image URL to a specific size. Non-TMDB URLs pass through. */
export function tmdbImageAtSize(url, size = 'w500') {
  const parsed = parseTmdbImageUrl(url);
  if (!parsed) return url || '';
  return `${parsed.prefix}${size}${parsed.path}`;
}

/** A `srcset` covering the ladder, smallest first. Empty string for non-TMDB
 *  URLs so callers can spread it only when it exists. */
export function tmdbImageSrcSet(url, sizes = POSTER_SRCSET_SIZES) {
  const parsed = parseTmdbImageUrl(url);
  if (!parsed) return '';
  return sizes.map((size) => `${parsed.prefix}${size}${parsed.path} ${size.replace(/^w/, '')}w`).join(', ');
}
