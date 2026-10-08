import { NextResponse } from 'next/server';
import { resolveTamilDirector } from '@/lib/tamilMusicDirectors';
import { getArtistDetails, searchArtists } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    const name = String(searchParams.get('name') || '').trim();
    if (!id) return NextResponse.json({ error: 'artist id is required' }, { status: 400 });
    const director = resolveTamilDirector(id);
    if (id.startsWith('tamil-director:') && !director) return NextResponse.json({ error: 'Unknown director' }, { status: 400 });
    let item;
    if (director) {
      const normalized = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
      const candidates = await searchArtists(director.name, 12).catch(() => []);
      const exact = candidates.find((artist) => normalized(artist.name) === normalized(director.name));
      // Resolve a real ID only on an exact name match; otherwise use existing name-search fallback.
      item = await getArtistDetails(exact?.id || director.name, director.name);
      item = { ...item, name: director.name, title: director.name };
    } else item = await getArtistDetails(id, name);
    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/artist] Error:', error);
    return NextResponse.json({ error: error.message || 'Artist failed' }, { status: 500 });
  }
}
