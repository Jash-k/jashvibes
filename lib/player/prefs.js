/**
 * Player preferences — one namespaced, versioned store.
 *
 * Replaces the split of `jb-watch-*` (chrome) and `jash-live-volume`
 * (only ever read, never written by anything) with a single source of truth,
 * and migrates the legacy keys on first touch so nobody loses their settings.
 */

export const PREFS_KEY = 'jash:player:v1';
/** localStorage queue for the chrome's "Report a problem" button (last 50). */
export const INCIDENT_QUEUE_KEY = 'jash:player-incidents';

// Order matters: the first legacy key found for a pref wins, so the newer
// per-page key beats the old live-page volume key. Retiring them on first write
// is what keeps a stale mirror from resurrecting itself.
const LEGACY_KEYS = {
  'jb-watch-vol': 'volume',
  'jash-live-volume': 'volume',
  'jb-watch-speed': 'rate',
  'jb-watch-ambient': 'ambient',
};

const DEFAULTS = {
  volume: 1,
  muted: false,
  rate: 1,
  brightness: 1,
  ambient: true,
  autoResume: true,
  qualityAuto: true,
  qualityHeight: 0,
  audioLanguage: '',
  subtitleDelayMs: 0,
  subtitleScale: 1,
  subtitleBackground: 0.35,
  subtitleOutline: true,
  dataSaver: false,
  showStats: false,
  haptics: true,
};

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function storage(getStorage) {
  try {
    const store = typeof getStorage === 'function' ? getStorage() : globalThis.localStorage;
    if (!store || typeof store.getItem !== 'function') return null;
    return store;
  } catch {
    return null;
  }
}

/** Read the whole pref bag (with legacy migration applied in-memory). */
export function readPrefs({ localStorage: getStorage } = {}) {
  const store = storage(getStorage);
  if (!store) return { ...DEFAULTS };

  const saved = safeParse(store.getItem?.(PREFS_KEY)) || {};
  const prefs = { ...DEFAULTS, ...saved };

  // One-time lift of the old per-page keys; never overwrite a new value.
  // Two legacy keys can map to the same pref (both carried a volume), so the
  // first lift wins — otherwise the result depends on object key order.
  const lifted = new Set();
  for (const [legacyKey, prefName] of Object.entries(LEGACY_KEYS)) {
    if (!prefName || lifted.has(prefName)) continue;
    const hasNew = Object.prototype.hasOwnProperty.call(saved, prefName);
    if (hasNew) continue;
    const legacyRaw = store.getItem?.(legacyKey);
    if (legacyRaw === null || legacyRaw === undefined) continue;
    if (prefName === 'ambient') prefs.ambient = legacyRaw === 'on';
    else prefs[prefName] = clampNumber(legacyRaw, DEFAULTS[prefName], 0, prefName === 'rate' ? 16 : 1);
    lifted.add(prefName);
  }

  return prefs;
}

export function writePref(name, value, { localStorage: getStorage } = {}) {
  const store = storage(getStorage);
  if (!store || !Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return null;
  const saved = safeParse(store.getItem?.(PREFS_KEY)) || {};
  saved[name] = value;
  saved.updatedAt = Date.now();
  try {
    store.setItem?.(PREFS_KEY, JSON.stringify(saved));
  } catch {}
  // Retire the legacy mirrors once the new store owns the value.
  for (const [legacyKey, prefName] of Object.entries(LEGACY_KEYS)) {
    if (prefName === name) {
      try {
        store.removeItem?.(legacyKey);
      } catch {}
    }
  }
  return value;
}

export function patchPrefs(patch = {}, options = {}) {
  for (const [name, value] of Object.entries(patch)) writePref(name, value, options);
  return readPrefs(options);
}

function clampNumber(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Clamp helper exported for the chrome (volume/brightness/rate all use it). */
export function clamp(raw, fallback, min, max) {
  return clampNumber(raw, fallback, min, max);
}

export { DEFAULTS as PREF_DEFAULTS, LEGACY_KEYS };
