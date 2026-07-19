const TMDB_BASE_URL = 'https://api.themoviedb.org/3/';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

function getTodayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanEnv(value = '') {
  return String(value || '').trim();
}

function splitEnvValues(value = '') {
  return cleanEnv(value)
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripBearerPrefix(value = '') {
  return cleanEnv(value).replace(/^Bearer\s+/i, '').trim();
}

function looksLikeBearerToken(value = '') {
  const token = stripBearerPrefix(value);
  // TMDB v4 read-access tokens are JWT-like strings and are much longer than
  // v3 API keys. This lets the short TMDB env accept either key style.
  return token.startsWith('eyJ') || token.split('.').length === 3 || token.length > 80;
}

function envValues(keys = []) {
  const values = [];
  for (const key of keys) values.push(...splitEnvValues(process.env[key] || ''));
  return [...new Set(values.map(cleanEnv).filter(Boolean))];
}

function getTMDBApiKeys() {
  return envValues([
    'TMDB_KEYS',
    'TMDB_API_KEYS',
    'TMDB_V3_KEYS',
    'TMDB',
    'TMDB_API_KEY',
    'TMDB_KEY',
    'TMDB_V3_API_KEY',
    'THEMOVIEDB_API_KEY',
    'MOVIEDB_API_KEY',
  ]).filter((value) => value && !looksLikeBearerToken(value));
}

function getTMDBBearerTokens() {
  const explicit = envValues([
    'TMDB_TOKENS',
    'TMDB_BEARER_TOKENS',
    'TMDB_TOKEN',
    'TMDB_BEARER_TOKEN',
    'TMDB_ACCESS_TOKEN',
    'TMDB_READ_ACCESS_TOKEN',
    'TMDB_V4_TOKEN',
    'TMDB_V4_BEARER_TOKEN',
  ]).map(stripBearerPrefix);

  const mixed = envValues(['TMDB', 'TMDB_API_KEY', 'TMDB_KEY'])
    .filter(looksLikeBearerToken)
    .map(stripBearerPrefix);

  return [...new Set([...explicit, ...mixed].filter(Boolean))];
}

function getTMDBCredentials() {
  return [
    ...getTMDBBearerTokens().map((token) => ({ type: 'bearer', token })),
    ...getTMDBApiKeys().map((key) => ({ type: 'api_key', key })),
  ];
}

function getTMDBAuthHeaders(bearerToken = '') {
  if (bearerToken) {
    return {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json',
    };
  }

  return {
    Accept: 'application/json',
  };
}

export function requireTMDBConfig() {
  if (!getTMDBCredentials().length) {
    throw new Error(
      'Missing TMDB key. Add TMDB, TMDB_KEYS, TMDB_API_KEY, TMDB_TOKEN, or TMDB_BEARER_TOKEN as a server-side environment variable.'
    );
  }
}

function buildTMDBUrl(path, params = {}, apiKey = '') {
  // Important: URL('/discover/movie', 'https://api.themoviedb.org/3') drops /3.
  // So we remove the leading slash and use a base URL ending in /3/.
  const cleanPath = String(path).replace(/^\/+/, '');
  const url = new URL(cleanPath, TMDB_BASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  if (apiKey) url.searchParams.set('api_key', apiKey);
  return url;
}

export async function fetchTMDB(path, params = {}) {
  const credentials = getTMDBCredentials();
  if (!credentials.length) requireTMDBConfig();

  const errors = [];
  for (let index = 0; index < credentials.length; index += 1) {
    const credential = credentials[index];
    const url = buildTMDBUrl(path, params, credential.type === 'api_key' ? credential.key : '');
    const response = await fetch(url, {
      method: 'GET',
      headers: getTMDBAuthHeaders(credential.type === 'bearer' ? credential.token : ''),
      cache: 'no-store',
    });

    if (response.ok) return response.json();

    const message = await response.text().catch(() => '');
    errors.push(`${credential.type}#${index + 1} returned ${response.status}: ${message.slice(0, 160)}`);

    // Try the next key for quota/auth/server errors. For clean 404s, another
    // key cannot help, so stop immediately.
    if (response.status === 404) break;
    if (![401, 403, 429, 500, 502, 503, 504].includes(response.status)) break;
  }

  const cleanPath = String(path).replace(/^\/+/, '');
  const safeUrl = new URL(cleanPath, TMDB_BASE_URL);
  throw new Error(
    `TMDB request failed. URL: ${safeUrl.origin}${safeUrl.pathname}. Tried ${credentials.length} key(s). ${errors.join(' | ')}`
  );
}

export function mapTMDBMovie(movie) {
  return {
    id: `tmdb-movie-${movie.id}`,
    tmdbId: movie.id,
    type: 'movie',
    title: movie.title || movie.original_title || 'Untitled Movie',
    originalTitle: movie.original_title || '',
    synopsis: movie.overview || '',
    posterUrl: movie.poster_path ? `${TMDB_IMAGE_BASE_URL}${movie.poster_path}` : '',
    backdropUrl: movie.backdrop_path ? `${TMDB_IMAGE_BASE_URL}${movie.backdrop_path}` : '',
    releaseDate: movie.release_date || '',
    rating: movie.vote_average || 0,
    language: movie.original_language || '',
  };
}

export function mapTMDBSeries(series) {
  return {
    id: `tmdb-series-${series.id}`,
    tmdbId: series.id,
    type: 'series',
    title: series.name || series.original_name || 'Untitled Series',
    originalTitle: series.original_name || '',
    synopsis: series.overview || '',
    posterUrl: series.poster_path ? `${TMDB_IMAGE_BASE_URL}${series.poster_path}` : '',
    backdropUrl: series.backdrop_path ? `${TMDB_IMAGE_BASE_URL}${series.backdrop_path}` : '',
    releaseDate: series.first_air_date || '',
    rating: series.vote_average || 0,
    language: series.original_language || '',
  };
}

export async function getLatestTamilMovies() {
  const today = getTodayISODate();

  const payload = await fetchTMDB('discover/movie', {
    with_original_language: 'ta',
    region: 'IN',
    sort_by: 'primary_release_date.desc',
    'primary_release_date.lte': today,
    include_adult: 'false',
    include_video: 'false',
    page: 1,
  });

  return (payload.results || []).map(mapTMDBMovie);
}

export async function getLatestTamilSeries() {
  const today = getTodayISODate();

  const payload = await fetchTMDB('discover/tv', {
    with_original_language: 'ta',
    watch_region: 'IN',
    sort_by: 'first_air_date.desc',
    'first_air_date.lte': today,
    include_adult: 'false',
    include_null_first_air_dates: 'false',
    page: 1,
  });

  return (payload.results || []).map(mapTMDBSeries);
}
