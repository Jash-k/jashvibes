import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getDefaultLiveSources } from '@/lib/liveTv';
import { deduplicateChannels, isDummyVariant, orderVariantsByLadder } from '@/lib/live/pipeline/deduplicate.js';
import { policyForLogicalChannel } from '@/lib/live/playback/policy.js';
import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';
import { isReligiousExcludedGroup } from '@/lib/live/catalogRules';
import { sortLogicalGroups } from '@/lib/live/catalogOrder';
import { LIVE_CATALOGS, isLiveCatalogId } from '@/lib/liveCatalogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Speed: only the fields the dedup/player path reads leave the database. The
 * full collection (thousands of rows) used to ship whole docs incl. big
 * headers/audit fields on every single page load.
 */
const PUBLIC_PROJECTION = [
  'channelId', 'sourceId', 'source', 'tvgId', 'name', 'customName', 'logo', 'customLogo',
  'category', 'language', 'url', 'format', 'playable', 'hidden', 'keyId', 'key', 'licenseKey',
  'licenseType', 'cookie', 'userAgent', 'referer', 'headers', 'catalogs', 'logicalChannelId',
  'order', 'mappingManaged', 'ladderOrder',
].join(' ');

/**
 * Versioned in-memory cache for the expensive base catalogue (full find +
 * dedup + policy map + ladder/religious processing). It lives on the same
 * global object as the A3 catalogue cache, so every model write (admin edit,
 * sync, rebuild — see lib/catalogVersion.js) bumps the version and clears it.
 * A short TTL is the backstop for non-model state changes.
 */
const BASE_TTL_MS = Number(process.env.LIVE_CHANNELS_CACHE_TTL_MS || 15_000);
const cacheStore = globalThis.__jashLiveCatalogCache || (globalThis.__jashLiveCatalogCache = { entries: new Map(), version: 0 });
const BASE_KEY = 'public-channels-base-v4';

function groupHasCatalog(group, catalogId) {
  return (group.variants || []).some((variant) => (variant.catalogIds || []).includes(catalogId));
}

/**
 * Build (or return cached) base result: every visible, deduplicated logical
 * group BEFORE source/catalog filtering, plus the catalog tab counts. Filter
 * requests then derive from this in-memory base instead of touching Mongo.
 */
async function loadBaseCatalogue({ tamilOnly }) {
  const cached = cacheStore.entries.get(BASE_KEY);
  if (cached && cached.tamilOnly === tamilOnly && cacheStore.version === cached.version && Date.now() - cached.at < BASE_TTL_MS) {
    return cached.value;
  }

  await dbConnect();
  const docs = await LiveChannel.find({}).select(PUBLIC_PROJECTION).lean().catch(() => []);
  const defaults = getDefaultLiveSources({ includePocket: true });

  if (!docs.length) {
    const empty = {
      empty: true,
      sources: defaults.map((s) => ({ id: s.id, label: s.label, url: s.url, type: s.type })),
    };
    cacheStore.entries.set(BASE_KEY, { at: Date.now(), version: cacheStore.version, tamilOnly, value: empty });
    return empty;
  }

  const flat = docs.map((d) => ({
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
  })).filter((ch) => {
    if (!ch.playable) return false;
    if (isDummyVariant(ch)) return false;
    if (!ch.url) return false;
    // Admin "Hide from /live" must actually remove the row from the public
    // catalogue. Hidden variants are dropped before dedup, so a group whose
    // every variant is hidden disappears; a group with other live variants
    // simply loses this fallback entry.
    if (ch.hidden) return false;
    if (tamilOnly && !isMainstreamTamilChannel(ch, ch.sourceId)) return false;
    return true;
  });

  const visibleLogical = deduplicateChannels(flat).map(policyForLogicalChannel).map((group) => {
    const ladder = group.variants.find((variant) => Array.isArray(variant.ladderOrder) && variant.ladderOrder.length)?.ladderOrder;
    if (ladder) {
      group.variants = orderVariantsByLadder(group.variants, ladder);
      group.best = group.variants[0] || group.best;
    }
    // Religious/devotional groups are excluded everywhere unless an owner
    // manually mapped one of their variants (checked inside).
    group.religious = isReligiousExcludedGroup(group);
    return group;
  }).filter((group) => !group.religious);

  const catalogs = LIVE_CATALOGS.map((catalog) => ({
    ...catalog,
    count: visibleLogical.filter((g) => groupHasCatalog(g, catalog.id)).length,
  }));

  const value = { empty: false, visibleLogical, catalogs, totalVariants: flat.length, sources: defaults };
  cacheStore.entries.set(BASE_KEY, { at: Date.now(), version: cacheStore.version, tamilOnly, value });
  return value;
}

/**
 * GET /api/live/channels?tamilOnly=1&source=all&catalog=main
 * Deduplicated logical channels (one card per base-name) with fallback
 * ladder, filtered by source/catalog and ordered by persisted catalog
 * positions. The heavy base build is cached; filters are pure in-memory.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceFilter = String(searchParams.get('source') || 'all').toLowerCase();
    const requestedCatalog = String(searchParams.get('catalog') || '').toLowerCase();
    const catalogFilter = isLiveCatalogId(requestedCatalog) ? requestedCatalog : '';
    const tamilOnly = ['1', 'true', 'yes'].includes(String(searchParams.get('tamilOnly') || '').toLowerCase());

    const base = await loadBaseCatalogue({ tamilOnly });
    if (base.empty) {
      return NextResponse.json(
        { ok: true, logical: [], flat: [], groups: 0, totalVariants: 0, sources: base.sources, deduplicated: true, needSync: true, hint: 'No channels in DB yet — run Admin → TV → Sync All Tamil' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    let logical = base.visibleLogical;
    if (sourceFilter !== 'all') {
      logical = logical
        .filter((g) => g.variants.some((v) => String(v.sourceId).toLowerCase() === sourceFilter))
        .map((g) => {
          // Trim variants to only that source for accurate card variant counts.
          const variants = g.variants.filter((v) => String(v.sourceId).toLowerCase() === sourceFilter);
          return { ...g, variants, best: variants[0] || g.best, variantCount: variants.length };
        });
    }

    // Catalog filter (persisted memberships). Variants stay intact when no
    // source filter is active, so the fallback ladder reaches every source.
    if (catalogFilter) {
      logical = logical.filter((g) => groupHasCatalog(g, catalogFilter));
    }

    // Inside a fixed catalog the owner's Admin reorder is authoritative
    // (exact same order as Admin → TV); the virtual "All Tamil" view keeps
    // family-first ordering. Comparator shared and tested in catalogOrder.js.
    logical = sortLogicalGroups(logical, catalogFilter);

    return NextResponse.json({
      ok: true,
      deduplicated: true,
      groups: logical.length,
      totalVariants: base.totalVariants,
      logical,
      catalog: catalogFilter || 'all',
      catalogs: base.catalogs,
      // Backward-compat flat view.
      flat: logical.flatMap((g) => g.variants.map((v) => ({ ...v, logicalId: g.logicalId, displayName: g.displayName }))),
      sources: base.sources,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
