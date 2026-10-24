/**
 * lib/live/registry.js — v12 Source Registry
 * Single truth for all 5 sources the user owns. Handles each separately.
 */

export const SOURCE_REGISTRY = {
  'jio-tamil': {
    id: 'jio-tamil',
    label: 'Jio Tamil',
    type: 'json',
    url: 'https://jtvxweb.pages.dev/jstr4web.json',
    priority: 0,
    timeoutMs: 10000,
    retry: 0,
    token: 'jio', // needs getFreshJioCookie() injected
    proxy: false, // geo-blocked if proxied via non-IN server (451)
    drm: 'clearkey',
    trustTamil: false,
    refreshSec: 6 * 3600,
    adapter: 'jioAdapter',
    group: 'jio',
  },
  'hjh-jio': {
    id: 'hjh-jio',
    label: 'HJH Tamil (Auto IPTV)',
    type: 'm3u',
    url: 'https://hjh-545.pages.dev/',
    priority: 1,
    timeoutMs: 25000,
    retry: 1,
    token: 'hdnea_in_url', // 302 carries ?__hdnea__=... fresh 5m
    proxy: false,
    drm: 'clearkey',
    trustTamil: false,
    refreshSec: 300,
    adapter: 'hjhAdapter',
    group: 'jio',
  },
  'jash-live': {
    id: 'jash-live',
    label: 'Jash Live',
    type: 'm3u',
    url: 'https://raw.githubusercontent.com/Jash-k/live_play/refs/heads/main/jash-live.m3u',
    priority: 2,
    timeoutMs: 15000,
    retry: 1,
    token: 'mixed', // hdnea + hdntl + hdnts per variant
    proxy: 'auto', // Hotstar YT needs proxy, Jio variants not
    drm: 'mixed',
    trustTamil: true,
    refreshSec: 1800,
    adapter: 'jashAdapter',
    group: 'mixed',
  },
  'pocket-tamil': {
    id: 'pocket-tamil',
    label: 'Pocket Tamil',
    type: 'm3u',
    url: 'https://raw.githubusercontent.com/joiptv/jojo/refs/heads/main/pocket.m3u',
    priority: 3,
    timeoutMs: 15000,
    retry: 0,
    token: 'none',
    proxy: false,
    drm: 'clearkey',
    trustTamil: false,
    refreshSec: 3600,
    adapter: 'pocketAdapter',
    group: 'generic',
  },
  // The id MUST match the source row the sync pipeline writes
  // (DEFAULT_SOURCES in lib/liveTv.js uses 'iptv-org-tamil'). The old registry
  // id 'tamil-iptv' matched zero documents, so the FTA tab always read 0.
  'iptv-org-tamil': {
    id: 'iptv-org-tamil',
    label: 'Tamil FTA (iptv-org)',
    type: 'm3u',
    url: 'https://iptv-org.github.io/iptv/languages/tam.m3u',
    priority: 4,
    timeoutMs: 15000,
    retry: 0,
    token: 'none',
    proxy: false,
    drm: 'none',
    trustTamil: true,
    refreshSec: 86400,
    adapter: 'tamilIptvAdapter',
    group: 'generic',
  },
};

// Keep extra defaults from old lib/liveTv.js (streamlive, binge, sony) as low-priority fallback
export const EXTRA_FALLBACKS = {
  'streamlive-m3u': { id: 'streamlive-m3u', label: 'StreamLive Tamil', type: 'm3u', url: 'https://raw.githubusercontent.com/margabantheshwar/Streamliveplatlist.m3u/refs/heads/main/streamlive.m3u', priority: 10, timeoutMs: 15000, token: 'none', proxy: false, drm: 'none', trustTamil: false },
  'binge-tamil': { id: 'binge-tamil', label: 'Binge Tamil', type: 'json', url: 'https://binge-giotv.pages.dev/data/id.json', priority: 11, timeoutMs: 10000, token: 'none', proxy: false, drm: 'none', trustTamil: false },
  'sony-jio': { id: 'sony-jio', label: 'Sony Sports HD (Jio)', type: 'json', url: 'https://raw.githubusercontent.com/sportlive18/Sportlink-wtf/refs/heads/main/sony.json', priority: 12, timeoutMs: 10000, token: 'jio', proxy: false, drm: 'clearkey', trustTamil: false },
};

export function getRegistryList() {
  return Object.values(SOURCE_REGISTRY).sort((a,b)=> (a.priority??99)-(b.priority??99));
}

export function getSourceDef(id) {
  return SOURCE_REGISTRY[id] || EXTRA_FALLBACKS[id] || null;
}

export function isJioSourceId(id) {
  const def = getSourceDef(id);
  return def?.group === 'jio' || def?.token === 'jio' || id === 'hjh-jio';
}

export function needsProxyForSource(sourceId) {
  const def = getSourceDef(sourceId);
  if (!def) return false;
  if (def.proxy === false) return false;
  if (def.proxy === true) return true;
  // 'auto' → only Hotstar/YuppTV variants need proxy, decided per-channel
  return false;
}
