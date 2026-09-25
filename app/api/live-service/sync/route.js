import { NextResponse } from 'next/server';
import { requireServiceAuth } from '@/lib/serverAuth';
import { syncAllLiveSources } from '@/lib/liveService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(data, status = 200) { return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(request) {
  try {
    requireServiceAuth(request);
    const body = await request.json().catch(() => ({}));
    const sourceId = String(body.sourceId || '').trim();
    const includeAll = body.includeAll !== false;
    const results = await syncAllLiveSources({ sourceId, includeAll });
    return json({ ok: true, results });
  } catch (error) { return json({ ok: false, error: error.message }, error.status || 500); }
}
