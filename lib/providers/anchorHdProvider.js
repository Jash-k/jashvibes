import { fetchTMDB } from '@/lib/tmdb';

const DEFAULT_ANCHOR_BACKEND = 'https://movies1-backend.onrender.com';
const DEFAULT_ANCHOR_VALIDATE_TIMEOUT_MS = 9000;

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

function cleanSnippet(value = '') {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 140);
}

function normalizeOrigin(value = '') {
  try {
    if (!value) return '';
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function validationTimeoutMs() {
  const value = Number(process.env.ANCHORHD_VALIDATE_TIMEOUT_MS || DEFAULT_ANCHOR_VALIDATE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 1000 ? value : DEFAULT_ANCHOR_VALIDATE_TIMEOUT_MS;
}

function shouldValidateAnchorStream() {
  return !['0', 'false', 'no'].includes(String(process.env.ANCHORHD_VALIDATE || '1').toLowerCase());
}

function buildPlaybackHeaders(requestOrigin = '') {
  const playbackOrigin = normalizeOrigin(
    process.env.ANCHORHD_PLAYBACK_ORIGIN ||
    process.env.ANCHORHD_ORIGIN ||
    requestOrigin ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    '',
  );

  const headers = {
    Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, application/x-mpegurl, text/plain, */*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 JaSH-ViBeS-AnchorHD/1.0',
  };

  if (playbackOrigin) {
    headers.Origin = playbackOrigin;
    headers.Referer = process.env.ANCHORHD_REFERER || `${playbackOrigin}/`;
  } else if (process.env.ANCHORHD_REFERER) {
    headers.Referer = process.env.ANCHORHD_REFERER;
  }

  return { headers, playbackOrigin };
}

function describeAnchorHttpError(status, bodySnippet, path, playbackOrigin) {
  const lower = bodySnippet.toLowerCase();
  if (status === 403 && lower.includes('forbidden origin')) {
    return `1AnchorHD rejected this app domain${playbackOrigin ? ` (${playbackOrigin})` : ''} with HTTP 403 Forbidden origin. Add your JaSH ViBeS domain to the 1AnchorHD/R2 worker allowed origins, or use Omega for this title.`;
  }
  if (status === 403) {
    return `1AnchorHD signed URL was rejected with HTTP 403${bodySnippet ? `: ${bodySnippet}` : ''}. The token/origin may not be valid for this app domain.`;
  }
  if (status === 404) {
    return `1AnchorHD does not have this hosted path yet: ${path}. Falling back to other servers.`;
  }
  return `1AnchorHD signed URL failed health check with HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}.`;
}

function firstHlsUri(manifest = '') {
  return String(manifest || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#')) || '';
}

function isLikelyManifestUrl(url = '') {
  try {
    return /\.m3u8$/i.test(new URL(url).pathname);
  } catch {
    return /\.m3u8(\?|#|$)/i.test(String(url || ''));
  }
}

async function cancelBody(response) {
  try { await response?.body?.cancel?.(); } catch {}
}

async function probeAnchorChild({ manifestBody, manifestUrl, headers, signal, path, playbackOrigin }) {
  let currentBody = manifestBody;
  let currentUrl = manifestUrl;

  for (let depth = 0; depth < 2; depth += 1) {
    const childUri = firstHlsUri(currentBody);
    if (!childUri) return null;

    const childUrl = new URL(childUri, currentUrl).toString();
    const likelyManifest = isLikelyManifestUrl(childUrl);
    const response = await fetch(childUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal,
      headers: likelyManifest ? headers : { ...headers, Range: 'bytes=0-1' },
    });
    const contentType = response.headers.get('content-type') || '';

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(describeAnchorHttpError(response.status, cleanSnippet(body), path, playbackOrigin));
    }

    if (!likelyManifest) {
      await cancelBody(response);
      return { ok: true, status: response.status, contentType, depth: depth + 1 };
    }

    const body = await response.text().catch(() => '');
    if (!/^#EXTM3U/m.test(body)) {
      throw new Error(`1AnchorHD child playlist returned ${contentType || 'a non-HLS response'} instead of an HLS manifest${cleanSnippet(body) ? `: ${cleanSnippet(body)}` : ''}.`);
    }

    currentBody = body;
    currentUrl = response.url || childUrl;
  }

  return { ok: true, depth: 2 };
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

async function validateAnchorManifest(streamUrl, { path = '', requestOrigin = '' } = {}) {
  if (!shouldValidateAnchorStream()) {
    return { ok: true, skipped: true, reason: 'ANCHORHD_VALIDATE=0' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), validationTimeoutMs());
  const { headers, playbackOrigin } = buildPlaybackHeaders(requestOrigin);

  try {
    const response = await fetch(streamUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers,
    });
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text().catch(() => '');
    const snippet = cleanSnippet(body);

    if (!response.ok) {
      throw new Error(describeAnchorHttpError(response.status, snippet, path, playbackOrigin));
    }

    if (!/^#EXTM3U/m.test(body)) {
      throw new Error(`1AnchorHD returned ${contentType || 'a non-HLS response'} instead of an HLS manifest${snippet ? `: ${snippet}` : ''}.`);
    }

    const childProbe = await probeAnchorChild({
      manifestBody: body,
      manifestUrl: response.url || streamUrl,
      headers,
      signal: controller.signal,
      path,
      playbackOrigin,
    });

    return {
      ok: true,
      status: response.status,
      contentType,
      finalUrl: response.url || streamUrl,
      playbackOrigin,
      childProbe,
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`1AnchorHD health check timed out for ${path}. Falling back to other servers.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveAnchorHdProvider({ tmdbId, type = 'movie', season = 1, episode = 1, requestOrigin = '' } = {}) {
  if (!tmdbId) throw new Error('AnchorHD requires a TMDB id.');
  const mediaType = type === 'series' || type === 'tv' ? 'series' : 'movie';
  const slug = await getTitleSlug({ tmdbId, type: mediaType });
  const path = mediaType === 'series'
    ? `movies/${slug}/s${String(season || 1).padStart(2, '0')}e${String(episode || 1).padStart(2, '0')}/master.m3u8`
    : `movies/${slug}/master.m3u8`;
  const streamUrl = await signAnchorPath(path);
  const health = await validateAnchorManifest(streamUrl, { path, requestOrigin });

  return {
    id: 'anchorhd',
    providerId: 'anchorhd',
    provider: '1AnchorHD',
    label: mediaType === 'series' ? `AnchorHD S${season} E${episode}` : 'AnchorHD',
    streamUrl,
    streamType: 'hls',
    externalId: `anchorhd:${mediaType}:${tmdbId}:s${season}:e${episode}`,
    path,
    health,
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
    health: result?.health || null,
  };
}
