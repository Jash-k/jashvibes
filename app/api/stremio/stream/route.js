import { NextResponse } from 'next/server';
import { getStremioStreams } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'series' ? 'series' : 'movie';
    const id = searchParams.get('id') || '';
    const source = searchParams.get('source') || '';
    const season = Number(searchParams.get('season') || searchParams.get('s') || 1);
    const episode = Number(searchParams.get('episode') || searchParams.get('e') || 1);
    const payload = await getStremioStreams({ type, id, source, season, episode });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/stremio/stream] Error:', error);
    return NextResponse.json({ error: error.message || 'Stremio stream failed', streams: [], count: 0 }, { status: 500 });
  }
}
