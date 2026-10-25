/**
 * lib/live/pipeline/deduplicate.js — logical channel grouping
 *
 * One source names the same broadcaster "Star Vijay", another "Star Vijay
 * HD", a third "Star Vijay DASH" or "Star Vijay_ClearKey [HLS proxy]". Those
 * describe DELIVERY variants, not different channels, so they must collapse
 * into one card whose variants form the automatic fallback ladder.
 *
 * canonicalChannelName() is the single identity rule shared by the runtime
 * dedup (public /live), the background grouping pass (persisted
 * logicalChannelId) and the Admin duplicate finder. It is pure and
 * side-effect free.
 */

import { getSourceDef } from '../registry.js';

/**
 * Delivery/quality/DRM words that never carry channel identity. Matched as
 * WHOLE tokens after non-alphanumerics become spaces, so "hd" inside another
 * word is never touched. "tv" is included because Indian EPGs use it as a
 * brand suffix ("Vijay TV" === "Star Vijay"); sister channels keep their
 * real differentiators (Super, Takkar, News, Music, Movies…).
 */
const TECH_TOKENS = new Set([
  'hd', 'fhd', 'uhd', 'sd', '4k', '2k', '1080p', '720p', '576p', '480p', '360p',
  'dash', 'hls', 'm3u8', 'mpd', 'mp4', 'clearkey', 'widevine', 'drm',
  'encrypted', 'progressive', 'hevc', 'h265', 'h264', 'avc',
  'tv',
]);

/**
 * Canonical identity key for a channel name.
 * "Star Vijay_ClearKey [HLS · proxy]" → "star vijay"
 * "Sun TV HD" → "sun", "Vijay TV" → "vijay" (so it merges with "Star Vijay").
 * Display names keep their friendly suffixes via displayNameForChannel().
 */
export function canonicalChannelName(rawName = '') {
  const cleaned = String(rawName || '')
    .replace(/\[[^\]]*\]/g, ' ') // bracket labels are always plumbing ([HLS · JioTV proxy])
    .toLowerCase()
    .replace(/clear\s*key/g, 'clearkey')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .filter((token) => !TECH_TOKENS.has(token))
    .join(' ');
}

/**
 * Original-casing, human-facing name with the technical suffixes removed but
 * real brand words kept ("tv" is NOT stripped here, only in the identity
 * key). "Star Vijay HD (DASH)" → "Star Vijay".
 */
export function displayNameForChannel(rawName = '') {
  const withoutBrackets = String(rawName || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^)]*\b(?:hd|sd|fhd|uhd|4k|dash|hls|m3u8|mpd|clearkey|clear\s*key|widevine|drm|1080p|720p)\b[^)]*)\)/gi, ' ')
    .trim();
  const tokens = withoutBrackets.replace(/clear\s*key/gi, 'ClearKey').split(/[^A-Za-z0-9]+/).filter(Boolean);
  const kept = tokens.filter((token) => !TECH_TOKENS.has(token.toLowerCase()) || token.toLowerCase() === 'tv');
  const friendly = kept.join(' ');
  return friendly || withoutBrackets || String(rawName || '').trim() || 'Channel';
}

function slugBase(name = '') {
  // Backward-compatible lowercased base name, now identity-aware.
  return canonicalChannelName(name);
}

