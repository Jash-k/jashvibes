import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveChannel from '@/models/LiveChannel';
import { recalcSourceCounts } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const sourceId = String(body.sourceId || '').trim();
    const mode = body.mode || 'unused';
    const filter = {};
    if (sourceId) filter.sourceId = sourceId;
    if (mode === 'broken') {
      filter.workingStatus = 'broken';
      filter['catalogs.0'] = { $exists: false };
    } else if (mode === 'notSeen') {
      const days = Math.max(1, Number(body.days || 30));
      filter.lastSeenAt = { $lt: new Date(Date.now() - days * 86400000) };
      filter['catalogs.0'] = { $exists: false };
      filter.favorite = { $ne: true };
    } else if (mode === 'hidden') {
      filter.hidden = true;
      filter['catalogs.0'] = { $exists: false };
    } else {
      filter['catalogs.0'] = { $exists: false };
      filter.favorite = { $ne: true };
    }
    const res = await LiveChannel.deleteMany(filter);
    await recalcSourceCounts(sourceId || '');
    return json({ ok: true, removed: res.deletedCount || 0, mode });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
