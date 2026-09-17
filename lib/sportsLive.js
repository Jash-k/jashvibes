/*
 * lib/sportsLive.js — the "best live stream right now" resolver.
 *
 * The board used to present watching as a manual walk: open a card, find the
 * Video tab, pick a feed. The On Air Grid inverts that — the page names THE
 * thing to watch and puts one button on it. This module is the referee:
 *
 *   live FanCode match feeds (fresh signed token, one entry per audio feed)
 *   > a live match's single published stream
 *   > the standing env channels (SPORTS_FANCODE_URL, then SPORTS_WILLOW_URL)
 *   > sports channels the live-TV catalog already carries
 *
 * Honesty rules inherited from the board: a variant whose token expired is
 * never offered as playable (it is the dump being stale — the card already
 * says so); a channel that `needs a key` or has no URL is never ranked; a
 * stale-dump "live" row is not live at all and is filtered before we run.
 *
 * Pure and sync — the caller hands us the merged feed items and the channel
 * list it already has, so ranking costs nothing and is trivially testable.
 */

import { channelReadiness } from './sportsFeedView.js';

const PLAYABLE_CHANNEL_STATES = new Set(['ready', 'key', 'proxy']);

/** Human words for why this entry is ranked where it is / how it plays. */
export function explainEntry(entry = {}, now = Date.now()) {
  if (entry.kind === 'channel') {
    const readiness = entry.readiness || {};
    return readiness.note || readiness.label || 'channel';
  }
  if (entry.expiresAt) {
    const ms = Date.parse(entry.expiresAt) - now;
    if (Number.isFinite(ms)) {
      const minutes = Math.round(ms / 60_000);
      return minutes > 0 ? `token good for ~${minutes} min` : 'token about to expire';
    }
  }
  return entry.kind === 'variant' ? 'match feed' : 'published stream';
}

/** "IND v AUS" / the competition — the words every surface prints for a match. */
export function matchLabel(item = {}) {
  return [item.homeCode || item.home, item.awayCode || item.away].filter(Boolean).join(' v ') || item.competition || 'Match';
}

function matchContext(item = {}) {
  return {
    source: item.source,
    id: item.id,
    href: item.href || `/sports/hub/${item.source}/${item.id}`,
    label: matchLabel(item),
    competition: item.competition || '',
    statusLine: item.statusLine || '',
    scoreHome: item.scoreHome || '',
    scoreAway: item.scoreAway || '',
    homeCode: item.homeCode || '',
    awayCode: item.awayCode || '',
    venue: item.venue || '',
    matchOrder: item.matchOrder || '',
    state: item.state,
    dumpAt: item.dumpAt || '',
    poster: item.poster || '',
  };
}

const channelBadge = (channel = {}) =>
  /^(fancode|willow)/i.test(String(channel.id || '')) || /^(fancode|willow)/i.test(String(channel.source || ''))
    ? (/fancode/i.test(`${channel.id} ${channel.source}`) ? 'FanCode' : 'Willow')
    : (channel.source || 'channel').toUpperCase();

/**
 * Rank every playable live source. `items` are merged-feed cards (only live,
 * non-quarantined rows make sense here — we filter defensively anyway);
 * `channels` is what /api/sports/channels answered.
 */
export function rankPlayableSources({ items = [], channels = [], now = Date.now() } = {}) {
  const matchEntries = [];
  for (const item of items) {
    if (item.state !== 'live' || item.staleFeed) continue;
    const context = matchContext(item);
    const variants = Array.isArray(item.variants) ? item.variants : [];
    let offered = 0;
    for (const variant of variants) {
      if (!variant?.url || variant.unavailable) continue;
      if (variant.expiresAt && Date.parse(variant.expiresAt) <= now) continue;
      offered += 1;
      matchEntries.push({
        key: `variant:${item.source}:${item.id}:${variant.id || offered}`,
        kind: 'variant',
        url: variant.url,
        label: `${context.label} · ${variant.label || `feed ${offered}`}`,
        langLabel: variant.label || '',
        badge: 'FanCode',
        expiresAt: variant.expiresAt || '',
        variantId: variant.id || `fan-${offered - 1}`,
        match: context,
        extra: {
          cookie: variant.cookie,
          referer: variant.referer,
          userAgent: variant.userAgent,
          keyId: variant.keyId,
          key: variant.key,
          licenseKey: variant.licenseKey,
        },
      });
    }
    /* The single stream a feed published outright (FanCode playback URL, an ICC
       highlight-style live URL) — only when no variants exist, or the variants
       all expired and the stream itself may still answer. */
    if ((!offered && item.stream && /^https?:/i.test(item.stream))) {
      matchEntries.push({
        key: `stream:${item.source}:${item.id}`,
        kind: 'stream',
        url: item.stream,
        label: `${context.label} · match feed`,
        langLabel: '',
        badge: String(item.source || 'feed').toUpperCase(),
        expiresAt: '',
        variantId: '',
        match: context,
        extra: {},
      });
    }
  }

  const channelEntries = [];
  for (const channel of channels) {
    const readiness = channelReadiness(channel, now);
    if (!PLAYABLE_CHANNEL_STATES.has(readiness.state)) continue;
    channelEntries.push({
      key: `channel:${channel.id}`,
      kind: 'channel',
      url: channel.url,
      label: channel.name,
      langLabel: '',
      badge: channelBadge(channel),
      readiness,
      expiresAt: '',
      variantId: '',
      match: null,
      extra: {
        keyId: channel.keyId, key: channel.key, licenseKey: channel.licenseKey,
        cookie: channel.cookie, referer: channel.referer, userAgent: channel.userAgent,
      },
      priority: Number(channel.priority ?? 99),
    });
  }
  channelEntries.sort((a, b) => a.priority - b.priority);

  return [...matchEntries, ...channelEntries];
}

/** The hero: the top-ranked entry, or null when nothing can play. */
export function pickHeroSource(entries = []) {
  return entries[0] || null;
}

/**
 * The hero's one-line status: what it is and why it is the pick. Used under
 * the WATCH LIVE button — never a promise, only what the feed said.
 */
export function heroNote(entry = {}, now = Date.now()) {
  if (!entry) return 'nothing can play on any feed right now';
  if (entry.kind === 'channel') {
    const readiness = entry.readiness || {};
    return `${entry.label} · ${readiness.label || 'channel'}${readiness.note ? ` · ${readiness.note}` : ''}`;
  }
  const via = entry.expiresAt ? explainEntry(entry, now) : 'the feed published this stream';
  return `${entry.label} · ${via}`;
}

/**
 * Other live entries for the grid, hero excluded. Same array, filtered —
 * the grid section is "also live", not a second ranking.
 */
export function otherLiveEntries(entries = [], hero = null) {
  return entries.filter((entry) => entry !== hero && entry.key !== hero?.key);
}
