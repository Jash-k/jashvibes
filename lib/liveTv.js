const DEFAULT_SOURCES = [
  {
    id: 'jio-tamil',
    label: 'Jio Tamil',
    type: 'json',
    url: 'https://jtvxweb.pages.dev/jstr4web.json',
    trustTamil: false,
    priority: 0,
  },
  {
    id: 'binge-tamil',
    label: 'Binge Tamil',
    type: 'json',
    url: 'https://binge-giotv.pages.dev/data/id.json',
    trustTamil: false,
    priority: 1,
  },
  {
    id: 'streamlive-m3u',
    label: 'StreamLive Tamil',
    type: 'm3u',
    url: 'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamlive.m3u',
    trustTamil: false,
    priority: 2,
  },
  {
    id: 'streamlive-json',
    label: 'StreamLive JSON',
    type: 'json',
    url: 'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamlive.json',
    trustTamil: false,
    priority: 3,
  },
];

const POPULAR_TAMIL_RULES = [
  'star vijay hd',
  'star vijay',
  'sun tv hd',
  'sun tv',
  'zee tamil hd',
  'zee tamil',
  'ktv hd',
  'ktv',
  'vijay super hd',
  'vijay super',
  'vijay takkar',
  'sun music hd',
  'sun music',
  'jaya max',
  'jayamax',
  'raj musix',
  'raj music',
  'isaiaruvi',
  '7s music',
  'mega musiq',
  'murasu',
  'adithya tv',
  'jaya tv hd',
  'jaya tv',
  'kalaignar tv',
  'raj tv',
  'polimer news',
  'puthiya thalaimurai',
  'thanthi tv',
  'news18 tamil',
  'star sports 1 tamil hd',
  'star sports 2 tamil hd',
  'willow tv',
  'willow',
  'sky sports cricket',
  'skyspcricket',
  'ind vs',
  'india vs',
  'sony yay tamil',
  'chutti tv',
  'wow kidz tamil',
];

const CACHE_TTL_MS = 60 * 60 * 1000;
const JIO_COOKIE_TTL_MS = 20 * 60 * 1000;
const cache = globalThis.__jashLiveTvCache || { key: '', loadedAt: 0, channels: null };
const jioCookieCache = globalThis.__jashJioCookieCache || { value: '', loadedAt: 0 };
globalThis.__jashLiveTvCache = cache;
globalThis.__jashJioCookieCache = jioCookieCache;

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

function slugify(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'channel';
}

function detectFormat(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('.m3u8')) return 'hls';
  if (lower.includes('.mpd')) return 'dash';
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(lower)) return 'video';
  if (lower.includes('/hls/') || lower.includes('playlist')) return 'hls';
  return 'unknown';
}

function parseAttrs(value = '') {
  const attrs = {};
  const regex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function cleanChannelName(value = '') {
  return normalizeWhitespace(value)
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\s+\[(?:Tata Play|OTTLive|YuppTV|DistroTV|Phoenix|Cloud7)\]$/i, '')
    .trim();
}

function isJioChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.url || ''} ${channel.logo || ''} ${channel.source || ''}`.toLowerCase();
  return text.includes('jio') || text.includes('jiotv');
}

function isStarSportsChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.url || ''}`.toLowerCase();
  return text.includes('star sports') || text.includes('star_sports') || text.includes('starsports');
}

function hasBlockedRegionalLanguage(text = '') {
  const value = String(text || '').toLowerCase();
  const allowedLanguage = /\b(tamil|english|eng)\b/.test(value);
  const blocked = /\b(hindi|telugu|kannada|malayalam|bangla|bengali|marathi|gujarati|urdu|arabic|spanish|odia|punjabi|bhojpuri)\b/.test(value);
  return blocked && !allowedLanguage;
}

function isPreferredCricketChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  if (hasBlockedRegionalLanguage(text)) return false;

  return (
    text.includes('willow') ||
    text.includes('sky sports cricket') ||
    text.includes('skyspcricket') ||
    text.includes('star sports 1 tamil') ||
    text.includes('star sports 2 tamil') ||
    /\b(ind|india)\s*(vs|v\.?|versus)\b/.test(text) ||
    /\b(vs|v\.?|versus)\s*(ind|india)\b/.test(text)
  );
}


