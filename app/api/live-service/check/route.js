import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { checkAndUpdateChannel, toClientChannel } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids : [];
    const sourceId = body.sourceId || '';
    const filter = ids.length ? { channelId: { $in: ids } } : sourceId ? { sourceId } : { selected: true };
    const limit = Math.max(1, Math.min(80, Number(body.limit || 40)));
    const channels = await LiveChannel.find(filter).limit(limit);
    const results = [];
    for (const channel of channels) {
      const ok = await checkAndUpdateChannel(channel);
      results.push({ channelId: channel.channelId, name: channel.name, ok });
    }
    const updated = await LiveChannel.find({ channelId: { $in: results.map((r) => r.channelId) } }).lean();
    return json({ ok: true, checked: results.length, results, channels: updated.map(toClientChannel) });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
