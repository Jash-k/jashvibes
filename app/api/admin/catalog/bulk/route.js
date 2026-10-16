import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import { listAdminCatalog } from '@/lib/catalogAdmin';
import { planBulk } from '@/lib/catalogBulk';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/admin/catalog/bulk
 *
 *   { mode: 'preview' | 'apply', op: {op, value}, keys: [...] }
 *
 * One endpoint for both halves on purpose: the preview and the apply run the **same** planner over
 * the **same** rows, so what you are shown is what will happen. Preview returns every changed row
 * (and every row skipped because it is already in that state); apply runs it and records one
 * history entry per row, so a mistake in a 40-row edit is still undone per row rather than
 * all-or-nothing.
 *
 * `mode: 'select'` resolves the current view (search + filter + section) into the key list, so
 * "select everything that matches" never means "select the 25 rows on this page".
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || 'preview');

    const listing = await listAdminCatalog({
      q: String(body?.q || ''),
      filter: String(body?.filter || 'all'),
      section: String(body?.section || 'all'),
      sort: 'home',
      page: 1,
      pageSize: 5000,
    });
    const rowByKey = new Map(listing.rows.map((row) => [row.key, row]));
    const overrides = await CatalogOverride.find({ key: { $in: [...rowByKey.keys()] } }).lean();
    for (const doc of overrides) {
      const row = rowByKey.get(doc.key);
      if (row) row.override = doc;
    }

    if (mode === 'select') {
      return json({ ok: true, keys: listing.rows.map((row) => row.key), total: listing.rows.length });
    }

    const keys = Array.isArray(body?.keys) ? body.keys.map((key) => String(key)) : [];
    if (!keys.length) return json({ ok: false, error: 'Select at least one row.' }, 400);
    const rows = keys.map((key) => rowByKey.get(key)).filter(Boolean);
    if (!rows.length) return json({ ok: false, error: 'None of those rows are in the current catalogue. Reload and try again.' }, 409);

    const plan = planBulk(rows, { op: body?.op?.op, value: body?.op?.value });
    if (mode === 'preview' || body?.dryRun) {
      return json({
        ok: true,
        preview: true,
        summary: plan.summary,
        changed: plan.changed.map((entry) => ({ key: entry.key, label: entry.label, before: entry.before, after: entry.after })),
        skipped: plan.skipped.map((entry) => ({ key: entry.key, label: entry.label })),
        missing: keys.length - rows.length,
      });
    }

    let applied = 0;
    for (const entry of plan.changed) {
      if (entry.after === null) await CatalogOverride.deleteOne({ key: entry.key });
      else await CatalogOverride.updateOne({ key: entry.key }, { $set: entry.after }, { upsert: true });
      applied += 1;
      await recordAction({
        area: 'catalog',
        action: `catalog.bulk.${body?.op?.op || 'edit'}`,
        targetModel: 'CatalogOverride',
        summary: `Bulk ${body?.op?.op || 'edit'} — “${entry.label}”${body?.op?.value ? ` → ${body.op.value}` : ''} (${applied} of ${plan.changed.length})`,
        target: { kind: 'catalog-override', key: entry.key, label: entry.label },
        before: entry.before,
        after: entry.after,
        // A bulk edit is a row edit: each entry is separately undoable from History.
      });
    }

    return json({ ok: true, applied, skipped: plan.skipped.length, message: `${plan.summary}. Undo per row is in History.` });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Bulk edit failed' }, error.status || 500);
  }
}
