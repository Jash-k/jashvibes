/**
 * lib/live/hero.js — owner-controlled live homepage hero.
 *
 * A single LiveChannel flagged `heroBanner: true` takes over the homepage
 * banner from the normal scraped-movie hero. The slide deep-links into
 * /live?channel=<channelId>, which LivePage turns into an auto-play selection.
 * Pure helpers only (no DB) so the slide contract is unit-testable and the
 * API route and any future server reader share one shape.
 */

export const LIVE_HERO_NONE = Object.freeze({ active: false });

/** Deep link consumed by components/live/LivePage.jsx on mount. */
export function liveHeroHref(channelId) {
  return `/live?channel=${encodeURIComponent(String(channelId))}`;
}

/**
 * Map a stored LiveChannel doc (or client channel view) to the RailFocus
 * slide shape. Returns null when there is no usable, visible channel, so the
 * caller can fall back to the normal movie hero.
 */
export function buildLiveHeroSlide(channel = null) {
  if (!channel || !channel.channelId || channel.hidden) return null;
  const title = channel.customName || channel.name || 'Live TV';
  const art = channel.customLogo || channel.logo || '';
  return {
    live: true,
    title,
    type: 'live',
    href: liveHeroHref(channel.channelId),
    posterUrl: art,
    backdropUrl: art,
    chips: ['LIVE'],
    note: 'Streaming now — tap to watch',
  };
}

/** Public API payload for /api/live/hero. */
export function liveHeroResponse(channel = null) {
  const slide = buildLiveHeroSlide(channel);
  if (!slide) return LIVE_HERO_NONE;
  return { active: true, channelId: channel.channelId, forceProxy: Boolean(channel.forceProxy), slide };
}
