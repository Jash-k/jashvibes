import { NextResponse } from 'next/server';
import { getArtistDetails } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    const name = String(searchParams.get('name') || '').trim();
    if (!id) return NextResponse.json({ error: 'artist id is required' }, { status: 400 });
    const item = await getArtistDetails(id, name);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/artist] Error:', error);
    return NextResponse.json({ error: error.message || 'Artist failed' }, { status: 500 });
  }
}
