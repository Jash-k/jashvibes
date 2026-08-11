import { fetchTMDB } from '@/lib/tmdb';

const DEFAULT_CATALOG_SOURCES = {
  movies: 'https://tamilott.vercel.app/tamil_movies.json',
  dubbed: 'https://tamilott.vercel.app/tamil_dubbed.json',
};

const DEFAULT_JSON_URLS = [
  DEFAULT_CATALOG_SOURCES.movies,
  DEFAULT_CATALOG_SOURCES.dubbed,
];
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_CACHE_TTL_MS = Number(process.env.OTT_CATALOG_CACHE_TTL_MS || 2 * 60 * 1000);

const cache = globalThis.__jashTamilOttCache || {
  key: '',
  loadedAt: 0,
  items: null,
  catalog: new Map(),
  catalogHead: new Map(),
  inflight: new Map(),
  headInflight: new Map(),
  allInflight: null,
};

cache.catalog ||= new Map();
cache.catalogHead ||= new Map();
cache.inflight ||= new Map();
cache.headInflight ||= new Map();
cache.allInflight ||= null;
globalThis.__jashTamilOttCache = cache;

function normalizeType(type) {
  return type === 'series' || type === 'tv' ? 'series' : 'movie';
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function getTamilOttJsonUrls() {
  const raw = String(
    process.env.OTT ||
      process.env.TAMILOTT_JSON_URL ||
      DEFAULT_JSON_URLS.join(','),
  ).trim();

  if (!raw || /^(0|false|off|disabled)$/i.test(raw)) return [];

  return [
    ...new Set(
      raw
        .split(',')
        .map((item) => normalizeHttpUrl(item))
        .filter(Boolean),
    ),
  ];
}

function normalizeTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/moviesda\.?\w*/g, ' ')
    .replace(/isaidub\.?\w*/g, ' ')
    .replace(/tamilott\.?\w*/g, ' ')
    .replace(/\b(original|proper|hq|hd|hdrip|web.?dl|bluray|predvd|esub|aac|avc|hevc|x264|x265|single|part|sample)\b/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|360p|4k)\b/g, ' ')
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return normalizeTitle(value)
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'untitled';
}

function tokenSet(value = '') {
  return normalizeTitle(value)
    .split(' ')
    .filter((token) => token.length > 1);
}

function titleMatchScore(itemTitle = '', itemStreamTitle = '', targetTitle = '') {
  const item = normalizeTitle(itemTitle);
  const stream = normalizeTitle(itemStreamTitle);
  const target = normalizeTitle(targetTitle);
  if (!item || !target) return 0;

  const itemTokens = tokenSet(item);
  const targetTokens = tokenSet(target);
  const itemTokenCount = itemTokens.length;
  const targetTokenCount = targetTokens.length;

  if (item === target) return 260;
  if (stream === target) return 240;
  if (stream.includes(target) && target.length >= 5) return 210;
  if (item.includes(target) && target.length >= 5) return 190;

  // Avoid false matches like target “Cooku with Comali” matching movie “Comali”.
  if (target.includes(item) && itemTokenCount >= 2 && item.length >= target.length * 0.55) return 150;

  const targetTokenSet = new Set(targetTokens);
  let hits = 0;
  for (const token of itemTokens) {
    if (targetTokenSet.has(token)) hits += 1;
  }

  const ratio = hits / Math.max(itemTokenCount, targetTokenCount, 1);
  if (ratio >= 0.9) return 145;
  if (ratio >= 0.75) return 120;
  if (ratio >= 0.65) return 95;
  return 0;
}

