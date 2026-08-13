import {
  JIO_REFERER,
  JIO_USER_AGENT,
  appendJioCookieToUrl,
  getJioCookieExpiry,
  isJioChannel as isJioPlaybackChannel,
  isJioCookieValid,
  normalizeJioCookie,
} from '@/lib/jioPlayback';

export const POCKET_SOURCE = {
  id: 'pocket-tamil',
  label: 'Pocket Tamil',
  type: 'm3u',
  url: 'https://raw.githubusercontent.com/joiptv/jojo/refs/heads/main/pocket.m3u',
  trustTamil: false,
  priority: 0,
};

export const DEFAULT_SOURCES = [
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

const REMOVED_SOURCE_PATTERNS = [
  'rjmbts/rjms',
  'rjm tamil',
  'rjm-tamil',
  'zoh tamil',
  'zoh-tamil',
  'zoh.txt',
  'sportlive18/jio-auto-update-m3u-playlist',
  'jio auto tamil',
  'jio-auto-tamil',
];

function isRemovedSource(source = {}) {
  const text = `${source.id || ''} ${source.label || ''} ${source.url || ''}`.toLowerCase();
  return REMOVED_SOURCE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isPocketSource(source = {}) {
  const text = `${source.id || ''} ${source.label || ''} ${source.url || ''}`.toLowerCase();
  return text.includes('pocket-tamil') || text.includes('joiptv/jojo') || text.includes('pocket.m3u');
}

function pocketKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const POCKET_WANTED_NAMES = new Set(`
ktv hd
zee thirai hd
vijay super hd
vijay takkar
j movies
raj digital plus
star movies hd
star movies select hd
tata play hollywood local
star vijay hd
zee tamil hd
colors tamil hd
d tamil
sirippoli
chithiram
sun tv hd au
sun tv hdr10
sun life
adithya tv
chutti tv
astro vinmeen
thangathirai
vasantham
astro vaanavil
astro vellithirai
star vijay
sun tv
colors tamil
zee tamil
ktv
adithya
zee thirai
sony yay
sony yay!
eye tamil
eye tamil comedy
roja tv
roja movies hd
vaanam tv
utv
suriya tv
suriyan tv
rock tv
tamil ratna
magalir tv
namma gobi tv
om sakthi tv
velavan tv
vinayaga tv
isai tv
jayam tv
devi tv
jith tv
alar tv
malar tv
malar tv alangulam
alangulam sky tv
king tv alangulam
chola tv
raga tv
ragam tv
3 star tv
oli tv
sri arjun tv
fort tv
aramm tv
sai tv
sai tv tenkasi
sabari tv aruppukottai
shark tv
gjv tv
naveen tv
apple tv puducherry
diamond tv
diamond talkies
pdp tv
arun tv
selfie tv
velan tv
naga tv
acp tv
acp classic
aps tv gold
aps gold tv
chither tv
mcn
s media
subin tv
subintv
silver sat media
thalaa tv
thala tv
sun news
tamil janam
raj news 24x7
jaya plus
news18 tamil nadu
news tamil 24x7
news j
thanthi tv
polimer news
news7 tamil
puthiya thalaimurai
seithigal tv
sathiyam tv
malaimurasu seithigal
malai murasu seithigal
star sports 1 tamil
star sports 1 tamil hd
star sports 2 tamil
star sports 2 tamil hd
sony sports ten 4 tamil
sony ten 4 tamil
`.split('\n').map(pocketKey).filter(Boolean));

function parsePocketNameList(value = '') {
  return String(value || '')
    .split(/[\n,|;]+/)
    .map(pocketKey)
    .filter(Boolean);
}

const POCKET_DEFAULT_REMOVED_NAMES = parsePocketNameList(`
9xjalwa
9xm
chither isai
mega musiq
aadvik tv
diamond music
eye tamil music
hit songs
latest songs
max music
mix songs
mn music
romantic songs
sachin music
thalapathy tv
trending songs
tsnmusic
zoom
yet music
`);

const POCKET_REMOVED_NAMES = new Set([
  ...POCKET_DEFAULT_REMOVED_NAMES,
  ...parsePocketNameList(process.env.POCKET_REMOVE_CHANNELS),
  ...parsePocketNameList(process.env.POCKET_HIDE_CHANNELS),
  ...parsePocketNameList(process.env.LIVE_POCKET_REMOVE_CHANNELS),
  ...parsePocketNameList(process.env.LIVE_POCKET_HIDE_CHANNELS),
]);

function pocketCompactKey(value = '') {
  return pocketKey(value).replace(/\s+/g, '');
}

function isPocketRemovedChannel(channel = {}) {
  const name = pocketKey(channel.name);
  const compactName = pocketCompactKey(channel.name);
  if (!name) return false;
  if (POCKET_REMOVED_NAMES.has(name)) return true;
  return [...POCKET_REMOVED_NAMES].some((removed) => pocketCompactKey(removed) === compactName);
}

function isPocketWantedChannel(channel = {}) {
  if (hasBlockedLiveCategory(channel) || isPocketRemovedChannel(channel)) return false;
  const name = pocketKey(channel.name);
  const category = pocketKey(channel.category);

  if (!name) return false;
  if (category === 'music') return true;
  if (POCKET_WANTED_NAMES.has(name)) return true;
  if (name.includes('alangulam') && name.includes('tv')) return true;
  if (name.includes('thalaa') && name.includes('tv')) return true;

  if (category === 'news') {
    return (
      name.includes('tamil') ||
      name.includes('thanthi') ||
      name.includes('polimer') ||
      name.includes('puthiya') ||
      name.includes('sathiyam') ||
      name.includes('malaimurasu') ||
      name.includes('malai murasu') ||
      name.includes('jaya plus') ||
      name.includes('news j') ||
      name.includes('sun news') ||
      name.includes('tamil janam') ||
      name.includes('raj news') ||
      name.includes('seithigal')
    );
  }

  if (category === 'sports' || name.includes('sports')) {
    return name.includes('tamil') || name.includes('ten 4');
  }

  return false;
}

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
const WORKING_CHECK_TTL_MS = Number(process.env.LIVE_WORKING_CACHE_TTL_MS || 5 * 60 * 1000);
const WORKING_CHECK_TIMEOUT_MS = Number(process.env.LIVE_WORKING_TIMEOUT_MS || 2500);
const WORKING_CHECK_CONCURRENCY = Number(process.env.LIVE_WORKING_CONCURRENCY || 64);
const cache = globalThis.__jashLiveTvCache || { key: '', loadedAt: 0, channels: null };
const jioCookieCache = globalThis.__jashJioCookieCache || { value: '', loadedAt: 0 };
const jioStarAccessCache = globalThis.__jashJioStarAccessCache || { records: [], loadedAt: 0 };
const workingCache = globalThis.__jashLiveWorkingCache || new Map();
globalThis.__jashLiveTvCache = cache;
globalThis.__jashJioCookieCache = jioCookieCache;
globalThis.__jashJioStarAccessCache = jioStarAccessCache;
globalThis.__jashLiveWorkingCache = workingCache;

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
    // M3U providers sometimes put cookie/header payload in a URL fragment
    // (example: index.mpd?#__hdnea__=...&xxx=%7Ccookie=...). Fragments are
    // never sent to the CDN and they break token injection, so keep the real
    // playable URL clean and store cookies/headers separately.
    parsed.hash = '';
    return parsed.href.replace(/\?$/, '');
  } catch {
    return '';
  }
}

