function normalizeMovieZonType(type) {
  return type === 'series' ? 'tv' : 'movie';
}

function getMovieZonBaseUrl() {
  return process.env.MOVIEZON_API_BASE_URL?.replace(/\/+$/, '') || '';
}

function extractMovieZonStream(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const streamUrl =
    payload.streamUrl ||
    payload.embedUrl ||
    payload?.stream?.streamUrl ||
    payload?.stream?.embedUrl ||
    payload?.data?.streamUrl ||
    payload?.data?.embedUrl;

  if (typeof streamUrl === 'string' && /^https?:\/\//i.test(streamUrl)) {
    return streamUrl;
  }

  if (Array.isArray(payload.embedFallbacks)) {
    const fallback = payload.embedFallbacks.find(
      (url) => typeof url === 'string' && /^https?:\/\//i.test(url)
    );
    if (fallback) return fallback;
  }

  if (Array.isArray(payload?.stream?.qualities)) {
    const quality = payload.stream.qualities.find(
      (item) => typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)
    );
    if (quality) return quality.url;
  }

  return null;
}

export async function tryMovieZonAuto({ tmdbId, type, season = 1, episode = 1 }) {
  const baseUrl = getMovieZonBaseUrl();

  if (!baseUrl) {
    return {
      providerId: 'moviezon',
      provider: 'MovieZon',
      label: 'Not configured',
      status: 'not_configured',
      reason: 'MOVIEZON_API_BASE_URL is not configured.',
    };
  }

  const movieZonType = normalizeMovieZonType(type);
  const url = new URL(`/api/v2/stream/auto/${tmdbId}`, baseUrl);
  url.searchParams.set('type', movieZonType);
  url.searchParams.set('season', String(season));
  url.searchParams.set('episode', String(episode));

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        providerId: 'moviezon',
        provider: 'MovieZon',
        label: 'Auto stream',
        status: 'failed',
        reason: `MovieZon returned ${response.status}`,
        raw: payload,
      };
    }

    const streamUrl = extractMovieZonStream(payload);

    if (!streamUrl) {
      return {
        providerId: 'moviezon',
        provider: 'MovieZon',
        label: payload?.selectedProvider || payload?.provider || 'Auto stream',
        status: payload?.available ? 'found' : 'not_found',
        reason: payload?.available
          ? 'MovieZon reported availability, but no streamUrl/embedUrl was found in the response.'
          : 'MovieZon did not return an available playable source.',
        raw: payload,
      };
    }

    return {
      providerId: 'moviezon',
      provider: 'MovieZon',
      label: payload?.selectedProvider || payload?.provider || 'Auto stream',
      status: 'available',
      reason: 'MovieZon returned a playable stream/embed URL.',
      streamUrl,
      source: {
        provider: 'MovieZon',
        label: payload?.selectedProvider || payload?.provider || 'MovieZon Auto Source',
        externalId: `moviezon:${movieZonType}:${tmdbId}:s${season}:e${episode}`,
        priority: 0,
        isActive: true,
      },
      raw: payload,
    };
  } catch (error) {
    return {
      providerId: 'moviezon',
      provider: 'MovieZon',
      label: 'Auto stream',
      status: 'failed',
      reason: error.message || 'MovieZon request failed.',
    };
  }
}

export async function resolveSavedMovieZonSource(source) {
  const match = String(source.externalId || '').match(
    /^moviezon:(movie|tv):(\d+):s(\d+):e(\d+)$/
  );

  if (!match) return null;

  const [, movieZonType, tmdbId, season, episode] = match;
  const result = await tryMovieZonAuto({
    tmdbId: Number(tmdbId),
    type: movieZonType === 'tv' ? 'series' : 'movie',
    season: Number(season),
    episode: Number(episode),
  });

  if (result.status === 'available' && result.streamUrl) {
    return result.streamUrl;
  }

  throw new Error(result.reason || 'Saved MovieZon source failed.');
}