function cleanStreamTitle(value = '') {
  return String(value)
    .replace(/^\s*(moviesda\.?\w*|isaidub\.?\w*|tamilott\.?\w*)\s*[-–:]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceName(value = '') {
  const text = String(value).toLowerCase();
  if (text.includes('isaidub')) return 'isaiDub';
  if (text.includes('moviesda')) return 'Moviesda';
  return 'TamilOTT';
}

function extractYear(value = '') {
  const match = String(value).match(/\b(19\d{2}|20\d{2})\b/);
  return match?.[1] || '';
}

function parseSeasonEpisode(value = '') {
  const text = String(value);

  const patterns = [
    /\bS(?:eason)?\s*0*(\d{1,2})\s*(?:E|EP|EPI|Episode)\s*0*(\d{1,3})\b/i,
    /\bSeason\s*0*(\d{1,2})\s*\(?\s*(?:E|EP|EPI|Episode)\s*0*(\d{1,3})\s*\)?/i,
    /\bS0*(\d{1,2})\s*E0*(\d{1,3})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  }

  const season = text.match(/\b(?:S|Season)\s*0*(\d{1,2})\b/i);
  const episode = text.match(/\b(?:E|EP|EPI|Episode)\s*0*(\d{1,3})\b/i);

  return {
    season: season ? Number(season[1]) : null,
    episode: episode ? Number(episode[1]) : null,
  };
}

function qualityRank(value = '') {
  const text = String(value).toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(text)) return 40;
  if (/1080p/.test(text)) return 30;
  if (/720p/.test(text)) return 20;
  if (/640x360|360p/.test(text)) return 12;
  if (/480x320|480p/.test(text)) return 10;
  return 5;
}

function detectQuality(value = '') {
  const text = String(value).toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(text)) return '4K';
  if (/1080p/.test(text)) return '1080p';
  if (/720p/.test(text)) return '720p';
  if (/640x360|360p/.test(text)) return '360p';
  if (/480x320|480p/.test(text)) return '480p';
  return 'HD';
}

function parseSize(value = '') {
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : '';
}

function buildDisplayLabel({ title, season, episode, quality, size, source }) {
  const parts = [];
  if (season && episode) parts.push(`S${String(season).padStart(2, '0')} E${String(episode).padStart(2, '0')}`);
  else if (season) parts.push(`Season ${String(season).padStart(2, '0')}`);
  parts.push(title || 'Untitled');
  if (quality) parts.push(quality);
  if (size) parts.push(size);
  if (source) parts.push(source);
  return parts.join(' • ');
}

function cleanSeriesTitleFromStream(value = '') {
  return normalizeWhitespace(String(value || '')
    .replace(/^\s*(moviesda\.?\w*|isaidub\.?\w*|tamilott\.?\w*)\s*[-–:]\s*/i, '')
    .replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\bS\s*\d{1,2}\s*E\s*\d{1,3}\b/gi, ' ')
    .replace(/\(?\s*Season\s*\d{1,2}\s*\)?/gi, ' ')
    .replace(/\(?\s*(?:Episode|EPI|EP|E)\s*\d{1,3}\s*\)?/gi, ' ')
    .replace(/\([^)]*(?:720p|1080p|480p|360p|HD|HDRip|WEB.?DL)[^)]*\)/gi, ' ')
    .replace(/\s+[-–:]+\s*$/g, ' '));
}

function mapFeedItem(item, feedUrl = '') {
  const omdb = item?.omdb || {};
  const streamTitle = String(item?.stream_title || '');
  const cleanTitle = cleanStreamTitle(streamTitle);
  const parsedEpisode = parseSeasonEpisode(streamTitle);
  const omdbType = String(omdb.Type || '').toLowerCase();
  const looksSeries = omdbType === 'series' || Boolean(parsedEpisode.season || parsedEpisode.episode) || /\bseason\s*\d{1,2}\b|\bs\s*\d{1,2}\s*e\s*\d{1,3}\b/i.test(streamTitle);
  const type = looksSeries ? 'series' : 'movie';
  const rawTitle = String(omdb.Title || cleanTitle || '').trim();
  const title = type === 'series' ? cleanSeriesTitleFromStream(rawTitle || streamTitle) : rawTitle;
  const year = extractYear(omdb.Year || streamTitle);
  const quality = detectQuality(streamTitle);
  const size = parseSize(streamTitle);
  const source = sourceName(streamTitle || feedUrl);

  return {
    id: item?.id,
    streamId: String(item?.id || item?.stream_url || ''),
    title,
    normalizedTitle: normalizeTitle(title),
    streamTitle,
    cleanStreamTitle: cleanTitle,
    normalizedStreamTitle: normalizeTitle(streamTitle),
    streamUrl: String(item?.stream_url || '').trim(),
    type,
    year,
    quality,
    size,
    qualityScore: qualityRank(streamTitle),
    season: parsedEpisode.season,
    episode: parsedEpisode.episode,
    source,
    posterUrl: omdb.Poster || '',
    synopsis: omdb.Plot || '',
    rating: omdb.imdbRating || '',
    feedUrl,
    displayLabel: buildDisplayLabel({
      title,
      season: parsedEpisode.season,
      episode: parsedEpisode.episode,
      quality,
      size,
      source,
    }),
  };
}

