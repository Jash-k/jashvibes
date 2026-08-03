import { fetchTMDB, mapTMDBMovie } from '@/lib/tmdb';

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeHttpUrl(value = '') {
  const raw = normalizeWhitespace(value);
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

export function normalizeTitle(value = '') {
  return normalizeWhitespace(
    String(value || '')
      .toLowerCase()
      .replace(/&amp;/g, '&')
      .replace(/[^a-z0-9\u0B80-\u0BFF]+/g, ' '),
  );
}

function slugify(value = '') {
  return normalizeTitle(value).replace(/\s+/g, '-') || 'untitled';
}

function parseAttrs(value = '') {
  const attrs = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(value)) !== null) attrs[match[1]] = match[2];
  return attrs;
}

function detectQuality(value = '') {
  const text = String(value).toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(text)) return '4K';
  if (/1080p/.test(text)) return '1080p';
  if (/720p/.test(text)) return '720p';
  if (/480p|480x/.test(text)) return '480p';
  if (/360p|360x/.test(text)) return '360p';
  return 'Auto';
}

function detectFormat(url = '') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('/hls/')) return 'hls';
  if (lower.includes('.mpd') || lower.includes('/dash/') || lower.includes('manifest.mpd')) return 'dash';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(lower)) return 'video';
  return 'unknown';
}

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function base64UrlToHex(value = '') {
  try {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return Buffer.from(padded, 'base64').toString('hex').toLowerCase();
  } catch {
    return '';
  }
}

function applyLicenseKey(pending, value = '') {
  const raw = String(value || '').trim().replace(/^"|"$/g, '');
  if (!raw) return;

  // JSON ClearKey/JWKS format: {"keys":[{"kid":"...","k":"..."}]}
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      const firstKey = parsed?.keys?.[0];
      const kid = cleanHex(firstKey?.kid) || base64UrlToHex(firstKey?.kid);
      const key = cleanHex(firstKey?.k) || base64UrlToHex(firstKey?.k);
      if (kid && key) {
        pending.keyId = kid;
        pending.key = key;
        pending.licenseKey = `${kid}:${key}`;
        pending.licenseType = pending.licenseType || 'org.w3.clearkey';
        return;
      }
    } catch {}
  }

  // Most Kodi/IPTV ClearKey lines are: keyId:key
  if (raw.includes(':') && !/^https?:\/\//i.test(raw)) {
    const [keyId, key] = raw.split(':');
    const cleanKeyId = cleanHex(keyId);
    const cleanKey = cleanHex(key);
    if (cleanKeyId && cleanKey) {
      pending.keyId = cleanKeyId;
      pending.key = cleanKey;
      pending.licenseKey = `${cleanKeyId}:${cleanKey}`;
      pending.licenseType = pending.licenseType || 'org.w3.clearkey';
      return;
    }
  }

  pending.licenseKey = raw;
}

function parseHeaderPairs(value = '') {
  const headers = {};
  String(value || '')
    .replace(/^"|"$/g, '')
    .split('&')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [key, ...rest] = part.split('=');
      const val = rest.join('=');
      if (key && val) headers[key.trim()] = decodeURIComponent(val.trim());
    });
  return headers;
}

