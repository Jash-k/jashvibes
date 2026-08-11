import { fetchTMDB } from '@/lib/tmdb';
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
      '',
  ).trim();

  if (source === 'watch' || source === 'provider') {
    return String(
      process.env.STREMIO_WATCH ||
        process.env.STREMIO_WATCH_ADDON ||
        process.env.STREMIO_PROVIDER ||
        process.env.STREMIO_PROVIDER_ADDON ||
        process.env.STREMIO_PROVIDER_MANIFEST ||
        generic ||
        process.env.STREMIO_HOME ||
        process.env.STREMIO_CATALOG ||
        '',
    ).trim();
  }

  if (source === 'catalog' || source === 'home' || !source) {
    return String(
      process.env.STREMIO_HOME ||
        process.env.STREMIO_CATALOG ||
        process.env.STREMIO_CATALOG_ADDON ||
        process.env.STREMIO_CATALOG_MANIFEST ||
        generic ||
        process.env.STREMIO_WATCH ||
        process.env.STREMIO_PROVIDER ||
        '',
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

function parseTmdbRef(id = '') {
  const match = String(id || '').match(/^tmdb:(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

async function getImdbIdForStremio({ id = '', type = 'movie' } = {}) {
  const tmdbId = parseTmdbRef(id);
  if (!tmdbId) return '';
  try {
    if (type === 'series') {
      const external = await fetchTMDB(`/tv/${tmdbId}/external_ids`);
      return external?.imdb_id || '';
    }
    const details = await fetchTMDB(`/movie/${tmdbId}`, { language: 'en-IN' });
    return details?.imdb_id || '';
  } catch {
    return '';
  }
}

async function getTmdbMetaForStremio({ id = '', type = 'movie' } = {}) {
  const tmdbId = parseTmdbRef(id);
  if (!tmdbId) return null;
  try {
    if (type === 'series') {
      const [details, external] = await Promise.all([
        fetchTMDB(`/tv/${tmdbId}`, { language: 'en-IN' }),
        fetchTMDB(`/tv/${tmdbId}/external_ids`).catch(() => ({})),
      ]);
      const baseId = external?.imdb_id || `tmdb:${tmdbId}`;
      const maxSeasons = Math.max(1, Math.min(Number(process.env.STREMIO_TMDB_MAX_SEASONS || 12), 40));
      const seasonList = (details.seasons || [])
        .filter((season) => Number(season.season_number) > 0 && Number(season.episode_count || 0) > 0)
        .slice(0, maxSeasons);
      const videos = [];
      for (const season of seasonList) {
        try {
          const seasonNo = Number(season.season_number);
          const seasonDetails = await fetchTMDB(`/tv/${tmdbId}/season/${seasonNo}`, { language: 'en-IN' });
          for (const episode of seasonDetails.episodes || []) {
            const episodeNo = Number(episode.episode_number || 0);
            if (!episodeNo) continue;
            videos.push({
              id: `${baseId}:${seasonNo}:${episodeNo}`,
              title: episode.name || `Episode ${episodeNo}`,
              season: seasonNo,
              episode: episodeNo,
              overview: episode.overview || '',
              released: episode.air_date || '',
              thumbnail: episode.still_path ? `https://image.tmdb.org/t/p/w780${episode.still_path}` : '',
              imdb_id: baseId,
            });
          }
        } catch {}
      }
      return {
        id: baseId,
        imdb_id: baseId,
        type: 'series',
        name: details.name || details.original_name || 'Untitled',
        poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : '',
        background: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : '',
        year: String(details.first_air_date || '').slice(0, 4),
        releaseInfo: String(details.first_air_date || '').slice(0, 4),
        description: details.overview || '',
        genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
        imdbRating: details.vote_average ? String(Number(details.vote_average).toFixed(1)) : '',
        moviedb_id: tmdbId,
        videos,
      };
    }

    const details = await fetchTMDB(`/movie/${tmdbId}`, { language: 'en-IN' });
    return {
      id: details.imdb_id || id,
      imdb_id: details.imdb_id || id,
      type: 'movie',
      name: details.title || details.original_title || 'Untitled',
      poster: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : '',
      background: details.backdrop_path ? `https://image.tmdb.org/t/p/w500${details.backdrop_path}` : '',
      year: String(details.release_date || '').slice(0, 4),
      releaseInfo: String(details.release_date || '').slice(0, 4),
      description: details.overview || '',
      genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
      imdbRating: details.vote_average ? String(Number(details.vote_average).toFixed(1)) : '',
      runtime: details.runtime ? `${details.runtime} min` : '',
      moviedb_id: tmdbId,
    };
  } catch {
    return null;
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

function encodeStremioPathPart(value = '') {
  // Stremio ids commonly contain ':' (tmdb:123, tt123:1:2). Some addons route
  // those literally, so keep ':' readable while still escaping unsafe chars.
  return encodeURIComponent(String(value || '')).replace(/%3A/gi, ':');
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

export async function getStremioCatalog({ type = 'movie', catalogId = '', skip = 0, search = '', genre = '', language = '', sort = '', source = 'catalog' } = {}) {
  const manifest = await getStremioManifest({ source });
  const ids = getTamilCatalogIds(manifest);
  const selectedCatalogId = catalogId || ids[type] || ids.movie;
  if (!selectedCatalogId) throw new Error(`No Stremio catalog configured for ${type}.`);

  const base = getStremioBaseUrl({ source });
  const extra = { skip };
  if (search) extra.search = search;
  if (genre) extra.genre = genre;
  if (language) extra.language = language;
  if (sort) extra.sort = sort;
  const url = `${base}/catalog/${encodeStremioPathPart(type)}/${encodeStremioPathPart(selectedCatalogId)}${encodeExtra(extra)}.json`;
  const cacheKey = `${base}|${source}|${type}|${selectedCatalogId}|${skip}|${search}|${genre}|${language}|${sort}`;
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
  const url = `${base}/meta/${encodeStremioPathPart(type)}/${encodeStremioPathPart(id)}.json`;
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

  if (!hasUsefulMeta(meta) && parseTmdbRef(id)) {
    const imdbId = await getImdbIdForStremio({ id, type });
    if (imdbId) {
      try {
        const imdbMeta = await fetchStremioMetaFromBase({ base, type, id: imdbId });
        if (hasUsefulMeta(imdbMeta)) meta = imdbMeta;
      } catch {}
    }
  }

  // Some stream-only/provider addons return { meta: {} }. If the watch addon
  // has streams but no metadata, fall back to the normal catalog addon, then
  // to Cinemeta, so the player still shows poster/title/episodes.
  if (!hasUsefulMeta(meta)) {
    const fallbackBase = source ? getStremioBaseUrl({ source: 'catalog' }) : '';
    if (fallbackBase && fallbackBase !== base) {
      try {
        const fallbackMeta = await fetchStremioMetaFromBase({ base: fallbackBase, type, id });
        if (hasUsefulMeta(fallbackMeta)) meta = fallbackMeta;
      } catch {}
    }
  }

  if (!hasUsefulMeta(meta)) {
    const tmdbMeta = await getTmdbMetaForStremio({ id, type });
    if (hasUsefulMeta(tmdbMeta)) meta = tmdbMeta;
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

function normalizeStreamSize(value = '') {
  if (typeof value === 'number') return formatBytes(value);
  const raw = String(value || '').trim();
  if (!raw) return '';
  const bytes = Number(raw);
  if (Number.isFinite(bytes) && bytes > 0) return formatBytes(bytes);
  const match = raw.match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : raw;
}

function compactSizeLabel(value = '') {
  return String(value || '').replace(/\s+/g, '');
}

function extractSizeMeta(text = '') {
  const match = String(text || '').match(/([\d.]+)\s*(TB|GB|MB|KB|B)\b/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : '';
}

function uniqueMetaParts(parts = []) {
  const seen = new Set();
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .filter((part) => {
      const key = part.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractResolutionMeta(text = '') {
  const value = String(text || '');
  const exact = value.match(/\b(2160p|1440p|1080p|720p|576p|540p|480p|360p|240p)\b/i)?.[1];
  if (exact) return exact.toLowerCase().replace(/^([0-9]+)/, (_, n) => `${n}`);
  if (/\b(4k|uhd)\b/i.test(value)) return '4K';
  if (/\bfull\s*hd\b/i.test(value)) return '1080p';
  if (/\bhd\b/i.test(value)) return 'HD';
  return '';
}

function extractAudioMeta(text = '') {
  const value = String(text || '');
  const compact = value.replace(/[._-]+/g, ' ');
  const parts = [];

  if (/\bmulti\s*(audio|lang|language)?\b/i.test(compact)) parts.push('Multi Audio');
  if (/\bdual\s*(audio|lang|language)?\b/i.test(compact)) parts.push('Dual Audio');

  const languages = [
    ['Tamil', /\btamil\b|\btam\b/i],
    ['Hindi', /\bhindi\b|\bhin\b/i],
    ['English', /\benglish\b|\beng\b/i],
    ['Telugu', /\btelugu\b|\btel\b/i],
    ['Malayalam', /\bmalayalam\b|\bmal\b/i],
    ['Kannada', /\bkannada\b|\bkan\b/i],
  ];
  for (const [label, pattern] of languages) {
    if (pattern.test(compact)) parts.push(label);
  }

  if (/\btrue\s*hd\b/i.test(compact)) parts.push('TrueHD');
  if (/\batmos\b/i.test(compact)) parts.push('Atmos');
  if (/\bdts\s*-?\s*hd\s*-?\s*ma\b/i.test(compact)) parts.push('DTS-HD MA');
  else if (/\bdts\b/i.test(compact)) parts.push('DTS');
  if (/\b(eac-?3|e-?ac-?3)\b/i.test(compact)) parts.push('EAC3');
  if (/\b(ddp|dd\+|dolby\s*digital\s*plus)\b/i.test(compact)) parts.push('DDP');
  if (/\b(ac-?3|dolby\s*digital)\b/i.test(compact)) parts.push('AC3');
  if (/\baac\b/i.test(compact)) parts.push('AAC');
  if (/\bopus\b/i.test(compact)) parts.push('Opus');
  if (/\bflac\b/i.test(compact)) parts.push('FLAC');
  if (/\bmp3\b/i.test(compact)) parts.push('MP3');

  const channels = compact.match(/\b(7\.1|5\.1|2\.0)\b/)?.[1];
  if (channels) parts.push(channels);

  return uniqueMetaParts(parts);
}

function buildStreamMetaLabel(stream = {}, index = 0, size = '') {
  const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`;
  const resolution = extractResolutionMeta(text);
  const audio = extractAudioMeta(text);
  const parts = uniqueMetaParts([resolution, ...audio, compactSizeLabel(size)]);
  return parts.length ? parts.join(' • ') : `Stream ${index + 1}`;
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
  const text = `${stream.name || ''} ${stream.title || ''} ${stream.description || ''}`;
  const size = normalizeStreamSize(stream.size_bytes || stream.size || extractSizeMeta(text) || 0);
  return {
    id: `stremio-${index}`,
    value: url,
    url,
    title: stream.title || stream.name || `Stream ${index + 1}`,
    label: buildStreamMetaLabel(stream, index, size),
    name: stream.name || 'Stremio',
    size,
    sizeBytes: Number(stream.size_bytes || 0),
    qualityScore,
    subtitles: stream.subtitles || [],
  };
}

async function fetchStremioStreamCandidate({ base, streamType, requestId, source }) {
  const url = `${base}/stream/${encodeStremioPathPart(streamType)}/${encodeStremioPathPart(requestId)}.json`;
  const payload = await fetchJson(url, { timeoutMs: Number(process.env.STREMIO_STREAM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) });
  const rawStreams = payload.streams || [];
  const streams = rawStreams
    .filter((stream) => isSafeDirectStream(stream, { source }))
    .map(mapStremioStream)
    .sort((a, b) => b.qualityScore - a.qualityScore || b.sizeBytes - a.sizeBytes);

  return {
    requestId,
    rawStreams,
    streams,
    blockedCount: rawStreams.length - streams.length,
  };
}

function addUniqueCandidate(candidates, value = '') {
  const id = String(value || '').trim();
  if (!id) return;
  if (!candidates.includes(id)) candidates.push(id);
}

export async function getStremioStreams({ type = 'movie', id = '', source = '', season = 1, episode = 1 } = {}) {
  if (!id) throw new Error('Stremio stream id is required');
  const base = getStremioBaseUrl({ source });
  if (!base) throw new Error(source === 'watch' ? 'Stremio watch addon is not configured. Set STREMIO_WATCH to your provider addon manifest URL.' : 'Stremio addon is not configured. Set STREMIO to your addon manifest URL.');

  const normalizedType = type === 'series' || type === 'tv' ? 'series' : 'movie';
  const originalId = String(id || '').trim();
  const isEpisodeStyleId = /^tt\d+:\d+:\d+$/i.test(originalId);
  const streamType = normalizedType === 'series' || isEpisodeStyleId ? 'series' : 'movie';
  const wantedSeason = Math.max(1, Number(season || 1));
  const wantedEpisode = Math.max(1, Number(episode || 1));
  const cacheKey = `${base}|${source}|${streamType}|${originalId}|s${wantedSeason}|e${wantedEpisode}`;
  const cached = getCached(stremioCache.streams, cacheKey);
  if (cached) return { ...cached, cached: true };

  const candidates = [];
  const tmdbId = parseTmdbRef(originalId);
  let imdbFallback = '';

  if (streamType === 'series') {
    if (isEpisodeStyleId) {
      addUniqueCandidate(candidates, originalId);
    } else if (/^tt\d+$/i.test(originalId)) {
      addUniqueCandidate(candidates, `${originalId}:${wantedSeason}:${wantedEpisode}`);
      addUniqueCandidate(candidates, originalId);
    } else if (tmdbId) {
      // Some addons index series episodes by tmdb:123:1:2, while others need
      // the IMDb episode id form. Try the catalog id first because posters from
      // the addon often mean that exact id is streamable in the same addon.
      addUniqueCandidate(candidates, `${originalId}:${wantedSeason}:${wantedEpisode}`);
      addUniqueCandidate(candidates, originalId);
      imdbFallback = await getImdbIdForStremio({ id: originalId, type: 'series' });
      if (imdbFallback) addUniqueCandidate(candidates, `${imdbFallback}:${wantedSeason}:${wantedEpisode}`);
    } else {
      addUniqueCandidate(candidates, originalId);
    }
  } else {
    // For movies, try the original catalog id first. This fixes catalog items
    // like tmdb:123 where the addon may stream the tmdb id directly. If that is
    // empty, fall back to IMDb id for addons that only support tt ids.
    addUniqueCandidate(candidates, originalId);
    if (tmdbId) {
      imdbFallback = await getImdbIdForStremio({ id: originalId, type: 'movie' });
      if (imdbFallback) addUniqueCandidate(candidates, imdbFallback);
    }
  }

  let bestEmpty = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const attempt = await fetchStremioStreamCandidate({ base, streamType, requestId: candidate, source });
      if (attempt.streams.length) {
        const result = {
          id: originalId,
          resolvedId: candidate,
          attemptedIds: candidates,
          type: streamType,
          season: streamType === 'series' ? wantedSeason : null,
          episode: streamType === 'series' ? wantedEpisode : null,
          count: attempt.streams.length,
          streams: attempt.streams,
          fallbackResolved: candidate !== originalId,
          blockedCount: attempt.blockedCount,
        };
        return setCached(stremioCache.streams, cacheKey, result);
      }
      if (!bestEmpty || attempt.rawStreams.length > bestEmpty.rawStreams.length) bestEmpty = attempt;
    } catch (error) {
      lastError = error;
    }
  }

  if (!bestEmpty && lastError) throw lastError;

  const emptyAttempt = bestEmpty || { requestId: candidates[0] || originalId, rawStreams: [], streams: [], blockedCount: 0 };
  const result = {
    id: originalId,
    resolvedId: emptyAttempt.requestId,
    attemptedIds: candidates,
    type: streamType,
    season: streamType === 'series' ? wantedSeason : null,
    episode: streamType === 'series' ? wantedEpisode : null,
    count: 0,
    streams: [],
    fallbackResolved: emptyAttempt.requestId !== originalId,
    blockedCount: emptyAttempt.rawStreams.length ? emptyAttempt.blockedCount : 0,
  };
  return setCached(stremioCache.streams, cacheKey, result);
}