function getTamilOttCatalogUrl(source = 'movies') {
  const key = source === 'dubbed' ? 'dubbed' : 'movies';
  const envValue = key === 'dubbed'
    ? process.env.OTT_DUBBED || process.env.TAMILOTT_DUBBED_JSON_URL
    : process.env.OTT_MOVIES || process.env.TAMILOTT_MOVIES_JSON_URL;
  return normalizeHttpUrl(envValue || DEFAULT_CATALOG_SOURCES[key]);
}

async function fetchJsonFeed(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre/1.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`TamilOTT JSON returned HTTP ${response.status} for ${url}`);
  }

  const length = Number(response.headers.get('content-length') || 0);
  const maxBytes = Number(process.env.OTT_MAX_JSON_BYTES || 35 * 1024 * 1024);
  if (length && length > maxBytes) {
    throw new Error(`TamilOTT JSON is too large for this instance (${Math.round(length / 1024 / 1024)} MB).`);
  }

  const payload = await response.json();
  const rawItems = Array.isArray(payload) ? payload : payload?.items || payload?.results || [];
  if (!Array.isArray(rawItems)) throw new Error(`TamilOTT JSON must be an array or contain items/results array: ${url}`);

  return rawItems.map((item) => mapFeedItem(item, url));
}

async function fetchJsonFeedCached(url) {
  const cached = cache.catalog.get(url);
  if (cached?.items && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.items;
  if (cache.inflight.has(url)) return cache.inflight.get(url);

  const promise = fetchJsonFeed(url)
    .then((items) => {
      cache.catalog.set(url, { items, loadedAt: Date.now() });
      return items;
    })
    .finally(() => cache.inflight.delete(url));

  cache.inflight.set(url, promise);
  return promise;
}

async function fetchJsonFeedHead(url, maxObjects = 240) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre/1.0)',
    },
  });

  if (!response.ok) throw new Error(`TamilOTT JSON returned HTTP ${response.status} for ${url}`);
  if (!response.body?.getReader) return fetchJsonFeed(url).then((items) => items.slice(0, maxObjects));

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const items = [];
  let buffer = '';
  const delimiter = '\n  },\n  {';

  function cleanObjectJson(segment, addClosing = true) {
    let json = String(segment || '').trim();
    if (json.startsWith('[')) json = json.slice(1).trim();
    if (json.startsWith(',')) json = json.slice(1).trim();
    if (!json.startsWith('{')) json = `{${json}`;
    if (addClosing) json = `${json}\n  }`;
    return json;
  }

  function pushObject(segment) {
    try {
      const parsed = JSON.parse(cleanObjectJson(segment, true));
      const mapped = mapFeedItem(parsed, url);
      if (mapped.streamUrl && mapped.title) items.push(mapped);
    } catch {}
  }

  while (items.length < maxObjects) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: true });

    let delimiterIndex = buffer.indexOf(delimiter);
    while (delimiterIndex >= 0 && items.length < maxObjects) {
      const segment = buffer.slice(0, delimiterIndex);
      pushObject(segment);
      buffer = `  {${buffer.slice(delimiterIndex + delimiter.length)}`;
      delimiterIndex = buffer.indexOf(delimiter);
    }

    // If the upstream format changes and no delimiter is seen, fall back before
    // holding the full 10MB+ feed in memory on tiny hosts.
    if (items.length === 0 && buffer.length > 2 * 1024 * 1024) {
      try { reader.cancel().catch(() => {}); } catch {}
      return fetchJsonFeed(url).then((list) => list.slice(0, maxObjects));
    }
  }

  try { reader.cancel().catch(() => {}); } catch {}
  return items;
}

