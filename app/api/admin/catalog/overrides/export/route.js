import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/catalog/overrides/export — the override set as a file you can keep.
 *
 * This exists because everything else in the panel is a write, and the one thing a panel full of
 * writes needs is a way out. The file carries the same shapes the importer accepts, plus a header
 * with the release and counts, so a restore years from now can tell whether it belongs.
 *
 * `?download=1` sets the filename; the same JSON is returned inline otherwise, which is what the
 * Health tab reads to show the size of the set.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const { searchParams } = new URL(request.url);
    const docs = await CatalogOverride.find({}).sort({ key: 1 }).lean();
    const payload = {
      kind: 'catalog-overrides',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: docs.length,
      overrides: docs.map((doc) => ({
        key: doc.key,
        type: doc.type || 'movie',
        rawTitle: doc.rawTitle || '',
        title: doc.title || '',
        hidden: Boolean(doc.hidden),
        pinned: Boolean(doc.pinned),
        titleOverride: doc.titleOverride || '',
        yearOverride: doc.yearOverride || '',
        qualityOverride: doc.qualityOverride || '',
        note: doc.note || '',
      })),
    };
    const headers = { 'Cache-Control': 'no-store' };
    if (searchParams.get('download') === '1') {
      const stamp = new Date().toISOString().slice(0, 10);
      headers['Content-Disposition'] = `attachment; filename="jashvibes-catalog-overrides-${stamp}.json"`;
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    return new NextResponse(JSON.stringify(payload, null, 2), { status: 200, headers });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Export failed' }, {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
