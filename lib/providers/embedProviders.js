const DEFAULT_PRIORITY = [
  'omega',
  'vidlink',
  'vidnest',
  'videasy',
  'vidzee',
  'vidrock',
  'vixsrc',
  'oneembed',
  'vidsrcsbs',
  'vidsrc',
];

const VALID_PROVIDERS = [...DEFAULT_PRIORITY, 'anchorhd'];

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
  return (process.env.PROVIDERS || process.env.EMBED_PROVIDER_PRIORITY || DEFAULT_PRIORITY.join(','))
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => VALID_PROVIDERS.includes(item));
}

function appendCommonVidLinkParams(url) {
  url.searchParams.set('primaryColor', process.env.VIDLINK_PRIMARY_COLOR || 'B20710');
  url.searchParams.set('secondaryColor', process.env.VIDLINK_SECONDARY_COLOR || '170000');
  url.searchParams.set('autoplay', process.env.VIDLINK_AUTOPLAY || 'false');
  url.searchParams.set('poster', process.env.VIDLINK_POSTER || 'true');
  url.searchParams.set('title', process.env.VIDLINK_TITLE || 'true');
  return url;
}

export function buildScreenScapeEmbed({ tmdbId, type, season = 1, episode = 1, language = 'tam' }) {
  const embedType = normalizeType(type);
  const url = new URL('/embed', getProviderBaseUrl('screenscape', 'https://screenscape.me'));
  url.searchParams.set('tmdb', String(tmdbId));
  url.searchParams.set('type', embedType);
  if (embedType === 'tv') {
    url.searchParams.set('s', String(season || 1));
    url.searchParams.set('e', String(episode || 1));
  }
  url.searchParams.set('lan', normalizeLanguage(language));

  return {
    id: 'screenscape',
    providerId: 'screenscape',
    provider: 'ScreenScape Embed',
    label: embedType === 'tv' ? `ScreenScape S${season} E${episode}` : 'ScreenScape Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `screenscape:${embedType}:${tmdbId}:s${season}:e${episode}:lan${normalizeLanguage(language)}`,
  };
}

export function buildOmegaEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const id = String(tmdbId || '').trim();
  const url = new URL(`/play/${encodeURIComponent(id)}`, getProviderBaseUrl('omega', 'https://gemma416okl.com'));
  if (embedType === 'tv') {
    url.searchParams.set('s', String(season || 1));
    url.searchParams.set('e', String(episode || 1));
  }

  return {
    id: 'omega',
    providerId: 'omega',
    provider: 'Omega',
    label: embedType === 'tv' ? `Omega S${season} E${episode}` : 'Omega',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `omega:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

export function buildVidLinkEmbed({ tmdbId, type, season = 1, episode = 1 }) {
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

export function buildVidNestEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('vidnest', 'https://vidnest.fun'));
  if (process.env.VIDNEST_SERVER) url.searchParams.set('server', process.env.VIDNEST_SERVER);

  return {
    id: 'vidnest',
    providerId: 'vidnest',
    provider: 'VidNest',
    label: embedType === 'tv' ? `VidNest S${season} E${episode}` : 'VidNest Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `vidnest:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

export function buildVideasyEmbed({ tmdbId, type, season = 1, episode = 1 }) {
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

export function buildVidZeeEmbed({ tmdbId, type, season = 1, episode = 1 }) {
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

export function buildVidRockEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('vidrock', 'https://vidrock.ru'));

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

export function buildVixSrcEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const url = new URL('/api/vixsrc', process.env.APP_BASE_URL || 'http://localhost');
  url.searchParams.set('tmdbId', String(tmdbId));
  url.searchParams.set('type', embedType);
  if (embedType === 'tv') {
    url.searchParams.set('season', String(season || 1));
    url.searchParams.set('episode', String(episode || 1));
  }

  return {
    id: 'vixsrc',
    providerId: 'vixsrc',
    provider: 'VixSrc',
    label: embedType === 'tv' ? `VixSrc S${season} E${episode}` : 'VixSrc Movie',
    streamUrl: `${url.pathname}${url.search}`,
    streamType: 'embed',
    externalId: `vixsrc:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

export function buildOneEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `/embed/movie/${tmdbId}`;
  const url = new URL(path, getProviderBaseUrl('oneembed', 'https://1embed.cc'));
  const server = process.env.ONEEMBED_SERVER || process.env.ONEEMBED_SR || '';
  if (server) url.searchParams.set('sr', server);

  return {
    id: 'oneembed',
    providerId: 'oneembed',
    provider: '1Embed',
    label: embedType === 'tv' ? `1Embed S${season} E${episode}` : '1Embed Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `oneembed:${embedType}:${tmdbId}:s${season}:e${episode}`,
  };
}

export function buildVidSrcSbsEmbed({ tmdbId, type, season = 1, episode = 1 }) {
  const embedType = normalizeType(type);
  const path = embedType === 'tv'
    ? `/embed/tv/${tmdbId}/${season || 1}/${episode || 1}/`
    : `/embed/movie/${tmdbId}/`;
  const url = new URL(path, getProviderBaseUrl('vidsrcsbs', 'https://vidsrc.sbs'));

  return {
    id: 'vidsrcsbs',
    providerId: 'vidsrcsbs',
    provider: 'VidSrc SBS',
    label: embedType === 'tv' ? `VidSrc SBS S${season} E${episode}` : 'VidSrc SBS Movie',
    streamUrl: url.toString(),
    streamType: 'embed',
    externalId: `vidsrcsbs:${embedType}:${tmdbId}:s${season}:e${episode}`,
    fallbacks: embedType === 'tv'
      ? [
          `https://vidsrc.pro/embed/tv/${tmdbId}/${season || 1}/${episode || 1}/`,
          `https://vidsrc.cc/embed/tv/${tmdbId}/${season || 1}/${episode || 1}/`,
          `https://vidsrc.to/embed/tv/${tmdbId}/${season || 1}/${episode || 1}/`,
        ]
      : [
          `https://vidsrc.pro/embed/movie/${tmdbId}/`,
          `https://vidsrc.cc/embed/movie/${tmdbId}/`,
          `https://vidsrc.to/embed/movie/${tmdbId}/`,
        ],
  };
}

