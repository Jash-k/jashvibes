import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import { selfApi } from '@/lib/selfApi';
import dbConnect from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/catalog/sync  {mode: 'sync' | 'purge'}
 *
 *   sync  → the exact code path of the homepage Sync button (full re-scrape,
 *           TMDB matching, cache overwrite), via the existing endpoint.
 *   purge → forget the cached scrape entirely; the next catalog read rebuilds.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body?.mode === 'purge' ? 'purge' : 'sync';

    if (mode === 'purge') {
      const mongoose = await dbConnect();
      await mongoose.connection.db.collection('tamilmv_scrapes').deleteOne({ key: 'latest' });
      return NextResponse.json(
        { ok: true, purged: true, message: 'Catalog cache purged. The next visit re-scrapes from TamilMV.' },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const result = await selfApi(request, '/api/tamilmv?refresh=1&posters=1', { method: 'GET' });
    return NextResponse.json(
      {
        ok: true,
        message: `Catalog refreshed — ${(result?.movies?.length || 0) + (result?.series?.length || 0)} titles in cache.`,
        count: result?.count || 0,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Sync failed' }, { status: 500 });
  }
}
