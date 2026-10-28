/**
 * lib/live/playback/policy.js — v12 per-source playback policy
 * Decides proxy (direct vs /api/live-proxy) + headers + DRM per variant.
 * Geo-sensitive hosts never proxied (451).
 */

import { isJioChannel } from '@/lib/jioPlayback';
import { getSourceDef } from '../registry.js';
import { liveSourceHeaders } from '@/lib/player/liveHeaders';

const GEO_HOSTS = /jiotv|jiotvmblive|jiotvpllive|nw18live/i;
const HDNEA_RX = /__hdnea__/i;
const HOTSTAR_RX = /hotstar\.com/i;
const YUPP_RX = /yupptv|hdnts/i;

export function isGeoSensitive(channel) {
  const url = String(channel.url||'');
  return GEO_HOSTS.test(url) || HDNEA_RX.test(url) || HDNEA_RX.test(String(channel.cookie||''));
}

export function needsProxyForVariant(variant = {}) {
  // Geo hosts never proxy — would 451 via server IP
  if (isGeoSensitive(variant)) return false;

  // Owner override: manual channels flagged forceProxy always ride
  // /api/live-proxy (insurance against ISP-level blocks on Indian networks).
  if (variant.forceProxy) return true;

  // Hotstar needs forbidden Cookie+Origin+Referer
  if (HOTSTAR_RX.test(variant.url||'') || HOTSTAR_RX.test(variant.referer||'') || /hdntl/i.test(variant.cookie||'')) return true;

  // Explicit per-source registry
  const def = getSourceDef(variant.sourceId);
  if (def?.proxy === true) return true;
  if (def?.proxy === false) return false;

  // 'auto' → check headers
  const h = liveSourceHeaders(variant);
  if (Object.keys(h).length) {
    // Only proxy if headers contain Cookie/Referer/Origin that browser can't set
    if (h.cookie || h.referer || h.origin) return true;
  }
  // YuppTV with User-Agent only → try direct first
  return false;
}

export function policyForLogicalChannel(logical) {
  // Attach per-variant proxy decision + token tag for UI
  const variants = (logical.variants||[]).map(v=>{
    const url = String(v.url||'');
    let tokenTag = 'none';
    if (/__hdnea__/i.test(url+v.cookie)) tokenTag='hdnea';
    else if (/hdntl/i.test(url+v.cookie)) tokenTag='hdntl';
    else if (/hdnts/i.test(url)) tokenTag='hdnts';
    return {
      ...v,
      needsProxy: needsProxyForVariant(v),
      tokenTag,
      geoSensitive: isGeoSensitive(v),
    };
  });
  return { ...logical, variants, best: variants[0] || null };
}
