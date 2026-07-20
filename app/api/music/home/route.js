import { NextResponse } from 'next/server';
import { getFallbackTamilArtists, getMusicHome } from '@/lib/musicApi';
import { listImportedPlaylists } from '@/lib/musicPlaylistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function loadImportedPlaylistsSafe() {
  try {
    return await listImportedPlaylists();
  } catch (error) {
    console.warn('[api/music/home] Imported playlists unavailable:', error.message);
    return [];
  }
}

export async function GET() {
  try {
    const [payload, importedPlaylists] = await Promise.all([
      getMusicHome(),
      loadImportedPlaylistsSafe(),
    ]);
    return NextResponse.json({
      ...payload,
      playlists: importedPlaylists,
      importedPlaylists,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/home] Error:', error);
    const importedPlaylists = await loadImportedPlaylistsSafe();
    return NextResponse.json({
      warning: error.message || 'Music home failed',
      sections: [],
      artists: getFallbackTamilArtists(),
      playlists: importedPlaylists,
      importedPlaylists,
      releases: { tracks: [], albums: [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
