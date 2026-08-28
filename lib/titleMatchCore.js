// Pure title-match helpers shared by the /api/title-match endpoint, the
// tamilmv catalog merge, and the homepage Match dialog. No imports here, so
// the same code can also be unit-tested in plain Node.

const NOISE_WORDS = new Set([
  'tamil', 'telugu', 'hindi', 'malayalam', 'kannada', 'english',
  'tam', 'tel', 'hin', 'mal', 'kan', 'eng',
  'esub', 'esubs', 'sub', 'subs', 'aac', 'avc', 'hevc', 'x264', 'x265',
  'hdrip', 'hd', 'hq', 'uhd', 'fhd', 'webdl', 'web', 'dl', 'bluray', 'bdrip',
  'brrip', 'dvdrip', 'predvd', 'pdtv', 'hdtv', 'cam', 'ts', 'scr', 'dscr',
  'proper', 'repack', 'uncut', 'unrated', 'extended', 'original', 'org',
  'auds', 'aud', 'dubbed', 'dub', 'single', 'part', 'sample', 'line', 'rip',
  'mp4', 'mkv', 'avi', 'new', 'true', 'mb', 'gb',
  'moviesda', 'isaidub', 'tamilrockers', 'tamilyogi', 'tamilmv', 'tamilblasters',
]);

export function normalizeMatchType(type = '') {
  return /series|tv|show/i.test(String(type)) ? 'series' : 'movie';
}

/**
 * Reduce a scraped release title to a stable slug for matching:
 * "Coolie (2025) Tamil HQ HDRip x265" -> "coolie".
 */
export function normalizeMatchTitle(value = '') {
  let text = String(value || '').toLowerCase();
  text = text.replace(/\[[^\]]*\]/g, ' ');
  text = text.replace(/\((?:19|20)\d{2}[^)]*\)/g, ' '); // "(2025) HQ ..."
  text = text.replace(/\((?:19|20)\d{2}[^)]*$/g, ' '); // unclosed "(2025"
  text = text.replace(/\b(?:19|20)\d{2}\b/g, ' '); // bare year
  text = text.replace(/\b(?:s|season)\s?\d{1,2}\b/g, ' ');
  text = text.replace(/\b(?:e|ep|episode)\s?\d{1,3}\b/g, ' ');
  text = text.replace(/\b\d{3,4}p\b/g, ' '); // 720p/1080p/2160p
  text = text.replace(/\b\d{2,4}\s?kbps\b/g, ' ');
  text = text.replace(/\b\d+(?:\.\d+)?\s?(?:mb|gb)\b/g, ' ');
  text = text.replace(/[^a-z0-9]+/g, ' ');
  return text
    .split(' ')
    .filter((word) => word && !NOISE_WORDS.has(word))
    .join(' ')
    .trim();
}

export function extractYear(value = '') {
  return String(value || '').match(/(?:19|20)\d{2}/)?.[0] || '';
}

export function makeMatchKey({ type = 'movie', title = '', year = '' } = {}) {
  return `${normalizeMatchType(type)}|${normalizeMatchTitle(title)}|${extractYear(year)}`;
}

/** Year-tolerant lookup candidates (a scrape may gain/lose a year between syncs). */
export function matchKeyCandidates(input = {}) {
  const withYear = makeMatchKey(input);
  const bare = makeMatchKey({ ...input, year: '' });
  return withYear === bare ? [withYear] : [withYear, bare];
}

/**
 * Parse a user-typed match input:
 *   TMDB url   https://www.themoviedb.org/movie/1132687-coolie
 *              https://www.themoviedb.org/tv/114574
 *   IMDb url   https://www.imdb.com/title/tt0133093/
 *   bare ids   1132687 | tv:114574 | movie:550 | tt0133093
 * Returns { kind:'tmdb', id:Number, mediaType:'movie'|'tv'|null } or
 *         { kind:'imdb', id:'tt...' } or null.
 */
