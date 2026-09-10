/*
 * lib/musicCore.js — the pure half of the music section, for the Light Curtains design (concept 31).
 *
 * Moved out of `app/music/page.js` verbatim in v8.15.0, so the old UI could be deleted instead of restyled:
 * nothing here knows about JSX, React or the network, which is what makes the new design testable at all.
 * The helpers the curtains layout needs (`muTabs`, `muLyricRows`, `muQualityChips`, `muCurtainVars`,
 * `muLockView`) are pure too, on purpose — the browser pass proves the pixels, this file proves the model.
 */

export const QUALITY_LABELS = {
  '320kbps': '320k',
  '160kbps': '160k',
  '96kbps': '96k',
  '48kbps': '48k',
  '12kbps': '12k',
  auto: 'Auto',
};

export const QUALITY_ORDER = ['320kbps', '160kbps', '96kbps', '48kbps', '12kbps', 'auto'];

export function trackKey(track) {
  if (!track || typeof track !== 'object') return '';
  return String(track.seokey || track.id || track.trackId || track.title || '');
}

export function chooseBestQuality(streamUrls = {}) {
  return QUALITY_ORDER.find((key) => streamUrls[key]) || Object.keys(streamUrls)[0] || '';
}

export function isHlsUrl(url = '') {
  const lower = String(url || '').toLowerCase();
  return lower.includes('.m3u8') || lower.includes('m3u8') || lower.includes('/hls/');
}

export function formatTime(value = 0) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

export function dedupeQueue(tracks = []) {
  const seen = new Set();
  const output = [];
  for (const track of tracks || []) {
    const key = trackKey(track);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(track);
  }
  return output;
}

export function emptySearchResults() {
  return { songs: [], albums: [], artists: [], playlists: [] };
}

export function normalizeSearchResults(value) {
  if (Array.isArray(value)) return { ...emptySearchResults(), songs: value.filter(Boolean) };
  return {
    songs: Array.isArray(value?.songs) ? value.songs.filter(Boolean) : Array.isArray(value?.items) ? value.items.filter(Boolean) : [],
    albums: Array.isArray(value?.albums) ? value.albums.filter(Boolean) : [],
    artists: Array.isArray(value?.artists) ? value.artists.filter(Boolean) : [],
    playlists: Array.isArray(value?.playlists) ? value.playlists.filter(Boolean) : [],
  };
}

export function searchResultCount(results) {
  return (results?.songs?.length || 0) + (results?.albums?.length || 0) + (results?.artists?.length || 0) + (results?.playlists?.length || 0);
}