async function findStreamIdInJsonFeed(url, streamId = '', maxObjects = 5000) {
  const wanted = String(streamId || '').trim();
  if (!wanted) return null;

  const full = cache.catalog.get(url);
  if (full?.items && Date.now() - full.loadedAt < CACHE_TTL_MS) {
    return full.items.find((item) => String(item.streamId) === wanted || String(item.id) === wanted) || null;
  }

  const head = cache.catalogHead.get(url);
  if (head?.items && Date.now() - head.loadedAt < CACHE_TTL_MS) {
    const found = head.items.find((item) => String(item.streamId) === wanted || String(item.id) === wanted);
    if (found) return found;
    if (head.maxObjects >= maxObjects) return null;
  }

  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre/1.0)',
    },
  });

  if (!response.ok) throw new Error(`TamilOTT JSON returned HTTP ${response.status} for ${url}`);
  if (!response.body?.getReader) {
    const items = await fetchJsonFeed(url);
    cache.catalog.set(url, { items, loadedAt: Date.now() });
    return items.find((item) => String(item.streamId) === wanted || String(item.id) === wanted) || null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parsedItems = [];
  let buffer = '';
  const delimiter = '\n  },\n  {';

  function cleanObjectJson(segment) {
    let json = String(segment || '').trim();
    if (json.startsWith('[')) json = json.slice(1).trim();
    if (json.startsWith(',')) json = json.slice(1).trim();
    if (!json.startsWith('{')) json = `{${json}`;
    return `${json}\n  }`;
  }

  function parseSegment(segment) {
    try {
      const parsed = JSON.parse(cleanObjectJson(segment));
      const mapped = mapFeedItem(parsed, url);
      if (mapped.streamUrl && mapped.title) return mapped;
    } catch {}
    return null;
  }

  try {
    while (parsedItems.length < maxObjects) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: true });

      let delimiterIndex = buffer.indexOf(delimiter);
      while (delimiterIndex >= 0 && parsedItems.length < maxObjects) {
        const item = parseSegment(buffer.slice(0, delimiterIndex));
        if (item) {
          parsedItems.push(item);
          if (String(item.streamId) === wanted || String(item.id) === wanted) {
            const existing = cache.catalogHead.get(url);
            if (!existing || parsedItems.length > existing.items.length) {
              cache.catalogHead.set(url, { items: parsedItems, maxObjects: parsedItems.length, loadedAt: Date.now() });
            }
            try { reader.cancel().catch(() => {}); } catch {}
            return item;
          }
        }
        buffer = `  {${buffer.slice(delimiterIndex + delimiter.length)}`;
        delimiterIndex = buffer.indexOf(delimiter);
      }

      if (parsedItems.length === 0 && buffer.length > 2 * 1024 * 1024) break;
    }
  } finally {
    try { reader.cancel().catch(() => {}); } catch {}
  }

  if (parsedItems.length) {
    const existing = cache.catalogHead.get(url);
    if (!existing || parsedItems.length > existing.items.length) {
      cache.catalogHead.set(url, { items: parsedItems, maxObjects: parsedItems.length, loadedAt: Date.now() });
    }
  }
  return null;
}

async function findTamilOttItemByStreamId(streamId = '', maxObjects = 5000) {
  const wanted = String(streamId || '').trim();
  if (!wanted) return null;

  const urls = getTamilOttJsonUrls();
  for (const url of urls) {
    const found = await findStreamIdInJsonFeed(url, wanted, maxObjects).catch(() => null);
    if (found) return found;
  }
  return null;
}

async function fetchJsonFeedHeadCached(url, maxObjects = 240) {
  const full = cache.catalog.get(url);
  if (full?.items && Date.now() - full.loadedAt < CATALOG_CACHE_TTL_MS) return full.items.slice(0, maxObjects);

  const cached = cache.catalogHead.get(url);
  if (cached?.items && cached.maxObjects >= maxObjects && Date.now() - cached.loadedAt < CATALOG_CACHE_TTL_MS) {
    return cached.items.slice(0, maxObjects);
  }

  const key = `${url}|${maxObjects}`;
  if (cache.headInflight.has(key)) return cache.headInflight.get(key);

  const promise = fetchJsonFeedHead(url, maxObjects)
    .then((items) => {
      cache.catalogHead.set(url, { items, maxObjects, loadedAt: Date.now() });
      return items;
    })
    .finally(() => cache.headInflight.delete(key));

  cache.headInflight.set(key, promise);
  return promise;
}

function catalogScanLimit({ page = 1, limit = 15, query = '' } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(60, Number(limit) || 15));
  const envKey = query ? 'OTT_QUERY_SCAN_LIMIT' : 'OTT_CATALOG_SCAN_LIMIT';
  const envLimit = Number(process.env[envKey] || 0);
  if (Number.isFinite(envLimit) && envLimit > 0) return Math.max(safeLimit, Math.floor(envLimit));

  // Feed is newest-first by stream id, so an overscan window gives exact-looking
  // LIFO pages without parsing a 10MB+ JSON file on small free containers.
  if (query) return Math.max(1200, safePage * safeLimit * 30);
  return Math.max(240, (safePage + 2) * safeLimit * 8);
}