function parsePipedStreamUrl(value = '') {
  const raw = String(value || '').trim();
  const [urlPart, ...optionParts] = raw.split('|');
  const optionsText = optionParts.join('|');
  const options = {};
  if (optionsText) {
    for (const part of optionsText.split('&')) {
      const at = part.indexOf('=');
      if (at <= 0) continue;
      const key = part.slice(0, at).trim().toLowerCase();
      const val = part.slice(at + 1).trim();
      if (!key || !val) continue;
      options[key] = val;
    }
  }

  let decodedRaw = raw;
  try {
    decodedRaw = decodeURIComponent(raw);
  } catch {}

  return {
    url: urlPart.trim(),
    userAgent: options['user-agent'] || options.useragent || options.ua || '',
    cookie: options.cookie || options.cookies || extractJioCookieFromText(decodedRaw) || extractJioCookieFromText(raw) || '',
    referer: options.referer || options.referrer || options.origin || '',
  };
}

function appendCookieTokenToUrl(uri = '', cookie = '') {
  return appendJioCookieToUrl(uri, cookie);
}

function slugify(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'channel';
}

function detectFormat(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('/m3u/') || lower.includes('/m3u?')) return 'hls';
  if (lower.includes('.mpd') || lower.includes('mpd.php') || lower.includes('/mpd/') || lower.includes('/mpd?')) return 'dash';
  if (/\.(mp4|webm|ogg|ts)(\?|$)/i.test(lower) || /live\.ts(\?|$)/i.test(lower)) return 'video';
  if (lower.includes('/hls/') || lower.includes('playlist')) return 'hls';
  return 'unknown';
}

