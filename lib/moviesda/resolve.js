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
import { slugify } from '../slug.js';

const BASES = ['https://moviesda34.com', 'https://movies.downloadpage.xyz'];
const TIMEOUT_MS = Number(process.env.MOVIESDA_TIMEOUT_MS || 12000);
const RETRIES = 2;
const DELAY_MS = 150;
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

/** Folder-link extraction shared by stage 1 and the on-demand search. */
function extractFolderLinks(html, base) {
  const $ = cheerio.load(html);
  const out = [];
  $('div.f a, div.folder a, a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const label = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || href === '/' || href.startsWith('#') || href.startsWith('mailto:')) return;
    if (/telegram|t\.me|whatsapp|instagram/i.test(label + href)) return;
    if (href.includes('-movies/') || href.includes('collection') || href.includes('isaidub')) return;
    // Quality-labelled folders pass directly; bare single-segment folders
    // (e.g. "Hi (Original)" → /hi-original-movie/) pass too — some titles
    // nest one quality-less level before the resolution pages.
    const hasQuality = /\d+p|hd|predvd|dvd|blu/i.test(label) || /\d+p|hd-|predvd|dvd|blu/i.test(href);
    const singleSegment = href.split('/').filter(Boolean).length === 1;
    if (!hasQuality && !singleSegment) return;
    const abs = absolute(base, href);
    if (abs) out.push({ url: abs, label });
  });
  const seen = new Set();
  return out.filter((row) => (seen.has(row.url) ? false : (seen.add(row.url), true)));
}

/** Stage 1: folder links on a listing or item page (div.f blocks). */
async function getMovieFolders(pageUrl) {
  const { html, base } = await fetchPage(pageUrl);
  return extractFolderLinks(html, base);
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
    const hasQuality = /\d+p|hd|predvd|dvd|blu/i.test(label + href);
    const singleSegment = href.split('/').filter(Boolean).length === 1;
    if (!hasQuality && !singleSegment) return;
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
      if (/onestream|watch\s*online/i.test(href)) return; // embeds disabled on watch path
      if (href && (/\.mp4/i.test(href) || /cdnserver|download\.php|fastbytes|uptodl|biggshare|hotshare/i.test(href))) {
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

/** Stage 5: 302-resolve one candidate (onestream pages unwrap to raw MP4s). */
async function resolveServerLink(url) {
  if (/onestream/i.test(url)) {
    // Try to unwrap a direct MP4 from the onestream page; never return the iframe.
    try {
      const html = await fetchWithRetry(url);
      const source = html.match(/<source[^>]+src="([^"]+)"/i) || html.match(/(https?:\/\/[^"'\s]+\.mp4[^"'\s]*)/i);
      if (source) return { type: 'mp4', url: absolute(url, source[1]) };
    } catch { /* no direct file */ }
    return null;
  }
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
 * Candidate liveness — v10.11.2.
 *
 * The hop chain returns links from several hosts, and a host that has expired
 * its token answers 403 with an HTML page instead of video. `resolveServerLink`
 * cannot know that: when a server page 302s, it returns the redirect TARGET
 * without ever seeing a byte of it. So the walk happily listed dead links, and
 * "Auto" could open the one host that was down — which is what a viewer
 * experiences as "the direct MP4 source does not work".
 *
 * One ranged GET settles it, and it costs ~4 KB: a host serving video answers
 * 206 (or 200) with a video content-type and a real MP4/WebM signature; a host
 * that has rotted answers HTML. Results are memoised briefly because health is
 * the thing that changes fastest — the links themselves stay cached 45 minutes.
 */
const PROBE_TIMEOUT_MS = Number(process.env.MOVIESDA_PROBE_TIMEOUT_MS || 2500);
const PROBE_CONCURRENCY = 4;
const HEALTH_TTL_MS = 90 * 1000;

const healthCache = new Map(); // url -> { at, health, status, contentType, acceptRanges }

/**
 * Probes are queued at mint time so they run *while* the walk continues.
 *
 * Nothing else is waiting on the network in those seconds, and a probe is ~4 KB.
 * Doing them after the walk instead cost extra wall-clock on top of an already
 * expensive crawl, which is how a 25s walk with a 12s budget produced a list of
 * three dead links. Started here, almost every probe has already answered by the
 * time the walk returns.
 */
const pendingProbes = new Map(); // url -> Promise<probe result>

function queueProbe(url) {
  let promise = pendingProbes.get(url);
  if (!promise) {
    promise = probeVideo(url).catch(() => ({ health: 'unknown', status: 0, contentType: '', acceptRanges: '' }));
    pendingProbes.set(url, promise);
    promise.finally(() => { if (pendingProbes.get(url) === promise) pendingProbes.delete(url); });
  }
  return promise;
}

