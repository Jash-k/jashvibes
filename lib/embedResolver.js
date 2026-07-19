const SCREENSCAPE_EMBED_BASE_URL = 'https://screenscape.me/embed';

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

export function buildScreenScapeEmbedUrl({
  tmdbId,
  type,
  season = 1,
  episode = 1,
  language = 'tam',
}) {
  if (!tmdbId || Number.isNaN(Number(tmdbId))) {
    throw new Error('A valid TMDB ID is required to build the embed URL.');
  }

  const embedType = normalizeType(type);
  const url = new URL(SCREENSCAPE_EMBED_BASE_URL);

  url.searchParams.set('tmdb', String(tmdbId));
  url.searchParams.set('type', embedType);

  if (embedType === 'tv') {
    url.searchParams.set('s', String(season || 1));
    url.searchParams.set('e', String(episode || 1));
  }

  if (language) {
    url.searchParams.set('lan', language);
  }

  return url.toString();
}

export function buildEmbedSource({ tmdbId, type, season = 1, episode = 1, language = 'tam' }) {
  return {
    provider: 'ScreenScape Embed',
    label: type === 'series' || type === 'tv' ? `Season ${season} Episode ${episode}` : 'Movie Embed',
    externalId: `screenscapeembed:${normalizeType(type)}:${tmdbId}:s${season}:e${episode}:lan${language}`,
    priority: 0,
    isActive: true,
  };
}
