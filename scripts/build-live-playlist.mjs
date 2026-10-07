#!/usr/bin/env node
/**
 * build-live-playlist.mjs
 *
 * Builds ONE M3U containing only:
 *   • Bigg Boss Tamil 24/7 feeds
 *   • Tamil channels
 *   • Sports channels from the Star / Sony / Willow / Cricbuzz / FanCode families
 *
 * ...from the whole Sportlink-wtf playlist family (plus anything you add to the config).
 * Output is written in a format jashvibes' Live Service parses natively
 * (KODIPROP ClearKey + EXTVLCOPT + EXTHTTP headers), and is safe for VLC/TiviMate too.
 *
 * No dependencies — plain Node 20+.
 *
 *   node scripts/build-live-playlist.mjs                       # fetch from GitHub (default)
 *   node scripts/build-live-playlist.mjs --local ../sportlink  # build from a local checkout
 *   node scripts/build-live-playlist.mjs --out jash-live.m3u --config scripts/live-playlist.config.json
 */

import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ args */

function parseArgs(argv) {
  const out = { config: '', out: '', local: '', quiet: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--config') out.config = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--local') out.local = argv[++i];
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--force') out.force = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const configPath = args.config || 'scripts/live-playlist.config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const log = (...a) => { if (!args.quiet) console.log(...a); };

/* ------------------------------------------------------- text / headers */

/** Header values must be ISO-8859-1 (emoji make Node AND browsers throw). */
function sanitizeHeaderValue(value = '') {
  return String(value || '')
    .replace(/[^\t\x20-\xFF]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function parseAttrs(line = '') {
  const attrs = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(line))) attrs[m[1].toLowerCase()] = m[2];
  return attrs;
}

/**
 * Channel name = everything after the LAST comma that sits OUTSIDE quotes.
 * (Naive "split on last comma" breaks on `tvg-logo="...720,1080_.jpg",Name`.)
 */
function extinfName(line = '') {
  let inQuotes = false;
  let lastComma = -1;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ',' && !inQuotes) lastComma = i;
  }
  return lastComma === -1 ? '' : line.slice(lastComma + 1).trim();
}