async function loadTamilOttItems() {
  const urls = getTamilOttJsonUrls();
  if (!urls.length) throw new Error('TamilOTT JSON source is disabled. Set OTT to one or more authorized JSON URLs.');

  const key = urls.join(',');
  if (cache.items && cache.key === key && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.items;
  }
  if (cache.allInflight?.key === key) return cache.allInflight.promise;

  const promise = (async () => {
    const feeds = [];
    const errors = [];

    // Sequential fetch/parse avoids two large 10MB+ JSON parses peaking memory at once.
    for (const url of urls) {
      try {
        feeds.push(await fetchJsonFeedCached(url));
      } catch (error) {
        errors.push(error.message);
      }
    }

    if (!feeds.length) {
      throw new Error(errors[0] || 'All configured TamilOTT JSON feeds failed');
    }

    const seen = new Set();
    const items = feeds
      .flat()
      .filter((item) => item.streamUrl && item.title)
      .filter((item) => {
        const itemKey = item.streamUrl || `${item.feedUrl}:${item.streamId}`;
        if (seen.has(itemKey)) return false;
        seen.add(itemKey);
        return true;
      });

    cache.key = key;
    cache.items = items;
    cache.loadedAt = Date.now();
    return items;
  })().finally(() => {
    if (cache.allInflight?.key === key) cache.allInflight = null;
  });

  cache.allInflight = { key, promise };
  return promise;
}

function resolveScanLimit({ quick = true, manual = false, streamId = '', override = 0 } = {}) {
  const explicit = Number(override || 0);
  if (Number.isFinite(explicit) && explicit > 0) return Math.floor(explicit);
  const envKey = quick ? 'OTT_AUTO_RESOLVE_SCAN_LIMIT' : 'OTT_MANUAL_RESOLVE_SCAN_LIMIT';
  const envValue = Number(process.env[envKey] || process.env.OTT_RESOLVE_SCAN_LIMIT || 0);
  if (Number.isFinite(envValue) && envValue > 0) return Math.floor(envValue);
  if (streamId) return 5000;
  if (manual) return 6000;
  return 900;
}

async function loadTamilOttItemsForResolve({ quick = true, manual = false, streamId = '', scanLimit = 0 } = {}) {
  const urls = getTamilOttJsonUrls();
  if (!urls.length) throw new Error('TamilOTT JSON source is disabled. Set OTT to one or more authorized JSON URLs.');

  const key = urls.join(',');
  if (cache.items && cache.key === key && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.items;

  const shouldUseFull = !quick && process.env.OTT_FULL_RESOLVE === '1';
  if (shouldUseFull) return loadTamilOttItems();

  const maxObjects = resolveScanLimit({ quick, manual, streamId, override: scanLimit });
  if (streamId) {
    const exact = await findTamilOttItemByStreamId(streamId, maxObjects);
    if (exact) return [exact];
  }

  const feeds = [];
  const errors = [];
  for (const url of urls) {
    try {
      feeds.push(await fetchJsonFeedHeadCached(url, maxObjects));
    } catch (error) {
      errors.push(error.message);
    }
  }

  if (!feeds.length) throw new Error(errors[0] || 'All configured TamilOTT JSON feeds failed');

  const seen = new Set();
  const items = feeds
    .flat()
    .filter((item) => item.streamUrl && item.title)
    .filter((item) => {
      const itemKey = item.streamUrl || `${item.feedUrl}:${item.streamId}`;
      if (seen.has(itemKey)) return false;
      seen.add(itemKey);
      return true;
    });

  return items;
}

async function getTMDBMeta({ tmdbId, type, title = '', year = '' }) {
  const mediaType = normalizeType(type);
  const numericTmdbId = Number(tmdbId);

  // TamilMV cards can be unmatched with TMDB but still exist in the authorized
  // TamilOTT JSON feed. In that case resolve directly by scraped title/year and
  // keep the watch page locked to TamilOTT only.
  if (!numericTmdbId || Number.isNaN(numericTmdbId)) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) throw new Error('TamilOTT title search requires a title.');
    return {
      type: mediaType,
      title: cleanTitle,
      originalTitle: cleanTitle,
      year: String(year || '').match(/\b(19\d{2}|20\d{2})\b/)?.[1] || '',
      titleOnly: true,
    };
  }

  const details = await fetchTMDB(mediaType === 'series' ? `/tv/${numericTmdbId}` : `/movie/${numericTmdbId}`, {
    language: 'en-IN',
  });

  if (mediaType === 'series') {
    return {
      type: 'series',
      title: details.name || details.original_name || '',
      originalTitle: details.original_name || '',
      year: String(details.first_air_date || '').slice(0, 4),
    };
  }

  return {
    type: 'movie',
    title: details.title || details.original_title || '',
    originalTitle: details.original_title || '',
    year: String(details.release_date || '').slice(0, 4),
  };
}