export function splitArtistText(value = '') {
  return String(value || '')
    .split(/,|&|;|\band\b/gi)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export function artistChipsFromTrack(track) {
  const rawList = Array.isArray(track?.artistList) ? track.artistList : [];
  const combined = rawList.length
    ? rawList
    : splitArtistText(track?.artists).map((name) => ({ id: name, name }));
  const seen = new Set();
  return combined
    .map((item) => ({ id: String(item?.id || item?.name || '').trim(), name: String(item?.name || '').trim(), image: item?.image || '' }))
    .filter((item) => item.name)
    .filter((item) => {
      const key = (item.id || item.name).toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

export function parseLrcTimestamp(value = '') {
  const match = String(value).match(/(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?/);
  if (!match) return null;
  const minutes = Number(match[1] || 0);
  const seconds = Number(match[2] || 0);
  const millis = Number(String(match[3] || '0').padEnd(3, '0').slice(0, 3));
  return minutes * 60 + seconds + millis / 1000;
}

export function parseSyncedLyrics(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .flatMap((line) => {
      const stamps = [...line.matchAll(/\[(\d{1,2}:\d{1,2}(?:\.\d{1,3})?)\]/g)];
      if (!stamps.length) return [];
      const text = line.replace(/\[[^\]]+\]/g, '').trim();
      return stamps
        .map((stamp) => ({ time: parseLrcTimestamp(stamp[1]), text }))
        .filter((item) => item.time !== null && item.text);
    })
    .sort((a, b) => a.time - b.time);
}

export function plainFromSyncedLyrics(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

/* ───────────────────────────────── curtains-specific model ───────────────────────────────── */

/**
 * The three tabs the design is built around, in the order the board shows them.
 * `count` is what the facet actually returned — a `0` is rendered as `0`, never hidden, because a
 * tab that quietly disappears when empty is how a library starts lying about what it holds.
 */
export const MU_TABS = [
  { id: 'albums', glyph: '▣', label: 'Albums' },
  { id: 'artists', glyph: '◎', label: 'Artists' },
  { id: 'playlists', glyph: '♬', label: 'Playlists' },
];

/** Views that are not facets: kept reachable, but not dressed up as a fourth tab. */
export const MU_CHIPS = [
  { id: 'search', glyph: '⌕', label: 'Search' },
  { id: 'favorites', glyph: '★', label: 'Favorites' },
  { id: 'recent', glyph: '◴', label: 'Recent' },
];

export function muTabs(counts = {}) {
  return MU_TABS.map((tab) => ({ ...tab, count: Math.max(0, Number(counts[tab.id]) || 0) }));
}

/**
 * Lyric rows with the state the curtains column of light depends on. `tappable` is only true when the
 * file carried timestamps: an unsynchronised lyric must not look like a control it cannot use.
 */
export function muLyricRows(lines = [], activeIndex = -1, { radius = 0 } = {}) {
  const list = Array.isArray(lines) ? lines.filter((line) => line && line.text) : [];
  const synced = activeIndex >= 0;
  return list.map((line, index) => {
    const offset = index - activeIndex;
    const inWindow = !synced || radius <= 0 || Math.abs(offset) <= radius;
    return {
      index,
      text: line.text,
      time: Number.isFinite(line.time) ? line.time : null,
      state: !synced ? 'plain' : offset < 0 ? 'past' : offset === 0 ? 'current' : 'future',
      tappable: synced && Number.isFinite(line.time),
      visible: inWindow,
    };
  });
}

/** Where the light column sits, as a 0-1 fraction of the panel — from playback time, not from a timer. */
export function muCurtainPosition(currentTime = 0, duration = 0) {
  const now = Number(currentTime) || 0;
  const total = Number(duration) || 0;
  if (!(total > 0) || now < 0) return 0;
  return Math.min(1, Math.max(0, now / total));
}

/**
 * CSS custom properties for the curtain field. Three stops only, and the hue rotates by the track key so a
 * playlist looks like a shift in light rather than a new random wallpaper on every re-render.
 */
export function muCurtainVars(seed = '') {
  const text = String(seed || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 100000;
  const hue = hash % 360;
  const hue2 = (hue + 48) % 360;
  const hue3 = (hue + 210) % 360;
  return {
    '--mu-curtain-a': `hsl(${hue} 78% 62%)`,
    '--mu-curtain-b': `hsl(${hue2} 72% 55%)`,
    '--mu-curtain-c': `hsl(${hue3} 66% 48%)`,
  };
}

/** The quality chips row, in the order the player prefers, with `current` marked rather than re-sorted. */
export function muQualityChips(streamUrls = {}, current = '') {
  const keys = Object.keys(streamUrls || {}).filter((key) => streamUrls[key]);
  const ordered = [...QUALITY_ORDER.filter((key) => keys.includes(key)), ...keys.filter((key) => !QUALITY_ORDER.includes(key))];
  return ordered.map((key) => ({ key, label: QUALITY_LABELS[key] || key, current: key === current }));
}

/**
 * The lock surface, as one object, because this is the part of the design that must stay honest: pocket mode
 * has a real hold-to-release gesture, the wake lock has real browser states, and each says what it is doing.
 */
export function muLockView({ pocketMode = false, listeningMode = false, wakeLockStatus = 'idle', hold = 0, nextTitle = '' } = {}) {
  const percent = Math.round(Math.min(1, Math.max(0, Number(hold) || 0)) * 100);
  if (pocketMode) {
    return {
      kind: 'pocket',
      title: 'Pocket mode',
      hint: 'Hold the ring for a second to unlock',
      progress: percent,
      status: listeningMode ? 'screen stays awake' : 'screen may sleep',
      nextTitle,
    };
  }
  if (listeningMode) {
    const status = {
      requesting: 'asking the browser to keep the screen on…',
      active: 'keeping the screen awake',
      released: 'the browser took the lock back — it re-asks when you return',
      blocked: 'the browser refused the wake lock',
      error: 'wake lock failed',
      unsupported: 'no wake lock in this browser',
      idle: 'listening mode on',
    }[wakeLockStatus] || 'listening mode on';
    return { kind: 'listening', title: 'Listening mode', hint: 'Controls stay, the screen stays on', progress: 0, status, nextTitle };
  }
  return { kind: 'off', title: '', hint: '', progress: 0, status: '', nextTitle: '' };
}

export const MU_MINI_DRAG_CLOSE_PX = 120;
