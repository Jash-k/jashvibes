import { NextResponse } from 'next/server';
import { fetchTMDB } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function isAired(date) {
  return Boolean(date) && date <= todayISO();
}

export async function GET(_request, { params }) {
  try {
    const tmdbId = Number(params.tmdbId);
    if (!tmdbId || Number.isNaN(tmdbId)) {
      return NextResponse.json({ ok: false, error: 'Valid TMDB series id is required' }, { status: 400 });
    }

    const details = await fetchTMDB(`/tv/${tmdbId}`, { language: 'en-IN' });
    const normalSeasons = (details.seasons || [])
      .filter((season) => season.season_number > 0)
      .filter((season) => !season.air_date || isAired(season.air_date));

    const seasons = [];

    for (const season of normalSeasons) {
      try {
        const seasonDetails = await fetchTMDB(`/tv/${tmdbId}/season/${season.season_number}`, {
          language: 'en-IN',
        });

        const episodes = (seasonDetails.episodes || [])
          .filter((episode) => episode.episode_number > 0)
          .filter((episode) => !episode.air_date || isAired(episode.air_date))
          .map((episode) => ({
            episodeNumber: episode.episode_number,
            name: episode.name || `Episode ${episode.episode_number}`,
            airDate: episode.air_date || '',
            overview: episode.overview || '',
            stillUrl: episode.still_path ? `https://image.tmdb.org/t/p/w300${episode.still_path}` : '',
          }));

        if (episodes.length > 0) {
          seasons.push({
            seasonNumber: season.season_number,
            name: season.name || `Season ${season.season_number}`,
            airDate: season.air_date || '',
            episodeCount: episodes.length,
            posterUrl: season.poster_path ? `https://image.tmdb.org/t/p/w300${season.poster_path}` : '',
            episodes,
          });
        }
      } catch (error) {
        // Keep the page usable even if one season details call fails.
        const count = Number(season.episode_count || 0);
        if (count > 0) {
          seasons.push({
            seasonNumber: season.season_number,
            name: season.name || `Season ${season.season_number}`,
            airDate: season.air_date || '',
            episodeCount: count,
            posterUrl: season.poster_path ? `https://image.tmdb.org/t/p/w300${season.poster_path}` : '',
            episodes: Array.from({ length: count }, (_, index) => ({
              episodeNumber: index + 1,
              name: `Episode ${index + 1}`,
              airDate: '',
              overview: '',
              stillUrl: '',
            })),
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      id: details.id,
      title: details.name || details.original_name || '',
      overview: details.overview || '',
      posterUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : '',
      firstAirDate: details.first_air_date || '',
      lastAirDate: details.last_air_date || '',
      status: details.status || '',
      numberOfSeasons: details.number_of_seasons || seasons.length,
      seasons,
    });
  } catch (error) {
    console.error('[api/tmdb/series] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Unable to load series metadata' },
      { status: 500 }
    );
  }
}
