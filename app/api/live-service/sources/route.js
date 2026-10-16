import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import { ensureLiveServiceSeeded, sourceIdFromLabel, toClientSource, recalcSourceCounts } from '@/lib/liveService';
import { recordAction } from '@/lib/adminAudit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

/** The snapshot undo restores for a source. */
function sourceSnapshot(doc = {}) {
  return {
    sourceId: doc.sourceId, label: doc.label, url: doc.url, type: doc.type,
    enabled: doc.enabled !== false, trustTamil: Boolean(doc.trustTamil),
    priority: Number(doc.priority ?? 50), autoPurge: Boolean(doc.autoPurge),
    titleFilter: doc.titleFilter || '', deleted: Boolean(doc.deleted),
  };
}

export async function GET(request) {
  try {
    await requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const sources = await LiveSource.find({ deleted: { $ne: true } }).sort({ priority: 1, label: 1 }).lean();
    return json({ ok: true, sources: sources.map(toClientSource) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function POST(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const label = String(body.label || body.name || '').trim();
    const url = String(body.url || '').trim();
    if (!label || !url) return json({ ok: false, error: 'label and url are required' }, 400);
    const sourceId = String(body.sourceId || body.id || sourceIdFromLabel(label)).trim();
    const before = await LiveSource.findOne({ sourceId }).lean();
    const doc = await LiveSource.findOneAndUpdate(
      { sourceId },
      { $set: { deleted: false, sourceId, label, url, headers: body.headers || {}, type: body.type === 'json' ? 'json' : 'm3u', enabled: body.enabled !== false, trustTamil: Boolean(body.trustTamil), priority: Number(body.priority ?? 50), autoPurge: Boolean(body.autoPurge), titleFilter: String(body.titleFilter || '').trim() } },
      { upsert: true, new: true },
    );
    await recordAction({
      area: 'live', action: before ? 'live.source.edit' : 'live.source.add', targetModel: 'LiveSource',
      summary: `${before ? 'Edited' : 'Added'} the live source “${label}”`,
      target: { kind: 'live-source', key: sourceId, label },
      before: before ? sourceSnapshot(before) : null,
      after: sourceSnapshot(doc),
    });
    return json({ ok: true, source: toClientSource(doc) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function PATCH(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const sourceId = String(body.sourceId || body.id || '').trim();
    if (!sourceId) return json({ ok: false, error: 'sourceId is required' }, 400);
    const patch = {};
    ['label', 'url', 'type', 'enabled', 'trustTamil', 'priority', 'autoPurge', 'titleFilter', 'headers'].forEach((key) => { if (body[key] !== undefined) patch[key] = body[key]; });
    if (patch.type && !['m3u', 'json'].includes(patch.type)) patch.type = 'm3u';
    const before = await LiveSource.findOne({ sourceId }).lean();
    const doc = await LiveSource.findOneAndUpdate({ sourceId }, { $set: patch }, { new: true });
    if (!doc) return json({ ok: false, error: 'Source not found' }, 404);
    await recordAction({
      area: 'live', action: 'live.source.edit', targetModel: 'LiveSource',
      summary: `Updated the live source “${doc.label}” (${Object.keys(patch).join(', ')})`,
      target: { kind: 'live-source', key: sourceId, label: doc.label },
      before: before ? sourceSnapshot(before) : null,
      after: sourceSnapshot(doc),
    });
    return json({ ok: true, source: toClientSource(doc) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function DELETE(request) {
  try {
    await requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const sourceId = String(searchParams.get('sourceId') || searchParams.get('id') || '').trim();
    const deleteChannels = searchParams.get('channels') === '1';
    if (!sourceId) return json({ ok: false, error: 'sourceId is required' }, 400);
    const before = await LiveSource.findOne({ sourceId }).lean();
    await LiveSource.updateOne({ sourceId }, { $set: { deleted: true, enabled: false } });
    let removedChannels = 0;
    if (deleteChannels) {
      const res = await LiveChannel.deleteMany({ sourceId, 'catalogs.0': { $exists: false }, favorite: { $ne: true } });
      removedChannels = res.deletedCount || 0;
    }
    await recalcSourceCounts();
    await recordAction({
      area: 'live', action: 'live.source.remove', targetModel: 'LiveSource',
      summary: `Removed the live source “${before?.label || sourceId}”${deleteChannels ? ` and ${removedChannels} of its channels` : ''}`,
      target: { kind: 'live-source', key: sourceId, label: before?.label || sourceId },
      before: before ? sourceSnapshot(before) : null,
      after: null,
      reversible: !deleteChannels, // deleting channels with it cannot be undone from this snapshot
    });
    return json({ ok: true, removed: true, removedChannels });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
