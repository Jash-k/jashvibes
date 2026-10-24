import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import { getDefaultLiveSources } from '@/lib/liveTv';
import { deduplicateChannels, isDummyVariant, orderVariantsByLadder } from '@/lib/live/pipeline/deduplicate.js';
import { policyForLogicalChannel } from '@/lib/live/playback/policy.js';
import { isMainstreamTamilChannel } from '@/lib/live/pipeline/normalize.js';
import { isReligiousExcludedGroup } from '@/lib/live/catalogRules';
import { LIVE_CATALOGS, isLiveCatalogId, normalizeCatalogMemberships } from '@/lib/liveCatalogs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Lowest catalog position any variant of this group holds (999999 if unmapped). */
function groupCatalogPosition(group, catalogId = 'all') {
  let lowest = 999999;
  for (const variant of group.variants || []) {
    const memberships = normalizeCatalogMemberships(variant.catalogs || []);
    for (const membership of memberships) {
      if (catalogId !== 'all' && membership.catalogId !== catalogId) continue;
      lowest = Math.min(lowest, membership.position);
    }
  }
  return lowest;
}

function groupHasCatalog(group, catalogId) {
  return (group.variants || []).some((variant) => (variant.catalogIds || []).includes(catalogId));
}

/**
 * GET /api/live/channels?tamilOnly=1&source=all&catalog=main
 * Returns deduplicated logical channels (one card per base-name) with fallback
 * ladder, filtered by source/catalog and ordered by the persisted catalog
 * positions set in Admin → TV.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const sourceFilter = String(searchParams.get('source')||'all').toLowerCase();
    const requestedCatalog = String(searchParams.get('catalog')||'').toLowerCase();
    const catalogFilter = isLiveCatalogId(requestedCatalog) ? requestedCatalog : '';
    const tamilOnly = ['1','true','yes'].includes(String(searchParams.get('tamilOnly')||'').toLowerCase());
    const includeUnplayable = false;

    await dbConnect();
    // Ensure sources seeded so admin shows them
    const defaults = getDefaultLiveSources({ includePocket:true });
    // For channels, use DB LiveChannel docs (synced via /api/live-service/sync)
    // For accurate per-source tabs, always load ALL then filter in-memory
    // Querying by sourceId would lose dedup groups that have that source among variants
    const docs = await LiveChannel.find({}).lean().catch(()=>[]);
    if (!docs.length) {
      return NextResponse.json({ ok:true, logical:[], flat:[], groups:0, totalVariants:0, sources: defaults.map(s=>({id:s.id,label:s.label,url:s.url,type:s.type})), deduplicated:true, needSync:true, hint: 'No channels in DB yet — run Admin → TV Service → Sync' }, { headers:{'Cache-Control':'no-store'}});
    }

    // Convert docs → flat channel shape used by deduplicate
    const flat = docs.map(d=>({
      channelId: d.channelId || d._id?.toString(),
      id: d.channelId,
      name: d.customName || d.name,
      originalName: d.name,
      logo: d.customLogo || d.logo,
      category: d.category || 'Live',
      language: d.language || '',
      url: d.url,
      format: d.format || 'unknown',
      playable: includeUnplayable ? true : (d.playable !== false),
      keyId: d.keyId||'',
      key: d.key||'',
      licenseKey: d.licenseKey||'',
      licenseType: d.licenseType||'',
      cookie: d.cookie||'',
      userAgent: d.userAgent||'',
      referer: d.referer||'',
      headers: d.headers||{},
      sourceId: d.sourceId,
      source: d.source,
      tvgId: d.tvgId||'',
      priority: d.priority ?? 99,
      catalogs: Array.isArray(d.catalogs) ? d.catalogs : [],
      catalogIds: (d.catalogs || []).map((item) => (typeof item === 'string' ? item : item?.catalogId)).filter(Boolean),
      logicalChannelId: d.logicalChannelId || '',
      order: d.order ?? 9999,
      mappingManaged: Boolean(d.mappingManaged),
      ladderOrder: Array.isArray(d.ladderOrder) ? d.ladderOrder : [],
    })).filter(ch => {
      if (!ch.playable) return false;
      if (isDummyVariant(ch)) return false;
      if (!ch.url) return false;
      if (tamilOnly && !isMainstreamTamilChannel(ch, ch.sourceId)) return false;
      return true;
    });

    const allLogical = deduplicateChannels(flat).map(policyForLogicalChannel).map((group) => {
      // Owner-pinned source ladder wins over registry priority for this title.
      const ladder = group.variants.find((variant) => Array.isArray(variant.ladderOrder) && variant.ladderOrder.length)?.ladderOrder;
      if (ladder) {
        group.variants = orderVariantsByLadder(group.variants, ladder);
        group.best = group.variants[0] || group.best;
      }
      // v13: religious/devotional groups are excluded everywhere unless an
      // owner manually mapped one of their variants (checked inside).
      group.religious = isReligiousExcludedGroup(group);
      return group;
    });

    // Hide auto-tagged religious groups from /live entirely. Manual mappings
    // flip isReligiousExcludedGroup() to false, so an owner-added one stays.
    const visibleLogical = allLogical.filter((group) => !group.religious);

    // Source filter: keep only groups that have at least one variant from requested source
    let logical = visibleLogical;
    if (sourceFilter !== 'all') {
      logical = visibleLogical.filter(g => g.variants.some(v => String(v.sourceId).toLowerCase() === sourceFilter));
      // Trim variants to only that source for accurate card variant count when filtered
      logical = logical.map(g => {
        const variants = g.variants.filter(v => String(v.sourceId).toLowerCase() === sourceFilter);
        return { ...g, variants, best: variants[0] || g.best, variantCount: variants.length };
      });
    }

    // Catalog filter (persisted memberships written by the background grouping
    // pass / Admin mapping). Variants are kept intact so the fallback ladder
    // still reaches every source for the title.
    if (catalogFilter) {
      logical = logical.filter((g) => groupHasCatalog(g, catalogFilter));
    }

    // Owner order first (per-catalog positions), name as the stable tiebreak.
    logical = [...logical].sort((a, b) => {
      const positionDiff = groupCatalogPosition(a, catalogFilter) - groupCatalogPosition(b, catalogFilter);
      if (positionDiff) return positionDiff;
      return String(a.displayName || '').localeCompare(String(b.displayName || ''));
    });

    // Per-catalog group counts for the public catalog tabs. Religious-excluded
    // groups have no memberships anyway, but filter the visible set explicitly
    // so a manually re-added religious channel is counted where it was placed.
    const catalogs = LIVE_CATALOGS.map((catalog) => ({
      ...catalog,
      count: visibleLogical.filter((g) => groupHasCatalog(g, catalog.id)).length,
    }));

    return NextResponse.json({
      ok:true,
      deduplicated:true,
      groups: logical.length,
      totalVariants: flat.length,
      logical,
      catalog: catalogFilter || 'all',
      catalogs,
      // keep flat for backward compat
      flat: logical.flatMap(g=> g.variants.map(v=> ({...v, logicalId:g.logicalId, displayName:g.displayName}))),
      sources: defaults,
    }, { headers:{'Cache-Control':'no-store'}});

  } catch (e) {
    return NextResponse.json({ ok:false, error: e.message }, { status:500, headers:{'Cache-Control':'no-store'}});
  }
}