function detectSourceType(url = '') {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.json')) return 'json';
  if (lower.includes('.m3u') || lower.endsWith('.txt') || lower.includes('/zoh.txt')) return 'm3u';
  return 'json';
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
  return isJioPlaybackChannel(channel);
}

function isStarSportsChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.url || ''}`.toLowerCase();
  return text.includes('star sports') || text.includes('star_sports') || text.includes('starsports');
}

function hasBlockedRegionalLanguage(text = '') {
  const value = String(text || '').toLowerCase();
  const allowedLanguage = /\btamil\b/.test(value);
  const blocked = /\b(english|eng|hindi|telugu|kannada|malayalam|bangla|bengali|marathi|gujarati|urdu|arabic|spanish|odia|punjabi|bhojpuri)\b/.test(value);
  return blocked && !allowedLanguage;
}

function hasBlockedLiveCategory(channel = {}) {
  const category = String(channel.category || channel.group || channel.groupTitle || channel['group-title'] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(extras?|usa|premium|premimum|izzigo|fm\s*radio|radio)\b/.test(category);
}

function isEnglishOnlyChannel(channel = {}) {
  const name = String(channel.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const meta = `${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const explicitEnglishName = /\b(willow|cnn\s*news18|cnn|bbc|cnbc|times\s*now|republic|ndtv\s*24x7|mirro?r\s*now|movies\s*now|romedy\s*now|mnx|sony\s*pix|star\s*movies|zee\s*cafe|zee\s*caf\b|history\s*tv18|discovery\s*hd|animal\s*planet|nat\s*geo|national\s*geographic)\b/.test(name);
  if (explicitEnglishName && !/\btamil\b/.test(name)) return true;
  return /\b(english|eng|usa)\b/.test(meta) && !/\btamil\b/.test(name);
}

function isPreferredCricketChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  if (hasBlockedLiveCategory(channel) || hasBlockedRegionalLanguage(text) || isEnglishOnlyChannel(channel)) return false;

  return (
    text.includes('star sports 1 tamil') ||
    text.includes('star sports 2 tamil') ||
    text.includes('sony sports ten 4 tamil') ||
    text.includes('sony ten 4 tamil') ||
    text.includes('sony liv sports 4 tamil')
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

function isSportsChannelText(text = '') {
  const value = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return (
    /\bstar\s*sports\b/.test(value) ||
    /\bsports\b/.test(value) ||
    /\bcricket\b/.test(value) ||
    /\bwillow\b/.test(value) ||
    /\bsky\s*sports\s*cricket\b/.test(value) ||
    /\bfancode\b/.test(value) ||
    /\b(ind|india)\s*(vs|v|versus)\b/.test(value) ||
    /\b(vs|v|versus)\s*(ind|india)\b/.test(value)
  );
}


function isTamilChannel(channel, source = {}) {
  if (hasBlockedLiveCategory(channel)) return false;
  if (isPocketSource(source)) return isPocketWantedChannel(channel);
  if (isEnglishOnlyChannel(channel)) return false;
  if (source.trustTamil) return true;
  if (isPreferredCricketChannel(channel)) return true;

  const text = `${channel.name || ''} ${channel.category || ''} ${channel.language || ''} ${channel.region || ''}`.toLowerCase();
  if (hasBlockedRegionalLanguage(text)) return false;
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
  const rawUrl = raw.url || raw.streamUrl || raw.link || raw.href || '';
  const piped = parsePipedStreamUrl(rawUrl);
  const url = normalizeHttpUrl(piped.url);
  if (!url) return null;

  const name = cleanChannelName(raw.name || raw.title || raw.channel || `Channel ${index + 1}`);
  const format = detectFormat(url);
  let category = normalizeWhitespace(raw.category || raw.group || raw.groupTitle || raw['group-title'] || 'Tamil');
  const language = normalizeWhitespace(raw.language || raw['tvg-language'] || (source.trustTamil ? 'Tamil' : ''));
  const region = normalizeWhitespace(raw.region || raw['tvg-region'] || '');
  const categoryText = `${name} ${category} ${language} ${region}`;
  if (isTamilMusicChannelText(categoryText)) category = 'Music';
  else if (isSportsChannelText(categoryText)) category = 'Sports';

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
    licenseType: raw.licenseType || raw.license_type || '',
    cookie: raw.cookie || raw.cookies || piped.cookie || extractJioCookieFromText(rawUrl) || '',
    userAgent: raw.userAgent || raw.user_agent || raw.ua || piped.userAgent || raw.headers?.['User-Agent'] || raw.headers?.['user-agent'] || '',
    referer: raw.referer || raw.referrer || raw.origin || piped.referer || raw.headers?.Referer || raw.headers?.referer || '',
    headers: raw.headers && typeof raw.headers === 'object' ? raw.headers : {}, 
    playable: format === 'hls' || format === 'dash' || format === 'video',
    priority: source.priority ?? 99,
  };
}

