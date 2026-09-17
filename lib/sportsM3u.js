/*
 * lib/sportsM3u.js — the playlist ingest for the live m3u dump family.
 *
 * The FanCode JSON dump this app started with went quiet on 2026-09-03; the same
 * publisher's `.m3u` playlists kept updating every ~15 minutes, and they turned out
 * to be a family: FanCode (zyphx8), SonyLiv (zyphora) and ICC (nexphi0), all written
 * by the same refresh bot in one shared dialect:
 *
 *   #EXTM3U
 *   #DATE:- Thursday, 17 September 2026 at 8:42:10 pm
 *   #EXTINF:-1 tvg-id="4248492" tvg-name="India Vs Afghanistan" tvg-language="English" group-title="Cricket",ENG | India Vs Afghanistan
 *   #EXTVLCOPT:http-user-agent=ReactNativeVideo/9.11.1
 *   #KODIPROP:inputstream.adaptive.license_key={"keys":[{"kty":"oct","k":"…","kid":"…"}]}
 *   https://edge.example/live.m3u8|User-Agent=…&Referer=https://fancode.com/
 *
 * This module is only a *parser*: text in, plain entries out. Turning an entry into a
 * board card is `normalizeM3uEntry` in `lib/sportsFeed.js`, so all the honesty rules
 * (staleness, quarantine, readiness) stay in one place.
 *
 * Pure and sync — like everything else in this layer, tests drive it with fixture text.
 */

/** The three playlists, in rank order. Each is env-overridable at the call site. */
export const M3U_FANCODE = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.m3u';
export const M3U_SONYLIV = 'https://raw.githubusercontent.com/doctor-8trange/zyphora/refs/heads/main/data/sony.m3u';
export const M3U_ICC = 'https://raw.githubusercontent.com/doctor-8trange/nexphi0/refs/heads/main/data/icc.m3u';

export const M3U_SOURCES = [
  { kind: 'fancode', url: M3U_FANCODE, label: 'FanCode live playlist' },
  { kind: 'sonyliv', url: M3U_SONYLIV, label: 'SonyLiv live playlist' },
  { kind: 'icc', url: M3U_ICC, label: 'ICC live playlist' },
];

