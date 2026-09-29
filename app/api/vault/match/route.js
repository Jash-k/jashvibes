import { NextResponse } from 'next/server';
import { loadVault } from '@/lib/vault';
import { matchVaultMovie, vaultPlayHref } from '@/lib/vaultMatch';

/**
 * GET /api/vault/match?tmdbId=&imdbId=&title=&year=
 *
 * Homepage / search click path: does the vault already have this title?
 * If yes → return { hit, playHref } so the client opens the vault embed player.
 * If no  → { hit: null } and the client falls through to /watch.
 */
export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = {
      tmdbId: searchParams.get('tmdbId') || '',
      imdbId: searchParams.get('imdbId') || '',
      title: searchParams.get('title') || '',
      year: searchParams.get('year') || '',
    };

    if (!query.tmdbId && !query.imdbId && !query.title) {
      return NextResponse.json(
        { error: 'Provide tmdbId, imdbId, or title' },
        { status: 400 },
      );
    }

    const payload = await loadVault();
    const hit = matchVaultMovie(payload.movies || [], query);
    if (!hit) {
      return NextResponse.json(
        { hit: null, playHref: null },
        { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } },
      );
    }

    // Lean payload for the click path — full embeds stay on /api/vault + vault page
    return NextResponse.json(
      {
        hit: {
          id: hit.id,
          title: hit.title,
          year: hit.year,
          kind: hit.kind || 'movie',
          isSeries: Boolean(hit.isSeries),
          tmdbId: hit.tmdbId || null,
          imdbId: hit.imdbId || '',
          poster: hit.poster || '',
          quality: hit.quality || '',
          embedCount: hit.embedCount || 0,
          matchedBy: hit.matchedBy || 'unknown',
        },
        playHref: vaultPlayHref(hit),
      },
      {
        headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Vault match failed', detail: String(error?.message || error), hit: null, playHref: null },
      { status: 502 },
    );
  }
}
