import { fetchTMDB } from '@/lib/tmdb';
import { extractStreamUrl } from '@/lib/streamResolver';
import { SCRAPER_PROVIDERS } from '@/lib/providers';

const SCREENSCAPE_BASE_URL = 'https://screenscapeapi.dev';

const SEARCHABLE_PROVIDERS = [
  {
    id: 'zinkmovies',
    name: 'ZinkMovies',
    searchPath: '/api/zinkmovies/search',
    detailsPath: '/api/zinkmovies/details',
    extractorPaths: ['/api/zinkmovies/zinkcloud'],
  },
  {
    id: 'movies4u',
    name: 'Movies4u',
    searchPath: '/api/movies4u/search',
    detailsPath: '/api/movies4u/details',
    extractorPaths: ['/api/movies4u/m4ulinks'],
  },
  {
    id: 'hdhub4u',
    name: 'HDHub4U',
    searchPath: '/api/hdhub4u/search',
    detailsPath: '/api/hdhub4u/details',
    extractorPaths: [],
  },
  {
    id: 'zeefliz',
    name: 'Zeefliz',
    searchPath: '/api/zeefliz/search',
    detailsPath: '/api/zeefliz/details',
    extractorPaths: ['/api/zeefliz/nextdrive'],
  },
  {
    id: 'vega',
    name: 'Vega Movies',
    searchPath: '/api/vega/search',
    detailsPath: '/api/vega/details',
    extractorPaths: ['/api/vega/nextdrive'],
  },
  {
    id: 'drive',
    name: 'Drive',
    searchPath: '/api/drive/search',
    detailsPath: '/api/drive/details',
    extractorPaths: ['/api/drive/mdrive'],
  },
  {
    id: '4khdhub',
    name: '4kHDHub',
    searchPath: '/api/4khdhub/search',
    detailsPath: '/api/4khdhub/details',
    extractorPaths: ['/api/4khdhub/gadget'],
  },
  {
    id: 'animesalt',
    name: 'AnimeSalt',
    searchPath: '/api/animesalt/search',
    detailsPath: '/api/animesalt/details',
    extractorPaths: ['/api/animesalt/stream'],
  },
];

function getScreenScapeKey() {
  return process.env.SCREENSCAPE || process.env.SCREENSCAPE_API_KEY || '';
}

function getApiHeaders() {
  return {
    'x-api-key': getScreenScapeKey(),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function fetchScreenScape(path, params = {}) {
  const screenScapeKey = getScreenScapeKey();
  if (!screenScapeKey) {
    throw new Error('SCREENSCAPE or SCREENSCAPE_API_KEY is missing');
  }

  const url = new URL(path, SCREENSCAPE_BASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  url.searchParams.set('key', screenScapeKey);

  const response = await fetch(url, {
    method: 'GET',
    headers: getApiHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`ScreenScape ${path} failed with ${response.status}`);
  }

  return response.json();
}

function simplifyTitle(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/\b(20\d{2}|19\d{2})\b/g, '')
    .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getResultsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data?.results)) return payload.data.results;
  if (Array.isArray(payload?.data?.items)) return payload.data.items;
  if (Array.isArray(payload?.slider) || Array.isArray(payload?.trending)) {
    return [...(payload.slider || []), ...(payload.trending || [])];
  }
  return [];
}

function getCandidateUrl(item) {
  return item?.url || item?.postUrl || item?.link || item?.href || item?.sourceUrl || '';
}

function getCandidateTitle(item) {
  return item?.title || item?.name || item?.movieName || '';
}

