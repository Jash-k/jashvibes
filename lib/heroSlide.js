/*
 * lib/heroSlide.js — the home hero's selection and shape, in one place.
 *
 * This logic used to live inside app/page.js. It moved here when the home hero
 * started being server-rendered: the server has to pick the SAME title the client
 * would have picked, or the banner visibly swaps a moment after hydration. One
 * implementation, imported from both sides, is the only way to guarantee that.
 *
 * Pure by design — no React, no fetch, no window — so it can run in the Node
 * server component that renders the first slide and in the browser that renders
 * every later one.
 */
import { watchHref as unifiedWatchHref } from '@/lib/watch/policy';
import { chipClassForTier, labelForTier, parseReleaseQuality, releaseQualityChip } from '@/lib/quality';

/** A slide is only worth showing with artwork; a poster alone will do. */
export function hasArt(item) {
  return Boolean(item?.backdropUrl || item?.posterUrl);
}

/** The text a quality tier is parsed out of — shared so both sides parse the same field. */
export function qualitySourceText(item) {
  return item?.rawTitle || item?.parsedSource || item?.title || item?.synopsis || '';
}

export function itemQualityChip(item) {
  // Server is the single source of truth for quality (see /api/tamilmv).
  // Client-side parsing remains only as a last-resort fallback.
  if (item?.qualityTier) {
    return { tier: item.qualityTier, label: item.qualityLabel || labelForTier(item.qualityTier), cls: chipClassForTier(item.qualityTier) };
  }
  return releaseQualityChip(qualitySourceText(item));
}

/** The one shape of a watch link used by the hero and the cards. */
function heroHref(item) {
  return unifiedWatchHref(item, 'home');
}

/** Pick the freshest title that has artwork. Returns null when nothing qualifies. */
export function pickHeroItem(items = []) {
  return items.find(hasArt) || null;
}

/** Shape one catalogue item into the hero's props. Null when it has no artwork. */
export function buildHeroSlide(item) {
  if (!item || !hasArt(item)) return null;
  const href = heroHref(item);
  const chip = item.type === 'series' ? null : itemQualityChip(item);
  return {
    title: item.title || 'Untitled',
    type: item.type || 'movie',
    year: item.year || '',
    tmdbId: item.tmdbId || null,
    imdbId: item.imdbId || '',
    href,
    posterUrl: item.posterUrl || item.backdropUrl || '',
    backdropUrl: item.backdropUrl || item.posterUrl || '',
    chips: chip?.label ? [chip.label] : [],
    note: href ? '' : 'No TMDB match yet — bind it once to unlock every stream server',
  };
}

/** Unused-export guard: keeps the quality helpers reachable for callers that only
 *  want the tier without building a whole slide (the watch page's quality hint). */
export { parseReleaseQuality };
