import { NextResponse } from 'next/server';
import { autoSearchScrapers } from '@/lib/autoScraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const debugToken = process.env.SEED || process.env.SEED_TOKEN;
    const { searchParams } = new URL(request.url);

    if (debugToken && searchParams.get('token') !== debugToken) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const tmdbId = Number(searchParams.get('tmdbId'));
    const type = searchParams.get('type') || 'series';

    if (!tmdbId || !['movie', 'series'].includes(type)) {
      return NextResponse.json(
        { error: 'tmdbId and type=movie|series are required' },
        { status: 400 }
      );
    }

    const result = await autoSearchScrapers({ tmdbId, type });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[api/debug-scrapers] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Debug scraper check failed' },
      { status: 500 }
    );
  }
}
