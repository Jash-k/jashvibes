/**
 * lib/live/v2/feed.js — V2 "PlugX-style" fast live source.
 *
 * Pure, isomorphic helpers: no DB, no React, no server-only imports, so the
 * same normalization runs inside route handlers and node contract tests.
 *
 * The upstream feed (jstr4web.json) is the same JSON the reference app is
 * built from: ~1.2k Jio CDN channels, one ClearKey pair per row, no token on
 * the URL. The six-hour account-level __hdnea__ token is harvested separately
 * server-side (see tokenStore.js) and attached at resolve/playback time.
 */

export const V2_SOURCE_ID = 'jio-v2';
export const V2_FEED_URL = 'https://jtvxweb.pages.dev/jstr4web.json';
export const PLUGX_URL = 'https://jioplus2plugx.lovable.app/';

/** Owner-chosen category order; every remaining category follows alphabetically. */
export const CATEGORY_HEAD = ['Tamil', 'Sports', 'Kids', 'English'];

const TOKEN_RE = /__hdnea__=(st=\d+~exp=\d+~acl=[^"&\\\s]+~hmac=[a-f0-9]+)/i;
const JIO_HOST_RE = /jio\.com|akamaized\.net|cloudfront\.net|jiocinema|mediatailor\//i;

export function detectFormat(url = '') {
  return /\.m3u8(\?|$)/i.test(String(url)) ? 'hls' : 'dash';
}

export function isJioHost(url = '') {
  return JIO_HOST_RE.test(String(url));
}

/**
 * Map raw feed rows into stable V2 channel records.
 * Raw shape: { id, name, category, url, keyId, key, logo }
 */
export function normalizeV2Rows(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.url || row.id === undefined || row.id === null) continue;
    const id = String(row.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const url = String(row.url);
    out.push({
      id,
      v2Id: `${V2_SOURCE_ID}:${id}`,
      name: String(row.name || `Channel ${id}`).trim(),
      category: String(row.category || 'Other').trim() || 'Other',
      logo: String(row.logo || ''),
      url,
      keyId: String(row.keyId || '').toLowerCase(),
      key: String(row.key || '').toLowerCase(),
      format: detectFormat(url),
    });
  }
  return out;
}

/** Categories in owner order (Tamil, Sports, Kids, English) then A–Z. */
export function orderedCategories(records = []) {
  const all = [...new Set(records.map((r) => r.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const head = CATEGORY_HEAD.filter((c) => all.includes(c));
  return [...head, ...all.filter((c) => !CATEGORY_HEAD.includes(c))];
}

/** Group records by category, channels sorted A–Z inside each group. */
export function groupV2Channels(records = []) {
  const byCategory = new Map();
  for (const record of records) {
    if (!byCategory.has(record.category)) byCategory.set(record.category, []);
    byCategory.get(record.category).push(record);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return orderedCategories(records).map((name) => ({
    id: `v2-cat-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    count: (byCategory.get(name) || []).length,
    channels: byCategory.get(name) || [],
  }));
}

/** Attach an __hdnea__ query token, but only to Jio-family hosts, and never twice. */
export function appendHdnea(url = '', token = '') {
  const uri = String(url || '');
  const t = String(token || '').trim();
  if (!t || !isJioHost(uri) || /__hdnea__=/.test(uri)) return uri;
  return `${uri}${uri.includes('?') ? '&' : '?'}${t.startsWith('__hdnea__=') ? t : `__hdnea__=${t}`}`;
}

/**
 * Parse the reference app's server-rendered HTML:
 *   - the shared six-hour __hdnea__ token (account-wide, acl=/*)
 *   - per-channel ClearKey rotations
 *   - channels the JSON feed does not carry
 * Tolerant by design: the markup is minified and redeployed often, so every
 * field degrades to empty rather than throwing.
 */
export function parsePlugxHtml(html = '') {
  const text = String(html || '');
  let token = '';
  let tokenExpiry = 0;
  const tokenMatch = text.match(TOKEN_RE);
  if (tokenMatch) {
    token = `__hdnea__=${tokenMatch[1]}`;
    const exp = token.match(/~exp=(\d+)/);
    tokenExpiry = exp ? Number(exp[1]) * 1000 : 0;
  }

  const keyMap = {};
  const extras = [];
  for (const block of text.split('{id:"').slice(1)) {
    const idMatch = block.match(/^(\d+)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const keyMatch = block.match(/clearkey:"([0-9a-f]{32}):([0-9a-f]{32})"/i);
    if (keyMatch) keyMap[id] = { keyId: keyMatch[1].toLowerCase(), key: keyMatch[2].toLowerCase() };
    const urlMatch = block.match(/mpd_url:"([^"]+)"/);
    const nameMatch = block.match(/name:"((?:[^"\\]|\\.)*)"/);
    const groupMatch = block.match(/group:"((?:[^"\\]|\\.)*)"/);
    const logoMatch = block.match(/logo:"([^"]*)"/);
    if (urlMatch && nameMatch) {
      const url = urlMatch[1];
      extras.push({
        id,
        v2Id: `${V2_SOURCE_ID}:${id}`,
        name: nameMatch[1].replace(/\\"/g, '"'),
        category: (groupMatch?.[1] || 'Other').replace(/\\"/g, '"'),
        logo: logoMatch?.[1] || '',
        url,
        keyId: keyMatch ? keyMatch[1].toLowerCase() : '',
        key: keyMatch ? keyMatch[2].toLowerCase() : '',
        format: detectFormat(url),
      });
    }
  }
  return { token, tokenExpiry, keyMap, extras, fetchedAt: Date.now() };
}

/**
 * Shaka profile ported from the reference app: conservative mobile-first
 * startup (small buffer goal, low ABR seed, bounded aggressive retries) so
 * first frames arrive fast; the engine's live defaults handle steady state.
 */
export const V2_FAST_PROFILE = {
  manifest: {
    defaultPresentationDelay: 12,
    retryParameters: { maxAttempts: 6, baseDelay: 500, timeout: 30_000 },
  },
  streaming: {
    bufferingGoal: 16,
    rebufferingGoal: 2,
    bufferBehind: 30,
    segmentPrefetchLimit: 2,
    lowLatencyMode: false,
    inaccurateManifestTolerance: 2,
    stallEnabled: true,
    stallThreshold: 1,
    stallSkip: 0.1,
    retryParameters: { maxAttempts: 6, baseDelay: 500, backoffFactor: 2, timeout: 30_000, stallTimeout: 8_000 },
  },
  abr: {
    enabled: true,
    defaultBandwidthEstimate: 500_000,
    switchInterval: 5,
    bandwidthDowngradeTarget: 0.85,
    bandwidthUpgradeTarget: 0.75,
    restrictToElementSize: true,
  },
};
