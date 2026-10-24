/**
 * lib/live/pipeline/deduplicate.js — v12 logical channel grouping
 * Collapses Jash triplets (Aaryaa TV x3) into 1 card with fallback ladder.
 */

import { getSourceDef } from '../registry.js';

function slugBase(name = '') {
  // "Aaryaa TV [HLS · JioTV proxy]" → "Aaryaa TV"
  const base = String(name||'').replace(/\s*\[.*?\]\s*$/,'').trim();
  return base.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim() || base;
}

export function logicalIdForChannel(ch = {}) {
  const base = slugBase(ch.name || ch.originalName || '');
  const cat = String(ch.category || ch.groupTitle || 'live').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  return `${base}|${cat}`;
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
 * Build logical channels from flat list (already filtered playable)
 * Returns Map<logicalId, { displayName, baseName, logo, category, variants[] }>
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
        displayName: slugBase(ch.name) ? String(ch.name||'').replace(/\s*\[.*?\]\s*$/,'').trim() : (ch.name||'Channel'),
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
