/**
 * The Tamil anime feed: a real pipeline over one catalogue, not an iframe of it.
 *
 *   /language/tamil[/page/N]      the list  → cards (title, TMDB id, poster, rating, kind)
 *   /series/<slug>                a title   → seasons + every episode (SxEp, still, href)
 *   /episode/<slug>-1x3/          an episode → a row of `div#options-N` servers
 *   <server page>                 the host  → a playable .m3u8, when the host publishes one
 *
 * Why scraping and not the player page: every host on that site ends in a JS player. One of them
 * (Vidmoly) writes its master playlist into `sources:[{file:'…'}]` as plain text, and its CDN answers
 * `Access-Control-Allow-Origin: *` with no referer or cookie — so the browser can play that HLS by
 * itself and this app's server never carries video bytes. That is the difference between a pipeline
 * and an embed, and it is the only shape that is free-tier-safe on Render/Koyeb (512 MB, no proxy
 * bandwidth, no headless browser). Hosts that build their URL in obfuscated script (the site's own
 * `as-cdn26` JWPlayer, `cloudy.upns.one`, `rubystm`) are *named* and linked, never faked.
 *
 * Rules this file keeps, same as `lib/sportsFeed.js`:
 *  - server-only; the view helpers live in `lib/animeTamilView.js`, which is what the client imports;
 *  - one upstream read per key per window, single-flight, `globalThis` so a dev reload is not a leak;
 *  - never writes to MongoDB; a restart just refetches;
 *  - only same-origin paths of the configured base are ever fetched (SSRF guard in `openPath`), and
 *    only hosts that have a rule below are followed one hop further;
 *  - an empty result is a failure (short window), so a cold start is retried instead of cached for hours.
 */

export const DEFAULT_BASE_URL = 'https://piratexplay.cc';
export const LISTING_PATH = '/language/tamil';

export const TTL_LISTING_MS = 6 * 60 * 60 * 1000;
export const TTL_TITLE_MS = 6 * 60 * 60 * 1000;
export const TTL_EPISODE_MS = 30 * 60 * 1000;
export const TTL_FAILURE_MS = 30 * 1000;

// The catalogue walk stops here rather than trusting whatever `page/N` the site happens to answer with.
export const MAX_LISTING_PAGE = 60;
// A page holds up to 16 servers; resolving all of them every time is rude and slow.
export const MAX_SOURCE_LOOKUPS = 6;

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Anything that has ever shown up as an ad, a redirect or a tracker on these pages. We never fetch them.
const DENY_HOST =
  /(googletagmanager|google-analytics|bysezejataos|essencereferencetummy|blurbsoutpry|casteschagoma|firevideoplayer|protectionthimbledespit|tracker\.|short\.icu|doubleclick|popads|propelller|juicyads)/i;

export function baseUrl(env = process.env) {
  const raw = String(env.ANIME_TAMIL_BASE_URL || DEFAULT_BASE_URL).trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    return DEFAULT_BASE_URL;
  }
  if (!/^https?:$/.test(url.protocol)) return DEFAULT_BASE_URL;
  return url.origin;
}

/**
 * The only URL builder the fetchers use: a path from this catalogue, or nothing.
 * Accepts `/series/x`, a bare slug, or an absolute URL on the same origin — and refuses the rest,
 * so a crafted `?u=` can never point the app's server at an internal address.
 */
