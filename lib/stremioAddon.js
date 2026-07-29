const DEFAULT_TIMEOUT_MS = 180000;
const STREMIO_CACHE_TTL_MS = Number(process.env.STREMIO_CACHE_TTL_MS || 10 * 60 * 1000);
const stremioCache = globalThis.__jashStremioCache || {
  manifest: new Map(),
  catalog: new Map(),
  meta: new Map(),
  streams: new Map(),
};
stremioCache.manifest ||= new Map();
stremioCache.catalog ||= new Map();
stremioCache.meta ||= new Map();
stremioCache.streams ||= new Map();
globalThis.__jashStremioCache = stremioCache;

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.loadedAt > STREMIO_CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(map, key, value) {
  map.set(key, { value, loadedAt: Date.now() });
  return value;
}

function configuredManifestUrl({ source = '', manifestUrl = '' } = {}) {
  if (manifestUrl) return String(manifestUrl || '').trim();

  const generic = String(
    process.env.STREMIO ||
      process.env.STREMIO_ADDON ||
      process.env.STREMIO_ADDON_URL ||
      process.env.STREMIO_MANIFEST ||
      process.env.STREMIO_WATCH ||
      process.env.STREMIO_WATCH_ADDON ||
      process.env.STREMIO_PROVIDER ||
      process.env.STREMIO_PROVIDER_ADDON ||
      process.env.STREMIO_PROVIDER_MANIFEST ||
      '',
  ).trim();

  if (source === 'watch' || source === 'provider') {
    return String(
      process.env.STREMIO_WATCH ||
        process.env.STREMIO_WATCH_ADDON ||
        process.env.STREMIO_PROVIDER ||
        process.env.STREMIO_PROVIDER_ADDON ||
        process.env.STREMIO_PROVIDER_MANIFEST ||
        generic,
    ).trim();
  }

  return generic;
}


function normalizeHttpUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export function getStremioBaseUrl(options = {}) {
  const manifestUrl = normalizeHttpUrl(configuredManifestUrl(options));
  if (!manifestUrl) return '';
  return manifestUrl.replace(/\/manifest\.json(?:\?.*)?$/i, '').replace(/\/+$/, '');
}

