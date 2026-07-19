const TMDB_BASE_URL = 'https://api.themoviedb.org/3/';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

function getTodayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function cleanEnv(value = '') {
  return String(value || '').trim();
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

function firstEnv(keys = []) {
  for (const key of keys) {
    const value = cleanEnv(process.env[key] || '');
    if (value) return value;
  }
  return '';
}

function getTMDBApiKey() {
  const value = firstEnv([
    'TMDB',
    'TMDB_API_KEY',
    'TMDB_KEY',
    'TMDB_V3_API_KEY',
    'THEMOVIEDB_API_KEY',
    'MOVIEDB_API_KEY',
  ]);
  return value && !looksLikeBearerToken(value) ? value : '';
}

function getTMDBBearerToken() {
  const explicit = firstEnv([
    'TMDB_TOKEN',
    'TMDB_BEARER_TOKEN',
    'TMDB_ACCESS_TOKEN',
    'TMDB_READ_ACCESS_TOKEN',
    'TMDB_V4_TOKEN',
    'TMDB_V4_BEARER_TOKEN',
  ]);
  if (explicit) return stripBearerPrefix(explicit);

  const maybeBearer = firstEnv(['TMDB', 'TMDB_API_KEY', 'TMDB_KEY']);
  return looksLikeBearerToken(maybeBearer) ? stripBearerPrefix(maybeBearer) : '';
}

function getTMDBAuthHeaders() {
  const bearer = getTMDBBearerToken();

  if (bearer) {
    return {
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json',
    };
  }

  return {
    Accept: 'application/json',
  };
}

export function requireTMDBConfig() {
  if (!getTMDBApiKey() && !getTMDBBearerToken()) {
    throw new Error(
      'Missing TMDB key. Add TMDB, TMDB_API_KEY, TMDB_TOKEN, or TMDB_BEARER_TOKEN as a server-side environment variable.'
    );
  }
}

function buildTMDBUrl(path, params = {}) {
  // Important: URL('/discover/movie', 'https://api.themoviedb.org/3') drops /3.
  // So we remove the leading slash and use a base URL ending in /3/.
  const cleanPath = String(path).replace(/^\/+/, '');
  const url = new URL(cleanPath, TMDB_BASE_URL);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  const apiKey = getTMDBApiKey();
  const bearer = getTMDBBearerToken();
  if (apiKey && !bearer) {
    url.searchParams.set('api_key', apiKey);
  }

  return url;
}

export async function fetchTMDB(path, params = {}) {
  requireTMDBConfig();

  const url = buildTMDBUrl(path, params);

  const response = await fetch(url, {
    method: 'GET',
    headers: getTMDBAuthHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(
      `TMDB request failed: ${response.status}. URL: ${url.origin}${url.pathname}. Response: ${message.slice(0, 300)}`
    );
  }

  return response.json();
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
