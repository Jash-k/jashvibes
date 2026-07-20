import { NextResponse } from 'next/server';
import { getPlaylistDetails } from '@/lib/musicApi';
import { getImportedPlaylistDetails } from '@/lib/musicPlaylistStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    const title = String(searchParams.get('title') || '').trim();
    if (!id) return NextResponse.json({ error: 'playlist id is required' }, { status: 400 });

    const item = id.startsWith('local:') || id.startsWith('imported:')
      ? await getImportedPlaylistDetails(id)
      : await getPlaylistDetails(id, title);

    return NextResponse.json({ item }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/playlist] Error:', error);
    return NextResponse.json({ error: error.message || 'Playlist failed' }, { status: 500 });
  }
}