function baseMatchScore(item, meta) {
  let score = 0;
  if (item.type === meta.type) score += 65;
  else score -= 120;

  const titleScore = Math.max(
    titleMatchScore(item.title, item.streamTitle, meta.title),
    titleMatchScore(item.title, item.streamTitle, meta.originalTitle),
  );
  score += titleScore;

  if (meta.year && item.year === meta.year) score += 22;
  else if (meta.year && item.year && item.year !== meta.year) score -= meta.type === 'series' ? 4 : 14;

  return score;
}

function episodeScore(item, meta, { season = 1, episode = 1 } = {}) {
  if (meta.type !== 'series') return 0;

  let score = 0;
  const wantsSeason = Number(season || 1);
  const wantsEpisode = Number(episode || 1);

  if (item.season && item.season === wantsSeason) score += 180;
  else if (item.season) score -= 220;

  if (item.episode && item.episode === wantsEpisode) score += 220;
  else if (item.episode) score -= 260;
  else score -= 18;

  return score;
}

function finalScore(item, meta, options) {
  return baseMatchScore(item, meta) + episodeScore(item, meta, options) + item.qualityScore;
}

function sortAvailableStreams(a, b, meta) {
  if (meta.type === 'series') {
    const seasonA = a.season || 999;
    const seasonB = b.season || 999;
    if (seasonA !== seasonB) return seasonA - seasonB;
    const episodeA = a.episode || 9999;
    const episodeB = b.episode || 9999;
    if (episodeA !== episodeB) return episodeA - episodeB;
  }

  if (b.qualityScore !== a.qualityScore) return b.qualityScore - a.qualityScore;
  return Number(b.id || 0) - Number(a.id || 0);
}

function toStreamOption(item, score = 0) {
  return {
    id: item.streamId,
    value: item.streamId,
    title: item.title,
    streamTitle: item.streamTitle,
    label: item.displayLabel,
    streamUrl: item.streamUrl,
    type: item.type,
    year: item.year,
    season: item.season,
    episode: item.episode,
    quality: item.quality,
    size: item.size,
    source: item.source,
    score,
  };
}

