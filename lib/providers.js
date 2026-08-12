export const SCRAPER_PROVIDERS = [
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

  if (text.includes('omega') || text.includes('gemma416okl')) return 'omega';
  if (text.includes('tamilott')) return 'tamilott';
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
