import { NextResponse } from 'next/server';
import { verifyRequestToken } from '@/lib/serverAuth';
import { matchAndStore } from '@/lib/titleMatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

/**
 * POST { title, year?, type?: 'movie'|'series', query }
 * `query` accepts: TMDB url, IMDb url, numeric TMDB id (movie:1132687 /
 * tv:114574 prefixes allowed) or a bare tt... IMDb id. On success the match is
 * persisted and the poster's new TMDB-bound metadata is returned.
 */
export async function POST(request) {
  if (!verifyRequestToken(request)) {
    return NextResponse.json({ error: 'Sign in to match titles.' }, { status: 401, headers: NO_STORE });
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const title = String(body.title || '').trim();
  const year = String(body.year || '').trim();
  const type = String(body.type || 'movie').trim();
  const query = String(body.query || body.match || body.tmdb || body.imdb || '').trim();

  if (!title) {
    return NextResponse.json({ error: 'Missing poster title.' }, { status: 400, headers: NO_STORE });
  }
  if (!query) {
    return NextResponse.json({ error: 'Paste a TMDB/IMDb link or id first.' }, { status: 400, headers: NO_STORE });
  }

  try {
    const doc = await matchAndStore({ type, title, year, query });
    return NextResponse.json(
      {
        ok: true,
        item: {
          tmdbId: doc.tmdbId,
          type: doc.tmdbType === 'tv' ? 'series' : 'movie',
          title: doc.title,
          year: doc.tmdbYear || '',
          posterUrl: doc.posterUrl,
          synopsis: doc.synopsis,
          matchedBy: 'manual',
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Unable to match that title.' },
      { status: 400, headers: NO_STORE },
    );
  }
}