export async function resolveTamilOttProvider({ tmdbId, type, title = '', year = '', season = 1, episode = 1, streamId = '', quick = false, scanLimit = 0 } = {}) {
  const requestedId = String(streamId || '').trim();
  const [items, meta] = await Promise.all([
    loadTamilOttItemsForResolve({ quick, manual: !quick, streamId: requestedId, scanLimit }),
    getTMDBMeta({ tmdbId, type, title, year }),
  ]);

  let candidates = items
    .map((item) => ({ item, baseScore: baseMatchScore(item, meta) }))
    .filter((entry) => entry.baseScore >= 150)
    .sort((a, b) => sortAvailableStreams(a.item, b.item, meta));

  // If a series has real episode-level entries, hide generic season/show pages
  // from the TamilOTT dropdown so the list stays neat and episode changes map
  // to actual episode streams.
  if (meta.type === 'series' && candidates.some((entry) => entry.item.episode)) {
    candidates = candidates.filter((entry) => entry.item.episode);
  }

  let selectedEntry = null;

  if (requestedId) {
    const exactRequestedItem = items.find((item) => String(item.streamId) === requestedId || String(item.id) === requestedId) || null;
    if (!exactRequestedItem) {
      throw new Error('Selected TamilOTT stream is no longer available in the current catalog.');
    }
    if (!candidates.some((entry) => entry.item.streamId === exactRequestedItem.streamId)) {
      candidates.unshift({ item: exactRequestedItem, baseScore: 9999, score: 9999 });
    }
    selectedEntry = candidates.find((entry) => String(entry.item.streamId) === requestedId || String(entry.item.id) === requestedId) || null;
  }

  if (!candidates.length) {
    throw new Error(`TamilOTT JSON has no matching authorized stream for ${meta.title || tmdbId} in the scanned recent window (${items.length} items).`);
  }

  if (!selectedEntry) {
    selectedEntry = candidates
      .map((entry) => ({ ...entry, score: finalScore(entry.item, meta, { season, episode }) }))
      .sort((a, b) => b.score - a.score)[0];
  }

  const best = selectedEntry.item;
  const availableStreams = candidates.map((entry) => toStreamOption(entry.item, finalScore(entry.item, meta, { season, episode })));
  const fallbacks = candidates
    .filter((entry) => entry.item.streamUrl !== best.streamUrl)
    .sort((a, b) => b.item.qualityScore - a.item.qualityScore)
    .slice(0, 10)
    .map((entry) => entry.item.streamUrl);

  return {
    id: 'tamilott',
    providerId: 'tamilott',
    provider: 'TamilOTT JSON',
    label: best.displayLabel,
    streamUrl: best.streamUrl,
    streamType: 'embed',
    externalId: `tamilott:${best.streamId}`,
    fallbacks: [...new Set(fallbacks)],
    selectedStreamId: best.streamId,
    availableStreams,
    match: {
      id: best.streamId,
      title: best.title,
      streamTitle: best.streamTitle,
      label: best.displayLabel,
      year: best.year,
      type: best.type,
      season: best.season,
      episode: best.episode,
      quality: best.quality,
      size: best.size,
      source: best.source,
      score: selectedEntry.score ?? finalScore(best, meta, { season, episode }),
      posterUrl: best.posterUrl,
    },
    feed: {
      urls: getTamilOttJsonUrls(),
      count: items.length,
      matchedCount: availableStreams.length,
      cachedAt: cache.loadedAt ? new Date(cache.loadedAt).toISOString() : null,
      quick,
    },
  };
}

