/**
 * Fresh moviesda resolver — v10.6.0.
 *
 * Stored direct URLs from the scraper rot within hours (htag/etag tokens
 * expire; the hosts then serve a Fastly HTML page instead of video). So the
 * app never plays stored links: it walks the moviesda hop chain ON DEMAND and
 * returns links minted seconds earlier.
 *
 *   item page → folder groups → resolution pages → /download/<id> →
 *   download/file/<id> → download/page/<id> → server candidates →
 *   302-resolved direct MP4 (onestream candidates become embeds)
 *
 * Results are cached ~45 minutes per page URL (tokens live a few hours, so a
 * 45-minute-old resolve is still playable while it stays hot).
 */
import * as cheerio from 'cheerio';

const BASES = ['https://moviesda34.com', 'https://movies.downloadpage.xyz'];
const TIMEOUT_MS = Number(process.env.MOVIESDA_TIMEOUT_MS || 12000);
const RETRIES = 2;
const DELAY_MS = 400;
const CACHE_TTL_MS = Number(process.env.MOVIESDA_RESOLVE_TTL_MS || 45 * 60 * 1000);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const resolveCache = new Map(); // pageUrl -> { at, result }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function absolute(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return '';
  }
}

async function fetchWithRetry(url, { attempt = 0, referer } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: referer ? { ...HEADERS, Referer: referer } : HEADERS,
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (attempt < RETRIES) {
      await sleep(900 * (attempt + 1));
      return fetchWithRetry(url, { attempt: attempt + 1, referer });
    }
    throw error;
  }
}

/** Fetch a path (try every mirror) or an absolute URL (as-is). */
async function fetchPage(urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    return { html: await fetchWithRetry(urlOrPath), base: new URL(urlOrPath).origin };
  }
  let lastError = new Error('no mirror answered');
  for (const base of BASES) {
    try {
      return { html: await fetchWithRetry(base + urlOrPath), base };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Read at most `max` bytes of a body — CDNs sometimes ignore Range. */
async function readCapped(response, max) {
  const reader = response.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  try { await reader.cancel(); } catch { /* already closed */ }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

/** Stage 1: folder links on a listing or item page (div.f blocks). */
async function getMovieFolders(pageUrl) {
  const { html, base } = await fetchPage(pageUrl);
  const $ = cheerio.load(html);
  const out = [];
  $('div.f a, div.folder a, a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || href === '/' || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (/telegram|t\.me|whatsapp|instagram/i.test(label + href)) return;
    if (href.includes('-movies/') || href.includes('collection') || href.includes('isaidub')) return;
    const hasQuality = /\d+p|hd|predvd|dvd|blu/i.test(label) || /\d+p|hd-|predvd|dvd|blu/i.test(href);
    if (!hasQuality) return;
    const abs = absolute(base, href);
    if (abs) out.push({ url: abs, label });
  });
  const seen = new Set();
  return out.filter((row) => (seen.has(row.url) ? false : (seen.add(row.url), true)));
}

/** Stage 2: resolution subfolder links inside one folder page. */
async function getResolutionSubfolders(folderUrl) {
  const { html, base } = await fetchPage(folderUrl);
  const $ = cheerio.load(html);
  const out = [];
  $('div.f a, div.folder a, a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || href === '/' || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (/telegram|t\.me|whatsapp|instagram/i.test(label + href)) return;
    if (href.includes('-movies/') || href.includes('collection') || href.includes('isaidub')) return;
    if (!/\d+p|hd|predvd|dvd|blu/i.test(label + href)) return;
    const abs = absolute(base, href);
    if (abs) out.push({ url: abs, label });
  });
  const seen = new Set();
  return out.filter((row) => (seen.has(row.url) ? false : (seen.add(row.url), true)));
}

/** Stage 3: /download/<id> selection links on a resolution page. */
async function getDownloadSelectionUrls(resolutionUrl) {
  const { html, base } = await fetchPage(resolutionUrl);
  const $ = cheerio.load(html);
  const set = new Set();
  $('a, div.f a, div.folder a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.startsWith('/download/')) set.add(absolute(base, href));
  });
  return [...set];
}

/** Stage 3b: download/file links on a /download/<id> page. */
async function getIntermediateServerUrls(selectionUrl) {
  const { html, base } = await fetchPage(selectionUrl);
  const $ = cheerio.load(html);
  const out = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('moviespage.xyz/download/file/') || href.includes('/download/file/')) {
      out.push(absolute(base, href));
    }
  });
  return [...new Set(out)];
}