/**
 * Media magic at the head of the body — the honest test when a host mislabels.
 *
 * Deliberately generous: a false "dead" hides a working mirror behind an
 * "unavailable" label, so anything that could plausibly be a media container
 * counts. MP4-family files start with a box size + type: ftyp (normal), styp /
 * moof / mdat (fragmented), free / skip / wide (padding first, seen in older
 * QuickTime-derived files). Matroska/WebM, FLV, Ogg, RIFF (AVI/WAV), MP3/AAC and
 * MPEG-TS (0x47 sync bytes at the 188-byte packet boundary) are all covered.
 */
function looksLikeMedia(chunk) {
  if (!chunk || chunk.length < 12) return false;
  // A fetch body yields a Uint8Array, not a Buffer — Uint8Array.toString() takes
  // no encoding and would hand back "0,0,0,32,102,…", silently failing every
  // signature test below. Caught by tests/direct-mp4-health.test.cjs.
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk.buffer || chunk, chunk.byteOffset || 0, chunk.length);
  const head = buf.toString('latin1', 0, 12);
  const box = head.slice(4, 8);
  if (['ftyp', 'styp', 'moof', 'mdat', 'moov', 'free', 'skip', 'wide'].includes(box)) return true; // ISO base media
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true; // matroska/webm
  if (head.startsWith('FLV')) return true;
  if (head.startsWith('OggS')) return true;
  if (head.startsWith('ID3') || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return true; // mp3 / aac
  if (head.startsWith('RIFF')) return true;
  if (buf[0] === 0x47 && buf[188] === 0x47) return true; // MPEG-TS packet sync
  return false;
}

/**
 * `health: 'ok' | 'dead' | 'unknown'`. Unknown (timeout, DNS, abort) is never
 * treated as dead — the probe must not be the reason a good link is skipped.
 */
export async function probeVideo(url) {
  const memo = healthCache.get(url);
  if (memo && Date.now() - memo.at < HEALTH_TTL_MS) return memo;
  const result = { at: Date.now(), health: 'unknown', status: 0, contentType: '', acceptRanges: '' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { ...HEADERS, Range: 'bytes=0-4095', Referer: 'https://movies.downloadpage.xyz/' },
        redirect: 'follow',
        signal: controller.signal,
        cache: 'no-store',
      });
      result.status = response.status;
      result.contentType = (response.headers.get('content-type') || '').toLowerCase();
      result.acceptRanges = response.headers.get('accept-ranges') || '';
      if (result.status === 403 || result.status === 404 || result.status === 410) {
        result.health = 'dead';
      } else if (result.status === 200 || result.status === 206) {
        /*
         * Read the first bytes and judge by content, not by the label.
         *
         * A content-type is a claim; the header of the body is evidence. The hosts
         * that broke this feature answered 403 with text/html — but a host can just
         * as easily answer 200 with `video/mp4` and an HTML challenge page, and
         * trusting the label would hand that to the player as a working source.
         * So: bytes decide whenever we can read them; the content-type is only the
         * fallback for a body we cannot read (and then the verdict is 'unknown',
         * which never counts as dead).
         */
        const reader = response.body?.getReader?.();
        if (reader) {
          const chunk = await reader.read();
          try { await reader.cancel(); } catch { /* already drained */ }
          if (chunk?.value?.length) {
            result.health = looksLikeMedia(chunk.value) ? 'ok' : 'dead';
          } else {
            result.health = /^video\/|octet-stream/.test(result.contentType) ? 'ok' : 'unknown';
          }
        } else {
          result.health = /^video\/|octet-stream/.test(result.contentType) ? 'ok' : 'unknown';
        }
      } else {
        result.health = 'unknown';
      }
      if (healthCache.size > 400) healthCache.clear();
      healthCache.set(url, result);
      return result;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    healthCache.set(url, result); // unknown, memoised briefly so a flaky host is not hammered
    return result;
  }
}

/** Probe a candidate list concurrently and return it healthy-first, stable within
 *  each group so the quality ordering the walk produced is preserved. */
export async function annotateHealth(list = []) {
  const queue = [...list];
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      const health = await queueProbe(item.url);
      item.health = health.health;
      item.healthStatus = health.status;
      item.healthType = health.contentType;
      item.acceptRanges = health.acceptRanges;
    }
  });
  await Promise.all(workers);
  const rank = { ok: 0, unknown: 1, dead: 2 };
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank[a.item.health] ?? 1) - (rank[b.item.health] ?? 1) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Walk the whole chain for one item page under a time budget and return
 * freshly minted links: { mp4s: [{quality, url}], embeds: [{quality, url}] }.
 */
