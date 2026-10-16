import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import { listAdminCatalog } from '@/lib/catalogAdmin';
import { findDuplicateGroups } from '@/lib/catalogBulk';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET  /api/admin/catalog/duplicates      — the same film uploaded more than once.
 * POST /api/admin/catalog/duplicates      — { keep, merge: [...] } hide the losers, carry corrections.
 *
 * Merging never deletes: the losing rows are hidden (one override each, so each is separately
 * undoable) and any correction the winner lacks is copied onto it, so "merge" cannot lose the
 * owner's title fix. The reason each row was suggested as a duplicate or as the winner travels
 * with it — a silent heuristic is how you hide the wrong film.
 */
export async function GET(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const { rows } = await listAdminCatalog({ pageSize: 100000, filter: 'all', sort: 'home', section: 'all' });
    const groups = findDuplicateGroups(rows);
    return json({
      ok: true,
      count: groups.length,
      duplicates: groups.length ? groups.reduce((total, group) => total + group.rows.length - 1, 0) : 0,
      groups,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Duplicate scan failed' }, 500);
  }
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const keep = String(body?.keep || '').trim();
    const mergeKeys = Array.isArray(body?.merge) ? body.merge.map((key) => String(key)).filter((key) => key && key !== keep) : [];
    if (!keep || !mergeKeys.length) return json({ ok: false, error: 'Pick the row to keep and at least one to merge into it.' }, 400);

    const { rows } = await listAdminCatalog({ pageSize: 100000, filter: 'all', sort: 'home', section: 'all' });
    const byKey = new Map(rows.map((row) => [row.key, row]));
    const winner = byKey.get(keep);
    if (!winner) return json({ ok: false, error: 'The row you chose to keep is no longer in the catalogue.' }, 409);
    const losers = mergeKeys.map((key) => byKey.get(key)).filter(Boolean);
    if (!losers.length) return json({ ok: false, error: 'The rows you chose to merge are no longer in the catalogue.' }, 409);

    const overrideDocs = await CatalogOverride.find({ key: { $in: [keep, ...losers.map((row) => row.key)] } }).lean();
    const overrideByKey = new Map(overrideDocs.map((doc) => [doc.key, doc]));
    const records = [];

    // 1. Carry the corrections: any loser that fixed the title/year/quality hands it to the winner
    //    when the winner does not have that fix itself.
    const winnerOverride = overrideByKey.get(keep) || null;
    const carry = {};
    for (const loser of losers) {
      const source = overrideByKey.get(loser.key);
      if (!source) continue;
      for (const field of ['titleOverride', 'yearOverride', 'qualityOverride']) {
        const incoming = source[field];
        if (!incoming) continue;
        if (winnerOverride?.[field]) continue;
        if (carry[field]) continue;
        carry[field] = incoming;
      }
    }
    if (Object.keys(carry).length) {
      const after = { ...(winnerOverride ? snapshotOf(winnerOverride) : {}), ...carry };
      await CatalogOverride.updateOne({ key: keep }, { $set: carry }, { upsert: true });
      records.push(await recordAction({
        area: 'catalog', action: 'catalog.merge.carry', targetModel: 'CatalogOverride',
        summary: `Merge — carried ${Object.keys(carry).join(', ')} onto “${winner.title}”`,
        target: { kind: 'catalog-override', key: keep, label: winner.title },
        before: winnerOverride ? snapshotOf(winnerOverride) : null,
        after,
      }));
    }

    // 2. Hide the losers, one action each, each saying where the row went.
    for (const loser of losers) {
      const before = overrideByKey.has(loser.key) ? snapshotOf(overrideByKey.get(loser.key)) : null;
      const after = { ...(before || {}), hidden: true, note: `Merged into ${winner.rawTitle || winner.title}`.slice(0, 2000) };
      await CatalogOverride.updateOne({ key: loser.key }, { $set: after }, { upsert: true });
      await recordAction({
        area: 'catalog', action: 'catalog.merge.hide', targetModel: 'CatalogOverride',
        summary: `Merged “${loser.rawTitle || loser.title}” into “${winner.rawTitle || winner.title}”`,
        target: { kind: 'catalog-override', key: loser.key, label: loser.title },
        before,
        after,
      });
    }

    return json({
      ok: true,
      hidden: losers.length,
      carried: Object.keys(carry),
      message: `Kept “${winner.title}” and hid ${losers.length} duplicate${losers.length === 1 ? '' : 's'}${Object.keys(carry).length ? `, carrying over ${Object.keys(carry).join(', ')}` : ''}. Each is separately undoable in History.`,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Merge failed' }, error.status || 500);
  }
}

/** The override snapshot shape the audit trail stores (empty values dropped). */
function snapshotOf(doc = {}) {
  const out = {};
  for (const key of ['hidden', 'pinned', 'titleOverride', 'yearOverride', 'qualityOverride', 'note']) {
    const value = doc[key];
    if (value === '' || value === false || value === null || value === undefined) continue;
    out[key] = key === 'hidden' || key === 'pinned' ? Boolean(value) : value;
  }
  return Object.keys(out).length ? out : null;
}
