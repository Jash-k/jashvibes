// Source registry: built-in source definitions, retirement list, env overrides.
// Split from the former lib/liveTv.js god module (phase 1) — behaviour unchanged.

import { detectSourceType, normalizeHttpUrl } from './text.js';

const POCKET_SOURCE = {
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
    id: 'hjh-jio',
    label: 'HJH Tamil (Auto IPTV)',
    type: 'm3u',
    url: 'https://hjh-545.pages.dev/',
    trustTamil: false,
    priority: 1,
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
  {
    // The "Sony Sports" section of Stream4Liv (stream4liv.netlify.app) is this
    // feed: Jio-CDN DASH re-streams (jiotvmblive) with a per-channel ClearKey
    // pair and a six-hour __hdnea__ token.
    //
    // The host this source previously pointed at —
    // sayan-sportlink-sonynetwork.pages.dev — no longer resolves (NXDOMAIN), so
    // it could never have synced a single channel. Stream4Liv reads its token
    // from sportlive18/Sportlink-wtf, and that same repo publishes the channel
    // list as a file, refreshed by GitHub Actions: 29 of its 31 names are
    // identical to Stream4Liv's Sony tab.
    //
    // It is worth having even though jstr4web.json carries seven "Sony LIV
    // Sports" rows: those are the SonyLIV_Sports_*_MOB encodes, while this feed
    // carries the HD Ten/Six set (Ten_HD, Ten2_HD, Ten3_HD, Six_HD) which
    // jstr4web.json has none of.
    id: 'sony-jio',
    label: 'Sony Sports HD (Jio)',
    type: 'json',
    url: 'https://raw.githubusercontent.com/sportlive18/Sportlink-wtf/refs/heads/main/sony.json',
    trustTamil: false,
    priority: 4,
    // Sports only: the file also carries SET, SAB, Max, BBC Earth, Yay, Animax.
    titleFilter: 'Sony Sports|Sony Ten',
    autoMapCatalog: 'sports',
  },
  {
    // iptv-org's Tamil-language playlist: 118 community-maintained Tamil
    // channels (entertainment, news, music, movies, kids, religious).
    // Segment-verified 2026-09-25: 5/6 sampled chains ended in real TS video
    // (up to 4 MB segments, two manifest hops — inside the deep check's
    // reach). Already Tamil-only, so no titleFilter needed.
    id: 'iptv-org-tamil',
    label: 'Tamil FTA (iptv-org)',
    type: 'm3u',
    url: 'https://iptv-org.github.io/iptv/languages/tam.m3u',
    trustTamil: true,
    priority: 5,
    autoPurge: true,
  },
  {
    id: 'jash-live',
    label: 'Jash Live',
    type: 'm3u',
    url: 'https://raw.githubusercontent.com/Jash-k/live_play/refs/heads/main/jash-live.m3u',
    trustTamil: false,
    priority: 2,
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
  // v10.2.1: verified 200-OK manifests but dead/403 segments — shipped and
  // pulled within a day. Purged from existing DBs on boot (see liveService).
  'babuperumana/in_iptv',
  'iptv-org.github.io/iptv/categories/sports',
  // v10.3.0: the "4K sports" source was real video but country-wide — its
  // sports automap flooded the catalog with 500+ non-Indian channels. Off.
  'romaxa55',
  'world_ip_tv',
  // v11: NXDOMAIN — the host this feed lived on is gone entirely, so a database
  // seeded by an older release still holds a source that can never sync.
  'sayan-sportlink-sonynetwork',
  // v11.1 legacy duplicate clones created during hjh/jash rebrand — seen live 2026-10-24 as pre/ss/jash/master (3211 groups inflation)
  'pre-jash', '"pre"', "'pre'", 'sourceId-pre', 'master-iptv', 'ss-iptv', 'jash-live-clone',
  'legacy-pre', 'legacy-ss',
];

function isRemovedSource(source = {}) {
  const text = `${source.id || ''} ${source.label || ''} ${source.url || ''}`.toLowerCase();
  const sid = String(source.id || source.sourceId || '').toLowerCase().trim();
  if (['pre','ss','master','jash'].includes(sid)) return true;
  return REMOVED_SOURCE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isPocketSource(source = {}) {
  const text = `${source.id || ''} ${source.label || ''} ${source.url || ''}`.toLowerCase();
  return text.includes('pocket-tamil') || text.includes('joiptv/jojo') || text.includes('pocket.m3u');
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

export function getDefaultLiveSources({ includePocket = true } = {}) {
  const base = [...DEFAULT_SOURCES];
  if (includePocket) base.push(POCKET_SOURCE);
  return base
    .filter((item) => item && !isRemovedSource(item))
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((item, index) => ({ ...item, priority: item.priority ?? index }));
}

export {
  POCKET_SOURCE,
  REMOVED_SOURCE_PATTERNS,
  getSources,
  isPocketSource,
  isRemovedSource,
  parseSourceListFromEnv,
};
