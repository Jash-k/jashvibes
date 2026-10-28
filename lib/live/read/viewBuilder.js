/**
 * lib/live/read/viewBuilder.js — the single doc → view-model pipeline.
 *
 * Both the public /api/live/channels route and the Admin → TV manager build
 * their data through these helpers, so admin chip counts and /live card counts
 * are parity by construction — nobody re-implements the visibility, dedup,
 * religious or membership rules a second time.
 *
 * Pipeline (every step pure and unit-tested without a database):
 *   stored docs → toFlatChannel → isVisibleFlatChannel → deduplicateChannels
 *   → policy → variant ladder → religious flag → catalog counts/summary.
 */

import { LIVE_CATALOGS, isLiveCatalogId } from '@/lib/liveCatalogs';
import { deduplicateChannels, isDummyVariant, orderVariantsByLadder } from '@/lib/live/pipeline/deduplicate.js';
import { policyForLogicalChannel } from '@/lib/live/playback/policy.js';
import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';
import { isReligiousExcludedGroup } from '@/lib/live/catalogRules';

/**
 * Normalise one stored LiveChannel doc into the flat shape the dedup/player
 * pipeline reads. Only fields the pipeline consumes survive.
 */
export function toFlatChannel(d = {}) {
  return {
    channelId: d.channelId || d._id?.toString(),
    id: d.channelId,
    name: d.customName || d.name,
    originalName: d.name,
    logo: d.customLogo || d.logo,
    category: d.category || 'Live',
    language: d.language || '',
    url: d.url,
    format: d.format || 'unknown',
    playable: d.playable !== false,
    hidden: Boolean(d.hidden),
    keyId: d.keyId || '',
    key: d.key || '',
    licenseKey: d.licenseKey || '',
    licenseType: d.licenseType || '',
    cookie: d.cookie || '',
    userAgent: d.userAgent || '',
    referer: d.referer || '',
    headers: d.headers || {},
    sourceId: d.sourceId,
    source: d.source,
    tvgId: d.tvgId || '',
    priority: d.priority ?? 99,
    catalogs: Array.isArray(d.catalogs) ? d.catalogs : [],
    catalogIds: (d.catalogs || []).map((item) => (typeof item === 'string' ? item : item?.catalogId)).filter(Boolean),
    logicalChannelId: d.logicalChannelId || '',
    order: d.order ?? 9999,
    mappingManaged: Boolean(d.mappingManaged),
    ladderOrder: Array.isArray(d.ladderOrder) ? d.ladderOrder : [],
    forceProxy: Boolean(d.forceProxy),
  };
}

/**
 * The shared /live visibility rule. Hidden variants are dropped BEFORE dedup,
 * so a group whose every variant is hidden disappears and a group with other
 * live variants simply loses this fallback entry.
 */
export function isVisibleFlatChannel(ch = {}, { tamilOnly = false } = {}) {
  if (!ch.playable) return false;
  if (isDummyVariant(ch)) return false;
  if (!ch.url) return false;
  if (ch.hidden) return false;
  if (tamilOnly && !isMainstreamTamilChannel(ch, ch.sourceId)) return false;
  return true;
}

/** Distinct fixed-catalog ids a whole logical group belongs to. */
export function catalogIdsForGroup(group = {}) {
  return [...new Set(
    (group.variants || []).flatMap((variant) => variant.catalogIds || []).filter(isLiveCatalogId),
  )];
}

/** Does any variant of the group carry this fixed-catalog membership? */
export function groupHasCatalog(group = {}, catalogId = '') {
  return (group.variants || []).some((variant) => (variant.catalogIds || []).includes(catalogId));
}

/**
 * Flat visible rows → deduplicated logical groups with playback policy,
 * manual variant ladders applied and the religious flag decided. Religious
 * groups are FLAGGED, not removed — callers decide whether to count or drop.
 */
export function buildLogicalGroups(flat = []) {
  return deduplicateChannels(flat).map(policyForLogicalChannel).map((group) => {
    const ladder = group.variants.find((variant) => Array.isArray(variant.ladderOrder) && variant.ladderOrder.length)?.ladderOrder;
    if (ladder) {
      group.variants = orderVariantsByLadder(group.variants, ladder);
      group.best = group.variants[0] || group.best;
    }
    // Religious/devotional groups are excluded everywhere unless an owner
    // manually mapped one of their variants (checked inside).
    group.religious = isReligiousExcludedGroup(group);
    return group;
  });
}

/** /live catalog tab counts — one card per logical group per catalog. */
export function countCatalogs(groups = []) {
  return LIVE_CATALOGS.map((catalog) => ({
    ...catalog,
    count: groups.filter((group) => groupHasCatalog(group, catalog.id)).length,
  }));
}

/**
 * The full shared view. `visibleLogical` is exactly what a viewer gets on
 * /live; `total`/`unmapped`/`religious` are the admin summary buckets, derived
 * from the same intermediate groups rather than a parallel implementation.
 */
export function buildCatalogueView(docs = [], { tamilOnly = false } = {}) {
  const flat = (docs || []).map(toFlatChannel).filter((ch) => isVisibleFlatChannel(ch, { tamilOnly }));
  const allGroups = buildLogicalGroups(flat);
  const visibleLogical = allGroups.filter((group) => !group.religious);
  const religious = allGroups.length - visibleLogical.length;
  const unmapped = visibleLogical.reduce((count, group) => count + (catalogIdsForGroup(group).length ? 0 : 1), 0);

  return {
    totalVariants: flat.length,
    allGroups,
    visibleLogical,
    religious,
    unmapped,
    total: visibleLogical.length,
    catalogs: countCatalogs(visibleLogical),
  };
}
