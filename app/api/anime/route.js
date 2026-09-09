import { NextResponse } from 'next/server';
import { getAnimeTitles, MAX_PAGE } from '@/lib/animeCatalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/anime?type=movie|series&page=1 → { ok, items, page, totalPages, hasMore }
 *
 * A failed TMDB call answers 200 with `ok:false` rather than a 5xx: the page shows "anime listing
 * unavailable, retry" instead of a red error screen, and a monitor watching for 5xx does not fire
 * because the metadata provider had a bad minute.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') === 'series' ? 'series' : 'movie';
  const page = Math.max(1, Math.min(MAX_PAGE, Number(searchParams.get('page')) || 1));

  try {
    const result = await getAnimeTitles({ type, page });
    const items = result.items || [];
    return NextResponse.json(
      {
        ok: true,
        type,
        items,
        page: result.page,
        totalPages: result.totalPages,
        hasMore: result.page < (result.totalPages || result.page),
        cached: Boolean(result.cached),
        stale: Boolean(result.stale),
        warning: result.warning || '',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, type, items: [], page, totalPages: 0, hasMore: false, error: String(error?.message || error).slice(0, 240) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
