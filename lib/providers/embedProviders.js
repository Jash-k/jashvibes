// Watch-page embed catalogue is Mirchi-only.
// VidLink / VidEasy / VidZee / VidRock stay implemented below for emergency
// re-enable, but they are no longer in DEFAULT_PRIORITY so Auto never picks them.
const DEFAULT_PRIORITY = [
  'mirchi',
];

const VALID_PROVIDERS = [...DEFAULT_PRIORITY];

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'tv' : 'movie';
}

function normalizeLanguage(language = 'tam') {
  const value = String(language || 'tam').toLowerCase();
  const map = {
    tamil: 'tam', tam: 'tam', ta: 'tam',
    english: 'eng', eng: 'eng', en: 'eng',
    hindi: 'hin', hin: 'hin', hi: 'hin',
    telugu: 'tel', tel: 'tel', te: 'tel',
    malayalam: 'mal', mal: 'mal', ml: 'mal',
  };
  return map[value] || value;
}

function getProviderBaseUrl(id, fallback) {
  const envKey = `${id.toUpperCase()}_BASE_URL`;
  return (process.env[envKey] || fallback).replace(/\/+$/, '');
}

function getVidSrcBaseUrl() {
  // vidsrc-embed.ru currently redirects to vsembed.ru. Use the final host first
  // so browser embeds avoid one extra cross-domain redirect.
  return (
    process.env.VIDSRC_MIRROR_BASE_URL ||
    process.env.VIDSRC_EMBED_BASE_URL ||
    process.env.VIDSRC_BASE_URL ||
    'https://vsembed.ru'
  ).replace(/\/+$/, '');
}

function getVidSrcFallbackDomains() {
  return (process.env.VIDSRC_FALLBACK_DOMAINS || 'https://vidsrcme.su,https://vidsrc-embed.ru,https://vidsrc-embed.su,https://vsrc.su')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function uniqueList(items) {
  return [...new Set(items.filter(Boolean))];
}

function getPriority() {
  const priority = (process.env.PROVIDERS || process.env.EMBED_PROVIDER_PRIORITY || DEFAULT_PRIORITY.join(','))
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => VALID_PROVIDERS.includes(item));
  // Mirchi is the designated first embed fallback after TamilOTT. Deployments
  // whose Render PROVIDERS env was set before Mirchi existed (e.g.
  // "omega,vidlink,...") would otherwise silently keep vidlink first — insert
  // Mirchi at the front whenever the env gives it no explicit position.
  if (!priority.includes('mirchi')) priority.unshift('mirchi');
  return priority;
}

function appendCommonVidLinkParams(url) {
  url.searchParams.set('primaryColor', process.env.VIDLINK_PRIMARY_COLOR || 'B20710');
  url.searchParams.set('secondaryColor', process.env.VIDLINK_SECONDARY_COLOR || '170000');
  url.searchParams.set('autoplay', process.env.VIDLINK_AUTOPLAY || 'false');
  url.searchParams.set('poster', process.env.VIDLINK_POSTER || 'true');
  url.searchParams.set('title', process.env.VIDLINK_TITLE || 'true');
  return url;
}

function buildVidLinkEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/movie/${tmdbId}`;
  const url = appendCommonVidLinkParams(new URL(path, getProviderBaseUrl('vidlink', 'https://vidlink.pro')));

  return {
    id: 'vidlink',
    providerId: 'vidlink',
    provider: 'VidLink',
    label: embedType === 'tv' ? `VidLink S${season} E${episode}` : 'VidLink Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `vidlink:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

function buildVideasyEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('videasy', 'https://player.videasy.to'));
  url.searchParams.set('color', process.env.VIDEASY_COLOR || 'B20710');
  if (embedType === 'tv') {
    url.searchParams.set('nextEpisode', 'true');
    url.searchParams.set('episodeSelector', 'true');
  }

  return {
    id: 'videasy',
    providerId: 'videasy',
    provider: 'Videasy',
    label: embedType === 'tv' ? `Videasy S${season} E${episode}` : 'Videasy Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `videasy:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

function buildVidZeeEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const version = process.env.VIDZEE_VERSION === 'v2' ? '/v2' : '';
  const path = embedType === 'tv'
    ? `${version}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `${version}/embed/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('vidzee', 'https://player.vidzee.wtf'));

  return {
    id: 'vidzee',
    providerId: 'vidzee',
    provider: 'VidZee',
    label: embedType === 'tv' ? `VidZee S${season} E${episode}` : 'VidZee Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `vidzee:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

function buildVidRockEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('vidrock', 'https://vidrock.ru'));
  // VidRock's public player supports language-focused subtitles via lang=ta.
  // It also keeps a Tamil source in its own source API; these query hints are
  // harmless when ignored and allow Tamil-first behavior if the player honors them.
  url.searchParams.set('lang', process.env.VIDROCK_LANG || 'ta');
  url.searchParams.set('server', process.env.VIDROCK_SERVER || 'Tamil');
  url.searchParams.set('source', process.env.VIDROCK_SOURCE || 'Tamil');

  return {
    id: 'vidrock',
    providerId: 'vidrock',
    provider: 'VidRock',
    label: embedType === 'tv' ? `VidRock S${season} E${episode}` : 'VidRock Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `vidrock:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

function buildMirchiEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  // Same URL shape as the reference site's Global Mirchi provider:
  //   movie → nxsha.space/embed/movie/{tmdbId}
  //   tv    → nxsha.space/embed/tv/{tmdbId}/{season}/{episode}
  const path = embedType === 'tv'
    ? `/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/embed/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('mirchi', 'https://nxsha.space'));

  return {
    id: 'mirchi',
    providerId: 'mirchi',
    provider: 'Global Mirchi',
    label: embedType === 'tv' ? `Global Mirchi S${season} E${episode}` : 'Global Mirchi Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `mirchi:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

function getEmbedProviders(input) {
  const all = {
    vidlink: buildVidLinkEmbed(input),
    videasy: buildVideasyEmbed(input),
    vidzee: buildVidZeeEmbed(input),
    vidrock: buildVidRockEmbed(input),
    mirchi: buildMirchiEmbed(input),
  };

  const priority = getPriority();
  const ordered = [];

  for (const id of priority) {
    if (all[id]) ordered.push(all[id]);
  }

  for (const [id, provider] of Object.entries(all)) {
    if (VALID_PROVIDERS.includes(id) && !ordered.some((item) => item.id === id)) ordered.push(provider);
  }

  return ordered;
}

function selectProvider(providers, preferredProvider = 'auto') {
  const preferred = String(preferredProvider || 'auto').toLowerCase();
  if (preferred === 'auto') return providers[0];
  return providers.find((item) => item.id === preferred) || providers[0];
}

export function resolveEmbedProvider(input) {
  const providers = getEmbedProviders(input);
  const selected = selectProvider(providers, input.provider || input.preferredProvider || 'auto');

  const attempts = providers.map((provider) => ({
    providerId: provider.providerId,
    provider: provider.provider,
    label: provider.label,
    status: selected.id === provider.id ? 'available' : 'configured',
    reason: selected.id === provider.id
      ? 'Selected manually or by priority. URL generated from TMDB ID.'
      : 'Available fallback provider. You can switch to it manually.',
    streamUrl: provider.streamUrl,
    fallbacks: provider.fallbacks || [],
  }));

  return { selected, providers, attempts };
}

export function buildStoredSource(provider) {
  const priorityMap = {
    stremio: 1,
    mirchi: 2,
    vidlink: 3,
    videasy: 4,
    vidzee: 5,
    vidrock: 6,
  };
  return {
    provider: provider.provider,
    label: provider.label,
    externalId: provider.externalId,
    priority: priorityMap[provider.id] ?? 9,
    isActive: true,
  };
}