/** The playlist's own date line, in both dialects the family uses, read as IST (+05:30). */
export function parseM3uDate(raw = '') {
  const text = String(raw || '').replace(/^#\s*DATE:\s*-?\s*/i, '').trim();
  if (!text) return 0;
  /* "17-09-2026 21:00" (zyphora/sony) */
  const short = text.match(/(\d{1,2})-(\d{1,2})-(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (short) {
    const [, dd, mon, yyyy, hh, mm, ss] = short;
    return Date.UTC(Number(yyyy), Number(mon) - 1, Number(dd), Number(hh) - 5, Number(mm) - 30, Number(ss) || 0);
  }
  /* "Thursday, 17 September 2026 at 8:42:10 pm" (zyphx8/fancode) */
  const long = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+at)?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (long) {
    const [, dd, monName, yyyy, hh, mm, ss, ap] = long;
    const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = months[monName.slice(0, 3).toLowerCase()];
    if (month === undefined) return 0;
    const hour24 = (Number(hh) % 12) + (/p/i.test(ap || '') ? 12 : 0);
    return Date.UTC(Number(yyyy), month, Number(dd), hour24 - 5, Number(mm) - 30, Number(ss) || 0);
  }
  const fallback = Date.parse(text);
  return Number.isFinite(fallback) ? fallback : 0;
}

const attr = (line, key) => {
  const match = line.match(new RegExp(`${key}="([^"]*)"`));
  return match ? match[1].trim() : '';
};

/** "ENG | India Vs Afghanistan" → { langCode, name }; a name with no pipe is still a name. */
function splitDisplay(display = '') {
  const pipe = display.split('|');
  if (pipe.length >= 2) {
    return { langCode: pipe[0].trim().toUpperCase().slice(0, 8), name: pipe.slice(1).join('|').trim() };
  }
  return { langCode: '', name: display.trim() };
}

/** The `url|User-Agent=…&Referer=…` suffix some players need, parsed into named headers. */
function splitPipeParams(urlLine = '') {
  const at = urlLine.indexOf('|');
  if (at < 0) return { url: urlLine.trim(), headers: {} };
  const url = urlLine.slice(0, at).trim();
  const headers = {};
  for (const pair of urlLine.slice(at + 1).split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    headers[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim();
  }
  return { url, headers };
}

/** A ClearKey KODIPROP payload: `{"keys":[{"kty":"oct","k":"…","kid":"…"}],"type":"temporary"}` */
function parseClearKey(json = '') {
  try {
    const parsed = JSON.parse(json);
    const key = (parsed.keys || []).find((entry) => entry.k && entry.kid);
    if (!key) return null;
    return { keyId: key.kid, key: key.k };
  } catch {
    return null;
  }
}

/**
 * Parse one playlist. `now` only feeds the returned `ageMs`; nothing here decides
 * liveness — that judgement belongs to the feed layer (`STALE_DUMP_MS`).
 */
export function parseM3u(text = '', { now = Date.now() } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  let dumpAt = '';
  let dumpMs = 0;
  const entries = [];
  let pending = null;
  const finish = (entry) => { if (entry && entry.url) entries.push(entry); pending = null; };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#DATE:/i.test(line)) {
      dumpAt = line.replace(/^#\s*DATE:\s*-?\s*/i, '').trim();
      dumpMs = parseM3uDate(dumpAt);
      continue;
    }
    if (/^#EXTINF/i.test(line)) {
      finish(pending);
      const attrsAndTitle = line.replace(/^#EXTINF:\s*-?\d+(\.\d+)?\s*/, '');
      const comma = attrsAndTitle.indexOf(',');
      const attrPart = comma >= 0 ? attrsAndTitle.slice(0, comma) : attrsAndTitle;
      const display = comma >= 0 ? attrsAndTitle.slice(comma + 1) : '';
      const { langCode, name } = splitDisplay(display);
      pending = {
        id: attr(attrPart, 'tvg-id') || name.slice(0, 40),
        tvgName: attr(attrPart, 'tvg-name'),
        lang: attr(attrPart, 'tvg-language'),
        group: attr(attrPart, 'group-title'),
        poster: attr(attrPart, 'tvg-logo'),
        langCode,
        name: name || attr(attrPart, 'tvg-name'),
        url: '',
        format: 'hls',
        userAgent: '',
        referer: '',
        origin: '',
        extraHeaders: {},
        clearKeyId: '',
        clearKey: '',
      };
      continue;
    }
    if (!pending) continue;
    if (/^#EXTVLCOPT:http-user-agent/i.test(line)) { pending.userAgent = line.split('=').slice(1).join('=').trim(); continue; }
    if (/^#EXTVLCOPT:http-referrer/i.test(line)) { pending.referer = line.split('=').slice(1).join('=').trim(); continue; }
    if (/^#EXTVLCOPT:http-origin/i.test(line)) { pending.origin = line.split('=').slice(1).join('=').trim(); continue; }
    if (/^#EXTHTTP:/i.test(line)) {
      try {
        const parsed = JSON.parse(line.replace(/^#EXTHTTP:/i, ''));
        for (const [key, value] of Object.entries(parsed)) {
          const lower = key.toLowerCase();
          if (lower === 'user-agent') pending.userAgent = String(value);
          else if (lower === 'referer') pending.referer = String(value);
          else if (lower === 'origin') pending.origin = String(value);
          else pending.extraHeaders[lower] = String(value);
        }
      } catch { /* a malformed directive is skipped, never fatal */ }
      continue;
    }
    if (/^#KODIPROP:inputstream\.adaptive\.manifest_type=(\w+)/i.test(line)) {
      pending.format = /mpd/i.test(line) ? 'dash' : 'hls';
      continue;
    }
    if (/^#KODIPROP:inputstream\.adaptive\.license_key/i.test(line)) {
      const json = line.slice(line.indexOf('=') + 1).replace(/^inputstream\.adaptive\.license_key=/i, '');
      const clearKey = parseClearKey(json);
      if (clearKey) { pending.clearKeyId = clearKey.keyId; pending.clearKey = clearKey.key; }
      continue;
    }
    if (/^#KODIPROP:inputstream\.adaptive\.license_type/i.test(line)) continue;
    if (line.startsWith('#')) continue;
    /* The first non-directive line after an EXTINF is the stream URL. */
    const { url, headers } = splitPipeParams(line);
    pending.url = url;
    if (headers['user-agent'] && !pending.userAgent) pending.userAgent = headers['user-agent'];
    if (headers['referer'] && !pending.referer) pending.referer = headers['referer'];
    if (headers['origin'] && !pending.origin) pending.origin = headers['origin'];
    for (const [key, value] of Object.entries(headers)) {
      if (key === 'user-agent' || key === 'referer' || key === 'origin') continue;
      pending.extraHeaders[key] = value;
    }
    finish(pending);
  }
  finish(pending);

  return {
    dumpAt,
    dumpMs,
    ageMs: dumpMs ? Math.max(0, now - dumpMs) : 0,
    entries,
  };
}
