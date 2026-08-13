import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import dbConnect from '@/lib/db';
import LiveSource from '@/models/LiveSource';
import LiveChannel from '@/models/LiveChannel';
import { ensureLiveServiceSeeded, syncLiveSource, recalcSourceCounts } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request) {
  try {
    requireServiceAuth(request);
    await ensureLiveServiceSeeded();
    await dbConnect();
    const body = await request.json().catch(() => ({}));
    const sourceId = String(body.sourceId || '').trim();
    const includeAll = body.includeAll !== false;
    const autoSelectPopular = Boolean(body.autoSelectPopular);
    const sources = sourceId ? await LiveSource.find({ sourceId }) : await LiveSource.find({ enabled: { $ne: false } }).sort({ priority: 1 });
    if (!sources.length) return json({ ok: false, error: 'No source found' }, 404);
    const results = [];
    for (const source of sources) {
      try {
        const result = await syncLiveSource(source, { includeAll, autoSelectPopular });
        if (source.autoPurge) {
          await LiveChannel.deleteMany({ sourceId: source.sourceId, selected: { $ne: true }, favorite: { $ne: true } });
          await recalcSourceCounts(source.sourceId);
        }
        results.push({ sourceId: source.sourceId, ok: true, ...result });
      } catch (error) {
        await LiveSource.updateOne({ sourceId: source.sourceId }, { $set: { lastError: error.message || 'Sync failed' } });
        results.push({ sourceId: source.sourceId, ok: false, error: error.message || 'Sync failed' });
      }
    }
    return json({ ok: true, results });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
