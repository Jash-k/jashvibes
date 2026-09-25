import { NextResponse } from 'next/server';
import { adminDeny } from '@/lib/adminAuth';
import dbConnect from '@/lib/db';
import VodItem from '@/models/VodItem';
import { matchMovieToTMDB } from '@/lib/vodM3u';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/vod/items/rematch {id} — re-run the TMDB match for one
 * ReTro title with its current title/year and update the stored metadata.
 */
export async function POST(request) {
  const deny = await adminDeny(request);
  if (deny) return deny;
  try {
    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ ok: false, error: 'Missing id' }, { status: 400 });

    await dbConnect();
    const item = await VodItem.findById(id).lean();
    if (!item) return NextResponse.json({ ok: false, error: 'Title not found' }, { status: 404 });

    const tmdb = await matchMovieToTMDB({ title: item.title, year: item.year }).catch(() => null);

    if (!tmdb?.tmdbId) {
      await VodItem.updateOne({ _id: id }, { $set: { tmdbMatched: false, tmdbId: undefined } });
      return NextResponse.json(
        { ok: true, matched: false, message: `No TMDB match for "${item.title}" — marked as unmatched.` },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    await VodItem.updateOne(
      { _id: id },
      {
        $set: {
          tmdbId: tmdb.tmdbId,
          tmdbMatched: true,
          title: tmdb.title || item.title,
          year: tmdb.year || item.year || undefined,
          releaseDate: tmdb.releaseDate || item.releaseDate || undefined,
          originalTitle: tmdb.originalTitle || '',
          synopsis: tmdb.synopsis || '',
          posterUrl: tmdb.posterUrl || item.posterUrl,
          backdropUrl: tmdb.backdropUrl || item.backdropUrl || '',
          rating: tmdb.rating || 0,
          voteCount: tmdb.voteCount || 0,
          language: tmdb.language || item.language || '',
          genres: tmdb.genres || item.genres || [],
        },
      },
    );

    return NextResponse.json(
      { ok: true, matched: true, message: `"${tmdb.title}" matched (TMDB ${tmdb.tmdbId}).` },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message || 'Re-match failed' }, { status: 500 });
  }
}