function cleanChannelName(name = '') {
  return String(name)
    .replace(/\s+by\s+@\S+/gi, '')
    .replace(/\s*@[A-Za-z0-9_.-]+\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parsePipedUrl(raw = '') {
  const [urlPart, pipePart] = String(raw).split('|');
  const meta = { url: urlPart.trim(), userAgent: '', referer: '', cookie: '' };
  if (!pipePart) return meta;
  for (const pair of pipePart.split('&')) {
    const [k, ...rest] = pair.split('=');
    const v = rest.join('=').trim();
    if (!k || !v) continue;
    const key = k.trim().toLowerCase();
    if (key.includes('user-agent')) meta.userAgent = v;
    else if (key.includes('referer') || key.includes('referrer')) meta.referer = v;
    else if (key.includes('cookie')) meta.cookie = v;
  }
  return meta;
}

function applyProperty(target, line = '') {
  const lower = line.toLowerCase();

  if (lower.startsWith('#exthttp:')) {
    try {
      const parsed = JSON.parse(line.slice(line.indexOf(':') + 1).trim());
      const headers = parsed.headers && typeof parsed.headers === 'object' ? parsed.headers : parsed;
      for (const [k, v] of Object.entries(headers)) {
        if (v == null) continue;
        const key = k.toLowerCase();
        if (key === 'cookie') target.cookie = sanitizeHeaderValue(v);
        else if (key === 'user-agent') target.userAgent = sanitizeHeaderValue(v);
        else if (key === 'referer' || key === 'referrer' || key === 'origin') target.referer = target.referer || sanitizeHeaderValue(v);
        else target.headers[k] = sanitizeHeaderValue(v);
      }
    } catch { /* malformed JSON — ignore */ }
    return;
  }

  const value = line.includes('=') ? line.slice(line.indexOf('=') + 1).replace(/^"|"$/g, '').trim() : '';
  if (!value) return;

  if (lower.includes('license_key')) {
    if (value.includes(':') && !/^https?:\/\//i.test(value)) {
      const [kid, key] = value.split(':');
      target.keyId = sanitizeHeaderValue(kid);
      target.key = sanitizeHeaderValue(key);
    } else {
      target.licenseUrl = sanitizeHeaderValue(value);
    }
  } else if (lower.includes('license_type')) {
    target.licenseType = sanitizeHeaderValue(value);
  } else if (lower.includes('http-user-agent') || lower.includes('user-agent')) {
    target.userAgent = sanitizeHeaderValue(value.includes('User-Agent=') ? value.split('User-Agent=').pop() : value);
  } else if (lower.includes('http-referrer') || lower.includes('http-referer') || lower.includes('referer=')) {
    target.referer = sanitizeHeaderValue(value.includes('Referer=') ? value.split('Referer=').pop() : value);
  } else if (lower.includes('http-cookie')) {
    target.cookie = sanitizeHeaderValue(value);
  } else if (lower.includes('http-extra-headers')) {
    const at = value.indexOf(':');
    if (at > 0) target.headers[value.slice(0, at).trim()] = sanitizeHeaderValue(value.slice(at + 1));
  }
}

/* ---------------------------------------------------------------- parser */

function parseM3U(text = '') {
  const channels = [];
  let pending = null;
  let carry = [];

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^#EXTINF/i.test(line)) {
      const attrs = parseAttrs(line);
      pending = {
        name: cleanChannelName(extinfName(line) || attrs['tvg-name'] || attrs['tvg-id'] || ''),
        tvgId: attrs['tvg-id'] || '',
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        language: attrs['tvg-language'] || '',
        keyId: '', key: '', licenseUrl: '', licenseType: '',
        userAgent: '', referer: '', cookie: '', headers: {},
      };
      for (const prop of carry) applyProperty(pending, prop);
      carry = [];
      continue;
    }

    if (/^#(KODIPROP|EXTVLCOPT|EXTHTTP)/i.test(line)) {
      if (pending) applyProperty(pending, line);
      else carry = [...carry.slice(-8), line];
      continue;
    }

    if (line.startsWith('#')) continue;

    if (pending) {
      const piped = parsePipedUrl(line);
      // `...index_6.m3u8?` and `...index_6.m3u8` are the same stream — a dangling
      // query mark otherwise looks like a distinct "alternative" feed.
      pending.url = piped.url.replace(/\?$/, '');
      pending.userAgent = pending.userAgent || sanitizeHeaderValue(piped.userAgent);
      pending.referer = pending.referer || sanitizeHeaderValue(piped.referer);
      pending.cookie = pending.cookie || sanitizeHeaderValue(piped.cookie);
      channels.push(pending);
      pending = null;
    }
  }

  return channels;
}

/* ------------------------------------------------------------ utilities */

function detectFormat(url = '') {
  const clean = String(url).split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8') || clean.includes('.m3u8')) return 'hls';
  if (clean.endsWith('.mpd') || clean.includes('.mpd')) return 'dash';
  return 'other';
}

function normalizeName(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(\d)\s*hd\b/g, '$1').replace(/\bhd\s*(\d)/g, '$1')   // "HD1" === "1 HD"
    .replace(/\b(eng|hd|sd|fhd|uhd|4k|stb|digital|feed|backup|live|24x7|24 7)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+(tv|television|channel|network)$/, '')  // "Adithya TV" === "Adithya"
    .trim();
}

function applyAliases(normalized = '') {
  let out = normalized;
  for (const [pattern, replacement] of config.nameAliases || []) {
    try { out = out.replace(new RegExp(pattern), replacement); } catch { /* ignore bad pattern */ }
  }
  return out.replace(/\s+/g, ' ').trim();
}

function qualityRank(name = '') {
  const n = String(name).toLowerCase();
  if (/\b4k\b|uhd|eng-4k/.test(n)) return 4;
  if (/\bfhd\b|full hd|eng-fhd/.test(n)) return 3;
  if (/\bhd\b/.test(n)) return 2;
  return 1;
}

/** Anything with an already-expired Akamai/Jio token is useless — drop it. */
function isExpired(channel) {
  const haystack = `${channel.url || ''} ${channel.cookie || ''}`;
  const re = /(?<![0-9])(?:exp|expires)=(\d{9,12})(?![0-9])/gi;
  const now = Math.floor(Date.now() / 1000);
  let m;
  while ((m = re.exec(haystack))) {
    const ts = Number(m[1]);
    if (ts > 1_600_000_000 && ts < 4_000_000_000 && ts < now - 60) return true;
  }
  return false;
}

