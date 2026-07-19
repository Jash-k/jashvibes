import { NextResponse } from 'next/server';
import { getAlbumDetails } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    const title = String(searchParams.get('title') || '').trim();
    if (!id) return NextResponse.json({ error: 'album id is required' }, { status: 400 });
    const item = await getAlbumDetails(id, title);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/album] Error:', error);
    return NextResponse.json({ error: error.message || 'Album failed' }, { status: 500 });
  }
}
