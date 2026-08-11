export const SCRAPER_PROVIDERS = [
  {
    id: 'anchorhd',
    name: '1AnchorHD',
    description: 'Signed HLS source from the configured movies1 backend /api/movie-stream when a matching AnchorHD path exists.',
  },
  {
    id: 'omega',
    name: 'Omega',
    description: 'Omega embed player compatible with TMDB/IMDb-style play URLs.',
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    description: 'Direct vidlink.pro TMDB embed player URL.',
  },
  {
    id: 'vidnest',
    name: 'VidNest',
    description: 'TMDB embed provider: vidnest.fun/movie/{tmdbId} and /tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'videasy',
    name: 'Videasy',
    description: 'TMDB embed provider: player.videasy.to/movie/{tmdbId} and /tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'vidzee',
    name: 'VidZee',
    description: 'TMDB embed provider: player.vidzee.wtf/embed/movie/{tmdbId} and /embed/tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'vidrock',
    name: 'VidRock',
    description: 'TMDB/IMDB embed provider: vidrock.ru/movie/{tmdbId} and /tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'vixsrc',
    name: 'VixSrc',
    description: 'Embed-only VixSrc resolver. Uses vixsrc.to API only to obtain its embed page, not direct HLS extraction.',
  },
  {
    id: 'oneembed',
    name: '1Embed',
    description: 'Direct 1embed.cc TMDB embed player: /embed/movie/{tmdbId} and /embed/tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'vidsrcsbs',
    name: 'VidSrc SBS',
    description: 'MovieZon-style VidSrc SBS embed provider with fallback mirrors.',
  },
  {
    id: 'vidsrc',
    name: 'VidSrc Mirrors',
    description: 'Configurable VidSrc mirror embed provider with path/query URL variants and a quick API health check. Use VIDSRC_MIRROR_BASE_URL and VIDSRC_FALLBACK_DOMAINS to update domains.'
  },
  {
    id: 'tamilott',
    name: 'TamilOTT JSON',
    description: 'Authorized JSON feed provider. Matches selected TMDB title against stream_title/omdb.Title and opens stream_url.'
  },
];

export function normalizeProviderId(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getProviderIdFromSource(source = {}) {
  const text = `${source.provider || ''} ${source.externalId || ''}`.toLowerCase();

  if (text.includes('anchorhd') || text.includes('1anchor')) return 'anchorhd';
  if (text.includes('omega') || text.includes('gemma416okl')) return 'omega';
  if (text.includes('tamilott')) return 'tamilott';
  if (text.includes('oneembed') || text.includes('1embed')) return 'oneembed';
  if (text.includes('vixsrc')) return 'vixsrc';
  if (text.includes('vidrock')) return 'vidrock';
  if (text.includes('vidzee')) return 'vidzee';
  if (text.includes('videasy')) return 'videasy';
  if (text.includes('vidnest')) return 'vidnest';
  if (text.includes('vidsrcsbs') || text.includes('vidsrc-sbs')) return 'vidsrcsbs';
  if (text.includes('vidsrc')) return 'vidsrc';
  if (text.includes('vidlink')) return 'vidlink';
  if (text.includes('screenscape') || text.includes('screenscape.me')) return 'vidlink';

  return normalizeProviderId(source.provider || 'vidlink') || 'vidlink';
}

export function createNotConfiguredAttempts() {
  return SCRAPER_PROVIDERS.map((provider) => ({
    providerId: provider.id,
    provider: provider.name,
    label: 'Ready',
    status: 'configured',
    reason: 'Embed URL can be generated from TMDB ID.',
  }));
}