/**
 * Big community dumps mix LIVE CHANNELS with movie/season VOD rips that carry
 * `group-title="Tamil"`. Those are direct .mkv/.mp4 links with IMDb blurbs —
 * they are not channels, they never "work" as live TV, and they poison the
 * catalogue, so drop them here.
 */
/**
 * Stream eligibility for an HTTPS web app:
 *   • http:// media is blocked as mixed content by every browser on an HTTPS page
 *     (jashvibes runs on Render/Koyeb/HF Spaces), so it is dropped by default.
 *   • raw MPEG-TS (`.ts`) has no browser support — fine in VLC/TiviMate, a broken
 *     tile in the app — also dropped by default.
 * Both are opt-outable in the config for VLC-style consumers.
 */
function urlRejection(url = '') {
  if (config.requireHttps !== false && !/^https:\/\//i.test(url)) return 'insecure';
  if (config.allowRawTs !== true && (/\.ts(\?|$)/i.test(url) || /extension=ts/i.test(url))) return 'rawTs';
  return '';
}

const VOD_FILE_RE = /\.(mkv|mp4|avi|mov|webm|flv|wmv|m4v|zip|rar|apk|srt)(\?|$)/i;
const VOD_TITLE_RES = [
  /\(\s*(?:𝗜𝗠𝗗𝗯|imdb)/i,
  /\b\d+\s*h\s*\d+\s*m(in)?\b/i,
  /\bdirector\b[\s\S]{0,120}\bstars?\b/i,
  /\b(?:watched?|full movie|web series|season \d+|episode \d+)\b/i,
];

function isVodRip(c) {
  if (VOD_FILE_RE.test(String(c.url || ''))) return true;
  return VOD_TITLE_RES.some((re) => re.test(c.name || ''));
}


function matchesAny(text, patterns = []) {
  return patterns.some((p) => {
    try { return new RegExp(p, 'i').test(text); } catch { return false; }
  });
}

/* ------------------------------------------------------- classification */

const sportsRe = new RegExp(config.sportsFamilies.join('|'), 'i');
const bigbossRe = new RegExp(config.bigbossPattern, 'i');
const tamilWordRe = /\btamil\b|\btam\b/i;

function channelText(c) {
  return `${c.name} ${c.group} ${c.language} ${c.tvgId}`.toLowerCase();
}

const OTHER_LANGUAGE_RE = /\b(english|hindi|telugu|kannada|malayalam|bangla|bengali|marathi|gujarati|punjabi|urdu|bhojpuri|odia|assamese|nepali|sinhala)\b/i;

function isTamilChannel(c) {
  const text = channelText(c);
  const tamil = tamilWordRe.test(text) || matchesAny(text, config.tamilNames);
  if (!tamil) return false;
  // "Raj Musix Malayalam", "KTV Bangla", "Aastha Gujarati" live in Tamil-ish
  // groups but are not Tamil channels.
  if (OTHER_LANGUAGE_RE.test(c.name) && !tamilWordRe.test(c.name)) return false;
  return true;
}

function classify(c) {
  const text = channelText(c);
  const tamil = isTamilChannel(c);
  const bigboss = bigbossRe.test(text) && tamil;
  const sports = sportsRe.test(c.name) || (sportsRe.test(c.group) && !/\bfm\b|radio/i.test(c.group));
  if (bigboss) return 'bigboss';
  if (sports) return 'sports';
  if (tamil) return 'tamil';
  return '';
}

/* ------------------------------------------------------------- fetching */

async function fetchText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'jash-live-playlist-builder/1.0', Accept: 'text/plain,*/*' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/#EXTM3U|#EXTINF/i.test(text)) throw new Error('not an M3U');
      return text;
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function loadSource(source) {
  if (args.local) {
    const file = path.join(args.local, source.file);
    if (!fs.existsSync(file)) throw new Error('missing locally');
    return fs.readFileSync(file, 'utf8');
  }
  return fetchText(config.base + source.file);
}

/* ----------------------------------------------------------------- build */

const stats = {
  generatedAt: new Date().toISOString(),
  sources: [],
  sections: { bigboss: 0, tamil: 0, sports: 0 },
  dropped: { expired: 0, radio: 0, blocked: 0, badUrl: 0, vod: 0, insecure: 0, rawTs: 0, duplicateUrl: 0, duplicateChannel: 0, capped: 0 },
};

const byKey = new Map();       // dedupe key -> candidate (Tamil / Sports)
const bigbossCandidates = [];  // kept separate: several quality variants are useful as fallbacks

for (const source of config.sources) {
  let text = '';
  try {
    text = await loadSource(source);
  } catch (error) {
    stats.sources.push({ file: source.file, ok: false, error: String(error.message || error).slice(0, 120) });
    log(`  ✗ ${source.file.padEnd(20)} ${String(error.message || error).slice(0, 60)}`);
    continue;
  }

  const parsed = parseM3U(text);
  let kept = 0;

  for (const c of parsed) {
    const section = classify(c);
    if (!section) continue;
    if (!config.sections[section]) continue;
    if (!/^https?:\/\//i.test(c.url)) { stats.dropped.badUrl += 1; continue; }
    if (matchesAny(`${c.group} ${c.name}`, config.blockedGroups)) { stats.dropped.radio += 1; continue; }
    if (matchesAny(c.name, config.blockedNames)) { stats.dropped.blocked += 1; continue; }
    if (isVodRip(c)) { stats.dropped.vod += 1; continue; }
    const rejection = urlRejection(c.url);
    if (rejection) { stats.dropped[rejection] += 1; continue; }
    if (isExpired(c)) { stats.dropped.expired += 1; continue; }

    const format = detectFormat(c.url);

    const score =
      source.weight * 10 +
      (c.keyId && c.key ? 30 : 0) +
      (c.cookie ? 8 : 0) +
      (c.userAgent ? 3 : 0) +
      (c.referer ? 2 : 0) +
      qualityRank(c.name) * 2 +
      (format === 'hls' ? 2 : 0) +
      (tamilWordRe.test(c.name) ? 6 : 0) +   // prefer channels that say "Tamil"
      (c.logo ? 3 : 0);

    const candidate = { ...c, section, score, source: source.file, format, quality: qualityRank(c.name) };

    if (section === 'bigboss') {
      bigbossCandidates.push(candidate);
      kept += 1;
      continue;
    }

    const key = `${section}:${applyAliases(normalizeName(c.name)) || c.tvgId || c.url}`;
    const existing = byKey.get(key);
    if (!existing || score > existing.score) {
      if (existing) stats.dropped.duplicateChannel += 1;
      byKey.set(key, candidate);
      kept += 1;
    } else {
      stats.dropped.duplicateChannel += 1;
    }
  }

  stats.sources.push({ file: source.file, ok: true, parsed: parsed.length, kept });
  log(`  ✓ ${source.file.padEnd(20)} parsed ${String(parsed.length).padStart(5)}  matched ${kept}`);
}

/* ---------------------------------------------------- pick final entries */

const picked = [];
const seenUrls = new Set();

function take(channel, displayName) {
  if (seenUrls.has(channel.url)) { stats.dropped.duplicateUrl += 1; return false; }
  seenUrls.add(channel.url);
  picked.push({ ...channel, displayName });
  return true;
}

// Bigg Boss first: primary + (bigbossVariants - 1) alternates, best quality first.
// Every BB feed collapses into one family so the player can map the rest as
// alternatives for the same channel (jashvibes' "Alternative group").
const seenBigboss = new Set();
const bigboss = bigbossCandidates
  .sort((a, b) => b.score - a.score)
  .filter((c) => (seenBigboss.has(c.url) ? false : seenBigboss.add(c.url)));
const variants = Math.max(1, Number(config.bigbossVariants || 3));
bigboss.slice(0, variants).forEach((c, index) => {
  const suffix = index === 0 ? '' : c.quality >= 4 ? ' (4K alt)' : c.quality === 3 ? ' (FHD alt)' : ` (alt ${index + 1})`;
  take(c, `Bigg Boss Tamil 24/7${suffix}`);
});
stats.dropped.duplicateChannel += Math.max(0, bigboss.length - variants);

// Tamil: rank by evidence quality, then alphabetically, then apply the cap so a
// giant aggregator dump cannot bury the list.
const tamilRanked = [...byKey.values()]
  .filter((c) => c.section === 'tamil')
  .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
const maxTamil = Number(config.maxTamil || 0);
const tamil = maxTamil > 0 ? tamilRanked.slice(0, maxTamil) : tamilRanked;
if (maxTamil > 0) stats.dropped.capped += Math.max(0, tamilRanked.length - tamil.length);
stats.tamilAvailable = tamilRanked.length;
for (const c of tamil.sort((a, b) => a.name.localeCompare(b.name))) take(c, c.name);

const familyOrder = ['star', 'sony', 'willow', 'cricbuzz', 'fancode'];

/** "ENG | Grandstand 2" in group "Fancode | Sportlink" is meaningless on its own. */
function sportsDisplayName(c) {
  const family = familyOrder.find((f) => c.name.toLowerCase().includes(f));
  if (family) return c.name;
  const fromGroup = familyOrder.find((f) => String(c.group || '').toLowerCase().includes(f));
  if (!fromGroup) return c.name;
  const label = fromGroup === 'fancode' ? 'FanCode' : fromGroup.charAt(0).toUpperCase() + fromGroup.slice(1);
  return `${label} — ${c.name}`;
}
function sportsRank(c) {
  const n = c.name.toLowerCase();
  const fam = familyOrder.findIndex((f) => n.includes(f));
  let rank = (fam === -1 ? familyOrder.length : fam) * 100;
  if (/tamil/i.test(n)) rank -= 50;           // Tamil feeds first
  if (!/tamil|hindi|telugu|kannada|malayalam/i.test(n)) rank -= 25; // then language-neutral HD feeds
  return rank;
}
const sports = [...byKey.values()].filter((c) => c.section === 'sports').sort((a, b) => sportsRank(a) - sportsRank(b) || a.name.localeCompare(b.name));
for (const c of sports) take(c, sportsDisplayName(c));

const cap = Number(config.maxPerSection || 0);
const finals = cap > 0
  ? [
    ...picked.filter((c) => c.section === 'bigboss'),
    ...picked.filter((c) => c.section === 'tamil').slice(0, cap),
    ...picked.filter((c) => c.section === 'sports').slice(0, cap),
  ]
  : picked;

for (const c of finals) stats.sections[c.section] += 1;

/* ----------------------------------------------------------- render M3U */

const GROUP_LABEL = { bigboss: 'Bigg Boss 24/7', tamil: 'Tamil', sports: 'Sports' };

/**
 * Attribute values must not contain `"` or `,`.
 *   • jashvibes' importer splits #EXTINF on the FIRST comma, so a comma inside
 *     tvg-logo (Hotstar logo URLs are full of them: `f_auto,q_90,w_1080/…`)
 *     swallows the rest of the line into the channel name.
 *   • commas are legal when %-encoded, so logos keep working everywhere else.
 */
function attrValue(value = '', { url = false } = {}) {
  let out = String(value).replace(/[\r\n"]+/g, ' ').trim();
  out = url ? out.replace(/,/g, '%2C') : out.replace(/,/g, ' ');
  return out;
}

function renderEntry(c) {
  const attrs = [
    c.tvgId ? `tvg-id="${attrValue(c.tvgId)}"` : 'tvg-id=""',
    `tvg-name="${attrValue(c.displayName)}"`,
    c.logo ? `tvg-logo="${attrValue(c.logo, { url: true })}"` : '',
    `group-title="${GROUP_LABEL[c.section]}"`,
    c.language ? `tvg-language="${attrValue(c.language)}"` : '',
  ].filter(Boolean).join(' ');

  const lines = [`#EXTINF:-1 ${attrs},${attrValue(c.displayName)}`];

  if (c.keyId && c.key) {
    lines.push(`#KODIPROP:inputstream.adaptive.manifest_type=${c.format === 'dash' ? 'mpd' : 'hls'}`);
    lines.push('#KODIPROP:inputstream.adaptive.license_type=clearkey');
    lines.push(`#KODIPROP:inputstream.adaptive.license_key=${c.keyId}:${c.key}`);
  }
  if (c.userAgent) lines.push(`#EXTVLCOPT:http-user-agent=${sanitizeHeaderValue(c.userAgent)}`);
  if (c.referer) lines.push(`#EXTVLCOPT:http-referrer=${sanitizeHeaderValue(c.referer)}`);
  if (c.cookie) lines.push(`#EXTVLCOPT:http-cookie=${sanitizeHeaderValue(c.cookie)}`);

  const json = {};
  if (c.userAgent) json['User-Agent'] = sanitizeHeaderValue(c.userAgent);
  if (c.referer) json.Referer = sanitizeHeaderValue(c.referer);
  if (c.cookie) json.Cookie = sanitizeHeaderValue(c.cookie);
  for (const [k, v] of Object.entries(c.headers || {})) {
    if (!/^(user-agent|cookie|referer|referrer)$/i.test(k) && v) json[k] = sanitizeHeaderValue(v);
  }
  if (Object.keys(json).length) lines.push(`#EXTHTTP:${JSON.stringify(json)}`);

  lines.push(c.url);
  return lines.join('\n');
}

const head = [
  '#EXTM3U',
  '#PLAYLIST:Jash Live — Tamil + Sports + Bigg Boss 24/7',
  `#GENERATED:${stats.generatedAt}`,
  `#TOTAL:${finals.length} (bigg boss ${stats.sections.bigboss}, tamil ${stats.sections.tamil}, sports ${stats.sections.sports})`,
  `#SOURCES:${stats.sources.filter((s) => s.ok).length}/${stats.sources.length} playlists`,// 
];

const body = [];
for (const section of ['bigboss', 'tamil', 'sports']) {
  const group = finals.filter((c) => c.section === section);
  if (!group.length) continue;
  body.push('', `# ===== ${GROUP_LABEL[section]} (${group.length}) =====`, '');
  for (const c of group) body.push(renderEntry(c), '');
}

const output = `${head.join('\n')}\n${body.join('\n')}`;

/* ------------------------------------------------------------ validation */

const problems = [];
if (finals.length < Number(config.minChannels || 1)) problems.push(`only ${finals.length} channels (min ${config.minChannels})`);
if (!stats.sections.bigboss) problems.push('no Bigg Boss Tamil feed found');
if (/[^\x09\x20-\xFF]/.test(output.replace(/[^\x00-\x7F]/g, (m) => m))) {
  // non-latin1 characters outside comments are fine for logos; only header lines matter
}
for (const line of output.split('\n')) {
  if (/^#(KODIPROP|EXTVLCOPT|EXTHTTP)/.test(line) && /[^\x09\x20-\xFF]/.test(line)) {
    problems.push(`non-ISO-8859-1 character in header line: ${line.slice(0, 60)}`);
    break;
  }
  if (/^https?:/.test(line) && !/^https?:\/\/[^\s]+$/.test(line)) problems.push(`malformed URL: ${line.slice(0, 60)}`);
  if (/^#EXTINF/.test(line)) {
    const head = line.slice(0, line.lastIndexOf(','));
    if (head.includes(',')) problems.push(`comma inside #EXTINF attributes breaks the jashvibes importer: ${line.slice(0, 60)}`);
  }
}

/* ---------------------------------------------------------------- write */

const outPath = args.out || config.output;
const statsPath = args.out ? `${outPath.replace(/\.m3u$/i, '')}.stats.json` : config.statsOutput;

// Don't churn the repo when nothing actually changed: the #GENERATED stamp alone
// must not create a commit every 30 minutes.
const withoutStamp = (text) => String(text).replace(/^#GENERATED:.*$/m, '');
let changed = true;
if (!args.force && fs.existsSync(outPath)) {
  try {
    changed = withoutStamp(fs.readFileSync(outPath, 'utf8')) !== withoutStamp(output);
  } catch { changed = true; }
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
if (changed) {
  fs.writeFileSync(outPath, output, 'utf8');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf8');
} else {
  log('No content change — output left untouched (no commit needed).');
}

log('');
log(`Sources OK        : ${stats.sources.filter((s) => s.ok).length}/${stats.sources.length}`);
log(`Dropped (vod rips): ${stats.dropped.vod}`);
log(`Dropped (expired) : ${stats.dropped.expired}`);
log(`Dropped (radio)   : ${stats.dropped.radio}`);
log(`Dropped (http:// ) : ${stats.dropped.insecure}   (mixed content on an HTTPS app)`);
log(`Dropped (raw .ts) : ${stats.dropped.rawTs}   (no browser support; allowRawTs to keep)`);
log(`Dropped (dupes)   : ${stats.dropped.duplicateChannel} channel / ${stats.dropped.duplicateUrl} url`);
log(`Bigg Boss 24/7    : ${stats.sections.bigboss}`);
log(`Tamil             : ${stats.sections.tamil}${stats.tamilAvailable > stats.sections.tamil ? ` (of ${stats.tamilAvailable} found, capped by maxTamil)` : ''}`);
log(`Sports            : ${stats.sections.sports}`);
log(`Output            : ${outPath} (${(output.length / 1024).toFixed(0)} KB)${changed ? '' : ' — unchanged'}`);

if (problems.length) {
  console.error(`\nFAILED validation:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
log('Validation        : OK');
