import { NextResponse } from 'next/server';
import { getStremioMeta } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'series' ? 'series' : 'movie';
    const id = searchParams.get('id') || '';
    const source = searchParams.get('source') || '';
    const item = await getStremioMeta({ type, id, source });
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/stremio/meta] Error:', error);
    return NextResponse.json({ error: error.message || 'Stremio meta failed' }, { status: 500 });
  }
}
