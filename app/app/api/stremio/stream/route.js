import { NextResponse } from 'next/server';
import { getStremioStreams } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'series' ? 'series' : 'movie';
    const id = searchParams.get('id') || '';
    const payload = await getStremioStreams({ type, id });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/stremio/stream] Error:', error);
    return NextResponse.json({ error: error.message || 'Stremio stream failed', streams: [], count: 0 }, { status: 500 });
  }
}
