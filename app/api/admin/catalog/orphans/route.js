import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import { listAdminCatalog } from '@/lib/catalogAdmin';
import { buildOrphanReport, rebindOverride } from '@/lib/catalogOrphans';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET  /api/admin/catalog/orphans          — overrides whose row is no longer in the catalogue.
 * POST /api/admin/catalog/orphans {from,to} — move one override onto a live row.
 *
 * Why a report: the override key is the raw scraped title, so when the forum renames a release the
 * owner's correction, pin or hide keeps existing but stops applying — silently. This surfaces it,
 * names the cause, and offers the closest live rows so the fix is a click.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const [{ rows }, overrides] = await Promise.all([
      listAdminCatalog({ pageSize: 100000, filter: 'all', sort: 'home', section: 'all' }),
      CatalogOverride.find({}).lean(),
    ]);
    const report = buildOrphanReport(overrides, rows);
    return json({ ok: true, ...report });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Report failed' }, 500);
  }
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const fromKey = String(body?.from || '').trim();
    const toKey = String(body?.to || '').trim();
    const before = await CatalogOverride.findOne({ key: fromKey }).lean().catch(() => null);
    await rebindOverride(fromKey, toKey);
    await recordAction({
      area: 'catalog', action: 'catalog.rebind', targetModel: 'CatalogOverride',
      summary: `Re-bound the override for “${before?.titleOverride || before?.rawTitle || fromKey}” onto the current row “${toKey}”`,
      target: { kind: 'catalog-override', key: fromKey, label: before?.titleOverride || before?.rawTitle || fromKey },
      before: before ? { ...before, _id: undefined, __v: undefined, updatedAt: undefined } : null,
      after: { key: toKey },
      // A move: undo restores the override under its old key and removes the copy at the new one.
      alsoDelete: { targetModel: 'CatalogOverride', key: toKey },
    });
    return json({ ok: true, message: 'Re-bound. The row it points at now shows your correction.' });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Re-bind failed' }, error.status || 400);
  }
}
