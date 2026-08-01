import { NextResponse } from 'next/server';
import { getStremioCatalog } from '@/lib/stremioAddon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'series' ? 'series' : 'movie';
    const catalogId = searchParams.get('catalog') || searchParams.get('catalogId') || '';
    const skip = Number(searchParams.get('skip') || 0);
    const search = searchParams.get('search') || '';
    const genre = searchParams.get('genre') || '';
    const language = searchParams.get('language') || '';
    const sort = searchParams.get('sort') || '';
    const source = searchParams.get('source') || 'catalog';
    const payload = await getStremioCatalog({ type, catalogId, skip, search, genre, language, sort, source });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/stremio/catalog] Error:', error);
    return NextResponse.json({ error: error.message || 'Stremio catalog failed', items: [], count: 0, hasMore: false }, { status: 500 });
  }
}
