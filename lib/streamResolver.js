const SCREENSCAPE_BASE_URL = 'https://screenscapeapi.dev';

function getScreenScapeKey() {
  return process.env.SCREENSCAPE || process.env.SCREENSCAPE_API_KEY || '';
}

export function buildScreenScapeUrl(externalId) {
  if (!externalId || typeof externalId !== 'string') {
    throw new Error('Invalid externalId');
  }

  const url = externalId.startsWith('http')
    ? new URL(externalId)
    : new URL(externalId.startsWith('/') ? externalId : `/${externalId}`, SCREENSCAPE_BASE_URL);

  if (url.origin !== SCREENSCAPE_BASE_URL) {
    throw new Error('externalId must point to screenscapeapi.dev only');
  }

  url.searchParams.set('key', getScreenScapeKey());
  return url;
}

export function extractStreamUrl(payload) {
  if (!payload || typeof payload !== 'object') return null;

  const preferredKeys = [
    'streamUrl',
    'stream_url',
    'embedUrl',
    'embed_url',
    'iframeUrl',
    'iframe_url',
    'videoUrl',
    'video_url',
    'source',
    'src',
    'url',
    'finalLink',
    'main',
    'master',
  ];

  const isHttpUrl = (value) =>
    typeof value === 'string' && /^https?:\/\//i.test(value.trim());

  const visit = (value) => {
    if (!value) return null;

    if (isHttpUrl(value)) return value.trim();

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }

    if (typeof value === 'object') {
      for (const key of preferredKeys) {
        if (key in value) {
          const found = visit(value[key]);
          if (found) return found;
        }
      }

      for (const nested of Object.values(value)) {
        const found = visit(nested);
        if (found) return found;
      }
    }

    return null;
  };

  return visit(payload);
}

export async function tryScreenScapeSource(source) {
  const screenScapeKey = getScreenScapeKey();
  if (!screenScapeKey) {
    throw new Error('Server is missing SCREENSCAPE or SCREENSCAPE_API_KEY');
  }

  const externalId = typeof source === 'string' ? source : source.externalId;
  const url = buildScreenScapeUrl(externalId);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': screenScapeKey,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Source failed with status ${response.status}`);
  }

  const payload = await response.json();
  const streamUrl = extractStreamUrl(payload);

  if (!streamUrl) {
    throw new Error('No stream URL found in source response');
  }

  return streamUrl;
}
