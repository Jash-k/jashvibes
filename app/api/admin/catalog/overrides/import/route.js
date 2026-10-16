import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

const FIELDS = ['hidden', 'pinned', 'titleOverride', 'yearOverride', 'qualityOverride', 'note'];

/**
 * POST /api/admin/catalog/overrides/import — { mode: 'merge' | 'replace', overrides: [...] }
 *
 * Two modes, and the difference is the whole point of having two:
 *
 *   merge    (the default) adds and updates, records **one history entry per row**, so the import
 *            is undoable row by row exactly like a bulk edit. Nothing that already exists is lost
 *            unless the file says so.
 *   replace  wipes the collection first. That cannot be undone from the panel — it records a
 *            single irreversible entry and says so, because "restore the 200 overrides I just
 *            deleted" is not something a snapshot of the deletion can do. Export first; the
 *            Health tab shows the export size right next to this button for that reason.
 *
 * Validation is strict on purpose: a malformed file must be rejected before it writes anything.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'replace' ? 'replace' : 'merge';
    const raw = Array.isArray(body?.overrides) ? body.overrides : null;
    if (!raw || !raw.length) return json({ ok: false, error: 'That file has no overrides in it.' }, 400);
    if (raw.length > 5000) return json({ ok: false, error: `That file has ${raw.length} overrides — the limit is 5000.` }, 400);

    const parsed = [];
    for (const [index, entry] of raw.entries()) {
      const key = String(entry?.key || '').trim();
      if (!key) return json({ ok: false, error: `Override ${index + 1} has no key, so it cannot be applied.` }, 400);
      const doc = { key, type: entry.type === 'series' ? 'series' : 'movie', rawTitle: String(entry.rawTitle || '').trim() };
      for (const field of FIELDS) {
        if (field === 'hidden' || field === 'pinned') doc[field] = Boolean(entry[field]);
        else doc[field] = String(entry[field] || '').trim();
      }
      parsed.push(doc);
    }

    const existing = await CatalogOverride.find({ key: { $in: parsed.map((doc) => doc.key) } }).lean();
    const existingByKey = new Map(existing.map((doc) => [doc.key, doc]));

    if (mode === 'replace') {
      const removed = await CatalogOverride.deleteMany({});
      await CatalogOverride.insertMany(parsed, { ordered: false }).catch(() => {});
      await recordAction({
        area: 'catalog', action: 'catalog.overrides.replace', reversible: false,
        summary: `Replaced all catalogue overrides with an imported file — ${parsed.length} imported, ${removed.deletedCount || 0} removed`,
        target: { kind: 'catalog-overrides', key: 'all', label: 'Catalogue overrides' },
      });
      return json({ ok: true, mode, imported: parsed.length, removed: removed.deletedCount || 0, message: `Replaced the override set with ${parsed.length} entries. This cannot be undone from the panel — the export you took before this is the way back.` });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const doc of parsed) {
      const before = existingByKey.get(doc.key) || null;
      if (before && sameShape(before, doc)) { unchanged += 1; continue; }
      await CatalogOverride.updateOne({ key: doc.key }, { $set: doc }, { upsert: true });
      if (before) updated += 1; else created += 1;
      await recordAction({
        area: 'catalog', action: before ? 'catalog.import.update' : 'catalog.import.add',
        targetModel: 'CatalogOverride',
        summary: `Imported the override for “${doc.titleOverride || doc.rawTitle || doc.key}” (${before ? 'updated' : 'added'})`,
        target: { kind: 'catalog-override', key: doc.key, label: doc.titleOverride || doc.rawTitle || doc.key },
        before: before ? snapshotOf(before) : null,
        after: snapshotOf(doc),
      });
    }
    return json({
      ok: true, mode, imported: parsed.length, created, updated, unchanged,
      message: `Imported ${parsed.length}: ${created} added, ${updated} updated, ${unchanged} already identical. Each is separately undoable in History.`,
    });
  } catch (error) {
    return json({ ok: false, error: error.message || 'Import failed' }, error.status || 500);
  }
}

function sameShape(before, incoming) {
  for (const field of FIELDS) {
    if ((before[field] || '') !== (incoming[field] || '')) return false;
  }
  return true;
}

function snapshotOf(doc = {}) {
  const out = {};
  for (const key of FIELDS) {
    const value = doc[key];
    if (value === '' || value === false || value === null || value === undefined) continue;
    out[key] = key === 'hidden' || key === 'pinned' ? Boolean(value) : value;
  }
  return Object.keys(out).length ? out : null;
}