function applyKodiProp(pending, line = '') {
  const withoutPrefix = line.replace(/^#(?:KODIPROP|EXTVLCOPT):/i, '');
  const eq = withoutPrefix.indexOf('=');
  const prop = (eq >= 0 ? withoutPrefix.slice(0, eq) : withoutPrefix).trim().toLowerCase();
  const value = eq >= 0 ? withoutPrefix.slice(eq + 1).trim().replace(/^"|"$/g, '') : '';
  if (!value) return;

  if (prop.includes('license_type')) {
    pending.licenseType = value;
    return;
  }

  if (prop.includes('license_key')) {
    applyLicenseKey(pending, value);
    return;
  }

  if (prop.includes('manifest_headers') || prop.includes('stream_headers')) {
    pending.headers = { ...(pending.headers || {}), ...parseHeaderPairs(value) };
    if (pending.headers['User-Agent']) pending.userAgent = pending.headers['User-Agent'];
    if (pending.headers.Referer) pending.referer = pending.headers.Referer;
    return;
  }

  if (prop.includes('user_agent') || prop.includes('http-user-agent') || prop.includes('user-agent')) {
    pending.userAgent = value.includes('User-Agent=') ? value.split('User-Agent=').pop() : value;
    return;
  }

  if (prop.includes('referer') || prop.includes('http-referrer')) {
    pending.referer = value.includes('Referer=') ? value.split('Referer=').pop() : value;
  }
}

function stripNoise(value = '') {
  return normalizeWhitespace(
    String(value || '')
      .replace(/&amp;/g, '&')
      .replace(/\.(m3u8|mp4|mkv|avi|webm)$/i, '')
      .replace(/\b(2160p|1080p|720p|480p|360p|4k|uhd|fhd|hd|sd)\b/gi, ' ')
      .replace(/\b(web.?dl|hdrip|bluray|bdrip|dvdrip|hevc|x264|x265|avc|aac|ddp?5\.1|esub|proper|original|hq)\b/gi, ' ')
      .replace(/\b(tamil|tam|telugu|hindi|malayalam|kannada|multi audio|dual audio|audio)\b/gi, ' ')
      .replace(/\b(erosnow|eros now|aha|vod|movie|movies)\b/gi, ' ')
      .replace(/\b\d+(?:\.\d+)?\s*(gb|mb)\b/gi, ' ')
      .replace(/[._-]+/g, ' '),
  );
}

function parseTitleYear(rawTitle = '') {
  const raw = normalizeWhitespace(rawTitle).replace(/\[[^\]]*\]/g, ' ');
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  let title = raw;

  if (yearMatch) title = raw.slice(0, yearMatch.index);
  title = stripNoise(title);

  if (!title || title.length < 2) {
    title = stripNoise(raw.replace(/\b(19\d{2}|20\d{2})\b/g, ' '));
  }

  return {
    title: normalizeWhitespace(title || rawTitle).slice(0, 160),
    year,
  };
}

const HARDCODED_VOD_SOURCES = [
  {
    label: 'Aha',
    url: 'https://raw.githubusercontent.com/Jash-k/old_Tamil/refs/heads/main/VOD_Aha.m3u',
  },
  {
    label: 'ErosNow',
    url: 'https://raw.githubusercontent.com/Jash-k/old_Tamil/refs/heads/main/VOD_ErosNow.m3u',
  },
];

function parseSourceEntry(entry = '', index = 0) {
  const raw = String(entry || '').trim();
  if (!raw) return null;
  const separator = raw.includes('|') ? '|' : raw.includes('=') ? '=' : '';
  let label = `Source ${index + 1}`;
  let urlValue = raw;

  if (separator) {
    const at = raw.indexOf(separator);
    label = raw.slice(0, at).trim() || label;
    urlValue = raw.slice(at + 1).trim();
  }

  const url = normalizeHttpUrl(urlValue);
  if (!url) return null;
  return { label: label.slice(0, 60), url };
}

export function getVodSources() {
  // Hardcoded stable Classics sources only. Render env VOD/VOD_AHA/VOD_EROS
  // is intentionally ignored so deleted placeholder env URLs cannot break sync.
  const sources = [...HARDCODED_VOD_SOURCES];

  const seen = new Set();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/x-mpegURL,text/plain,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-VOD/1.0)',
    },
  });
  if (!response.ok) throw new Error(`VOD source returned HTTP ${response.status}: ${url}`);
  return response.text();
}

export function parseM3U(text = '', sourceLabel = 'VOD') {
  const lines = String(text || '').split(/\r?\n/);
  const entries = [];
  let pending = null;
  let carriedProps = {};

  function buildEntry(url, data) {
    const parsed = parseTitleYear(data.rawTitle);
    const normalizedTitle = normalizeTitle(parsed.title);
    const quality = detectQuality(data.rawTitle);
    const format = detectFormat(url);
    const hasDrm = Boolean((data.keyId && data.key) || data.licenseKey);

    return {
      key: `${slugify(parsed.title)}:${parsed.year || ''}:movie`,
      title: parsed.title,
      normalizedTitle,
      type: 'movie',
      year: parsed.year,
      stream: {
        source: sourceLabel,
        label: `${sourceLabel}${quality !== 'Auto' ? ` • ${quality}` : ''}${hasDrm ? ' • DRM' : ''}`,
        url,
        quality,
        format,
        group: data.group,
        logo: normalizeHttpUrl(data.logo),
        rawTitle: data.rawTitle,
        keyId: data.keyId || '',
        key: data.key || '',
        licenseKey: data.licenseKey || '',
        licenseType: data.licenseType || '',
        userAgent: data.userAgent || '',
        referer: data.referer || '',
        headers: data.headers || {},
      },
    };
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const commaIndex = line.indexOf(',');
      const attrs = parseAttrs(commaIndex >= 0 ? line.slice(0, commaIndex) : line);
      const name = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : '';
      pending = {
        ...carriedProps,
        rawTitle: name || attrs['tvg-name'] || attrs['tvg-id'] || 'Untitled',
        logo: attrs['tvg-logo'] || carriedProps.logo || '',
        group: attrs['group-title'] || carriedProps.group || sourceLabel,
      };
      carriedProps = {};
      continue;
    }

    if (line.startsWith('#KODIPROP:') || line.startsWith('#EXTVLCOPT:')) {
      if (pending) {
        // Standard order: #EXTINF, then #KODIPROP, then URL.
        applyKodiProp(pending, line);
      } else {
        // Aha-style order seen in VOD_Aha.m3u:
        //   #EXTINF O Kadhal Kanmani
        //   O_Kadhal_URL
        //   #KODIPROP license_key for Uriyadi
        //   #EXTINF Uriyadi
        //   Uriyadi_URL
        //
        // So KODIPROP lines after a URL belong to the NEXT #EXTINF, not the
        // previous URL. Carry them forward to avoid attaching Movie B's key to
        // Movie A, which causes Shaka 3015/3016/4012 errors.
        applyKodiProp(carriedProps, line);
      }
      continue;
    }

    if (line.startsWith('#')) continue;
    const url = normalizeHttpUrl(line);
    if (!url || !pending) continue;

    entries.push(buildEntry(url, pending));
    pending = null;
  }

  return entries.filter((entry) => entry.title && entry.stream.url);
}

