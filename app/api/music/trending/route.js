import { NextResponse } from 'next/server';
import { getTrending } from '@/lib/musicApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const language = searchParams.get('language') || process.env.MUSIC_LANG || 'Tamil';
    const limit = Number(searchParams.get('limit') || 24);
    const items = await getTrending(language, limit);
    return NextResponse.json({ items, count: items.length, language }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/music/trending] Error:', error);
    return NextResponse.json({ error: error.message || 'Music trending failed', items: [] }, { status: 500 });
  }
}
