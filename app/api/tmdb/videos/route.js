import { NextResponse } from 'next/server';
import { fetchTMDB } from '@/lib/tmdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

function toEmbedUrl(video) {
  if (!video?.key) return '';
  const site = String(video.site || '').toLowerCase();

  if (site === 'youtube') {
    const url = new URL(`https://www.youtube-nocookie.com/embed/${video.key}`);
    url.searchParams.set('autoplay', '1');
    url.searchParams.set('rel', '0');
    url.searchParams.set('modestbranding', '1');
    url.searchParams.set('playsinline', '1');
    return url.toString();
  }

  if (site === 'vimeo') {
    const url = new URL(`https://player.vimeo.com/video/${video.key}`);
    url.searchParams.set('autoplay', '1');
    return url.toString();
  }

  return '';
}

function scoreVideo(video) {
  const type = String(video.type || '').toLowerCase();
  const name = String(video.name || '').toLowerCase();
  const site = String(video.site || '').toLowerCase();
  let score = 0;

  if (site === 'youtube') score += 10;
  if (video.official) score += 8;
  if (type === 'trailer') score += 7;
  if (type === 'teaser') score += 4;
  if (name.includes('official')) score += 4;
  if (name.includes('trailer')) score += 3;
  if (name.includes('teaser')) score += 1;

  return score;
}

async function loadVideos(type, tmdbId) {
  const path = type === 'tv' ? `/tv/${tmdbId}/videos` : `/movie/${tmdbId}/videos`;
  const requests = [
    fetchTMDB(path, {}),
    fetchTMDB(path, { language: 'en-US' }),
    fetchTMDB(path, { language: 'en-IN' }),
    fetchTMDB(path, { language: 'ta-IN' }),
  ];

  const settled = await Promise.allSettled(requests);
  const byKey = new Map();

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const video of result.value.results || []) {
      const key = `${video.site}:${video.key}`;
      if (!byKey.has(key)) byKey.set(key, video);
    }
  }

  return Array.from(byKey.values());
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const tmdbId = Number(searchParams.get('tmdbId') || searchParams.get('id'));
    const type = normalizeType(searchParams.get('type'));

    if (!tmdbId || Number.isNaN(tmdbId)) {
      return NextResponse.json({ ok: false, error: 'Valid tmdbId is required' }, { status: 400 });
    }

    let videos = (await loadVideos(type, tmdbId))
      .filter((video) => ['youtube', 'vimeo'].includes(String(video.site || '').toLowerCase()))
      .map((video) => ({
        id: video.id,
        name: video.name || 'Trailer',
        site: video.site,
        key: video.key,
        type: video.type || '',
        official: Boolean(video.official),
        publishedAt: video.published_at || '',
        embedUrl: toEmbedUrl(video),
        score: scoreVideo(video),
      }))
      .filter((video) => video.embedUrl);

    videos = videos.sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const selected = videos[0] || null;

    return NextResponse.json({
      ok: Boolean(selected),
      trailer: selected,
      videos,
      error: selected ? undefined : 'No trailer found for this title',
    }, { status: selected ? 200 : 404 });
  } catch (error) {
    console.error('[api/tmdb/videos] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Unable to load trailer' },
      { status: 500 }
    );
  }
}
