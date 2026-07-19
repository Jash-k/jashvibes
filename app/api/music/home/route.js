import { NextResponse } from 'next/server';
import { getMusicHome } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const payload = await getMusicHome();
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/home] Error:', error);
    return NextResponse.json({
      warning: error.message || 'Music home failed',
      sections: [],
      artists: [],
      playlists: [],
      releases: { tracks: [], albums: [] },
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
