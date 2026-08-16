'use client';

/**
 * Small client-side playback helpers shared by the /live page player and the
 * embeddable LiveChannelPlayer (home sports block, match-center Watch Live).
 * NOTE: /live/page.js keeps its own copies inline for stability — keep the
 * two in sync when changing Jio token resolution behaviour.
 */

import {
  JIO_COOKIE_OVERRIDE_KEY,
  isJioChannel,
  isJioCookieValid,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

export function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function channelSlug(value = '') {
  return normalizeText(value).replace(/\s+/g, '-');
}

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function buildClearKeys(channel = {}) {
  const license = String(channel?.licenseKey || '').trim();
  if (license && license.includes(':')) {
    const [keyId, key] = license.split(':');
    const kid = cleanHex(keyId);
    const clearKey = cleanHex(key);
    if (kid && clearKey) return { [kid]: clearKey };
  }

  const kid = cleanHex(channel?.keyId || '');
  const clearKey = cleanHex(channel?.key || '');
  if (kid && clearKey && kid !== 'null' && clearKey !== 'null') return { [kid]: clearKey };
  return {};
}

export function isShakaDrmLoadError(err) {
  if (!err) return false;
  // 6001 = REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE; 6 = Shaka's DRM bucket.
  return err.code === 6001 || err.category === 6;
}

function getLocalJioCookie() {
  if (typeof window === 'undefined') return '';
  try {
    const cookie = normalizeJioCookie(window.localStorage.getItem(JIO_COOKIE_OVERRIDE_KEY) || '');
    return isJioCookieValid(cookie) ? cookie : '';
  } catch {
    return '';
  }
}

export async function resolveJioAccess(channel = {}, { force = false } = {}) {
  const fallbackUrl = String(channel.url || '');
  const localCookie = getLocalJioCookie();
  if (localCookie) return { cookie: localCookie, playbackUrl: fallbackUrl, scoped: false };

  const channelCookie = normalizeJioCookie(channel.cookie || '');
  const channelCookieIsScoped = channelCookie.includes('/bpk-tv/') || (channelCookie.includes('acl=') && !channelCookie.includes('acl=/*'));
  if (!force && channelCookieIsScoped && isJioCookieValid(channelCookie)) {
    return { cookie: channelCookie, playbackUrl: fallbackUrl, scoped: true };
  }

  try {
    const params = new URLSearchParams();
    if (force) params.set('force', '1');
    if (channel.tvgId) params.set('channelId', channel.tvgId);
    if (channel.name) params.set('name', channel.name);
    if (fallbackUrl) params.set('channelUrl', fallbackUrl);
    const response = await fetch(`/api/live-jio?${params.toString()}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    const cookie = normalizeJioCookie(data.cookie || '');
    const playbackUrl = String(data.playbackUrl || fallbackUrl);
    if (response.ok && isJioCookieValid(cookie) && isJioChannel({ url: playbackUrl })) {
      return { cookie, playbackUrl, scoped: Boolean(data.scoped) };
    }
  } catch {}

  return {
    cookie: isJioCookieValid(channelCookie) ? channelCookie : '',
    playbackUrl: fallbackUrl,
    scoped: channelCookieIsScoped,
  };
}

/**
 * Ordered preference for auto-picking the channel that carries a cricket
 * match. First regex match across the playable channel list wins.
 */
export const CRICKET_CHANNEL_PRIORITY = [
  /star sports 1 tamil/i,
  /sony ten 4 tamil/i,
  /sony sports network ten 1/i,
  /star sports 1 hd hindi/i,
  /star sports 1(?!.*(tamil|telugu|kannada))/i,
  /star sports 2/i,
  /sony ten/i,
  /sony sports/i,
  /willow/i,
  /fancode/i,
  /star sports/i,
];

export function pickCricketChannel(channels = []) {
  const playable = (channels || []).filter((channel) => channel && channel.playable !== false && channel.url);
  for (const pattern of CRICKET_CHANNEL_PRIORITY) {
    const hit = playable.find((channel) => pattern.test(`${channel.name || ''} ${channel.category || ''}`));
    if (hit) return hit;
  }
  return null;
}