export function logicalIdForChannel(ch = {}) {
  const base = canonicalChannelName(ch.name || ch.originalName || '');
  if (base) return base;
  // Never emit an empty id for a garbage/blank name: fall back to the raw
  // normalized string, then a stable sentinel.
  const raw = String(ch.name || ch.originalName || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return raw || 'unknown-channel';
}

export function isDummyVariant(ch = {}) {
  // Jash generates license_key=null:null placeholder
  const lk = String(ch.licenseKey||'').toLowerCase();
  const kid = String(ch.keyId||'').toLowerCase();
  const key = String(ch.key||'').toLowerCase();
  if (lk === 'null:null') return true;
  if ((kid === 'null' || kid === '') && key === 'null') return true;
  return false;
}

/**
 * Build logical channels from flat list (already filtered playable).
 * Returns array of { logicalId, displayName, baseName, logo, category,
 * variants[] } sorted by display name. Identity is the canonical name, so
 * HD/SD/DASH/HLS/ClearKey/4K rows of one broadcaster become ONE group.
 */
export function deduplicateChannels(channels = []) {
  const groups = new Map();
  for (const ch of channels) {
    if (isDummyVariant(ch)) continue; // never play dummy
    const logicalId = logicalIdForChannel(ch);
    let g = groups.get(logicalId);
    if (!g) {
      g = {
        logicalId,
        displayName: displayNameForChannel(ch.name),
        baseName: slugBase(ch.name),
        logo: ch.logo || '',
        category: ch.category || 'Live',
        language: ch.language || '',
        groupTitle: ch.category || '',
        variants: [],
        sourceIds: new Set(),
      };
      groups.set(logicalId, g);
    }
    // keep best logo
    if (!g.logo && ch.logo) g.logo = ch.logo;
    const def = getSourceDef(ch.sourceId);
    const variant = {
      channelId: ch.channelId || ch.id,
      name: displayNameForChannel(ch.name),
      originalName: ch.originalName || ch.name || '',
      sourceId: ch.sourceId,
      sourceLabel: ch.source || def?.label || ch.sourceId,
      url: ch.url,
      format: (ch.format||'unknown').toLowerCase(),
      playable: ch.playable !== false,
      keyId: ch.keyId || '',
      key: ch.key || '',
      licenseKey: ch.licenseKey || '',
      licenseType: ch.licenseType || '',
      cookie: ch.cookie || '',
      userAgent: ch.userAgent || '',
      referer: ch.referer || '',
      headers: ch.headers || {},
      priority: def?.priority ?? 99,
      workingStatus: ch.workingStatus || 'unknown',
      tvgId: ch.tvgId || '',
      // Catalog memberships (persisted by the background grouping pass) ride
      // along on every variant so /api/live/channels can filter/order groups.
      catalogs: Array.isArray(ch.catalogs) ? ch.catalogs : [],
      catalogIds: Array.isArray(ch.catalogIds)
        ? ch.catalogIds
        : (Array.isArray(ch.catalogs) ? ch.catalogs.map((item) => (typeof item === 'string' ? item : item?.catalogId)).filter(Boolean) : []),
      logicalChannelId: ch.logicalChannelId || '',
      order: Number.isFinite(Number(ch.order)) ? Number(ch.order) : 9999,
      mappingManaged: Boolean(ch.mappingManaged),
      ladderOrder: Array.isArray(ch.ladderOrder) ? ch.ladderOrder : [],
    };
    g.variants.push(variant);
    g.sourceIds.add(ch.sourceId);
  }

  // sort variants inside each group by source priority, then playable first
  for (const g of groups.values()) {
    g.variants.sort((a,b)=>{
      if (a.playable !== b.playable) return a.playable ? -1 : 1;
      if ((a.priority??99) !== (b.priority??99)) return (a.priority??99)-(b.priority??99);
      return String(a.sourceId).localeCompare(String(b.sourceId));
    });
    g.sourceIds = [...g.sourceIds];
    g.best = g.variants[0] || null;
    g.variantCount = g.variants.length;
    // The card name comes from the best (first-playing) variant, with the
    // delivery suffixes stripped. An owner customName already rode in as
    // ch.name upstream, so a custom label always wins here too.
    g.displayName = displayNameForChannel(g.best?.name || g.displayName);
    g.baseName = canonicalChannelName(g.displayName) || g.baseName;
  }

  // return as array sorted by displayName
  return [...groups.values()].sort((a,b)=> String(a.displayName).localeCompare(String(b.displayName)));
}

/**
 * Per-channel source-ladder override (v13 Admin "variant ladder").
 *
 * Default variant order is source priority from the registry. An owner can pin
 * a logical channel's own order by storing a ladderOrder of sourceIds on one
 * of its rows. Listed sources come first in the given order; everything else
 * keeps its existing relative order afterwards, so a ladder naming only two
 * sources never hides or reorders the remaining fallbacks. Pure and stable —
 * a non-array/empty ladder returns the input untouched.
 */
export function orderVariantsByLadder(variants = [], ladderOrder = []) {
  const ladder = Array.isArray(ladderOrder)
    ? ladderOrder.map((id) => String(id || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (!ladder.length) return variants;
  const rank = new Map(ladder.map((id, index) => [id, index]));
  return variants
    .map((variant, index) => ({ variant, index }))
    .sort((a, b) => {
      const ra = rank.has(String(a.variant.sourceId || '').toLowerCase())
        ? rank.get(String(a.variant.sourceId || '').toLowerCase())
        : Number.MAX_SAFE_INTEGER;
      const rb = rank.has(String(b.variant.sourceId || '').toLowerCase())
        ? rank.get(String(b.variant.sourceId || '').toLowerCase())
        : Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.index - b.index; // stable: unlisted variants keep their priority order
    })
    .map((entry) => entry.variant);
}

export function flattenLogicalToChannels(logicalChannels = []) {
  // For DB storage compat: return flat list with logicalChannelId attached
  const out = [];
  for (const g of logicalChannels) {
    for (const v of g.variants) {
      out.push({ ...v, logicalChannelId: g.logicalId, displayName: g.displayName, variantCount: g.variantCount });
    }
  }
  return out;
}