function normalizeSeriesCatalogTitle(item = {}) {
  const raw = item.title || item.cleanStreamTitle || item.streamTitle || '';
  return normalizeTitle(raw)
    .replace(/\bs\s*\d{1,2}\s*e\s*\d{1,3}\b/g, ' ')
    .replace(/\bseason\s*\d{1,2}\b/g, ' ')
    .replace(/\b(?:episode|epi|ep|e)\s*\d{1,3}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSeriesDisplayTitle(item = {}) {
  const raw = normalizeWhitespace(item.title || item.cleanStreamTitle || item.streamTitle || 'Untitled');
  return normalizeWhitespace(raw
    .replace(/\bS\s*\d{1,2}\s*E\s*\d{1,3}\b/gi, ' ')
    .replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
    .replace(/\b(?:Episode|EPI|EP|E)\s*\d{1,3}\b/gi, ' ')
    .replace(/\s+[-–:]+\s*$/g, ' ')) || raw;
}

function catalogKey(item) {
  const type = item.type || 'movie';
  const baseTitle = type === 'series' ? normalizeSeriesCatalogTitle(item) : (item.normalizedTitle || normalizeTitle(item.title));

  // MiX catalog should show one poster per series, not one card per episode.
  // Do not include year for series because TamilOTT often uses upload/current
  // year in episode filenames, not the show's real release year.
  if (type === 'series') return [type, baseTitle].join(':');

  return [
    type,
    baseTitle,
    item.year || '',
    item.season || '',
    item.episode || '',
  ].join(':');
}

function toCatalogItem(item, source = 'movies', groupInfo = null) {
  const isSeriesGroup = item.type === 'series';
  return {
    id: isSeriesGroup
      ? `ott-${source}-series-${slugify(item.title)}-${item.year || 'na'}`
      : `ott-${source}-${item.streamId}`,
    // For grouped series cards, do not pass an episode stream id. The watch page
    // should behave like a real series page and resolve by selected S/E.
    streamId: isSeriesGroup ? '' : item.streamId,
    type: item.type || 'movie',
    title: isSeriesGroup ? cleanSeriesDisplayTitle(item) : (item.title || item.cleanStreamTitle || 'Untitled'),
    streamTitle: isSeriesGroup ? '' : (item.streamTitle || ''),
    category: item.type === 'series' ? 'Series' : source === 'dubbed' ? 'Dubbed' : item.source || 'TamilOTT',
    year: item.year || '',
    season: isSeriesGroup ? null : item.season,
    episode: isSeriesGroup ? null : item.episode,
    episodeCount: groupInfo?.episodeCount || 0,
    seasons: groupInfo?.seasons || [],
    releaseDate: item.year ? `${item.year}-01-01` : '',
    posterUrl: item.posterUrl || '',
    synopsis: isSeriesGroup
      ? `${groupInfo?.episodeCount || 'Multiple'} episode${groupInfo?.episodeCount === 1 ? '' : 's'} available in TamilOTT.`
      : item.synopsis || item.streamTitle || '',
    rating: item.rating || '',
    quality: isSeriesGroup ? '' : (item.quality || ''),
    size: isSeriesGroup ? '' : (item.size || ''),
    source: item.source || 'TamilOTT',
    ottSource: source,
    isOttCatalog: true,
    isOttSeriesGroup: isSeriesGroup,
  };
}

export async function listTamilOttCatalog({ source = 'movies', page = 1, limit = 15, query = '' } = {}) {
  const selectedSource = source === 'dubbed' ? 'dubbed' : 'movies';
  const selectedUrl = getTamilOttCatalogUrl(selectedSource);
  if (!selectedUrl) throw new Error('TamilOTT catalog source is disabled.');

  const safeLimit = Math.max(1, Math.min(60, Number(limit) || 15));
  const safePage = Math.max(1, Number(page) || 1);
  const q = normalizeTitle(query);
  const scanLimit = catalogScanLimit({ page: safePage, limit: safeLimit, query: q });
  const rawItems = await fetchJsonFeedHeadCached(selectedUrl, scanLimit);
  const seriesTitleKeys = new Set(
    rawItems
      .filter((item) => item.type === 'series')
      .map((item) => normalizeSeriesCatalogTitle(item))
      .filter(Boolean),
  );
  const grouped = new Map();

  for (const rawItem of rawItems) {
    if (!rawItem.streamUrl || !rawItem.title) continue;
    const item = rawItem.type !== 'series' && seriesTitleKeys.has(normalizeSeriesCatalogTitle(rawItem))
      ? { ...rawItem, type: 'series' }
      : rawItem;
    if (q) {
      const haystack = `${item.normalizedTitle || ''} ${item.normalizedStreamTitle || ''}`;
      if (!haystack.includes(q)) continue;
    }

    const key = catalogKey(item);
    const existing = grouped.get(key) || { item: null, episodeKeys: new Set(), seasons: new Set(), latestId: 0 };
    if (item.type === 'series') {
      if (item.season) existing.seasons.add(Number(item.season));
      if (item.season && item.episode) existing.episodeKeys.add(`${item.season}:${item.episode}`);
    }

    // LIFO: highest/latest stream id wins for the visible catalogue poster.
    if (!existing.item || Number(item.id || 0) > Number(existing.latestId || 0)) {
      existing.item = item;
      existing.latestId = Number(item.id || 0);
    }
    grouped.set(key, existing);
  }

  const sorted = [...grouped.values()].sort((a, b) => Number(b.latestId || 0) - Number(a.latestId || 0));
  const start = (safePage - 1) * safeLimit;
  const pageItems = sorted.slice(start, start + safeLimit).map((entry) => toCatalogItem(entry.item, selectedSource, {
    episodeCount: entry.episodeKeys.size,
    seasons: [...entry.seasons].sort((a, b) => a - b),
  }));

  return {
    source: selectedSource,
    sourceUrl: selectedUrl,
    page: safePage,
    limit: safeLimit,
    total: sorted.length,
    count: pageItems.length,
    hasMore: start + safeLimit < sorted.length || rawItems.length >= scanLimit,
    scanned: rawItems.length,
    scanLimit,
    lazyParsed: true,
    updatedAt: new Date().toISOString(),
    items: pageItems,
  };
}

export function createTamilOttAttempt(result, status = 'configured', reason = '') {
  return {
    providerId: 'tamilott',
    provider: 'TamilOTT JSON',
    label: result?.label || 'Authorized JSON feed',
    status,
    reason: reason || 'Select this source to match the selected TMDB title against the authorized JSON feed.',
    streamUrl: result?.streamUrl || '',
    fallbacks: result?.fallbacks || [],
    match: result?.match || null,
  };
}
