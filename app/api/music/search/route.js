import { NextResponse } from 'next/server';
import { searchAlbums, searchArtists, searchPlaylists, searchSongs } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = String(searchParams.get('q') || searchParams.get('query') || '').trim();
    const limit = Math.min(Number(searchParams.get('limit') || 12), 50);
    if (!query) {
      return NextResponse.json({ items: [], songs: [], albums: [], artists: [], playlists: [], count: 0 });
    }

    const [songs, albums, artists, playlists] = await Promise.all([
      searchSongs(query, limit).catch((error) => { console.warn('[api/music/search] song search failed:', error.message); return []; }),
      searchAlbums(query, limit).catch((error) => { console.warn('[api/music/search] album search failed:', error.message); return []; }),
      searchArtists(query, limit).catch((error) => { console.warn('[api/music/search] artist search failed:', error.message); return []; }),
      searchPlaylists(query, limit).catch((error) => { console.warn('[api/music/search] playlist search failed:', error.message); return []; }),
    ]);

    return NextResponse.json({
      items: songs,
      songs,
      albums,
      artists,
      playlists,
      count: songs.length + albums.length + artists.length + playlists.length,
      counts: {
        songs: songs.length,
        albums: albums.length,
        artists: artists.length,
        playlists: playlists.length,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/search] Error:', error);
    return NextResponse.json({ error: error.message || 'Music search failed', items: [], songs: [], albums: [], artists: [], playlists: [] }, { status: 500 });
  }
}