export function getStremioManifestUrl(options = {}) {
  const base = getStremioBaseUrl(options);
  return base ? `${base}/manifest.json` : '';
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json,text/plain,*/*',
        'User-Agent': 'JaSH-ViBeS-Stremio/1.0',
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = JSON.parse(text); } catch {}
    if (!response.ok) throw new Error(`Stremio addon returned HTTP ${response.status}. URL: ${url}. Response: ${text.slice(0, 180)}`);
    if (!payload) throw new Error(`Stremio addon returned a non-JSON response. URL: ${url}. Content-Type: ${response.headers.get('content-type') || 'unknown'}. Response: ${text.slice(0, 180)}`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Stremio addon timed out');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getStremioManifest(options = {}) {
  const url = getStremioManifestUrl(options);
  if (!url) throw new Error('Stremio addon is not configured. Set STREMIO to your addon manifest URL.');
  const cached = getCached(stremioCache.manifest, url);
  if (cached) return cached;
  return setCached(stremioCache.manifest, url, await fetchJson(url));
}

export function findCatalog(manifest, { type = 'movie', name = 'Tamil', id = '' } = {}) {
  const catalogs = manifest?.catalogs || [];
  if (id) {
    const exact = catalogs.find((catalog) => catalog.type === type && catalog.id === id);
    if (exact) return exact;
  }
  const wanted = String(name || 'Tamil').toLowerCase();
  return (
    catalogs.find((catalog) => catalog.type === type && String(catalog.name || '').toLowerCase() === wanted) ||
    catalogs.find((catalog) => catalog.type === type && String(catalog.name || '').toLowerCase().includes(wanted)) ||
    catalogs.find((catalog) => catalog.type === type) ||
    null
  );
}

export function getTamilCatalogIds(manifest) {
  return {
    movie: process.env.STREMIO_MOVIE_CATALOG || findCatalog(manifest, { type: 'movie', name: 'Tamil' })?.id || '',
    series: process.env.STREMIO_SERIES_CATALOG || findCatalog(manifest, { type: 'series', name: 'Tamil' })?.id || '',
  };
}

function encodeExtra(extra = {}) {
  const parts = Object.entries(extra)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  return parts.length ? `/${parts.join('&')}` : '';
}

export function mapStremioMeta(meta = {}) {
  return {
    id: String(meta.id || meta.imdb_id || ''),
    imdbId: meta.imdb_id || meta.id || '',
    type: meta.type || 'movie',
    title: meta.name || meta.title || 'Untitled',
    posterUrl: meta.poster || '',
    backdropUrl: meta.background || '',
    logo: meta.logo || '',
    year: meta.year || meta.releaseInfo || '',
    releaseInfo: meta.releaseInfo || meta.year || '',
    synopsis: meta.description || '',
    genres: meta.genres || [],
    rating: meta.imdbRating || '',
    runtime: meta.runtime || '',
    cast: meta.cast || [],
    moviedbId: meta.moviedb_id || null,
  };
}

export async function getStremioCatalog({ type = 'movie', catalogId = '', skip = 0, search = '' } = {}) {
  const manifest = await getStremioManifest();
  const ids = getTamilCatalogIds(manifest);
  const selectedCatalogId = catalogId || ids[type] || ids.movie;
  if (!selectedCatalogId) throw new Error(`No Stremio catalog configured for ${type}.`);

  const base = getStremioBaseUrl();
  const extra = search ? { search, skip } : { skip };
  const url = `${base}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(selectedCatalogId)}${encodeExtra(extra)}.json`;
  const cacheKey = `${base}|${type}|${selectedCatalogId}|${skip}|${search}`;
  const cached = getCached(stremioCache.catalog, cacheKey);
  if (cached) return { ...cached, cached: true };
  const payload = await fetchJson(url);
  const metas = (payload.metas || []).map(mapStremioMeta).filter((item) => item.id);
  const result = {
    type,
    catalogId: selectedCatalogId,
    catalogName: findCatalog(manifest, { type, id: selectedCatalogId })?.name || selectedCatalogId,
    skip: Number(skip || 0),
    count: metas.length,
    hasMore: metas.length >= 15,
    items: metas,
  };
  return setCached(stremioCache.catalog, cacheKey, result);
}

function hasUsefulMeta(meta = {}) {
  return Boolean(meta?.id || meta?.imdb_id || meta?.name || meta?.title || meta?.videos?.length);
}

async function fetchStremioMetaFromBase({ base, type, id }) {
  const url = `${base}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  const payload = await fetchJson(url);
  return payload.meta || {};
}

export async function getStremioMeta({ type = 'movie', id = '', source = '' } = {}) {
  if (!id) throw new Error('Stremio id is required');
  const base = getStremioBaseUrl({ source });
  if (!base) throw new Error(source === 'watch' ? 'Stremio watch addon is not configured. Set STREMIO_WATCH to your provider addon manifest URL.' : 'Stremio addon is not configured. Set STREMIO to your addon manifest URL.');
  const cacheKey = `${base}|${source}|${type}|${id}`;
  const cached = getCached(stremioCache.meta, cacheKey);
  if (cached) return { ...cached, cached: true };

  let meta = await fetchStremioMetaFromBase({ base, type, id });

  // Some stream-only/provider addons return { meta: {} }. If the watch addon
  // has streams but no metadata, fall back to the normal catalog addon, then
  // to Cinemeta, so the player still shows poster/title/episodes.
  if (!hasUsefulMeta(meta)) {
    const fallbackBase = source ? getStremioBaseUrl({ source: '' }) : '';
    if (fallbackBase && fallbackBase !== base) {
      try {
        const fallbackMeta = await fetchStremioMetaFromBase({ base: fallbackBase, type, id });
        if (hasUsefulMeta(fallbackMeta)) meta = fallbackMeta;
      } catch {}
    }
  }

  if (!hasUsefulMeta(meta)) {
    try {
      const cinemetaBase = 'https://v3-cinemeta.strem.io';
      const fallbackMeta = await fetchStremioMetaFromBase({ base: cinemetaBase, type, id });
      if (hasUsefulMeta(fallbackMeta)) meta = fallbackMeta;
    } catch {}
  }

  const result = {
    ...mapStremioMeta(meta),
    videos: (meta.videos || []).map((video) => ({
      id: String(video.id || ''),
      title: video.title || `S${video.season || 1} E${video.episode || 1}`,
      season: video.season || 1,
      episode: video.episode || 1,
      synopsis: video.overview || '',
      released: video.released || '',
      thumbnail: video.thumbnail || '',
      imdbId: video.imdb_id || meta.imdb_id || id,
    })).filter((video) => video.id),
  };
  return setCached(stremioCache.meta, cacheKey, result);
}

function streamQualityScore(stream = {}) {
  const text = `${stream.name || ''} ${stream.title || ''}`.toLowerCase();
  if (/2160p|4k|uhd/.test(text)) return 40;
  if (/1080p/.test(text)) return 30;
  if (/720p/.test(text)) return 20;
  if (/480p/.test(text)) return 10;
  return 0;
}

function formatBytes(bytes = 0) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 2)} ${units[index]}`;
}

function allowedHost(url, options = {}) {
  if (process.env.STREMIO_ALLOW_ANY_HOST === '1') return true;
  const allow = String(process.env.STREMIO_ALLOWED_HOSTS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const baseHost = new URL(getStremioBaseUrl(options)).hostname.toLowerCase();
    const allowed = allow.length ? allow : [baseHost];
    return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    return false;
  }
}

function isSafeDirectStream(stream = {}, options = {}) {
  if (stream.infoHash || stream.fileIdx !== undefined || stream.ytId) return false;
  const url = normalizeHttpUrl(stream.url || stream.externalUrl || '');
  if (!url) return false;
  if (/^magnet:/i.test(url)) return false;
  return allowedHost(url, options);
}

export function mapStremioStream(stream = {}, index = 0) {
  const url = normalizeHttpUrl(stream.url || stream.externalUrl || '');
  const qualityScore = streamQualityScore(stream);
  const size = formatBytes(stream.size_bytes || stream.size || 0);
  const labelParts = [stream.name || `Stream ${index + 1}`];
  if (size) labelParts.push(size);
  return {
    id: `stremio-${index}`,
    value: url,
    url,
    title: stream.title || stream.name || `Stream ${index + 1}`,
    label: labelParts.join(' • '),
    name: stream.name || 'Stremio',
    size,
    sizeBytes: stream.size_bytes || 0,
    qualityScore,
    subtitles: stream.subtitles || [],
  };
}

export async function getStremioStreams({ type = 'movie', id = '', source = '' } = {}) {
  if (!id) throw new Error('Stremio stream id is required');
  const base = getStremioBaseUrl({ source });
  if (!base) throw new Error(source === 'watch' ? 'Stremio watch addon is not configured. Set STREMIO_WATCH to your provider addon manifest URL.' : 'Stremio addon is not configured. Set STREMIO to your addon manifest URL.');
  const streamType = type === 'series' || String(id).includes(':') ? 'series' : 'movie';
  const cacheKey = `${base}|${source}|${streamType}|${id}`;
  const cached = getCached(stremioCache.streams, cacheKey);
  if (cached) return { ...cached, cached: true };

  const url = `${base}/stream/${encodeURIComponent(streamType)}/${encodeURIComponent(id)}.json`;
  const payload = await fetchJson(url, { timeoutMs: Number(process.env.STREMIO_STREAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) });
  const streams = (payload.streams || [])
    .filter((stream) => isSafeDirectStream(stream, { source }))
    .map(mapStremioStream)
    .sort((a, b) => b.qualityScore - a.qualityScore || b.sizeBytes - a.sizeBytes);
  const result = {
    id,
    type: streamType,
    count: streams.length,
    streams,
    blockedCount: (payload.streams || []).length - streams.length,
  };
  return setCached(stremioCache.streams, cacheKey, result);
}