export function buildVidSrcEmbed({ tmdbId, type, season = 1, episode = 1, language = 'eng' }) {
  const embedType = normalizeType(type);
  const dsLang = process.env.VIDSRC_DEFAULT_SUBTITLE_LANG || normalizeLanguage(language || 'eng').slice(0, 2) || 'en';
  const autoplay = process.env.VIDSRC_AUTOPLAY ?? '1';
  const autonext = process.env.VIDSRC_AUTONEXT ?? '1';
  const subtitleUrl = process.env.VIDSRC_SUBTITLE_URL || '';
  const domains = uniqueList([getVidSrcBaseUrl(), ...getVidSrcFallbackDomains()]);

  function addCommonParams(url) {
    url.searchParams.set('ds_lang', dsLang);
    url.searchParams.set('autoplay', autoplay);
    if (embedType === 'tv') url.searchParams.set('autonext', autonext);
    if (subtitleUrl) url.searchParams.set('sub_url', subtitleUrl);
    return url;
  }

  function buildPathUrl(domain) {
    const path = embedType === 'tv'
      ? `/embed/tv/${tmdbId}/${season || 1}-${episode || 1}`
      : `/embed/movie/${tmdbId}`;
    return addCommonParams(new URL(path, domain)).toString();
  }

  function buildQueryUrl(domain) {
    const url = new URL(embedType === 'tv' ? '/embed/tv' : '/embed/movie', domain);
    url.searchParams.set('tmdb', String(tmdbId));
    if (embedType === 'tv') {
      url.searchParams.set('season', String(season || 1));
      url.searchParams.set('episode', String(episode || 1));
    }
    return addCommonParams(url).toString();
  }

  // Path style is the most iframe-friendly format. Query style is kept as a
  // fallback because the official VidSrc API documents both forms.
  const variants = uniqueList(domains.flatMap((domain) => [buildPathUrl(domain), buildQueryUrl(domain)]));
  const streamUrl = variants[0];
  const fallbacks = variants.slice(1);

  return {
    id: 'vidsrc',
    providerId: 'vidsrc',
    provider: 'VidSrc Mirrors',
    label: embedType === 'tv' ? `VidSrc S${season} E${episode}` : 'VidSrc Movie',
    streamUrl,
    streamType: 'embed',
    externalId: `vidsrc:${embedType}:${tmdbId}:s${season}:e${episode}`,
    fallbacks,
  };
}

export function getEmbedProviders(input) {
  const all = {
    omega: buildOmegaEmbed(input),
    vidlink: buildVidLinkEmbed(input),
    vidnest: buildVidNestEmbed(input),
    videasy: buildVideasyEmbed(input),
    vidzee: buildVidZeeEmbed(input),
    vidrock: buildVidRockEmbed(input),
    vixsrc: buildVixSrcEmbed(input),
    oneembed: buildOneEmbed(input),
    vidsrcsbs: buildVidSrcSbsEmbed(input),
    vidsrc: buildVidSrcEmbed(input),
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
    anchorhd: 0,
    omega: 1,
    vidlink: 2,
    vidnest: 2,
    videasy: 3,
    vidzee: 4,
    vidrock: 5,
    vixsrc: 6,
    oneembed: 7,
    vidsrcsbs: 8,
    vidsrc: 9,
    tamilott: 10,
  };
  return {
    provider: provider.provider,
    label: provider.label,
    externalId: provider.externalId,
    priority: priorityMap[provider.id] ?? 9,
    isActive: true,
  };
}