function applyM3UProperty(target, line) {
  if (!target) return;
  const lower = line.toLowerCase();

  if (line.startsWith('#EXTHTTP:')) {
    const rawJson = line.slice(line.indexOf(':') + 1).trim();
    try {
      const parsed = JSON.parse(rawJson);
      const headers = parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : parsed;
      const cookie = parsed.cookie || parsed.Cookie || headers.cookie || headers.Cookie || '';
      const userAgent = parsed['user-agent'] || parsed['User-Agent'] || parsed.userAgent || headers['user-agent'] || headers['User-Agent'] || headers.userAgent || '';
      const referer = parsed.referer || parsed.referrer || parsed.Referer || headers.referer || headers.referrer || headers.Referer || '';
      if (cookie) target.cookie = cookie;
      if (userAgent) target.userAgent = userAgent;
      if (referer) target.referer = referer;
      target.headers = { ...(target.headers || {}), ...headers };
    } catch {}
    return;
  }

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

function parseM3U(text, source, { includeAll = false } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  const channels = [];
  let pending = null;
  let carryProperties = [];

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
      carryProperties.forEach((propertyLine) => applyM3UProperty(pending, propertyLine));
      carryProperties = [];
      continue;
    }

    if (line.startsWith('#KODIPROP:') || line.startsWith('#EXTVLCOPT:') || line.startsWith('#EXTHTTP:')) {
      if (pending) applyM3UProperty(pending, line);
      else carryProperties = [...carryProperties.slice(-8), line];
      continue;
    }

    if (line.startsWith('#')) continue;
    if (pending) {
      const mapped = mapChannel({ ...pending, url: line }, source, channels.length);
      if (mapped && (includeAll || isTamilChannel(mapped, source))) channels.push(mapped);
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

function parseJsonPayload(text, source, { includeAll = false } = {}) {
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
    .filter((item) => item && (includeAll || isTamilChannel(item, source)));
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
        type: detectSourceType(url),
        url,
        trustTamil: false,
        priority: 10 + index,
      };
    })
    .filter(Boolean);
}

function getSources(sourceOverride = null) {
  if (Array.isArray(sourceOverride)) {
    return sourceOverride.filter((item) => item && !isRemovedSource(item));
  }

  const custom = parseSourceListFromEnv().filter((item) => !isRemovedSource(item) && !isPocketSource(item));

  const byUrl = new Map();
  for (const item of [...DEFAULT_SOURCES, ...custom]) {
    if (isRemovedSource(item)) continue;
    const key = normalizeHttpUrl(item.url).toLowerCase();
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, item);
  }
  return [...byUrl.values()].map((item, index) => ({ ...item, priority: item.priority ?? index }));
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

