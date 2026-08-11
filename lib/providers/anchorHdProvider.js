import { fetchTMDB } from '@/lib/tmdb';

const DEFAULT_ANCHOR_BACKEND = 'https://movies1-backend.onrender.com';

function backendBase() {
  return String(process.env.ANCHORHD_BACKEND || process.env.MOVIES1_BACKEND || DEFAULT_ANCHOR_BACKEND).replace(/\/+$/, '');
}

function slugify(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'movie';
}

async function getTitleSlug({ tmdbId, type }) {
  const mediaType = type === 'series' || type === 'tv' ? 'tv' : 'movie';
  const details = await fetchTMDB(mediaType === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`, { language: 'en-IN' });
  const title = mediaType === 'tv' ? details.name || details.original_name : details.title || details.original_title;
  return slugify(title || `tmdb-${tmdbId}`);
}

async function signAnchorPath(path = '') {
  const base = backendBase();
  const url = new URL('/api/movie-stream', base);
  url.searchParams.set('path', path.replace(/^\/+/, ''));
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json', 'User-Agent': 'JaSH-ViBeS-AnchorHD/1.0' },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success || !data?.url) throw new Error(data?.error || `AnchorHD backend returned HTTP ${response.status}`);
  return data.url;
}

export async function resolveAnchorHdProvider({ tmdbId, type = 'movie', season = 1, episode = 1 } = {}) {
  if (!tmdbId) throw new Error('AnchorHD requires a TMDB id.');
  const mediaType = type === 'series' || type === 'tv' ? 'series' : 'movie';
  const slug = await getTitleSlug({ tmdbId, type: mediaType });
  const path = mediaType === 'series'
    ? `movies/${slug}/s${String(season || 1).padStart(2, '0')}e${String(episode || 1).padStart(2, '0')}/master.m3u8`
    : `movies/${slug}/master.m3u8`;
  const streamUrl = await signAnchorPath(path);

  return {
    id: 'anchorhd',
    providerId: 'anchorhd',
    provider: '1AnchorHD',
    label: mediaType === 'series' ? `AnchorHD S${season} E${episode}` : 'AnchorHD',
    streamUrl,
    streamType: 'hls',
    externalId: `anchorhd:${mediaType}:${tmdbId}:s${season}:e${episode}`,
    path,
  };
}

export function createAnchorHdAttempt(result, status = 'configured', reason = '') {
  return {
    providerId: 'anchorhd',
    provider: '1AnchorHD',
    label: result?.label || 'Signed HLS from movies1 backend',
    status,
    reason: reason || 'Uses the configured movies1 backend /api/movie-stream signed HLS source when available.',
    streamUrl: result?.streamUrl || '',
    match: result?.path ? { streamTitle: result.path, title: result.path, quality: 'HLS' } : null,
  };
}
