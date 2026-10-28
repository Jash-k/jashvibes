import { NextResponse } from 'next/server';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { getDefaultLiveSources } from '@/lib/liveTv';
import { sortLogicalGroups } from '@/lib/live/catalogOrder';
import { isLiveCatalogId } from '@/lib/liveCatalogs';
import { buildCatalogueView, groupHasCatalog } from '@/lib/live/read/viewBuilder.js';

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
  'order', 'mappingManaged', 'ladderOrder', 'forceProxy',
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

  // Single shared doc → view-model pipeline (lib/live/read/viewBuilder.js):
  // the admin manager runs the exact same builder, so its chip counts match
  // these /live cards by construction.
  const view = buildCatalogueView(docs, { tamilOnly });

  const value = {
    empty: false,
    visibleLogical: view.visibleLogical,
    catalogs: view.catalogs,
    totalVariants: view.totalVariants,
    sources: defaults,
  };
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