function isTamilMusicChannelText(text = '') {
  const value = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return (
    /\bsun\s*music\b/.test(value) ||
    /\bjaya\s*max\b/.test(value) ||
    /\bjayamax\b/.test(value) ||
    /\braj\s*musix\b/.test(value) ||
    /\braj\s*music\b/.test(value) ||
    /\bisai\s*aruvi\b/.test(value) ||
    /\bisaiaruvi\b/.test(value) ||
    /\b7s\s*music\b/.test(value) ||
    /\bmega\s*musiq\b/.test(value) ||
    /\btamil\s*music\b/.test(value) ||
    /\bmurasu\b/.test(value)
  );
}


function isTamilChannel(channel, source = {}) {
  if (source.trustTamil) return true;
  if (isPreferredCricketChannel(channel)) return true;

  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  return (
    text.includes('tamil') ||
    text.includes('tam ') ||
    text.includes(' tamil') ||
    text.includes('sun tv') ||
    text.includes('star vijay') ||
    text.includes('vijay tv') ||
    text.includes('zee tamil') ||
    text.includes('jaya tv') ||
    text.includes('kalaignar') ||
    text.includes('polimer') ||
    text.includes('puthiyathalaimurai') ||
    text.includes('thanthi') ||
    text.includes('news18 tamil') ||
    text.includes('adithya') ||
    text.includes('sun music') ||
    text.includes('jaya max') ||
    text.includes('jayamax') ||
    text.includes('raj musix') ||
    text.includes('raj music') ||
    text.includes('isaiaruvi') ||
    text.includes('7s music') ||
    text.includes('mega musiq') ||
    text.includes('sirippoli') ||
    text.includes('chithiram') ||
    text.includes('murasu') ||
    text.includes('isaiaruvi') ||
    text.includes('raj tv') ||
    text.includes('roja')
  );
}

function mapChannel(raw, source, index = 0) {
  const url = normalizeHttpUrl(raw.url || raw.streamUrl || raw.link || raw.href || '');
  if (!url) return null;

  const name = cleanChannelName(raw.name || raw.title || raw.channel || `Channel ${index + 1}`);
  const format = detectFormat(url);
  let category = normalizeWhitespace(raw.category || raw.group || raw.groupTitle || raw['group-title'] || 'Tamil');
  const language = normalizeWhitespace(raw.language || raw['tvg-language'] || (source.trustTamil ? 'Tamil' : ''));
  const region = normalizeWhitespace(raw.region || raw['tvg-region'] || '');
  if (isTamilMusicChannelText(`${name} ${category} ${language} ${region}`)) category = 'Music';

  return {
    id: `${source.id}-${raw.id || raw.tvgId || slugify(name)}-${index}`,
    tvgId: String(raw.id || raw.tvgId || raw['tvg-id'] || ''),
    name,
    url,
    logo: normalizeHttpUrl(raw.logo || raw.tvgLogo || raw['tvg-logo'] || ''),
    category,
    language,
    region,
    sourceId: source.id,
    source: source.label,
    format,
    keyId: raw.keyId || raw.key_id || raw.kid || raw.keyid || '',
    key: raw.key || raw.key_val || raw.keyValue || raw.key_value || '',
    licenseKey: raw.licenseKey || raw.license_key || raw.license || raw.licenseUrl || raw.license_url || '',
    cookie: raw.cookie || raw.cookies || '',
    userAgent: raw.userAgent || raw.user_agent || raw.ua || '',
    referer: raw.referer || raw.referrer || raw.origin || '',
    playable: format === 'hls' || format === 'dash' || format === 'video',
    priority: source.priority ?? 99,
  };
}

