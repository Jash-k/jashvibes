import { isJioStreamUrl, isJioCookieValid, normalizeJioCookie } from '@/lib/jioPlayback';
import { readTokenExpiry } from '@/lib/player/streamClassifier';
import { readHdneaExpiry } from '@/lib/live/tokens/hdnea';

// This is a readiness gate, not a claim that segments/license/video were tested.
export function resolutionHealth(channel = {}, now = Date.now()) {
  const expiresAt = readTokenExpiry(channel.url, channel.cookie, channel.userAgent, channel.referer)
    || readHdneaExpiry(channel.url, channel.cookie) || null;
  if (expiresAt && expiresAt <= now + 30_000) return {
    ok: false, code: 'AUTH_EXPIRED', error: 'Playback authorization expired or is about to expire. Try another source.', expiresAt,
  };
  // Only enforce Jio authorization on known protected CDN hosts. A source ID
  // containing "jio" is not sufficient: it can also contain public FTA streams.
  let host = ''; try { host = new URL(channel.url).hostname; } catch {}
  const protectedJio = isJioStreamUrl(channel.url) && /^jiotv(?:mb|pl)live\.cdn\.jio\.com$/i.test(host);
  if (protectedJio && !isJioCookieValid(normalizeJioCookie(channel.cookie) || normalizeJioCookie(channel.url), 30_000)) return {
    ok: false, code: 'AUTH_UNAVAILABLE', error: 'No current playback authorization is available for this source. Try another source.', expiresAt,
  };
  return { ok: true, expiresAt };
}

// Finite forward-only ladder; never wrap around and retry a failed source forever.
export function canAdvanceVariant(index, count) {
  return Number.isInteger(index) && index >= 0 && index + 1 < count;
}
