import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import { selfApi } from '@/lib/selfApi';
import { scrapeCollection, getCachedScrape } from '@/lib/tamilmvPayload';
import { scrapeTamilMV } from '@/lib/tamilmvScraper';
import { diffScrape, orphanedBy } from '@/lib/catalogBulk';
import CatalogOverride from '@/models/CatalogOverride';
import { itemKey } from '@/lib/catalogAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/catalog/sync  {mode: 'sync' | 'purge'}
 *
 *   sync  → the exact code path of the homepage Sync button (full re-scrape,
 *           TMDB matching, cache overwrite), via the existing endpoint.
 *   purge → forget the cached scrape entirely; the next catalog read rebuilds.
 *   dry   → scrape into memory, write NOTHING, and report the difference against the cache:
 *           what would appear, what would disappear, what would change, and — the part worth
 *           having — which overrides the sync would orphan, so the answer to "is it safe to
 *           sync?" is read before the sync rather than discovered after it.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'purge' ? 'purge' : body?.mode === 'dry' ? 'dry' : 'sync';

    if (mode === 'purge') {
      await (await scrapeCollection()).deleteOne({ key: 'latest' });
      await recordAction({
        area: 'catalog', action: 'catalog.purge', reversible: false,
        summary: 'Purged the catalogue cache (rebuilds on the next read)',
        target: { kind: 'catalog-cache', key: 'latest', label: 'TamilMV cache' },
      });
      return NextResponse.json(
        { ok: true, purged: true, message: 'Catalog cache purged. The next visit re-scrapes from TamilMV.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (mode === 'dry') {
      const [cached, scraped, overrides] = await Promise.all([
        getCachedScrape(),
        // No TMDB matching and no posters: this is a title-level diff, and it must not spend the
        // TMDB budget or write a single document.
        scrapeTamilMV({ fetchPostersEnabled: false, matchTMDB: false, limitPerType: 60 }),
        CatalogOverride.find({}).select('key').lean(),
      ]);
      const diff = diffScrape(cached || {}, scraped || {}, itemKey);
      const wouldOrphan = orphanedBy(diff, overrides.map((doc) => doc.key));
      await recordAction({
        area: 'catalog', action: 'catalog.dryrun', reversible: false,
        summary: `Dry run — ${diff.counts.after} titles scraped, ${diff.counts.added} new, ${diff.counts.removed} gone, ${wouldOrphan.length} override(s) would be orphaned`,
        target: { kind: 'catalog-cache', key: 'latest', label: 'TamilMV cache' },
      });
      return NextResponse.json(
        {
          ok: true,
          dryRun: true,
          counts: diff.counts,
          added: diff.added.slice(0, 40),
          removed: diff.removed.slice(0, 40),
          changed: diff.changed.slice(0, 40),
          truncation: { added: diff.added.length > 40, removed: diff.removed.length > 40, changed: diff.changed.length > 40 },
          wouldOrphanOverrides: wouldOrphan.slice(0, 40),
          message: `Nothing written. A sync now would add ${diff.counts.added}, remove ${diff.counts.removed}, change ${diff.counts.changed}${wouldOrphan.length ? `, and orphan ${wouldOrphan.length} override(s)` : ''}.`,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await selfApi(request, '/api/tamilmv?refresh=1&posters=1', { method: 'GET' });
    await recordAction({
      area: 'catalog', action: 'catalog.sync', reversible: false,
      summary: `Re-scraped TamilMV — ${(result?.movies?.length || 0) + (result?.series?.length || 0)} titles in cache`,
      target: { kind: 'catalog-cache', key: 'latest', label: 'TamilMV cache' },
    });
    return NextResponse.json(
      {
        ok: true,
        message: `Catalog refreshed — ${(result?.movies?.length || 0) + (result?.series?.length || 0)} titles in cache.`,
        count: result?.count || 0,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Sync failed' }, { status: 500 });
  }
}