async function walkMoviesda(pageUrl, { budgetMs = 40000, maxRes = 3, maxSel = 3, maxServers = 2, maxCandidates = 4, mp4Only = true } = {}) {
  const deadline = Date.now() + budgetMs;
  const out = { mp4s: [], embeds: [] };
  const seen = new Set();
  const push = (quality, resolved) => {
    if (!resolved || seen.has(resolved.url)) return;
    // Watch path is direct-MP4 only — drop onestream / iframe results.
    if (resolved.type !== 'mp4' || /onestream/i.test(resolved.url || '')) {
      if (!mp4Only && resolved.type !== 'mp4') {
        seen.add(resolved.url);
        out.embeds.push({ quality, url: resolved.url });
      }
      return;
    }
    seen.add(resolved.url);
    out.mp4s.push({ quality, url: resolved.url });
    queueProbe(resolved.url); // overlap the health check with the rest of the walk
  };

  let groups = [];
  try {
    groups = await getMovieFolders(pageUrl);
  } catch { /* some item pages link resolutions directly */ }
  const groupPages = groups.length ? groups.slice(0, 2) : [{ url: pageUrl, label: '' }];

  // v10.7.0: walk both folder groups concurrently — halves wall time.
  const processGroup = async (group) => {
    if (Date.now() > deadline) return;
    await sleep(DELAY_MS);
    let resolutions = [];
    try {
      resolutions = await getResolutionSubfolders(group.url);
    } catch { return; }

    for (const res of resolutions.slice(0, maxRes)) {
      if (Date.now() > deadline) return;
      await sleep(DELAY_MS);
      const quality = (res.label.match(/(1080p|720p|480p|360p)/i) || ['HD'])[0];

      let selections = [];
      try {
        selections = await getDownloadSelectionUrls(res.url);
      } catch { continue; }

      for (const selection of selections.slice(0, maxSel)) {
        if (Date.now() > deadline) return;
        await sleep(DELAY_MS);
        let serverPages = [];
        try {
          serverPages = await getIntermediateServerUrls(selection);
        } catch { continue; }

        for (const serverPage of serverPages.slice(0, maxServers)) {
          if (Date.now() > deadline) return;
          await sleep(DELAY_MS);
          let candidates = [];
          try {
            candidates = await getServerCandidates(serverPage);
          } catch { continue; }

          for (const candidate of candidates.slice(0, maxCandidates)) {
            if (Date.now() > deadline) return;
            try {
              push(quality, await resolveServerLink(candidate.url));
            } catch { /* dead candidate */ }
          }
        }
      }
    }
  };
  await Promise.all(groupPages.map(processGroup));

  // A budget that ran out is not the same as a page with nothing on it. The watch
  // route uses this to keep filling in the background instead of showing a
  // truncated prefix of the chain as if it were the whole list.
  out.truncated = Date.now() >= deadline - 400;

  if (!out.mp4s.length && !out.embeds.length) {
    // The old test compared "how far past the deadline we are" against the whole
    // budget, which is only true if the walk overran by nearly a full budget — so
    // a walk that simply ran out of time almost always reported "layout may have
    // changed". Running out of time is the common case and now says so.
    out.reason = out.truncated
      ? 'moviesda did not answer in time — try once more'
      : 'moviesda returned no playable links for this page (layout may have changed)';
  }
  return out;
}

/**
 * Resolve one item page: cached links, live health.
 *
 * The 45-minute cache holds the *links* (walking the chain is the expensive
 * part). Health is re-probed on every call, because the whole problem with a
 * direct link is that it dies between minting and clicking. Concurrent callers
 * for the same page share one walk — a watched page, a warm-up and a click
 * landing together used to mean three full crawls of the same chain.
 */
const inflight = new Map(); // pageUrl -> Promise<walk result>

export async function resolveMoviesdaMovie(pageUrl, options = {}) {
  const cached = resolveCache.get(pageUrl);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return finish(cached.result);

  if (inflight.has(pageUrl)) return finish(await inflight.get(pageUrl));

  const promise = walkMoviesda(pageUrl, options);
  inflight.set(pageUrl, promise);
  try {
    const out = await promise;
    const finished = await finish(out);

    /*
     * Cache decision, made after the health check and not before it.
     *
     * The 45-minute cache exists to spare moviesda a full crawl per viewer, but it
     * must only hold links that answer. A direct link's failure mode is exactly
     * "this worked an hour ago" — a stale URL mints a fresh token per request, and a
     * host that refuses today may serve again in a minute. So: keep the walk when at
     * least one candidate is alive; otherwise leave the entry unservable so the next
     * click mints again instead of replaying a list we already know is dead.
     */
    const hasLinks = Boolean(finished.mp4s.length || finished.embeds.length);
    const alive = finished.health?.ok || 0;
    resolveCache.set(pageUrl, {
      at: hasLinks && alive ? Date.now() : Date.now() - CACHE_TTL_MS + 60 * 1000,
      result: finished,
    });
    // Cold click that ran out of time *and* found nothing alive: keep walking with
    // the full budget in the background, so the retry (or the next visit) sees the
    // whole chain rather than the same truncated prefix. Cached result is replaced
    // only if the continuation does better, so a slow crawl can never make things
    // worse than what the viewer already has.
    if (finished.truncated && !finished.health?.ok && !finished.embeds?.length) {
      const continuation = walkMoviesda(pageUrl, { ...options, budgetMs: 40000 })
        .then((full) => finish(full))
        .then((full) => {
          const current = resolveCache.get(pageUrl)?.result;
          const improved = (full.health?.ok || 0) > (current?.health?.ok || 0);
          if (improved) resolveCache.set(pageUrl, { at: full.health?.ok ? Date.now() : Date.now() - CACHE_TTL_MS + 60 * 1000, result: full });
          return full;
        })
        .catch(() => finished)
        .finally(() => { if (inflight.get(pageUrl) === continuation) inflight.delete(pageUrl); });
      inflight.set(pageUrl, continuation);
    }
    return finished;
  } finally {
    if (inflight.get(pageUrl) === promise) inflight.delete(pageUrl);
  }
}

