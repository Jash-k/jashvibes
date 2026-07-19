import * as cheerio from 'cheerio';
import { fetchTMDB, mapTMDBMovie, mapTMDBSeries } from '@/lib/tmdb';

const DEFAULT_BASE_URL = 'https://www.1tamilmv.report/';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getBaseUrl() {
  return (process.env.TAMILMV || process.env.TAMILMV_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '/') || DEFAULT_BASE_URL;
}

function absoluteUrl(url, baseUrl = getBaseUrl()) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url || '';
  }
}

function normalizeWhitespace(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function getLinkText($, el) {
  let text = normalizeWhitespace($(el).text());

  // Some forum topic anchors only contain quality text like [1080p].
  // The release title can be in sibling text before the link.
  if (text.startsWith('[')) {
    let prev = el.prev;
    let prevText = '';
    while (prev && prev.name !== 'br') {
      if (prev.type === 'text') prevText = prev.data + prevText;
      else if (prev.type === 'tag') prevText = $(prev).text() + prevText;
      prev = prev.prev;
    }
    text = normalizeWhitespace(`${prevText} ${text}`);
  }

  return text;
}

function qualityRank(text = '') {
  const l = text.toLowerCase();
  if (l.includes('bluray') || l.includes('blu-ray')) return 6;
  if (l.includes('uhd') || l.includes('4k') || l.includes('2160p')) return 5;
  if (l.includes('1080p')) return 4;
  if (l.includes('720p')) return 3;
  if (l.includes('web-dl') || l.includes('web dl') || l.includes('webhd') || /\bhd\b/.test(l)) return 2;
  return 1;
}

function detectCategory(text = '') {
  const value = text.toLowerCase();

  const isTvShow = /\b(tv\s*show|tvshow|show|reality|serial)\b/i.test(value);
  const isSeries = /\b(web\s*series|series|season\s*\d+|s\d{1,2}\s*(e\d{1,3})?|episode\s*\d+|ep\s*\d+)\b/i.test(value);

  if (isTvShow) return 'tvshows';
  if (isSeries) return 'series';
  return 'movies';
}

function detectLanguage(text = '') {
  const value = text.toLowerCase();
  if (/\btamil\b|\btam\b/.test(value)) return 'Tamil';
  if (/\bmalayalam\b|\bmal\b/.test(value)) return 'Malayalam';
  if (/\btelugu\b|\btel\b/.test(value)) return 'Telugu';
  if (/\bhindi\b|\bhin\b/.test(value)) return 'Hindi';
  if (/\benglish\b|\beng\b/.test(value)) return 'English';
  return 'Tamil';
}

function titleCaseSlug(slug = '') {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractSlugText(url = '') {
  try {
    const parsed = new URL(url, getBaseUrl());
    const topicMatch = decodeURIComponent(parsed.pathname + parsed.search).match(/\/topic\/\d+-([^/?#]+)/i);
    if (!topicMatch?.[1]) return '';
    return titleCaseSlug(topicMatch[1]);
  } catch {
    const topicMatch = String(url).match(/\/topic\/\d+-([^/?#]+)/i);
    return topicMatch?.[1] ? titleCaseSlug(topicMatch[1]) : '';
  }
}

function stripReleaseNoise(value = '') {
  return normalizeWhitespace(
    value
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/^\/index\.php\?\/forums\/topic\/\d+\s*/i, '')
      .replace(/^S\.Saraswathi\s*[-:]?\s*/i, '')
      .replace(/\s+\/index\.php.*$/i, '')
  );
}

function parseReleaseMetadata(text = '', url = '') {
  // Prefer visible title because it keeps punctuation/casing. If the visible link
  // is only quality text, fall back to the decoded topic slug.
  const visible = stripReleaseNoise(String(text).split('/index.php?')[0]);
  const slugText = stripReleaseNoise(extractSlugText(url));
  let source = visible && !visible.startsWith('[') && /(19\d{2}|20\d{2})/.test(visible)
    ? visible
    : slugText || visible || text;

  source = stripReleaseNoise(source)
    .replace(/^(Tamil|Malayalam|Telugu|Hindi|English|Multi Audio|HQ|ORG)\s*[-:]\s*/i, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const yearMatch = source.match(/^(.*?)\s*(?:\((19\d{2}|20\d{2})\)|\b(19\d{2}|20\d{2})\b)/i);
  let title = yearMatch?.[1] || source;
  const year = yearMatch ? Number(yearMatch[2] || yearMatch[3]) : null;

  const seasonMatch = source.match(/\bS(?:eason)?\s*0*(\d{1,2})\b/i);
  const episodeRangeMatch = source.match(/\b(?:EP|E|Episode)\s*\(?\s*0*(\d{1,3})(?:\s*[-–]\s*0*(\d{1,3}))?\s*\)?/i);
  const compactMatch = source.match(/\bS0*(\d{1,2})\s*E0*(\d{1,3})\b/i);

  const season = compactMatch ? Number(compactMatch[1]) : seasonMatch ? Number(seasonMatch[1]) : null;
  const episode = compactMatch ? Number(compactMatch[2]) : episodeRangeMatch ? Number(episodeRangeMatch[1]) : null;
  const episodeEnd = episodeRangeMatch?.[2] ? Number(episodeRangeMatch[2]) : null;

  title = title
    .replace(/\b(TRUE|HQ|HD|UHD|WEB.?DL|BLURAY|PREDVD|ESUB|ORG|AUDS?|ORIGINAL|AUDIO|AAC|AVC|HEVC|X264|X265)\b.*$/i, '')
    .replace(/\b(TAMIL|TELUGU|HINDI|MALAYALAM|KANNADA|ENGLISH|TAM|TEL|HIN|MAL|KAN|ENG|CHI)\b.*$/i, '')
    .replace(/\bS\d{1,2}\b.*$/i, '')
    .replace(/\bEP\b.*$/i, '')
    .replace(/\s+[-–]+\s*$/g, '')
    .trim();

  return {
    title: normalizeWhitespace(title || 'Unknown Title').slice(0, 120),
    year,
    season,
    episode,
    episodeEnd,
    parsedSource: source,
  };
}

function cleanTitle(text = '', url = '') {
  return parseReleaseMetadata(text, url).title;
}

function extractYear(text = '', url = '') {
  const parsed = parseReleaseMetadata(text, url);
  if (parsed.year) return parsed.year;
  const match = text.match(/\((20\d{2}|19\d{2})\)|\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1] || match[2]) : null;
}

function isWantedRelease(text = '') {
  if (!text || text.length < 8) return false;
  if (/pre[-\s]?dvd|camrip|hdcam|telesync|xbet/i.test(text)) return false;
  return /(tamil|tam|malayalam|mal|telugu|tel|hindi|hin|web\s*series|series|season|episode|s\d{1,2}e\d{1,3}|tv\s*show|tvshow)/i.test(text);
}

function normalizeThreadUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, getBaseUrl());
    if (/(^|\.)1tamilmv\.[a-z]+$/i.test(parsed.hostname)) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function extractTopReleaseTopics($, baseUrl) {
  const topReleases = new Map();

  $('.banger-container').each((_, container) => {
    const containerText = normalizeWhitespace($(container).text()).toLowerCase();
    if (!containerText.includes('top releases this week')) return;

    let order = 0;
    $(container).find('a[href*="/topic/"]').each((__, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const threadUrl = absoluteUrl(href, baseUrl);
      const key = normalizeThreadUrl(threadUrl) || threadUrl;
      if (topReleases.has(key)) return;

      topReleases.set(key, {
        order,
        text: getLinkText($, el),
      });
      order += 1;
    });
  });

  return topReleases;
}

function pickPosterFromHtml(html, detailUrl) {
  const $ = cheerio.load(html);
  const candidates = [];

  $('img').each((_, img) => {
    const src = $(img).attr('src') || $(img).attr('data-src') || '';
    if (!src) return;

    let imgUrl;
    let parsed;
    try {
      imgUrl = new URL(src.replace(/&amp;/g, '&'), detailUrl).toString();
      parsed = new URL(imgUrl);
    } catch {
      return;
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isForumHost = /(^|\.)1tamilmv\.[a-z]+$/.test(host);
    const isForumUpload = isForumHost && path.startsWith('/uploads/');
    const isPixelbb = host === 'www.pixelbb.com' && path.startsWith('/images/');
    const ratio = parseFloat($(img).attr('data-ratio') || '0');
    const isPortrait = ratio > 80;

    const bad =
      imgUrl.includes('googletagmanager') ||
      imgUrl.includes('i2symbol') ||
      imgUrl.includes('istockphoto') ||
      imgUrl.includes('pinimg.com') ||
      imgUrl.includes('freepik.com') ||
      imgUrl.includes('tenor.com') ||
      imgUrl.includes('giphy.com') ||
      path.includes('/set_resources_') ||
      path.includes('/logo.png') ||
      path.includes('/emoticons/') ||
      path.includes('/reactions/') ||
      path.includes('.thumb.') ||
      path.endsWith('.svg') ||
      path.endsWith('.gif') ||
      path.includes('vlcsnap') ||
      path.includes('utorrent');

    if (bad) return;
    if (isForumHost && !isForumUpload) return;

    let score = 0;
    if (isPixelbb) score += 4;
    if (isForumUpload) score += 3;
    if (isPortrait) score += 2;
    if (!isForumHost) score += 1;

    if (score > 0) candidates.push({ url: isPixelbb ? imgUrl.replace('.md.', '.') : imgUrl, score });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || '';
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.8',
    },
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`TamilMV returned ${response.status}`);
  return response.text();
}

function normalizeTitleForSearch(title = '') {
  return normalizeWhitespace(
    title
      .replace(/\.{3,}$/g, '')
      .replace(/\b(TRUE|HQ|HD|UHD|WEB.?DL|BLURAY|PREDVD|ESUB|ORG|AUDS?)\b/gi, '')
      .replace(/\b(TAMIL|TELUGU|HINDI|MALAYALAM|KANNADA|ENGLISH|TAM|TEL|HIN|MAL|KAN|ENG)\b/gi, '')
      .replace(/\s+/g, ' ')
  );
}

function getManualTMDBOverride(item) {
  const title = normalizeTitleForSearch(item.title).toLowerCase();
  const type = item.group === 'series' || item.group === 'tvshows' ? 'tv' : 'movie';

  const defaults = {
    'cooku with comali': { id: 114574, type: 'tv' },
    'house of the dragon': { id: 94997, type: 'tv' },
    'house of dragon': { id: 94997, type: 'tv' },
    'mammattiyaan stars': { imdbId: 'tt43609065', type: 'tv' },
    'mammatiyaan stars': { imdbId: 'tt43609065', type: 'tv' },
  };

  const envMap = (process.env.OVERRIDES || process.env.TAMILMV_TMDB_OVERRIDES || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const [name, idType] = pair.split(':');
      const [id, overrideType = type] = String(idType || '').split('|');
      if (name && id) {
        acc[name.trim().toLowerCase()] = id.startsWith('tt')
          ? { imdbId: id, type: overrideType }
          : { id: Number(id), type: overrideType };
      }
      return acc;
    }, {});

  const exact = envMap[title] || defaults[title];
  if (exact) return exact;

  // Loose aliases for TamilMV spelling variations. This catches entries like
  // “House of The Dragon” even when year/season in the release name differs
  // from TMDB's original first-air year.
  if (title.includes('house') && title.includes('dragon')) return { id: 94997, type: 'tv' };
  if (title.includes('cooku') && title.includes('comali')) return { id: 114574, type: 'tv' };
  if ((title.includes('mammattiyaan') || title.includes('mammatiyaan')) && title.includes('stars')) {
    return { imdbId: 'tt43609065', type: 'tv' };
  }

  return null;
}

async function matchTamilMVItemToTMDB(item) {
  let mediaType = item.group === 'series' || item.group === 'tvshows' ? 'tv' : 'movie';
  const query = normalizeTitleForSearch(item.title);
  if (!query || query === 'Unknown Title') return item;

  try {
    const override = getManualTMDBOverride(item);
    if (override?.id || override?.imdbId) {
      mediaType = override.type === 'movie' ? 'movie' : 'tv';
      let tmdbOverrideId = override.id;

      if (!tmdbOverrideId && override.imdbId) {
        const findPayload = await fetchTMDB(`/find/${override.imdbId}`, {
          external_source: 'imdb_id',
          language: 'en-IN',
        });
        const found = mediaType === 'tv'
          ? findPayload.tv_results?.[0]
          : findPayload.movie_results?.[0];
        tmdbOverrideId = found?.id;
      }

      if (!tmdbOverrideId) return { ...item, tmdbMatched: false, tmdbQuery: query, imdbId: override.imdbId || '' };

      const details = await fetchTMDB(mediaType === 'tv' ? `/tv/${tmdbOverrideId}` : `/movie/${tmdbOverrideId}`, {
        language: 'en-IN',
      });
      const mapped = mediaType === 'tv' ? mapTMDBSeries(details) : mapTMDBMovie(details);
      return {
        ...item,
        id: `tamilmv-${mapped.type}-${mapped.tmdbId}`,
        tmdbId: mapped.tmdbId,
        type: mapped.type,
        title: mapped.title || item.title,
        originalTitle: mapped.originalTitle || item.title,
        posterUrl: mapped.posterUrl || item.posterUrl || '',
        backdropUrl: mapped.backdropUrl || '',
        synopsis: mapped.synopsis || item.synopsis,
        releaseDate: mapped.releaseDate || item.releaseDate,
        rating: mapped.rating || 0,
        language: mapped.language || item.category,
        tmdbMatched: true,
        tmdbOverride: true,
        tmdbQuery: query,
        scrapedTitle: item.title,
      };
    }

    const firstPayload = await fetchTMDB(mediaType === 'tv' ? '/search/tv' : '/search/movie', {
      query,
      include_adult: 'false',
      language: 'en-IN',
      page: 1,
      ...(item.year && mediaType === 'movie' ? { year: item.year } : {}),
      ...(item.year && mediaType === 'tv' ? { first_air_date_year: item.year } : {}),
    });

    let candidates = firstPayload.results || [];

    // Many TamilMV TV releases use current release year for dubbed/new season
    // uploads, but TMDB search year expects the show's original first-air year.
    // If year-filtered TV search returns no result, retry without year.
    if (candidates.length === 0 && mediaType === 'tv' && item.year) {
      const retryPayload = await fetchTMDB('/search/tv', {
        query,
        include_adult: 'false',
        language: 'en-IN',
        page: 1,
      });
      candidates = retryPayload.results || [];
    }
    const withPoster = candidates.filter((candidate) => candidate.poster_path);
    const pool = withPoster.length ? withPoster : candidates;
    const preferred = pool.find((candidate) => {
      const candidateYear = mediaType === 'tv'
        ? String(candidate.first_air_date || '').slice(0, 4)
        : String(candidate.release_date || '').slice(0, 4);
      return !item.year || candidateYear === String(item.year);
    }) || pool[0];

    if (!preferred?.id) return { ...item, tmdbMatched: false, tmdbQuery: query };

    let mapped = mediaType === 'tv' ? mapTMDBSeries(preferred) : mapTMDBMovie(preferred);

    // Search results sometimes omit poster/overview. Fetch details once for matched items.
    if (!mapped.posterUrl || !mapped.synopsis) {
      try {
        const details = await fetchTMDB(mediaType === 'tv' ? `/tv/${preferred.id}` : `/movie/${preferred.id}`, {
          language: 'en-IN',
        });
        mapped = mediaType === 'tv' ? mapTMDBSeries(details) : mapTMDBMovie(details);
      } catch {}
    }

    return {
      ...item,
      id: `tamilmv-${mapped.type}-${mapped.tmdbId}`,
      tmdbId: mapped.tmdbId,
      type: mapped.type,
      title: mapped.title || item.title,
      originalTitle: mapped.originalTitle || item.title,
      posterUrl: mapped.posterUrl || item.posterUrl || '',
      backdropUrl: mapped.backdropUrl || '',
      synopsis: mapped.synopsis || item.synopsis,
      releaseDate: mapped.releaseDate || item.releaseDate,
      rating: mapped.rating || 0,
      language: mapped.language || item.category,
      tmdbMatched: true,
      tmdbQuery: query,
      scrapedTitle: item.title,
    };
  } catch (error) {
    return { ...item, tmdbMatched: false, tmdbQuery: query, tmdbError: error.message };
  }
}

async function matchTamilMVItemsToTMDB(items) {
  const matched = [];
  for (const item of items) {
    matched.push(await matchTamilMVItemToTMDB(item));
  }
  return matched;
}

async function fetchPosters(items, { maxPosterFetches = 8, delayMs = 1200 } = {}) {
  let fetched = 0;

  for (const item of items) {
    if (!item.threadUrl || fetched >= maxPosterFetches) continue;

    try {
      const html = await fetchHtml(item.threadUrl);
      item.posterUrl = pickPosterFromHtml(html, item.threadUrl);
      fetched += 1;
      if (fetched < maxPosterFetches && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } catch {
      fetched += 1;
    }
  }

  return items;
}

export async function scrapeTamilMV({ fetchPostersEnabled = false, maxPosterFetches = 8, limitPerType = 15, matchTMDB = true, includeTvShows = true } = {}) {
  const baseUrl = getBaseUrl();
  const html = await fetchHtml(baseUrl);
  const $ = cheerio.load(html);
  const byKey = new Map();
  const topReleaseTopics = extractTopReleaseTopics($, baseUrl);

  $('a').each((_, el) => {
    const href = $(el).attr('href');
    const text = getLinkText($, el);

    if (!href || !text) return;

    let threadUrl = absoluteUrl(href, baseUrl);
    const hrefPath = (() => {
      try {
        const parsed = new URL(threadUrl);
        return `${parsed.pathname}${parsed.search}`;
      } catch {
        return href;
      }
    })();

    if (!hrefPath.includes('/topic/')) return;

    const threadKey = normalizeThreadUrl(threadUrl) || threadUrl;
    const topRelease = topReleaseTopics.get(threadKey);
    const isTopRelease = Boolean(topRelease);

    // Many TamilMV homepage links show only quality text like
    // "[1080p & 720p ...]" while the real title/language is in the topic URL.
    // Use both the visible text and decoded URL slug for filtering/parsing.
    const decodedHrefText = decodeURIComponent(hrefPath).replace(/[-_]+/g, ' ');
    const releaseText = normalizeWhitespace(`${text} ${decodedHrefText}`);

    // Top Releases are intentionally allowed through even when they include
    // noisy terms such as HQ PreDVD, because the user wants that homepage block
    // pinned first as catalogue metadata.
    if (!isTopRelease && !isWantedRelease(releaseText)) return;

    const parsed = parseReleaseMetadata(releaseText, threadUrl);
    const title = parsed.title;
    const year = parsed.year || extractYear(releaseText, threadUrl);
    const group = detectCategory(releaseText);
    const language = detectLanguage(releaseText);
    const key = `${group}:${title.toLowerCase()}:${year || ''}:s${parsed.season || ''}:e${parsed.episode || ''}`;

    const item = {
      id: threadKey,
      title,
      rawTitle: releaseText,
      type: group === 'movies' ? 'movie' : group === 'series' ? 'series' : 'other',
      group,
      category: language,
      year,
      season: parsed.season,
      episode: parsed.episode,
      episodeEnd: parsed.episodeEnd,
      releaseDate: year ? `${year}-01-01` : '',
      synopsis: releaseText,
      posterUrl: '',
      threadUrl,
      sourceDomain: baseUrl,
      parsedSource: parsed.parsedSource,
      quality: qualityRank(releaseText),
      isTopRelease,
      topReleaseOrder: topRelease?.order ?? null,
      section: isTopRelease ? 'TOP RELEASES THIS WEEK' : 'Latest Listings',
      scrapedAt: new Date().toISOString(),
    };

    const existing = byKey.get(key);
    if (
      !existing ||
      (item.isTopRelease && !existing.isTopRelease) ||
      (item.isTopRelease === existing.isTopRelease && item.quality > existing.quality)
    ) {
      byKey.set(key, item);
    }
  });

  const items = Array.from(byKey.values()).sort((a, b) => {
    if (a.isTopRelease !== b.isTopRelease) return a.isTopRelease ? -1 : 1;
    if (a.isTopRelease && b.isTopRelease) {
      return (a.topReleaseOrder ?? 9999) - (b.topReleaseOrder ?? 9999);
    }
    return (b.year || 0) - (a.year || 0);
  });

  if (fetchPostersEnabled) {
    await fetchPosters(items, { maxPosterFetches });
  }

  let movies = items.filter((item) => item.group === 'movies').slice(0, limitPerType);
  let series = items.filter((item) => item.group === 'series').slice(0, limitPerType);
  let tvshows = includeTvShows ? items.filter((item) => item.group === 'tvshows').slice(0, limitPerType) : [];

  if (matchTMDB) {
    movies = await matchTamilMVItemsToTMDB(movies);
    series = await matchTamilMVItemsToTMDB(series);
    if (includeTvShows) tvshows = await matchTamilMVItemsToTMDB(tvshows);
  }

  const limitedItems = [...movies, ...series, ...tvshows];

  return {
    updatedAt: new Date().toISOString(),
    source: baseUrl,
    count: limitedItems.length,
    totalFound: items.length,
    limitPerType,
    movies,
    series,
    tvshows,
    items: limitedItems,
  };
}
