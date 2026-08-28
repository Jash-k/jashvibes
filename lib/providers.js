export const SCRAPER_PROVIDERS = [
  {
    id: 'mirchi',
    name: 'Global Mirchi',
    description: 'Global Mirchi (1anchormovies) embed player: nxsha.space/embed/movie/{tmdbId} and /embed/tv/{tmdbId}/{season}/{episode}.',
  },
  {
    id: 'vidlink',
    name: 'VidLink',
    description: 'Direct vidlink.pro TMDB embed player URL.',
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
];

export function normalizeProviderId(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getProviderIdFromSource(source = {}) {
  const text = `${source.provider || ''} ${source.externalId || ''}`.toLowerCase();

  if (text.includes('mirchi') || text.includes('nxsha.space')) return 'mirchi';
  if (text.includes('vidrock')) return 'vidrock';
  if (text.includes('vidzee')) return 'vidzee';
  if (text.includes('videasy')) return 'videasy';
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
