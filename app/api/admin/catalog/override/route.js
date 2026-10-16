import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { recordAction } from '@/lib/adminAudit';
import dbConnect from '@/lib/db';
import CatalogOverride from '@/models/CatalogOverride';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QUALITY_TIERS = new Set(['', '4k', '1080p', '720p', 'hdrip', 'dvdscr', 'cam', 'tv']);

/**
 * POST /api/admin/catalog/override
 * {key, rawTitle?, type?, hidden?, pinned?, titleOverride?, yearOverride?, qualityOverride?}
 *
 * One upsert powers hide / unhide, pin / unpin, and the manual corrections.
 */
/** What changed, in the words the history list uses. */
function describeCatalogAction(patch = {}) {
  if ('hidden' in patch) return patch.hidden ? 'catalog.hide' : 'catalog.restore';
  if ('pinned' in patch) return patch.pinned ? 'catalog.pin' : 'catalog.unpin';
  if ('titleOverride' in patch || 'yearOverride' in patch || 'qualityOverride' in patch) return 'catalog.correct';
  return 'catalog.override';
}
function summarise(patch = {}, doc = {}) {
  const name = doc?.titleOverride || doc?.rawTitle || 'row';
  if ('hidden' in patch) return `${patch.hidden ? 'Removed' : 'Restored'} “${name}” on the home page`;
  if ('pinned' in patch) return `${patch.pinned ? 'Pinned' : 'Unpinned'} “${name}”`;
  const fields = ['titleOverride', 'yearOverride', 'qualityOverride'].filter((field) => field in patch);
  return fields.length ? `Corrected ${fields.map((f) => f.replace('Override', '')).join(' / ')} for “${name}”` : `Updated “${name}”`;
}
/** The snapshot shape undo restores. */
function snapshot(doc = {}) {
  return {
    key: doc.key, type: doc.type, rawTitle: doc.rawTitle, title: doc.title,
    hidden: Boolean(doc.hidden), pinned: Boolean(doc.pinned),
    titleOverride: doc.titleOverride || '', yearOverride: doc.yearOverride || '',
    qualityOverride: doc.qualityOverride || '', note: doc.note || '',
  };
}

export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const key = String(body?.key || '').trim();
    if (!key) return NextResponse.json({ ok: false, error: 'Missing row key' }, { status: 400 });

    await dbConnect();
    const patch = {};
    for (const field of ['hidden', 'pinned']) {
      if (field in body) patch[field] = Boolean(body[field]);
    }
    for (const field of ['titleOverride', 'yearOverride', 'rawTitle', 'type', 'note']) {
      if (field in body) patch[field] = String(body[field] || '').trim();
    }
    if ('qualityOverride' in body) {
      const tier = String(body.qualityOverride || '').trim().toLowerCase();
      patch.qualityOverride = QUALITY_TIERS.has(tier) ? tier : '';
    }

    // The snapshot of what this row looked like before, so the change is undoable.
    const before = await CatalogOverride.findOne({ key }).lean();

    const doc = await CatalogOverride.findOneAndUpdate(
      { key },
      { $set: patch, $setOnInsert: { key } },
      { upsert: true, new: true, runValidators: true },
    ).lean();

    await recordAction({
      area: 'catalog',
      action: describeCatalogAction(patch),
      summary: summarise(patch, doc),
      targetModel: 'CatalogOverride',
      target: { kind: 'catalog-row', key, label: doc?.titleOverride || doc?.rawTitle || key },
      before: before ? snapshot(before) : null,
      after: snapshot(doc),
    });

    return NextResponse.json({ ok: true, override: doc }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Override failed' }, { status: 500 });
  }
}
