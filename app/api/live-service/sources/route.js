import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import { ensureLiveServiceSeeded, sourceIdFromLabel, toClientSource, recalcSourceCounts } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const sources = await LiveSource.find({}).sort({ priority: 1, label: 1 }).lean();
    return json({ ok: true, sources: sources.map(toClientSource) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const label = String(body.label || body.name || '').trim();
    const url = String(body.url || '').trim();
    if (!label || !url) return json({ ok: false, error: 'label and url are required' }, 400);
    const sourceId = String(body.sourceId || body.id || sourceIdFromLabel(label)).trim();
    const doc = await LiveSource.findOneAndUpdate(
      { sourceId },
      { $set: { sourceId, label, url, type: body.type === 'json' ? 'json' : 'm3u', enabled: body.enabled !== false, trustTamil: Boolean(body.trustTamil), priority: Number(body.priority ?? 50), autoPurge: Boolean(body.autoPurge) } },
      { upsert: true, new: true },
    );
    return json({ ok: true, source: toClientSource(doc) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function PATCH(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const sourceId = String(body.sourceId || body.id || '').trim();
    if (!sourceId) return json({ ok: false, error: 'sourceId is required' }, 400);
    const patch = {};
    ['label', 'url', 'type', 'enabled', 'trustTamil', 'priority', 'autoPurge'].forEach((key) => { if (body[key] !== undefined) patch[key] = body[key]; });
    if (patch.type && !['m3u', 'json'].includes(patch.type)) patch.type = 'm3u';
    const doc = await LiveSource.findOneAndUpdate({ sourceId }, { $set: patch }, { new: true });
    if (!doc) return json({ ok: false, error: 'Source not found' }, 404);
    return json({ ok: true, source: toClientSource(doc) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function DELETE(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const sourceId = String(searchParams.get('sourceId') || searchParams.get('id') || '').trim();
    const deleteChannels = searchParams.get('channels') === '1';
    if (!sourceId) return json({ ok: false, error: 'sourceId is required' }, 400);
    await LiveSource.deleteOne({ sourceId });
    let removedChannels = 0;
    if (deleteChannels) {
      const res = await LiveChannel.deleteMany({ sourceId, selected: { $ne: true }, favorite: { $ne: true } });
      removedChannels = res.deletedCount || 0;
    }
    await recalcSourceCounts();
    return json({ ok: true, removed: true, removedChannels });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