function applyM3UProperty(target, line) {
  if (!target) return;
  const lower = line.toLowerCase();
  const value = line.includes('=') ? line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '').trim() : '';

  if (lower.includes('license_key') && value) {
    if (value.includes(':')) {
      const [keyId, key] = value.split(':');
      target.keyId = keyId?.trim() || target.keyId;
      target.key = key?.trim() || target.key;
    } else {
      target.licenseKey = value;
    }
  }

  if (lower.includes('license_type') && value) {
    target.licenseType = value;
  }

  if (lower.includes('http-user-agent') || lower.includes('user_agent') || lower.includes('user-agent')) {
    target.userAgent = value.includes('User-Agent=') ? value.split('User-Agent=').pop() : value;
  }

  if (lower.includes('http-referrer') || lower.includes('referer=')) {
    target.referer = value.includes('Referer=') ? value.split('Referer=').pop() : value;
  }

  if (lower.includes('manifest_headers')) {
    const decoded = value.replace(/&quot;/g, '"');
    const ua = decoded.match(/User-Agent=([^&"]+)/i)?.[1];
    const ref = decoded.match(/Referer=([^&"]+)/i)?.[1];
    if (ua) target.userAgent = ua;
    if (ref) target.referer = ref;
  }
}

function parseM3U(text, source) {
  const lines = String(text || '').split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const commaIndex = line.indexOf(',');
      const attrPart = commaIndex >= 0 ? line.slice(0, commaIndex) : line;
      const namePart = commaIndex >= 0 ? line.slice(commaIndex + 1) : '';
      const attrs = parseAttrs(attrPart);
      pending = {
        name: namePart || attrs['tvg-name'] || attrs['tvg-id'],
        id: attrs['tvg-id'] || attrs['channel-id'] || '',
        logo: attrs['tvg-logo'] || '',
        category: attrs['group-title'] || '',
        language: attrs['tvg-language'] || '',
        region: attrs['tvg-region'] || '',
      };
      continue;
    }

    if (line.startsWith('#KODIPROP:') || line.startsWith('#EXTVLCOPT:')) {
      if (pending) applyM3UProperty(pending, line);
      continue;
    }

    if (line.startsWith('#')) continue;
    if (pending) {
      const mapped = mapChannel({ ...pending, url: line }, source, channels.length);
      if (mapped && isTamilChannel(mapped, source)) channels.push(mapped);
      pending = null;
    }
  }

  return channels;
}

function parseLooseJson(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {}

  try {
    return JSON.parse(`[${trimmed.replace(/^,|,$/g, '')}]`);
  } catch {
    return null;
  }
}

function parseJsonPayload(text, source) {
  const payload = parseLooseJson(text);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.channels)
      ? payload.channels
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.results)
          ? payload.results
          : payload && payload.url
            ? [payload]
            : [];

  return list
    .map((item, index) => mapChannel(item, source, index))
    .filter((item) => item && isTamilChannel(item, source));
}

function parseSourceListFromEnv() {
  const raw = String(process.env.TV || process.env.LIVE_TV_SOURCES || '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((entry, index) => {
      const trimmed = entry.trim();
      if (!trimmed) return null;
      const sep = trimmed.includes('|') ? '|' : trimmed.includes('=') ? '=' : '';
      let label = `TV ${index + 1}`;
      let urlValue = trimmed;
      if (sep) {
        const at = trimmed.indexOf(sep);
        label = trimmed.slice(0, at).trim() || label;
        urlValue = trimmed.slice(at + 1).trim();
      }
      const url = normalizeHttpUrl(urlValue);
      if (!url) return null;
      return {
        id: `custom-${index + 1}`,
        label,
        type: url.toLowerCase().includes('.m3u') ? 'm3u' : 'json',
        url,
        trustTamil: false,
        priority: 10 + index,
      };
    })
    .filter(Boolean);
}

function getSources() {
  const custom = parseSourceListFromEnv();
  if (custom.length) return custom;
  return DEFAULT_SOURCES;
}