function scoreTMDBCandidate(candidate, title, year) {
  const target = normalizeTitle(title);
  const candidateTitle = normalizeTitle(candidate.title || candidate.original_title || '');
  const candidateYear = String(candidate.release_date || '').slice(0, 4);
  let score = 0;
  if (candidateTitle === target) score += 120;
  else if (candidateTitle.includes(target) || target.includes(candidateTitle)) score += 70;
  if (year && candidateYear === String(year)) score += 80;
  if (candidate.poster_path) score += 10;
  if (candidate.original_language === 'ta') score += 25;
  score += Math.min(Number(candidate.vote_count || 0) / 100, 15);
  return score;
}

export async function matchMovieToTMDB({ title, year }) {
  const query = normalizeWhitespace(title);
  if (!query) return null;

  const searchAttempts = [
    { query, include_adult: 'false', language: 'en-IN', page: 1, ...(year ? { year } : {}) },
    { query, include_adult: 'false', language: 'en-IN', page: 1 },
  ];

  let best = null;
  for (const params of searchAttempts) {
    const payload = await fetchTMDB('/search/movie', params);
    const candidates = payload.results || [];
    for (const candidate of candidates) {
      const score = scoreTMDBCandidate(candidate, title, year);
      if (!best || score > best.score) best = { candidate, score };
    }
    if (best?.score >= 150) break;
  }

  if (!best?.candidate?.id) return null;

  const details = await fetchTMDB(`/movie/${best.candidate.id}`, {
    language: 'en-IN',
  });
  const mapped = mapTMDBMovie(details);

  return {
    tmdbId: mapped.tmdbId,
    title: mapped.title,
    originalTitle: mapped.originalTitle,
    synopsis: mapped.synopsis,
    posterUrl: mapped.posterUrl,
    backdropUrl: mapped.backdropUrl,
    releaseDate: mapped.releaseDate ? new Date(mapped.releaseDate) : undefined,
    year: mapped.releaseDate ? Number(String(mapped.releaseDate).slice(0, 4)) : year,
    rating: Number(mapped.rating || 0),
    voteCount: Number(details.vote_count || 0),
    language: mapped.language || '',
    genres: (details.genres || []).map((genre) => genre.name).filter(Boolean),
  };
}

export async function fetchVodEntriesFromSources() {
  const sources = getVodSources();
  if (!sources.length) {
    throw new Error('No VOD sources configured. Add VOD, VOD_EROS, or VOD_AHA env variables.');
  }

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      try {
        const text = await fetchText(source.url);
        return parseM3U(text, source.label);
      } catch (error) {
        throw new Error(`${source.label}: ${error.message}`);
      }
    }),
  );

  const entries = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value);

  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason?.message || 'Unknown VOD source error');

  return { entries, sources, errors };
}

export async function runLimitedConcurrency(items, limit, worker) {
  const output = [];
  let index = 0;

  async function next() {
    const currentIndex = index;
    index += 1;
    if (currentIndex >= items.length) return;
    output[currentIndex] = await worker(items[currentIndex], currentIndex);
    await next();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next));
  return output;
}
