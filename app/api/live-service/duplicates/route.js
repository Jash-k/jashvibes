import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { normalizeLiveKey, toClientChannel, recalcSourceCounts } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId') || '';
    const filter = sourceId ? { sourceId } : {};
    const docs = await LiveChannel.find(filter).lean();
    const map = new Map();
    for (const doc of docs) {
      const key = normalizeLiveKey(doc.name).replace(/\b(hd|sd|fhd|tv|channel)\b/g, '').replace(/\s+/g, ' ').trim() || normalizeLiveKey(doc.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(doc);
    }
    const groups = [...map.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => ({ key, count: items.length, channels: items.map(toClientChannel) })).slice(0, 100);
    return json({ ok: true, groups });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const keepId = body.keepId || body.channelId;
    const removeIds = Array.isArray(body.removeIds) ? body.removeIds.filter((id) => id && id !== keepId) : [];
    if (!keepId || !removeIds.length) return json({ ok: false, error: 'keepId and removeIds are required' }, 400);
    const keep = await LiveChannel.findOne({ channelId: keepId });
    if (!keep) return json({ ok: false, error: 'Keep channel not found' }, 404);
    const duplicateSelected = await LiveChannel.exists({ channelId: { $in: removeIds }, selected: true });
    const duplicateFavorite = await LiveChannel.exists({ channelId: { $in: removeIds }, favorite: true });
    if (duplicateSelected) keep.selected = true;
    if (duplicateFavorite) keep.favorite = true;
    await keep.save();
    const res = await LiveChannel.deleteMany({ channelId: { $in: removeIds }, selected: { $ne: true }, favorite: { $ne: true } });
    await recalcSourceCounts();
    return json({ ok: true, kept: toClientChannel(keep), removed: res.deletedCount || 0 });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