function findBestMatch(results, tmdbTitle, year) {
  const target = simplifyTitle(tmdbTitle);
  if (!target) return null;

  const scored = results
    .map((item) => {
      const title = getCandidateTitle(item);
      const simple = simplifyTitle(title);
      const hasTitle = simple.includes(target) || target.includes(simple);
      const hasYear = year
        ? String(title).includes(String(year)) || String(item.year || '').includes(String(year))
        : false;

      let score = 0;
      if (hasTitle) score += 10;
      if (hasYear) score += 3;
      if (String(title).toLowerCase().includes('tamil')) score += 2;

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.item || null;
}

function mapTMDBDetails(details, type) {
  if (type === 'series') {
    return {
      title: details.name || details.original_name || '',
      originalTitle: details.original_name || '',
      year: (details.first_air_date || '').slice(0, 4),
    };
  }

  return {
    title: details.title || details.original_title || '',
    originalTitle: details.original_title || '',
    year: (details.release_date || '').slice(0, 4),
  };
}

async function getTMDBTitle(tmdbId, type) {
  const path = type === 'series' ? `tv/${tmdbId}` : `movie/${tmdbId}`;
  const details = await fetchTMDB(path, { language: 'en-IN' });
  return mapTMDBDetails(details, type);
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function collectUrlsDeep(value, output = [], path = '') {
  if (!value) return output;

  if (isHttpUrl(value)) {
    output.push({ url: value.trim(), path });
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrlsDeep(item, output, `${path}[${index}]`));
    return output;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, nested]) => {
      collectUrlsDeep(nested, output, path ? `${path}.${key}` : key);
    });
  }

  return output;
}