function buildPlaybackHeaders(channel = {}, uri = '') {
  const text = `${channel.url || ''} ${uri}`.toLowerCase();
  const jioLike = isJioChannel(channel) || text.includes('jiotv') || text.includes('jiotvmblive') || text.includes('jiotvpllive');
  const hotstarLike = text.includes('hotstar.com');
  const fancodeLike = text.includes('fancode.com') || text.includes('fblive.fancode.com') || normalizeWhitespace(channel.category).toLowerCase() === 'fancode';
  const headers = {
    Accept: channel.format === 'hls'
      ? 'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*'
      : channel.format === 'dash'
        ? 'application/dash+xml,application/xml,text/xml,text/plain,*/*'
        : '*/*',
  };

  const userAgent = channel.userAgent ||
    (jioLike ? JIO_USER_AGENT : '') ||
    (fancodeLike ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' : '') ||
    'Mozilla/5.0 (compatible; JaSH-Theatre-LiveTV/1.0)';

  if (channel.headers && typeof channel.headers === 'object') {
    for (const [key, val] of Object.entries(channel.headers)) {
      // Keep Cookie centralized in channel.cookie so stale EXTHTTP cookies can
      // be replaced by the fresh global Jio token before playback/checking.
      if (!key || /^cookie$/i.test(key) || val == null || val === '') continue;
      headers[key] = String(val);
    }
  }
  if (userAgent) headers['User-Agent'] = userAgent;
  if (channel.referer) headers.Referer = channel.referer;
  else if (jioLike) headers.Referer = JIO_REFERER;
  else if (hotstarLike) headers.Referer = 'https://www.hotstar.com/';
  else if (fancodeLike) headers.Referer = 'https://www.fancode.com/';
  if (channel.cookie) headers.Cookie = channel.cookie;

  return headers;
}

async function checkChannelWorking(channel = {}) {
  if (!channel?.playable || !channel.url) return false;
  // Server-side checks for Jio often fail because the CDN blocks data-center
  // locations, while the same URL works on the user's phone/browser after we
  // inject the fresh cookie token. Keep them visible and let the client hide a
  // channel only if Shaka actually fails.
  if (isJioChannel(channel)) return true;

  const cacheKey = `${channel.url}|${channel.cookie || ''}|${channel.userAgent || ''}|${channel.referer || ''}|${channel.keyId || ''}|${channel.key || ''}`;
  const cached = workingCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < WORKING_CHECK_TTL_MS) return cached.ok;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WORKING_CHECK_TIMEOUT_MS);

  try {
    const jioLike = isJioChannel(channel);
    const uri = jioLike && channel.cookie ? appendCookieTokenToUrl(channel.url, channel.cookie) : channel.url;
    const response = await fetch(uri, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
      headers: buildPlaybackHeaders(channel, uri),
    });

    if (!response.ok) {
      // Jio/CDN manifests often reject cloud servers with 401/403/451 while
      // still playing from the user's device/location. Don't hide those as
      // broken based only on the Render/server-side check.
      if ([401, 403, 451].includes(response.status) && (isJioChannel(channel) || uri.toLowerCase().includes('jiotv'))) {
        workingCache.set(cacheKey, { ok: true, checkedAt: Date.now() });
        return true;
      }
      throw new Error(`HTTP ${response.status}`);
    }

    let ok = true;
    if (channel.format === 'dash' || channel.format === 'hls') {
      const text = await response.text();
      const trimmed = text.slice(0, 4096).trim();
      ok = channel.format === 'dash'
        ? /<MPD[\s>]/i.test(trimmed) || trimmed.includes('<MPD')
        : trimmed.startsWith('#EXTM3U') || trimmed.includes('#EXT-X-STREAM-INF') || trimmed.includes('#EXT-X-TARGETDURATION');
    }

    workingCache.set(cacheKey, { ok, checkedAt: Date.now() });
    return ok;
  } catch {
    workingCache.set(cacheKey, { ok: false, checkedAt: Date.now() });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function filterWorkingChannels(channels = []) {
  if (!channels.length) return channels;

  const limit = Math.max(1, Math.min(WORKING_CHECK_CONCURRENCY, 40));
  const checks = new Array(channels.length);
  let cursor = 0;

  async function worker() {
    while (cursor < channels.length) {
      const index = cursor;
      cursor += 1;
      checks[index] = await checkChannelWorking(channels[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, channels.length) }, () => worker()));
  return channels.filter((_, index) => checks[index]);
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

export function extractJioCookieFromText(text = '') {
  const raw = String(text || '');
  const direct = raw.match(/((?:__hdnea__|hdnea)=st=[^&"'`\s;]+)/i);
  const directCookie = normalizeJioCookie(direct?.[1] || '');
  if (directCookie) return directCookie;

  try {
    const parsed = parseLooseJson(raw);
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const item = queue.shift();
      if (!item) continue;
      if (Array.isArray(item)) {
        queue.push(...item);
        continue;
      }
      if (typeof item !== 'object') continue;
      const value = item.cookie || item.cookies || item.value || item.jio_cookie || item.data || item.token || '';
      const cookie = normalizeJioCookie(value);
      if (cookie) return cookie;
      queue.push(...Object.values(item).filter((entry) => entry && typeof entry === 'object'));
    }
  } catch {}

  return '';
}

const JIO_COOKIE_URLS = [
  'https://allinonereborn2.online/jstrweb2/cookies.json',
  'https://allinonereborn2.online/jtv-fetch/cookies.json',
  'https://allinonereborn2.online/jstr4web/cookies.json',
  'https://allinonereborn2.online/jstr4web2/cookies.json',
  'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamcookie',
  'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/main/jstrweb2/cookies.json',
  'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/master/jstrweb2/cookies.json',
];

export async function getFreshJioCookie({ force = false, minValidityMs = 90_000 } = {}) {
  const configured = normalizeJioCookie(process.env.JIO_LIVE_COOKIE || process.env.JIO_COOKIE || '');
  if (configured && isJioCookieValid(configured, minValidityMs)) return configured;

  if (!force && jioCookieCache.value &&
    Date.now() - jioCookieCache.loadedAt < JIO_COOKIE_TTL_MS &&
    isJioCookieValid(jioCookieCache.value, minValidityMs)) {
    return jioCookieCache.value;
  }

  let bestCookie = '';
  let bestExpiry = 0;
  for (const url of JIO_COOKIE_URLS) {
    try {
      const text = await fetchText(url);
      const cookie = extractJioCookieFromText(text);
      if (!isJioCookieValid(cookie, minValidityMs)) continue;
      const expiry = getJioCookieExpiry(cookie) || Number.MAX_SAFE_INTEGER;
      if (!bestCookie || expiry > bestExpiry) {
        bestCookie = cookie;
        bestExpiry = expiry;
      }
      // The primary Stream4Liv-compatible endpoint is normally current. Avoid
      // adding latency once it gives us a token with at least ten minutes left.
      if (expiry > Date.now() + 10 * 60 * 1000) break;
    } catch {}
  }

  if (bestCookie) {
    jioCookieCache.value = bestCookie;
    jioCookieCache.loadedAt = Date.now();
    return bestCookie;
  }

  return isJioCookieValid(jioCookieCache.value, minValidityMs) ? jioCookieCache.value : '';
}

function stripJioCookieFromUrl(value = '') {
  const input = String(value || '').trim();
  const hashAt = input.indexOf('#');
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input;
  const questionAt = withoutHash.indexOf('?');
  if (questionAt < 0) return withoutHash;
  const path = withoutHash.slice(0, questionAt);
  const query = withoutHash.slice(questionAt + 1)
    .split('&')
    .filter(Boolean)
    .filter((part) => !/^(?:__hdnea__|hdnea)=/i.test(part));
  return query.length ? `${path}?${query.join('&')}` : path;
}

async function getJioStarAccessRecords({ force = false } = {}) {
  if (!force && jioStarAccessCache.records.length && Date.now() - jioStarAccessCache.loadedAt < 5 * 60 * 1000) {
    return jioStarAccessCache.records.filter((item) => isJioCookieValid(item.cookie));
  }

  const urls = [
    'https://allinonereborn2.online/jtv-fetch/jstarcookie/cookie.json',
    'https://raw.githubusercontent.com/allinonereborn/allinonereborn-m3u/main/jstarcookie/cookie.json',
  ];
  for (const url of urls) {
    try {
      const parsed = parseLooseJson(await fetchText(url));
      const payload = parsed?.data || parsed || {};
      const rows = [
        ...(Array.isArray(payload.successful_results) ? payload.successful_results : []),
        ...(Array.isArray(payload.failed_results) ? payload.failed_results : []),
      ];
      const records = rows.map((item) => {
        const finalUrl = item?.final_url || item?.error_details?.final_url || '';
        return {
          channelId: String(item?.channel_id || '').trim(),
          name: normalizeLiveName(item?.channel_name || ''),
          playbackUrl: stripJioCookieFromUrl(finalUrl),
          cookie: extractJioCookieFromText(finalUrl),
        };
      }).filter((item) => item.playbackUrl && isJioPlaybackChannel({ url: item.playbackUrl }) && isJioCookieValid(item.cookie));
      if (records.length) {
        jioStarAccessCache.records = records;
        jioStarAccessCache.loadedAt = Date.now();
        return records;
      }
    } catch {}
  }
  return jioStarAccessCache.records.filter((item) => isJioCookieValid(item.cookie));
}

function normalizeLiveName(value = '') {
  return normalizeWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function getJioChannelAccess(channel = {}, { force = false } = {}) {
  const originalUrl = String(channel.url || '').trim();
  if (isStarSportsChannel(channel)) {
    const records = await getJioStarAccessRecords({ force });
    const channelId = String(channel.tvgId || channel.channelId || channel.id || '').trim();
    const channelName = normalizeLiveName(channel.name || channel.originalName || '');
    const sourcePath = originalUrl.split('/bpk-tv/')[1]?.split('/')[0]?.toLowerCase() || '';
    const match = records.find((item) => channelId && item.channelId === channelId)
      || records.find((item) => channelName && item.name === channelName)
      || records.find((item) => sourcePath && item.playbackUrl.toLowerCase().includes(`/bpk-tv/${sourcePath}/`));
    if (match) return { cookie: match.cookie, playbackUrl: match.playbackUrl, scoped: true };
  }

  return {
    cookie: await getFreshJioCookie({ force }),
    playbackUrl: originalUrl,
    scoped: false,
  };
}

export function injectJioCookie(channels, cookie = '') {
  const freshCookie = normalizeJioCookie(cookie);
  if (!freshCookie) return channels;

  return channels.map((channel) => {
    if (!isJioChannel(channel) || isStarSportsChannel(channel)) return channel;

    const existing = normalizeJioCookie(channel.cookie || '');
    const existingLooksScoped = existing.includes('/bpk-tv/') || (existing.includes('acl=') && !existing.includes('acl=/*'));
    const selectedCookie = existingLooksScoped && isJioCookieValid(existing) ? existing : freshCookie;

    return {
      ...channel,
      cookie: selectedCookie,
      userAgent: channel.userAgent || JIO_USER_AGENT,
      referer: channel.referer || JIO_REFERER,
      jioTokenExpiresAt: getJioCookieExpiry(selectedCookie),
    };
  });
}

function dedupeChannels(channels) {
  const byName = new Map();
  for (const channel of channels) {
    const dedupeName = channel.sourceId === 'pocket-tamil'
      ? channel.name
      : channel.name.replace(/\s+HD$/i, '').replace(/\s+SD$/i, '');
    const key = slugify(dedupeName);
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

export async function getLiveTVChannels({ source = 'all', playableOnly = false, workingOnly = false, sourceOverride = null } = {}) {
  const sources = getSources(sourceOverride);
  const selectedSources = source && source !== 'all'
    ? sources.filter((item) => item.id === source)
    : sources;
  const key = `${selectedSources.map((item) => item.url).join(',')}|${playableOnly}|${workingOnly}`;

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

  const jioCookie = await getFreshJioCookie();
  const injectedChannels = injectJioCookie(rawChannels, jioCookie);
  const dedupedChannels = dedupeChannels(injectedChannels);
  const channels = workingOnly ? await filterWorkingChannels(dedupedChannels) : dedupedChannels;

  const payload = {
    updatedAt: new Date().toISOString(),
    source,
    workingOnly,
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

export async function getPocketLiveTVChannels({ playableOnly = false, workingOnly = false } = {}) {
  return getLiveTVChannels({
    source: 'all',
    playableOnly,
    workingOnly,
    sourceOverride: [POCKET_SOURCE],
  });
}

export function getDefaultLiveSources({ includePocket = true } = {}) {
  const base = [...DEFAULT_SOURCES];
  if (includePocket) base.push(POCKET_SOURCE);
  return base
    .filter((item) => item && !isRemovedSource(item))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((item, index) => ({ ...item, priority: item.priority ?? index }));
}

export async function parseLiveSourceChannels(source = {}, { includeAll = true } = {}) {
  if (!source?.url) throw new Error('Source URL is required');
  const normalizedSource = {
    id: source.id || source.sourceId || `source-${Date.now()}`,
    label: source.label || source.name || source.id || 'Live Source',
    type: source.type || detectSourceType(source.url),
    url: source.url,
    trustTamil: Boolean(source.trustTamil),
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : 99,
  };
  const text = await fetchText(normalizedSource.url);
  const channels = normalizedSource.type === 'm3u'
    ? parseM3U(text, normalizedSource, { includeAll })
    : parseJsonPayload(text, normalizedSource, { includeAll });
  return channels;
}

export async function checkLiveChannelUrl(channel = {}) {
  return checkChannelWorking({ ...channel, playable: channel.playable !== false });
}
