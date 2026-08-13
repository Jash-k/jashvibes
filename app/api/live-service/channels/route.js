import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { ensureLiveServiceSeeded, normalizeLiveKey, toClientChannel, recalcSourceCounts } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function GET(request) {
  try {
    requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    const { searchParams } = new URL(request.url);
    const sourceId = searchParams.get('sourceId') || '';
    const selected = searchParams.get('selected');
    const hidden = searchParams.get('hidden');
    const q = normalizeLiveKey(searchParams.get('q') || '');
    const category = searchParams.get('category') || '';
    const profileId = searchParams.get('profile') || 'default';
    const limit = Math.max(1, Math.min(1500, Number(searchParams.get('limit') || 500)));
    const page = Math.max(1, Number(searchParams.get('page') || 1));
    const filter = {};
    if (sourceId) filter.sourceId = sourceId;
    if (selected === '1') filter.selected = true;
    if (selected === '0') filter.selected = { $ne: true };
    if (hidden === '0') filter.hidden = { $ne: true };
    if (hidden === '1') filter.hidden = true;
    if (category) filter.category = category;
    if (profileId && selected === '1') filter.profiles = profileId;
    if (q) filter.$or = [
      { normalizedName: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
    ];
    const total = await LiveChannel.countDocuments(filter);
    const docs = await LiveChannel.find(filter).sort({ selected: -1, favorite: -1, order: 1, name: 1 }).skip((page - 1) * limit).limit(limit).lean();
    const categories = await LiveChannel.distinct('category', sourceId ? { sourceId } : {});
    return json({ ok: true, total, page, limit, hasMore: page * limit < total, categories: categories.filter(Boolean).sort(), channels: docs.map(toClientChannel) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function PATCH(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [body.channelId || body.id].filter(Boolean);
    if (!ids.length) return json({ ok: false, error: 'channel id is required' }, 400);
    const patch = {};
    ['selected', 'favorite', 'hidden', 'customName', 'customLogo', 'category', 'order', 'profiles', 'workingStatus'].forEach((key) => { if (body[key] !== undefined) patch[key] = body[key]; });
    if (body.action === 'add') patch.selected = true;
    if (body.action === 'remove') patch.selected = false;
    if (body.action === 'hide') patch.hidden = true;
    if (body.action === 'unhide') patch.hidden = false;
    if (body.action === 'favorite') patch.favorite = true;
    if (body.action === 'unfavorite') patch.favorite = false;
    const res = await LiveChannel.updateMany({ channelId: { $in: ids } }, { $set: patch });
    await recalcSourceCounts();
    const docs = await LiveChannel.find({ channelId: { $in: ids } }).lean();
    return json({ ok: true, modified: res.modifiedCount || 0, channels: docs.map(toClientChannel) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}

export async function DELETE(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('channelId') || searchParams.get('id') || '';
    if (!id) return json({ ok: false, error: 'channelId is required' }, 400);
    const doc = await LiveChannel.findOne({ channelId: id });
    await LiveChannel.deleteOne({ channelId: id });
    if (doc?.sourceId) await recalcSourceCounts(doc.sourceId);
    return json({ ok: true, removed: true });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