async function fetchText(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json,text/plain,application/x-mpegURL,*/*',
      'User-Agent': 'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)',
    },
  });
  if (!response.ok) throw new Error(`Live TV source returned HTTP ${response.status}: ${url}`);
  return response.text();
}

function popularityRank(channel = {}) {
  const name = normalizeWhitespace(channel.name).toLowerCase();
  const index = POPULAR_TAMIL_RULES.findIndex((rule) => name === rule || name.includes(rule));
  return index === -1 ? 9999 : index;
}

function qualityScore(channel) {
  let score = 0;
  const rank = popularityRank(channel);
  if (rank !== 9999) score += 5000 - rank * 100;
  if (channel.playable) score += 1000;
  if (channel.format === 'dash') score += 120;
  if (channel.format === 'hls') score += 80;
  if (/hd/i.test(channel.name)) score += 25;
  if (/\b(news|music|kids|movies|devotional|sports|entertainment)\b/i.test(channel.category)) score += 5;
  score -= channel.priority * 20;
  return score;
}

function extractJioCookieFromText(text = '') {
  const raw = String(text || '');
  const direct = raw.match(/((?:__hdnea__|hdnea)=st=[^&"'`\s;]+)/);
  if (direct?.[1]) return direct[1].startsWith('hdnea=') ? `__hdnea__=${direct[1].slice(6)}` : direct[1];

  try {
    const parsed = parseLooseJson(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const value = item.cookie || item.cookies || item.value || item.jio_cookie || item.data || '';
      const found = String(value).match(/((?:__hdnea__|hdnea)=st=[^&"'`\s;]+)/);
      if (found?.[1]) return found[1].startsWith('hdnea=') ? `__hdnea__=${found[1].slice(6)}` : found[1];
    }
  } catch {}

  return '';
}

async function fetchJioCookie() {
  if (jioCookieCache.value && Date.now() - jioCookieCache.loadedAt < JIO_COOKIE_TTL_MS) {
    return jioCookieCache.value;
  }

  const urls = [
    'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamcookie',
    'https://allinonereborn2.online/jstrweb2/cookies.json',
    'https://allinonereborn2.online/jtv-fetch/cookies.json',
    'https://allinonereborn2.online/jstr4web/cookies.json',
    'https://allinonereborn2.online/jstr4web2/cookies.json',
    'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/main/jstrweb2/cookies.json',
    'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/master/jstrweb2/cookies.json',
  ];

  for (const url of urls) {
    try {
      const text = await fetchText(url);
      const cookie = extractJioCookieFromText(text);
      if (cookie) {
        jioCookieCache.value = cookie;
        jioCookieCache.loadedAt = Date.now();
        return cookie;
      }
    } catch {}
  }

  return jioCookieCache.value || '';
}

function injectJioCookie(channels, cookie = '') {
  if (!cookie) return channels;

  return channels.map((channel) => {
    if (!isJioChannel(channel) || isStarSportsChannel(channel)) return channel;

    const existing = String(channel.cookie || '');
    const existingLooksScoped = existing.includes('/bpk-tv/') || (existing.includes('acl=') && !existing.includes('acl=/*'));
    if (existing && existingLooksScoped) return channel;

    return {
      ...channel,
      cookie,
      userAgent: channel.userAgent || 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6',
      referer: channel.referer || 'https://www.jiotv.co/',
    };
  });
}

function dedupeChannels(channels) {
  const byName = new Map();
  for (const channel of channels) {
    const key = slugify(channel.name.replace(/\s+HD$/i, '').replace(/\s+SD$/i, ''));
    const existing = byName.get(key);
    if (!existing || qualityScore(channel) > qualityScore(existing)) {
      byName.set(key, channel);
    }
  }

  return [...byName.values()].sort((a, b) => {
    const rankDiff = popularityRank(a) - popularityRank(b);
    if (rankDiff) return rankDiff;
    const playableDiff = Number(b.playable) - Number(a.playable);
    if (playableDiff) return playableDiff;
    const sourceDiff = a.priority - b.priority;
    if (sourceDiff) return sourceDiff;
    return a.name.localeCompare(b.name);
  });
}

export async function getLiveTVChannels({ source = 'all', playableOnly = false } = {}) {
  const sources = getSources();
  const selectedSources = source && source !== 'all'
    ? sources.filter((item) => item.id === source)
    : sources;
  const key = `${selectedSources.map((item) => item.url).join(',')}|${playableOnly}`;

  if (cache.channels && cache.key === key && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.channels;
  }

  const results = await Promise.allSettled(
    selectedSources.map(async (item) => {
      const text = await fetchText(item.url);
      return item.type === 'm3u' ? parseM3U(text, item) : parseJsonPayload(text, item);
    }),
  );

  const rawChannels = results
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value)
    .filter((channel) => !playableOnly || channel.playable);

  const jioCookie = await fetchJioCookie();
  const channels = dedupeChannels(injectJioCookie(rawChannels, jioCookie));

  const payload = {
    updatedAt: new Date().toISOString(),
    source,
    sources: selectedSources.map(({ id, label, url, type }) => ({ id, label, url, type })),
    count: channels.length,
    channels,
    errors: results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Unknown source error'),
  };

  cache.key = key;
  cache.loadedAt = Date.now();
  cache.channels = payload;

  return payload;
}