function uniqueUrls(urls) {
  const seen = new Set();
  return urls.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function looksDirectlyPlayable(url) {
  const lower = String(url).toLowerCase();
  return (
    lower.includes('.m3u8') ||
    lower.includes('.mp4') ||
    lower.includes('/embed') ||
    lower.includes('netmirror') ||
    lower.includes('stream') ||
    lower.includes('player')
  );
}

function buildAutoSource(provider, foundItem, externalId, priority = 1) {
  return {
    provider: provider.name,
    label: getCandidateTitle(foundItem) || `${provider.name} Auto Source`,
    externalId,
    priority,
    isActive: true,
  };
}

function successAttempt(provider, foundItem, streamUrl, source, reason) {
  return {
    providerId: provider.id,
    provider: provider.name,
    label: getCandidateTitle(foundItem) || 'Playable match',
    status: 'available',
    reason,
    streamUrl,
    source,
    foundItem,
  };
}

async function tryExtractorPaths(provider, foundItem, urls) {
  const errors = [];

  for (const link of urls) {
    // If the details endpoint already returned an embeddable/direct URL, use it.
    if (looksDirectlyPlayable(link.url)) {
      return successAttempt(
        provider,
        foundItem,
        link.url,
        buildAutoSource(provider, foundItem, provider.detailsPath ? `${provider.detailsPath}?url=${encodeURIComponent(getCandidateUrl(foundItem))}` : link.url),
        `Direct playable-looking URL found at details response path: ${link.path}`
      );
    }

    for (const extractorPath of provider.extractorPaths || []) {
      try {
        const paramName = extractorPath.includes('gadget') ? 'link' : 'url';
        const extractedPayload = await fetchScreenScape(extractorPath, {
          [paramName]: link.url,
        });
        const streamUrl = extractStreamUrl(extractedPayload);

        if (streamUrl) {
          return successAttempt(
            provider,
            foundItem,
            streamUrl,
            buildAutoSource(
              provider,
              foundItem,
              `${extractorPath}?${paramName}=${encodeURIComponent(link.url)}`,
              1
            ),
            `Playable URL extracted through ${extractorPath} from ${link.path}`
          );
        }

        const nestedUrls = uniqueUrls(collectUrlsDeep(extractedPayload));
        const playableNested = nestedUrls.find((item) => looksDirectlyPlayable(item.url));

        if (playableNested) {
          return successAttempt(
            provider,
            foundItem,
            playableNested.url,
            buildAutoSource(
              provider,
              foundItem,
              `${extractorPath}?${paramName}=${encodeURIComponent(link.url)}`,
              1
            ),
            `Playable-looking URL found after ${extractorPath}`
          );
        }
      } catch (error) {
        errors.push(`${extractorPath}: ${error.message}`);
      }
    }
  }

  return { error: errors.join(' | ') || 'No extractor produced a playable URL.' };
}

async function tryProvider(provider, tmdbMeta) {
  const queries = Array.from(
    new Set([
      tmdbMeta.title,
      tmdbMeta.originalTitle,
      tmdbMeta.year ? `${tmdbMeta.title} ${tmdbMeta.year}` : '',
    ].filter(Boolean))
  );

  let lastError = '';
  let foundItem = null;

  for (const query of queries) {
    try {
      const searchPayload = await fetchScreenScape(provider.searchPath, { q: query, page: 1 });
      const results = getResultsArray(searchPayload);
      const match = findBestMatch(results, tmdbMeta.title, tmdbMeta.year);

      if (match) {
        foundItem = match;
        break;
      }
    } catch (error) {
      lastError = error.message;
    }
  }

  if (!foundItem) {
    return {
      providerId: provider.id,
      provider: provider.name,
      label: 'Auto search',
      status: 'not_found',
      reason: lastError || 'No matching title found from scraper search.',
    };
  }

  const candidateUrl = getCandidateUrl(foundItem);

  if (!candidateUrl) {
    return {
      providerId: provider.id,
      provider: provider.name,
      label: getCandidateTitle(foundItem) || 'Match found',
      status: 'found',
      reason: 'Matching title found, but no details URL was returned by this scraper.',
      foundItem,
    };
  }

  let detailsPayload;

  try {
    detailsPayload = await fetchScreenScape(provider.detailsPath, { url: candidateUrl });
  } catch (error) {
    // Important: this means the scraper search found the movie, but the provider
    // details endpoint failed. Show it as found, not unavailable.
    return {
      providerId: provider.id,
      provider: provider.name,
      label: getCandidateTitle(foundItem) || 'Title found',
      status: 'found',
      reason: `Title found in search, but details endpoint failed: ${error.message}. This is a provider/API-side failure, not a title-not-found result.`,
      source: buildAutoSource(
        provider,
        foundItem,
        `${provider.detailsPath}?url=${encodeURIComponent(candidateUrl)}`,
        1
      ),
      foundItem,
    };
  }

  const immediateStreamUrl = extractStreamUrl(detailsPayload);

  if (immediateStreamUrl && looksDirectlyPlayable(immediateStreamUrl)) {
    return successAttempt(
      provider,
      foundItem,
      immediateStreamUrl,
      buildAutoSource(
        provider,
        foundItem,
        `${provider.detailsPath}?url=${encodeURIComponent(candidateUrl)}`,
        1
      ),
      'Playable URL extracted directly from details response.'
    );
  }

  const detailUrls = uniqueUrls(collectUrlsDeep(detailsPayload));
  const extractionResult = await tryExtractorPaths(provider, foundItem, detailUrls);

  if (extractionResult?.streamUrl) {
    return extractionResult;
  }

  return {
    providerId: provider.id,
    provider: provider.name,
    label: getCandidateTitle(foundItem) || 'Match found',
    status: 'found',
    reason:
      detailUrls.length > 0
        ? `Title found and details returned ${detailUrls.length} link(s), but no playable stream was extracted. ${extractionResult?.error || ''}`
        : 'Title found and details fetched, but no links were returned for extraction.',
    source: buildAutoSource(
      provider,
      foundItem,
      `${provider.detailsPath}?url=${encodeURIComponent(candidateUrl)}`,
      1
    ),
    foundItem,
  };
}

export async function autoSearchScrapers({ tmdbId, type }) {
  const tmdbMeta = await getTMDBTitle(tmdbId, type);
  const attempts = [];

  for (const provider of SEARCHABLE_PROVIDERS) {
    const attempt = await tryProvider(provider, tmdbMeta);
    attempts.push(attempt);

    if (attempt.status === 'available' && attempt.streamUrl) {
      return {
        streamUrl: attempt.streamUrl,
        provider: attempt.provider,
        label: attempt.label,
        source: attempt.source,
        attempts: mergeAutoAttempts(attempts),
        tmdbMeta,
      };
    }
  }

  return {
    streamUrl: null,
    attempts: mergeAutoAttempts(attempts),
    tmdbMeta,
  };
}

function mergeAutoAttempts(autoAttempts) {
  const byProvider = new Map();

  for (const provider of SCRAPER_PROVIDERS) {
    byProvider.set(provider.id, {
      providerId: provider.id,
      provider: provider.name,
      label: 'Auto search pending/not supported',
      status: 'not_found',
      reason: 'This scraper did not return a matching playable source during auto-search.',
    });
  }

  for (const attempt of autoAttempts) {
    byProvider.set(attempt.providerId, attempt);
  }

  return Array.from(byProvider.values());
}