/** Probe what we are about to hand over, and say what was found. */
async function finish(out) {
  if (out?.mp4s?.length) {
    out.mp4s = await annotateHealth(out.mp4s);
    const dead = out.mp4s.filter((item) => item.health === 'dead').length;
    const ok = out.mp4s.filter((item) => item.health === 'ok').length;
    out.health = { checked: out.mp4s.length, ok, dead };
    if (!ok) out.degraded = true; // every host refused — say so rather than pretend
  }
  return out;
}

// ---- v10.7.0 on-demand search (hybrid) -------------------------------

const searchCache = new Map(); // 'slug|year' -> { url, at }
const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Find a movie's item page on moviesda WITHOUT the scraper index:
 * 1) direct URL guesses ({slug}-{year}-tamil-movie, {slug}-tamil-movie) —
 *    one fetch each; a hit is a page that yields real folder links
 *    (item stubs like "Hi (Original)" qualify; soft-404 shells do not);
 * 2) fallback: the title's A–Z listing page, exact label match.
 * Results are cached 6h. Returns the stable pageUrl or null.
 */
export async function searchMoviesdaMovie(title, year, { budgetMs = 20000 } = {}) {
  const slug = slugify(String(title || ''));
  if (!slug) return null;
  const key = `${slug}|${year || 0}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.url;

  const deadline = Date.now() + budgetMs;

  for (const path of year ? [`/${slug}-${year}-tamil-movie/`, `/${slug}-tamil-movie/`] : [`/${slug}-tamil-movie/`]) {
    if (Date.now() > deadline) return null;
    try {
      const { html, base } = await fetchPage(path);
      if (extractFolderLinks(html, base).length) {
        const url = new URL(path, base).toString();
        searchCache.set(key, { url, at: Date.now() });
        return url;
      }
    } catch { /* try the next guess */ }
  }

  // Letter fallback — first character of the slug.
  const letter = slug[0];
  if (/[a-z0-9]/.test(letter) && Date.now() <= deadline) {
    try {
      const { html, base } = await fetchPage(`/tamil-movies/${letter}/`);
      const $ = cheerio.load(html);
      let hit = null;
      $('div.f a, div.folder a').each((_, el) => {
        if (hit) return;
        const href = $(el).attr('href') || '';
        const label = $(el).text().replace(/\s+/g, ' ').trim();
        if (!href || /tamil-movies\//.test(href) || /web[- ]?series/i.test(href)) return;
        const yearInLabel = Number(label.match(/\((19|20)\d{2}\)/)?.[0]?.replace(/[()]/g, '')) || 0;
        if (year && yearInLabel && yearInLabel !== year) return;
        if (slugify(label) === slug || slugify(label).startsWith(`${slug}-`)) {
          hit = new URL(href, base).toString();
        }
      });
      if (hit) {
        searchCache.set(key, { url: hit, at: Date.now() });
        return hit;
      }
    } catch { /* letter page failed */ }
  }
  return null;
}

const QUALITY_ORDER = ['1080p', '720p', '480p', '360p'];

/** Best-quality-first ordering of a freshly resolved tier. */
/**
 * Resolution first, then quality.
 *
 * Quality alone was the ordering, which is how a dead 1080p host sorted above a
 * working 720p one. `annotateHealth` has already put the living first; this keeps
 * that decision intact and only breaks ties by resolution, so array.sort's
 * stability does the rest.
 */
const HEALTH_RANK = { ok: 0, unknown: 1, dead: 2 };

export function sortByQuality(list = []) {
  return [...list].sort(
    (a, b) => (HEALTH_RANK[a.health] ?? 1) - (HEALTH_RANK[b.health] ?? 1)
      || QUALITY_ORDER.indexOf(a.quality) - QUALITY_ORDER.indexOf(b.quality),
  );
}