export function openPath(value, { base = DEFAULT_BASE_URL, kind = '' } = {}) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 300) return '';
  const root = String(base).replace(/\/+$/, '');
  const candidate = /^[a-z]+:\/\//i.test(raw)
    ? raw
    : `/${raw.replace(/^\/+/, '')}`.replace(/^(?!\/)/, '/');
  let url;
  try {
    url = new URL(candidate, `${root}/`);
  } catch {
    return '';
  }
  if (url.origin !== root) return '';
  if (kind === 'title' && !/^\/(series|movies)\//.test(url.pathname)) return '';
  if (kind === 'episode' && !/^\/(episode|movies|watch)\//.test(url.pathname)) return '';
  const path = `${url.pathname}${url.search}`;
  return `${root}${path === '' ? '/' : path}`;
}

/** `/series/clevatess-season-1-258348` → 258348 (their ids are TMDB ids, which is what makes
 *  posters, and the aggregate anime APIs, usable without inventing anything). */
export function tmdbIdFromHref(href = '') {
  const m = String(href).match(/-(\d{3,10})(?:[/?#]|$)/);
  return m ? Number(m[1]) : 0;
}

export function seasonEpisodeFromHref(href = '') {
  const m = String(href).match(/-(\d+)x(\d+)\/?(?:[?#]|$)/);
  return m ? { season: Number(m[1]), episode: Number(m[2]) } : { season: 0, episode: 0 };
}

function hostOf(value = '') {
  try {
    return new URL(value).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function absolute(value, base) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, `${base}/`).href;
  } catch {
    return '';
  }
}

function decodeEntities(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&minus;/g, '-')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `image.tmdb.org/t/p/w500/x.jpg` → the same art at a size we choose. */
export function resizeTmdbPoster(url = '', size = 'w342') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  return raw.replace(/\/t\/p\/w\d+\//, `/t/p/${size}/`).replace(/\/t\/p\/original\//, `/t/p/${size}/`);
}

/* ------------------------------------------------------------------------- *
 * 1 · the listing
 * ------------------------------------------------------------------------- */

const CARD_SPLIT = /<li[^>]+class="[^"]*\bpost\b[^"]*"[^>]*>([\s\S]*?)<\/li>/g;

function parseCard(block, base) {
  const href = (block.match(/class="lnk-blk"[^>]*\s+href="([^"]+)"|href="([^"]+)"[^>]*class="lnk-blk"/) || []).slice(1).find(Boolean) || '';
  if (!href) return null;
  const path = absolute(href, base);
  if (!/\/(series|movies)\//.test(path)) return null;
  const kind = /\bpost\s+series\b/.test(block) ? 'series' : 'movie';
  const title = decodeEntities((block.match(/class="entry-title"[^>]*>([\s\S]*?)<\/(?:h2|h1)>/) || [])[1] || '');
  if (!title) return null;
  const poster = ((block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '').trim();
  const rating = Number((block.match(/class="vote"[^>]*>[\s\S]*?([\d.]+)\s*<\//) || [])[1] || 0);
  const action = decodeEntities((block.match(/class="watch btn[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
  // `-2012-133121` — the year sits right before the id; the century is not a capture, or `[1]` is just `20`.
  const year = (path.match(/-(?:19|20)\d{2}-\d{3,10}(?:[/?#]|$)/) || [''])[0].replace(/-/g, '').slice(0, 4);
  const seasons = kind === 'series' ? Number((path.match(/-season-(\d+)-/) || [])[1] || 1) : 0;
  return {
    id: `${kind}:${path}`,
    kind,
    title,
    href: path,
    path: path.replace(/^https?:\/\/[^/]+/, ''),
    tmdbId: tmdbIdFromHref(path),
    poster: poster ? resizeTmdbPoster(poster, 'w342') : '',
    posterFull: poster,
    rating: Number.isFinite(rating) ? rating : 0,
    year: (year.match(/(19|20)\d{2}/) || [])[0] || '',
    season: seasons,
    action,
  };
}

/**
 * The list, from the first grid only.
 *
 * A taxonomy page carries three `ul.post-lst` grids: the list itself, then two six-card sections the
 * site repeats on every page (measured: pages 1 and 70 share those 12 hrefs, and from page 14 on only
 * those two grids have cards at all). Reading every grid is how a 298-title catalogue turns into 824
 * with the same twelve films on each page — so the first grid is the list, and an empty first grid is the
 * end of it.
 */
export function parseListing(html = '', { base = baseUrl() } = {}) {
  const text = String(html || '');
  const all = text.match(/<ul[^>]+class="[^"]*post-lst[^"]*"[\s\S]*?<\/ul>/g) || [];
  // The list itself is the first grid; anything the source wraps in a `widget_…` container is a rotating
  // sidebar (measured: those two change between loads, so counting them makes the catalogue never end).
  const grids = all.filter((grid, index) => {
    const at = text.indexOf(grid);
    const before = text.slice(Math.max(0, at - 320), at);
    return !/id="widget_|class="[^"]*widget_/.test(before) || index === 0;
  });
  const list = grids[0] || '';
  const items = [];
  const seen = new Set();
  for (const block of list.match(CARD_SPLIT) || []) {
    const card = parseCard(block, base);
    if (!card || seen.has(card.path)) continue;
    seen.add(card.path);
    items.push(card);
  }
  const pages = (text.match(/\/language\/tamil\/page\/(\d+)/g) || [])
    .map((row) => Number(row.replace(/\D+/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    items,
    page: 1,
    grids: all.length,
    maxPage: pages.length ? Math.min(Math.max(...pages), MAX_LISTING_PAGE) : 1,
  };
}

export function listingUrl(base, page = 1, query = '') {
  const root = String(base).replace(/\/+$/, '');
  const which = Math.max(1, Math.floor(Number(page) || 1));
  const search = String(query || '').trim();
  if (search) return `${root}/?s=${encodeURIComponent(search)}`;
  return which <= 1 ? `${root}${LISTING_PATH}` : `${root}${LISTING_PATH}/page/${which}`;
}

/* ------------------------------------------------------------------------- *
 * 2 · a title: seasons + episodes
 * ------------------------------------------------------------------------- */

export function parseTitle(html = '', { base = baseUrl(), href = '' } = {}) {
  const text = String(html || '');
  const fromHeading = decodeEntities((text.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const fromMeta = decodeEntities((text.match(/property="og:title"\s+content="([^"]+)"/) || [])[1] || '')
    .replace(/\s+[-–]\s*PirateXPlay.*$/i, '');
  const title = fromHeading || fromMeta;
  const synopsis = decodeEntities((text.match(/property="og:description"\s+content="([^"]+)"/) || [])[1] || '')
    || decodeEntities((text.match(/name="description"\s+content="([^"]+)"/) || [])[1] || '');
  const status = decodeEntities((text.match(/>(\s*(?:Top Airing|Airing|Completed|Not yet aired|Finished)\s*)</) || [])[1] || '');
  const poster = resizeTmdbPoster((text.match(/<div[^>]*class="[^"]*thumb[^"]*"[\s\S]{0,600}?<img[^>]+src="([^"]+)"/) || [])[1] || '', 'w500');

  const seasons = [];
  for (const m of text.matchAll(/<a[^>]+href="([^"]+)"[^>]*class="season-btn([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const label = decodeEntities(m[3]);
    const url = absolute(m[1], base);
    if (!url || seasons.some((row) => row.href === url)) continue;
    seasons.push({ season: Number((url.match(/-season-(\d+)-/) || [])[1] || seasons.length + 1), label, href: url, active: /active/.test(m[2]) });
  }

  const episodes = [];
  const list = text.match(/<ul[^>]+id="episode_by_temp"[\s\S]*?<\/ul>/) || [];
  for (const block of list[0] ? list[0].match(/<li[\s\S]*?<\/li>/g) || [] : []) {
    const hrefMatch = block.match(/href="([^"]*\/episode\/[^"]+)"/) || block.match(/href="([^"]*\/movies\/[^"]+)"/);
    if (!hrefMatch) continue;
    const url = absolute(hrefMatch[1], base);
    const number = decodeEntities((block.match(/class="num-epi"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '').replace(/\s+/g, '');
    const label = decodeEntities((block.match(/class="entry-title"[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || '');
    const still = resizeTmdbPoster((block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '', 'w300');
    const { season, episode } = seasonEpisodeFromHref(url);
    const id = number || `${season}x${episode}` || url.split('/').filter(Boolean).pop();
    if (episodes.some((row) => row.href === url)) continue;
    episodes.push({
      id: String(id),
      season: season || Number((number.match(/^(\d+)x/) || [])[1] || 0),
      episode: episode || Number((number.match(/x(\d+)$/) || [])[1] || 0),
      title: label.replace(/\s*\d+x\d+\s*$/, '').trim(),
      still,
      href: url,
      path: url.replace(/^https?:\/\/[^/]+/, ''),
    });
  }

  return {
    id: `title:${href || title}`,
    title: title || 'Untitled',
    synopsis,
    status,
    poster,
    tmdbId: tmdbIdFromHref(href || ''),
    year: (text.match(/class="year"[\s\S]{0,140}?(19\d{2}|20\d{2})/) || [])[1]
      || (title.match(/\((19\d{2}|20\d{2})\)$/) || [])[1]
      || '',
    duration: ((text.match(/class="duration"[\s\S]{0,160}?(\d+\s*min)/) || [])[1] || '').trim(),
    seasons,
    episodes,
  };
}

/* ------------------------------------------------------------------------- *
 * 3 · an episode: the server list, then what is actually playable
 * ------------------------------------------------------------------------- */

/** `div#options-N` rows, in the site's own order. `data-src` is the lazy form, `src` the active one. */
export function parseServers(html = '', { base = baseUrl() } = {}) {
  const text = String(html || '');
  const out = [];
  for (const m of text.matchAll(/<div[^>]+id="options-(\d+)"([^>]*)>([\s\S]*?)(?=<div[^>]+id="options-\d+"|<\/section>|$)/g)) {
    const raw = (m[3].match(/(?:data-src|src)="([^"]+)"/) || [])[1] || '';
    const url = absolute(raw, base);
    if (!url || DENY_HOST.test(url)) continue;
    const host = hostOf(url);
    if (!host || out.some((row) => row.url === url)) continue;
    const type = serverKind(url);
    const name = labelForHost(host, url);
    out.push({
      index: Number(m[1]),
      id: `opt-${m[1]}`,
      url,
      host,
      // Their rotator tabs are indistinguishable by name, so the slot number is kept in the label —
      // a row on screen has to say which of the site's servers it is.
      label: type === 'rotator' ? `${name} server ${Number(m[1])}` : name,
      active: /\bon\b/.test(m[2]),
      type,
    });
  }
  if (!out.length) {
    // A `/movies/…` page keeps its player outside the tab strip.
    for (const m of text.matchAll(/<iframe[^>]+(?:data-src|src)="([^"]+)"/g)) {
      const url = absolute(m[1], base);
      if (!url || DENY_HOST.test(url) || out.some((row) => row.url === url)) continue;
      out.push({
        index: out.length,
        id: `bare-${out.length}`,
        url,
        host: hostOf(url),
        label: labelForHost(hostOf(url), url),
        active: out.length === 0,
        type: serverKind(url),
      });
    }
  }
  return out;
}

function serverKind(url = '') {
  if (/proxy\/multi\.php/.test(url)) return 'multi';
  if (/proxy\/play\.php/.test(url)) return 'wrapped';
  if (/public\/player\//.test(url)) return 'rotator';
  return 'embed';
}

/** The site's own language map is base64 in the query string — read it, and say what came of it. */
export function decodeLanguageMap(url = '') {
  const data = (String(url).match(/[?&]data=([A-Za-z0-9+/=]+)/) || [])[1] || '';
  if (!data) return [];
  let json = '';
  try {
    json = Buffer.from(data, 'base64').toString('utf8');
  } catch {
    return [];
  }
  try {
    const rows = JSON.parse(json);
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({ language: decodeEntities(row?.language || ''), url: String(row?.link || '').trim() }))
      .filter((row) => row.language && row.url);
  } catch {
    return [];
  }
}

const HOST_LABEL = {
  'piratexplay.cc': 'PirateXPlay',
  'toonstream.world': 'PirateXPlay',
  'vidmoly.net': 'Vidmoly',
  'vidmoly.biz': 'Vidmoly',
  'emturbovid.com': 'TurboVid',
  'turbovidhls.com': 'TurboVid',
  'turbovid.top': 'TurboVid',
  'as-cdn26.top': 'PirateXPlay CDN',
  'abyssplayer.com': 'AbyssPlayer',
  'strmup.cc': 'StrmUp',
  'rubystm.com': 'RubyStream',
  'cloudy.upns.one': 'Upns',
  'animedekho.app': 'AnimeDekho',
  'blakiteapi.xyz': 'Blakite',
};

function labelForHost(host = '', url = '') {
  if (HOST_LABEL[host]) return HOST_LABEL[host];
  if (/filesforever\.link$/.test(host)) {
    const tier = host.split('.')[0];
    return `FilesForever ${tier === 'fhd' ? '1080p' : tier === 'hd' ? '720p' : tier === 'sd' ? '480p' : ''}`.trim();
  }
  return host.split('.').slice(-2, -1)[0]?.replace(/^\w/, (c) => c.toUpperCase()) || 'Server';
}

/* -- resolvers: one rule per host that publishes a fetchable address -- */

const M3U8_IN_PAGE = /["'](https?:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)["']/g;

function manifestsFrom(html = '') {
  const found = [];
  for (const m of String(html).matchAll(M3U8_IN_PAGE)) {
    const url = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    if (DENY_HOST.test(url)) continue;
    if (!found.some((row) => row.url === url)) found.push({ url, kind: 'hls' });
  }
  return found;
}

function vidmolyPoster(html = '') {
  return (String(html).match(/https?:\/\/[a-z0-9.-]*vmbox[^"'\\\s]+\.(?:jpe?g|png)/i) || [])[0] || '';
}

export const HOST_RULES = [
  {
    id: 'vidmoly',
    label: 'Vidmoly',
    // Two domains in the wild; the page carries the manifest as plain text inside `sources:[{file:'…'}]`,
    // and `vmbox.space` answers `access-control-allow-origin: *` with no referer and no cookie.
    test: (host) => /(^|\.)vidmoly\./.test(host),
    needsPage: true,
    generic: false,
    extract(html = '') {
      const direct = (String(html).match(/sources:\s*\[\s*\{\s*file:\s*['"](https?:\/\/[^'"]+master\.m3u8[^'"]*)['"]/) || [])[1] || '';
      const streams = direct ? [{ url: direct, label: 'Auto (HLS)', kind: 'hls' }] : [];
      const poster = vidmolyPoster(html);
      if (streams.length) streams.forEach((row) => { row.poster = poster; });
      return { ok: streams.length > 0, streams, poster, via: direct ? 'vidmoly' : '', note: direct ? '' : 'no manifest in the page' };
    },
  },
  {
    id: 'turbovid',
    label: 'TurboVid',
    test: (host) => /(^|\.)(em)?turbovid(hls|player)?\.(com|top|xyz|me|api)$|turboviplay\.com$/.test(host),
    needsPage: true,
    generic: true,
    extract(html = '') {
      const rows = manifestsFrom(html).slice(0, 3);
      return {
        ok: rows.length > 0,
        streams: rows.map((row, i) => ({ ...row, label: rows.length > 1 ? `Playlist ${i + 1}` : 'Auto (HLS)' })),
        via: rows.length ? 'turbovid' : '',
        note: rows.length ? '' : 'no manifest in the page',
      };
    },
  },
];

export function ruleForHost(host = '') {
  return HOST_RULES.find((rule) => rule.test(String(host).toLowerCase())) || null;
}

export function makeHttpError(message = 'upstream did not answer', status = 0) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function timeoutSignal(ms) {
  try {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  if (typeof fetchImpl !== 'function') throw makeHttpError('no fetch implementation');
  const response = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en' },
    redirect: 'follow',
    cache: 'no-store',
    ...(timeoutSignal(timeoutMs) ? { signal: timeoutSignal(timeoutMs) } : {}),
  });
  if (!response?.ok) throw makeHttpError(`HTTP ${response?.status || 0}`, response?.status || 0);
  return String(await response.text());
}

/**
 * One server → a playable address. `wrapped` (the site's `play.php?url=` shim) is unwrapped so the
 * real host gets the chance; `multi` (its per-language map) is decoded and reported, never played —
 * those links point at `short.icu`, which is NXDOMAIN at the registry, so it is named as dead.
 */
export async function resolveServer(server, { fetchImpl = globalThis.fetch, env = process.env, depth = 0 } = {}) {
  const base = baseUrl(env);
  const url = String(server?.url || '');
  if (!url) return { ...server, ok: false, note: 'no address' };

  if (server.type === 'multi') {
    const languages = decodeLanguageMap(url);
    return {
      ...server,
      ok: false,
      languages,
      note: languages.length
        ? `lists ${languages.map((row) => row.language).join(', ')} on a shortener that no longer resolves`
        : 'its language map is empty',
    };
  }

  let target = url;
  if (server.type === 'wrapped') {
    const inner = (url.match(/[?&]url=([^&]+)/) || [])[1] || '';
    if (!inner) return { ...server, ok: false, note: 'wrapper has nothing inside it' };
    let decoded = inner;
    try {
      decoded = decodeURIComponent(inner);
    } catch {
      /* keep as-is */
    }
    const host = hostOf(decoded);
    if (!ruleForHost(host)) {
      return { ...server, ok: false, embeddedUrl: decoded, host, label: labelForHost(host, decoded), note: 'the address is built by that host’s script, so it is not playable here' };
    }
    target = decoded;
  }

  const host = hostOf(target);
  const rule = ruleForHost(host);
  if (!rule) {
    if (server.type === 'rotator' && depth < 1) {
      // Their own rotator page lists the real hosts; follow only the ones we can resolve.
      const page = await fetchText(target, { fetchImpl });
      const nested = parseServers(page, { base }).length
        ? parseServers(page, { base })
        : [...page.matchAll(/https?:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[^\s"'<>]+/gi)]
            .map((m) => ({ url: m[0], host: hostOf(m[0]) }))
            .filter((row) => ruleForHost(row.host));
      const wanted = nested.filter((row) => ruleForHost(row.host)).slice(0, 3);
      const rows = await Promise.all(wanted.map((row) => resolveServer(
        { index: `${server.index}.${row.url}`, id: row.url, url: row.url, host: row.host, label: labelForHost(row.host, row.url), type: 'embed', active: false },
        { fetchImpl, env, depth: depth + 1 },
      )));
      const good = rows.filter((row) => row.ok);
      return good.length
        ? { ...server, ...good[0], via: `${server.label} → ${good[0].via}` }
        : { ...server, ok: false, note: 'its rotator offers no resolvable host' };
    }
    return { ...server, ok: false, note: 'no resolver for this host' };
  }

  let html = '';
  try {
    html = rule.needsPage ? await fetchText(target, { fetchImpl }) : '';
  } catch (err) {
    return { ...server, ok: false, note: `${rule.label} did not answer (${err?.message || 'fetch failed'})` };
  }
  const out = rule.extract(html);
  if (!out.ok) return { ...server, ok: false, note: out.note || 'nothing usable in the page' };
  return {
    ...server,
    ok: true,
    streams: out.streams,
    url: out.streams[0].url,
    poster: out.poster || server.poster || '',
    via: out.via,
    note: out.note || '',
  };
}

/** Two servers of one file carry the same manifest, so the playable list is deduped by address and each
 *  row keeps the label of the server it came from. */
/**
 * Which playable row goes first. Measured on the same episode: Vidmoly's CDN answers
 * `access-control-allow-origin: *` on the playlist *and* the segments, so hls.js in the browser plays it;
 * TurboVid's playlist resolves too but its segments are served off Google Drive (`lh3.googleusercontent.com`)
 * without that header, which fails in a page — so it is offered, never auto-selected.
 */
export const SOURCE_PRIORITY = { vidmoly: 0, turbovid: 1 };

/**
 * Measured on the same episode: Vidmoly's CDN answers a cross-origin read, TurboVid's segments do not.
 * `via` is written by whoever found the row, so it is matched as a phrase rather than looked up exactly —
 * `PirateXPlay server 3 → turbovid` and `turbovid` are the same host to the sort.
 */
function rankOf(row = {}) {
  const hay = `${row.via || ''} ${row.host || ''} ${row.url || ''}`;
  const key = Object.keys(SOURCE_PRIORITY).find((name) => hay.includes(name));
  return key ? SOURCE_PRIORITY[key] : 9;
}

/** A manifest a browser can read is not a stream a browser can play: these hosts serve the segments
 *  themselves, and the segment CDN says nothing about cross-origin access. Kept as a second source,
 *  never presented as one that works. */
const CORS_HOSTILE = /turboviplay\.com|turbosplayer\.com|turbovidhls\.com|emturbovid\.com|turbovid/i;

export function streamWarning(row = {}) {
  const hay = `${row.url || ''} ${row.via || ''} ${row.host || ''}`;
  return CORS_HOSTILE.test(hay)
    ? 'this host publishes the manifest but not the segments — it can stall here, and plays on the source page'
    : '';
}

export function rankStreams(rows = []) {
  return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
}

export function dedupeStreams(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    for (const stream of row.streams || []) {
      if (!stream?.url || seen.has(stream.url)) continue;
      seen.add(stream.url);
      out.push({
        ...row,
        url: stream.url,
        streams: [stream],
        label: `${row.label}${stream.label && stream.label !== 'Auto (HLS)' ? ` · ${stream.label}` : ''}`,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------------- *
 * 4 · the cache — one place, same shape as the sports board
 * ------------------------------------------------------------------------- */

export function store(env = process.env) {
  if (typeof globalThis === 'undefined') return new Map();
  if (!globalThis.__jashAnimeTamil) globalThis.__jashAnimeTamil = new Map();
  return globalThis.__jashAnimeTamil;
}

/** `fresh` is inside its window; `stale` is the last good payload after the window, kept only as a
 *  fallback when a refresh fails — a page nobody can refresh is a page that lies. */
export function readCache(key, { now = Date.now(), env = process.env, stale = false } = {}) {
  const row = store(env).get(key);
  if (!row?.payload) return null;
  const age = now - row.at;
  if (age <= row.ttl) return { ...row.payload, cached: true, cacheAgeMs: age };
  if (!stale) return null;
  return { ...row.payload, cached: true, stale: true, cacheAgeMs: age };
}

export function writeCache(key, payload, ttlMs, { now = Date.now(), env = process.env } = {}) {
  store(env).set(key, { at: now, ttl: ttlMs, payload: { ...payload, ttlMs } });
  return payload;
}

/** Single-flight + "keep the last good page when the refresh fails". */
export async function cached(key, { ttlMs, failTtlMs = TTL_FAILURE_MS, fetchImpl, env = process.env, now = Date.now(), load }) {
  const hit = readCache(key, { now, env });
  if (hit) return hit;
  const table = store(env);
  const previous = table.get(key)?.payload || null;
  const pending = table.get(`${key}:pending`);
  if (pending) return pending;
  const run = (async () => {
    try {
      const payload = await load({ fetchImpl, env, now });
      const fresh = Boolean(payload?.ok && !payload?.empty);
      const window = fresh ? ttlMs : failTtlMs;
      // The payload carries its own window: a route that sets `Cache-Control` from `ttlMs` and a cache
      // that holds the row for a different length is how a page starts lying about its freshness.
      writeCache(key, { ...payload, generatedAt: payload?.generatedAt || now, ttlMs: window }, window, { now, env });
      return { ...payload, generatedAt: payload?.generatedAt || now, ttlMs: window, cached: false };
    } catch (err) {
      writeCache(key, { ok: false, error: err?.message || 'feed failed', empty: true }, failTtlMs, { now, env });
      if (previous) return { ...previous, cached: true, stale: true, refreshError: err?.message || 'feed failed' };
      throw err;
    } finally {
      table.delete(`${key}:pending`);
    }
  })();
  table.set(`${key}:pending`, run);
  return run;
}

/* ------------------------------------------------------------------------- *
 * 5 · the entry points the routes call
 * ------------------------------------------------------------------------- */

async function loadPage({ page = 1, query = '', force = false, fetchImpl, env, now }) {
  const key = `listing:${query || LISTING_PATH}:${page}`;
  if (force) store(env).delete(key);
  return cached(key, {
    ttlMs: TTL_LISTING_MS,
    failTtlMs: TTL_FAILURE_MS,
    fetchImpl,
    env,
    now,
    load: async ({ fetchImpl: impl, env: e }) => {
      const root = baseUrl(e);
      const url = listingUrl(root, page, query);
      const html = await fetchText(url, { fetchImpl: impl });
      const parsed = parseListing(html, { base: root });
      return {
        ok: parsed.items.length > 0,
        empty: parsed.items.length === 0,
        items: parsed.items,
        page: Math.max(1, Number(page) || 1),
        maxPage: parsed.maxPage,
        grids: parsed.grids,
        source: hostOf(url),
        url,
        error: parsed.items.length ? '' : 'that page had no titles',
      };
    },
  });
}

/** `all: true` walks every page of the taxonomy once, so the browse view is the whole catalogue
 *  and not a first page (the rule that came out of the ReTro grid). */
export async function loadListing({ page = 1, query = '', all = false, force = false, maxPages = MAX_LISTING_PAGE, fetchImpl = globalThis.fetch, env = process.env, now = Date.now() } = {}) {
  const first = await loadPage({ page: 1, query, force, fetchImpl, env, now });
  const which = Math.max(1, Number(page) || 1);
  if (!all) {
    const chunk = which === 1 ? first : await loadPage({ page: which, query, force, fetchImpl, env, now });
    return {
      ok: Boolean(chunk?.ok),
      items: chunk?.items || [],
      page: which,
      // The site's own pagination widget undercounts (it advertises 13 of 14), so "more" is decided by
      // whether a page answered with rows, not by its hint.
      maxPage: Math.max(Number(chunk?.maxPage) || 1, which, first?.maxPage || 1),
      hasNext: Boolean(chunk?.items?.length) && which < MAX_LISTING_PAGE,
      generatedAt: chunk?.generatedAt || now,
      source: chunk?.source || hostOf(baseUrl(env)),
      error: chunk?.ok ? '' : chunk?.error || 'the listing did not answer',
      cached: chunk?.cached,
      ttlMs: chunk?.ttlMs,
    };
  }
  const rows = [];
  const seen = new Set();
  let pages = 0;
  let complete = false;
  for (let n = 1; n <= maxPages; n += 1) {
    const chunk = n === 1 ? first : await loadPage({ page: n, query, fetchImpl, env, now });
    const found = chunk?.items || [];
    if (!found.length) {
      // An empty page is the end of the taxonomy. Anything else would be guessing at a limit.
      complete = n > 1;
      break;
    }
    pages = n;
    for (const item of found) {
      if (seen.has(item.path)) continue;
      seen.add(item.path);
      rows.push(item);
    }
  }
  return {
    ok: rows.length > 0,
    empty: rows.length === 0,
    items: rows,
    all: true,
    page: pages,
    maxPage: pages,
    pagesFetched: pages,
    hasNext: !complete,
    generatedAt: now,
    source: first?.source || hostOf(baseUrl(env)),
    error: rows.length ? '' : 'the listing did not answer',
    complete,
    ttlMs: TTL_LISTING_MS,
  };
}

export async function loadTitle({ path = '', force = false, fetchImpl = globalThis.fetch, env = process.env, now = Date.now() } = {}) {
  const base = baseUrl(env);
  const url = openPath(path, { base, kind: 'title' });
  if (!url) return { ok: false, error: 'unknown title' };
  const key = `title:${url}`;
  if (force) store(env).delete(key);
  return cached(key, {
    ttlMs: TTL_TITLE_MS,
    failTtlMs: TTL_FAILURE_MS,
    fetchImpl,
    env,
    now,
    load: async ({ fetchImpl: impl }) => {
      const html = await fetchText(url, { fetchImpl: impl });
      const parsed = parseTitle(html, { base: baseUrl(env), href: url });
      const isMovie = /\/movies\//.test(url);
      const episodes = isMovie
        ? [{ id: 'movie', season: 0, episode: 0, title: parsed.title, still: parsed.poster, href: url, path: url.replace(/^https?:\/\/[^/]+/, '') }]
        : parsed.episodes;
      return {
        ok: episodes.length > 0,
        empty: episodes.length === 0,
        title: { ...parsed, episodes, kind: isMovie ? 'movie' : 'series' },
        source: hostOf(url),
        url,
        error: episodes.length ? '' : 'this title has no episode list on the source',
      };
    },
  });
}

export async function loadEpisode({ path = '', force = false, fetchImpl = globalThis.fetch, env = process.env, now = Date.now() } = {}) {
  const base = baseUrl(env);
  const url = openPath(path, { base, kind: 'episode' });
  if (!url) return { ok: false, error: 'unknown episode' };
  const key = `ep:${url}`;
  if (force) store(env).delete(key);
  return cached(key, {
    ttlMs: TTL_EPISODE_MS,
    failTtlMs: TTL_FAILURE_MS,
    fetchImpl,
    env,
    now,
    load: async ({ fetchImpl: impl }) => {
      const root = baseUrl(env);
      const html = await fetchText(url, { fetchImpl: impl });
      const servers = parseServers(html, { base: root });
      const wanted = servers.filter((row) => ruleForHost(row.host) || row.type === 'rotator' || row.type === 'wrapped').slice(0, MAX_SOURCE_LOOKUPS);
      const settled = await Promise.allSettled(wanted.map((row) => resolveServer(row, { fetchImpl: impl, env })));
      const rows = settled.map((row, i) => (row.status === 'fulfilled' ? row.value : { ...wanted[i], ok: false, note: row?.reason?.message || 'lookup failed' }));
      const playable = rankStreams(dedupeStreams(rows.filter((row) => row.ok && row.streams?.length)))
        .map((row) => ({ ...row, warn: streamWarning(row) }));
      const meta = parseTitle(html, { base: root, href: url });
      return {
        ok: rows.length > 0,
        empty: rows.length === 0,
        episode: {
          href: url,
          path: url.replace(/^https?:\/\/[^/]+/, ''),
          title: meta.title,
          sources: rows.map((row) => ({ id: row.id, label: row.label, host: row.host, index: row.index, type: row.type, ok: Boolean(row.ok), note: row.note || '', streams: row.streams || [], poster: row.poster || '', via: row.via || '' })),
          playable,
          open: url,
          source: hostOf(url),
        },
        source: hostOf(url),
        url,
        error: rows.length ? '' : 'this episode page has no servers',
      };
    },
  });
}

