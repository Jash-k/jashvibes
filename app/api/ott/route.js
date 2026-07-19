import { NextResponse } from 'next/server';
import { listTamilOttCatalog } from '@/lib/providers/tamilOttProvider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source') || 'movies';
    const page = Number(searchParams.get('page') || 1);
    const limit = Number(searchParams.get('limit') || 15);
    const query = searchParams.get('q') || '';

    const payload = await listTamilOttCatalog({ source, page, limit, query });

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    console.error('[api/ott] Error:', error);
    return NextResponse.json(
      { error: error.message || 'TamilOTT catalog failed', items: [], count: 0, hasMore: false },
      { status: 500 },
    );
  }
}
