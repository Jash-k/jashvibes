import { NextResponse } from 'next/server';
import { getTamilArtists, searchArtists } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || searchParams.get('query') || '').trim();
    const limit = Math.min(Number(searchParams.get('limit') || 12), 50);
    const items = query ? await searchArtists(query, limit) : await getTamilArtists();
    return NextResponse.json({ items, count: items.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/artists] Error:', error);
    return NextResponse.json({ error: error.message || 'Music artists failed', items: [] }, { status: 500 });
  }
}
