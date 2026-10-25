// Playback header construction per CDN family (Jio/Hotstar/FanCode/custom).
// Split from the former lib/liveTv.js god module (phase 1) — behaviour unchanged.

import { JIO_REFERER, JIO_USER_AGENT, isJioChannel } from '@/lib/jioPlayback';
import { normalizeWhitespace } from '../ingest/text.js';

export function buildPlaybackHeaders(channel = {}, uri = '') {
  const text = `${channel.url || ''} ${uri}`.toLowerCase();
  const jioLike = isJioChannel(channel) || text.includes('jiotv') || text.includes('jiotvmblive') || text.includes('jiotvpllive');
  const hotstarLike = text.includes('hotstar.com');
  const fancodeLike = text.includes('fancode.com') || text.includes('fblive.fancode.com') || normalizeWhitespace(channel.category).toLowerCase() === 'fancode';
  const headers = {
    Accept: channel.format === 'hls'
      ? 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*'
      : channel.format === 'dash'
        ? 'application/dash+xml,application/xml,text/xml,text/plain,*/*'
        : '*/*',
  };

  const userAgent = channel.userAgent ||
    (jioLike ? JIO_USER_AGENT : '') ||
    (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : '') ||
    'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)';

  if (channel.headers && typeof channel.headers === 'object') {
    for (const [key, val] of Object.entries(channel.headers)) {
      // Keep Cookie centralized in channel.cookie so stale EXTHTTP cookies can
      // be replaced by the fresh global Jio token before playback/checking.
      if (!key || /^cookie$/i.test(key) || val == null || val === '') continue;
      headers[key] = String(val);
    }
  }
  if (userAgent) headers['User-Agent'] = userAgent;
  if (channel.referer) headers.Referer = channel.referer;
  else if (jioLike) headers.Referer = JIO_REFERER;
  else if (hotstarLike) headers.Referer = 'https://www.hotstar.com/';
  else if (fancodeLike) headers.Referer = 'https://www.fancode.com/';
  if (channel.cookie) headers.Cookie = channel.cookie;

  return headers;
}
