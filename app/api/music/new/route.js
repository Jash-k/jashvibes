import { NextResponse } from 'next/server';
import { getNewReleases } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const language = searchParams.get('language') || process.env.MUSIC_LANG || 'Tamil';
    const limit = Number(searchParams.get('limit') || 24);
    const payload = await getNewReleases(language, limit);
    return NextResponse.json({ ...payload, language }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/new] Error:', error);
    return NextResponse.json({ error: error.message || 'Music new releases failed', tracks: [], albums: [] }, { status: 500 });
  }
}
