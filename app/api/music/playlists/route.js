import { NextResponse } from 'next/server';
import { searchPlaylists } from '@/lib/musicApi';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || searchParams.get('query') || 'Tamil').trim();
    const limit = Number(searchParams.get('limit') || 12);
    const items = await searchPlaylists(query, limit);
    return NextResponse.json({ items, count: items.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Playlist search failed', items: [] }, { status: 500 });
  }
}
