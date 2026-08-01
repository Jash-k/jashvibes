import { NextResponse } from 'next/server';
import { getStremioStreams } from '@/lib/stremioAddon';
import { fetchTMDB } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type = '') {
  return type === 'series' || type === 'tv' ? 'series' : 'movie';
}

async function getImdbId({ tmdbId, type }) {
  const path = normalizeType(type) === 'series' ? `/tv/${tmdbId}/external_ids` : `/movie/${tmdbId}/external_ids`;
  const payload = await fetchTMDB(path);
  return payload?.imdb_id || '';
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = normalizeType(searchParams.get('type'));
    const tmdbId = Number(searchParams.get('tmdbId') || searchParams.get('tmdb') || 0);
    const season = Math.max(1, Number(searchParams.get('season') || searchParams.get('s') || 1));
    const episode = Math.max(1, Number(searchParams.get('episode') || searchParams.get('e') || 1));
    if (!tmdbId || Number.isNaN(tmdbId)) return NextResponse.json({ ok: false, available: false, error: 'tmdbId is required' }, { status: 400 });

    const imdbId = await getImdbId({ tmdbId, type });
    if (!imdbId) return NextResponse.json({ ok: true, available: false, reason: 'No IMDb id for this TMDB item' }, { headers: { 'Cache-Control': 'no-store' } });

    // Telegram-Stremio supports tmdb ids directly (`tmdb:123` and
    // `tmdb:123:1:2`) and some catalogs/providers prefer those over IMDb ids.
    // Use the TMDB id as the visible watch id; getStremioStreams will try TMDB
    // first and fall back to IMDb when needed.
    const stremioId = `tmdb:${tmdbId}`;
    const result = await getStremioStreams({ type, id: stremioId, source: 'watch', season, episode });
    const href = type === 'series'
      ? `/stremio-watch/series/${encodeURIComponent(stremioId)}?season=${season}&episode=${episode}&source=watch`
      : `/stremio-watch/movie/${encodeURIComponent(stremioId)}?source=watch`;

    return NextResponse.json({
      ok: true,
      available: result.count > 0,
      count: result.count,
      blockedCount: result.blockedCount || 0,
      tmdbId,
      imdbId,
      stremioId,
      href,
      streams: (result.streams || []).slice(0, 5),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[api/stremio/check] Error:', error);
    return NextResponse.json({ ok: false, available: false, error: error.message || 'Stremio check failed' }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