export function parseMatchQuery(value = '', defaultType = 'movie') {
  const text = String(value || '').trim();
  if (!text) return null;

  const tmdbUrl = text.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (tmdbUrl) return { kind: 'tmdb', mediaType: tmdbUrl[1].toLowerCase(), id: Number(tmdbUrl[2]) };

  const imdbUrl = text.match(/imdb\.com\/(?:[a-z]{2}\/)?title\/(tt\d{4,10})/i);
  if (imdbUrl) return { kind: 'imdb', id: imdbUrl[1].toLowerCase() };

  const bareImdb = text.match(/^(tt\d{4,10})$/i);
  if (bareImdb) return { kind: 'imdb', id: bareImdb[1].toLowerCase() };

  const typed = text.match(/^(movie|film|tv|series|show)\s*[:#/-]\s*(\d{1,9})$/i);
  if (typed) {
    const mediaType = /movie|film/i.test(typed[1]) ? 'movie' : 'tv';
    return { kind: 'tmdb', mediaType, id: Number(typed[2]) };
  }

  if (/^\d{1,9}$/.test(text)) {
    return {
      kind: 'tmdb',
      mediaType: normalizeMatchType(defaultType) === 'series' ? 'tv' : 'movie',
      id: Number(text),
    };
  }

  return null;
}

const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500';

export function mapMovieDetail(doc = {}) {
  return {
    tmdbId: Number(doc.id) || 0,
    tmdbType: 'movie',
    title: doc.title || doc.original_title || '',
    tmdbYear: String(doc.release_date || '').slice(0, 4),
    posterUrl: doc.poster_path ? `${TMDB_IMAGE_BASE_URL}${doc.poster_path}` : '',
    synopsis: doc.overview || '',
    rating: Number(doc.vote_average) || 0,
  };
}

export function mapTvDetail(doc = {}) {
  return {
    tmdbId: Number(doc.id) || 0,
    tmdbType: 'tv',
    title: doc.name || doc.original_name || '',
    tmdbYear: String(doc.first_air_date || '').slice(0, 4),
    posterUrl: doc.poster_path ? `${TMDB_IMAGE_BASE_URL}${doc.poster_path}` : '',
    synopsis: doc.overview || '',
    rating: Number(doc.vote_average) || 0,
  };
}

/**
 * Overlay stored manual matches onto tamilmv catalog items. Matched items
 * gain a TMDB identity: they become plain deep-links to /watch/{type}/{tmdbId}
 * and inherit the TMDB title/poster/year ("metadata fixed with the poster").
 */
export function applyMatchesToItems(items = [], docs = []) {
  if (!items.length || !docs.length) return items;

  const byKey = new Map();
  for (const doc of docs) {
    if (!doc?.tmdbId) continue;
    const slug = doc.titleSlug || normalizeMatchTitle(doc.sourceTitle || '');
    if (!slug) continue;
    const type = normalizeMatchType(doc.type);
    byKey.set(`${type}|${slug}|`, doc);
    const scrapedYear = extractYear(doc.scrapedYear || doc.year || '');
    if (scrapedYear) byKey.set(`${type}|${slug}|${scrapedYear}`, doc);
    if (doc.key) byKey.set(doc.key, doc);
  }

  return items.map((item) => {
    if (item?.tmdbId) return item;
    const candidates = matchKeyCandidates({ type: item.type || item.group, title: item.title, year: item.year || '' });
    let doc = null;
    for (const key of candidates) {
      if (byKey.has(key)) { doc = byKey.get(key); break; }
    }
    if (!doc) return item;

    const type = doc.tmdbType === 'tv' ? 'series' : 'movie';
    return {
      ...item,
      id: `tamilmv-${type}-${doc.tmdbId}`,
      tmdbId: doc.tmdbId,
      type,
      title: doc.title || item.title,
      year: doc.tmdbYear || item.year || '',
      posterUrl: doc.posterUrl || item.posterUrl || '',
      synopsis: doc.synopsis || item.synopsis || '',
      matchedBy: 'manual',
    };
  });
}