/** Stage 4: candidate server links on a download/file or download/page URL. */
async function getServerCandidates(serverPageUrl) {
  const extract = (html, base) => {
    const $ = cheerio.load(html);
    const out = [];
    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (href && (/\.mp4/i.test(href) || /cdnserver|download\.php|fastbytes|onestream|uptodl/i.test(href))) {
        out.push({ url: absolute(base, href), label: 'server' });
      }
    });
    return out;
  };

  const { html, base } = await fetchPage(serverPageUrl);
  let candidates = extract(html, base);
  if (!candidates.length) {
    // download/file/<id> pages are bare stubs pointing at download/page/<id>.
    const $ = cheerio.load(html);
    const nextHop = $('a[href*="download/page/"]').first().attr('href');
    if (nextHop) {
      const pageUrl = absolute(base, nextHop);
      const inner = await fetchWithRetry(pageUrl);
      candidates = extract(inner, pageUrl);
    }
  }
  return candidates;
}

/** Stage 5: 302-resolve one candidate (onestream stays an embed). */
async function resolveServerLink(url) {
  if (/onestream/i.test(url)) return { type: 'iframe', url };
  for (let attempt = 0; attempt <= 1; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { ...HEADERS, Referer: 'https://movies.downloadpage.xyz/' },
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });
      const location = response.headers.get('location');
      if (location && /^https?:\/\//.test(location)) {
        return { type: 'mp4', url: location };
      }
      const ctype = (response.headers.get('content-type') || '').toLowerCase();
      if (response.ok && /video\/|octet-stream/.test(ctype)) {
        try { await response.body.cancel(); } catch { /* drained */ }
        return { type: 'mp4', url };
      }
      if (response.ok) {
        const body = await readCapped(response, 4096);
        const meta = body.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
        if (meta) return { type: 'mp4', url: meta[0] };
      }
      return null;
    } catch (error) {
      if (attempt >= 1) return null;
      await sleep(700);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Walk the whole chain for one item page under a time budget and return
 * freshly minted links: { mp4s: [{quality, url}], embeds: [{quality, url}] }.
 */
export async function resolveMoviesdaMovie(pageUrl, { budgetMs = 25000, maxRes = 3, maxSel = 3, maxServers = 2, maxCandidates = 4 } = {}) {
  const cached = resolveCache.get(pageUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const deadline = Date.now() + budgetMs;
  const out = { mp4s: [], embeds: [] };
  const seen = new Set();
  const push = (quality, resolved) => {
    if (!resolved || seen.has(resolved.url)) return;
    seen.add(resolved.url);
    if (resolved.type === 'mp4') out.mp4s.push({ quality, url: resolved.url });
    else out.embeds.push({ quality, url: resolved.url });
  };

  let groups = [];
  try {
    groups = await getMovieFolders(pageUrl);
  } catch { /* some item pages link resolutions directly */ }
  const groupPages = groups.length ? groups.slice(0, 2) : [{ url: pageUrl, label: '' }];

  for (const group of groupPages) {
    if (Date.now() > deadline) break;
    await sleep(DELAY_MS);
    let resolutions = [];
    try {
      resolutions = await getResolutionSubfolders(group.url);
    } catch { continue; }

    for (const res of resolutions.slice(0, maxRes)) {
      if (Date.now() > deadline) break;
      await sleep(DELAY_MS);
      const quality = (res.label.match(/(1080p|720p|480p|360p)/i) || ['HD'])[0];

      let selections = [];
      try {
        selections = await getDownloadSelectionUrls(res.url);
      } catch { continue; }

      for (const selection of selections.slice(0, maxSel)) {
        if (Date.now() > deadline) break;
        await sleep(DELAY_MS);
        let serverPages = [];
        try {
          serverPages = await getIntermediateServerUrls(selection);
        } catch { continue; }

        for (const serverPage of serverPages.slice(0, maxServers)) {
          if (Date.now() > deadline) break;
          await sleep(DELAY_MS);
          let candidates = [];
          try {
            candidates = await getServerCandidates(serverPage);
          } catch { continue; }

          for (const candidate of candidates.slice(0, maxCandidates)) {
            if (Date.now() > deadline) break;
            try {
              push(quality, await resolveServerLink(candidate.url));
            } catch { /* dead candidate */ }
          }
        }
      }
    }
  }

  if (out.mp4s.length || out.embeds.length) {
    resolveCache.set(pageUrl, { at: Date.now(), result: out });
  }
  return out;
}

const QUALITY_ORDER = ['1080p', '720p', '480p', '360p'];

/** Best-quality-first ordering of a freshly resolved tier. */
export function sortByQuality(list = []) {
  return [...list].sort(
    (a, b) => QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality),
  );
}
