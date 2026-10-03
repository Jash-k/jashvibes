/**
 * Client-side personal library store.
 *
 * Powers two JaSH ViBeS features without any server/database cost:
 *   1. My List          — user-picked favorites
 *   2. Provider memory  — last manually selected server per title
 *
 * Everything is stored in localStorage so the feature works on free-tier hosts
 * with zero extra infrastructure. Import from client components only.
 *
 * NO WATCH HISTORY. This file used to also own "Continue Watching": a capped
 * history list, a progress writer, and a resume lookup. Watch history was
 * removed by request, and removed here rather than merely hidden so there is no
 * function left for a page to write a history row with — a feature that is
 * "disabled in the UI" always comes back the moment a new surface forgets the
 * rule. `purgeLegacyHistory()` deletes rows the old build left in browsers.
 *
 * Provider memory (`getLastProvider` / `setLastProvider`) is likewise gone: the
 * last reader was removed with the history work and nothing had called it for
 * several releases.
 */

import { useSyncExternalStore } from 'react';

const FAVORITES_KEY = 'jash:library:favorites:v1';
const PROVIDERS_KEY = 'jash:library:providers:v1';
/** Written by app versions before 11.0.1; pruned on first read, never written. */
const LEGACY_HISTORY_KEY = 'jash:library:continue:v1';
const FAVORITES_LIMIT = 200;

/**
 * Live keys must never enter a list that cannot render them.
 *
 * A live broadcast has no "continue" and no stable title metadata: a channel
 * saved from /live renders as "Untitled" in My List and can never be found
 * again. Prefixes rather than an allow-list, so an unknown-but-legitimate key
 * from a future page still shows up.
 */
const LIVE_KEY_PREFIXES = ['live:', 'tv:', 'channel:', 'match:', 'sports:'];

function isLiveKey(key = '') {
  const value = String(key || '');
  return LIVE_KEY_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isLiveEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  return entry.live === true || entry.kind === 'live' || isLiveKey(entry.key);
}

/** One-time cleanup of history rows written by an older build. */
function purgeLegacyHistory() {
  try {
    window.localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch { /* private mode / storage disabled */ }
}

let cache = null;
let version = 0;
const listeners = new Set();

function readKey(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function ensureCache() {
  if (cache) return;
  purgeLegacyHistory();
  const favorites = readKey(FAVORITES_KEY, []);
  const providers = readKey(PROVIDERS_KEY, {});
  cache = {
    favorites: Array.isArray(favorites) ? favorites : [],
    providers: providers && typeof providers === 'object' && !Array.isArray(providers) ? providers : {},
  };
}

function persist(key, value) {
  ensureCache();
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota / private mode: the in-memory cache stays correct for this session */ }
  version += 1;
  listeners.forEach((listener) => {
    try { listener(); } catch { /* one bad listener must not stop the others */ }
  });
}

/**
 * Re-render hook: any component calling this re-renders whenever the library
 * changes (including changes made in another browser tab via `storage`).
 */
export function useLibraryVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const onStorage = (event) => {
        if (!event.key || [FAVORITES_KEY, PROVIDERS_KEY, LEGACY_HISTORY_KEY].includes(event.key)) {
          cache = null;
          version += 1;
          listeners.forEach((fn) => fn());
        }
      };
      try { window.addEventListener('storage', onStorage); } catch { /* SSR */ }
      return () => {
        listeners.delete(listener);
        try { window.removeEventListener('storage', onStorage); } catch { /* SSR */ }
      };
    },
    () => version,
    () => 0,
  );
}

/**
 * Stable identity for a watchable item. TMDB titles use `movie:597` /
 * `series:1396`. Title-only scraped items use `ott:<normalized title>`.
 */
export function makeWatchKey({ type = 'movie', tmdbId = null, ottTitle = '' } = {}) {
  const numeric = Number(tmdbId);
  const raw = String(tmdbId ?? '').toLowerCase();
  if (raw === 'ott' || !Number.isFinite(numeric) || numeric <= 0) {
    const slug = String(ottTitle || 'unknown').toLowerCase().replace(/\s+/g, ' ').trim() || 'unknown';
    return `ott:${slug}`;
  }
  return `${type === 'series' || type === 'tv' ? 'series' : 'movie'}:${numeric}`;
}

// ---------------------------------------------------------------------------
// My List (favorites)
// ---------------------------------------------------------------------------

export function getFavorites() {
  ensureCache();
  return [...(cache?.favorites || [])]
    .filter((item) => !String(item?.key || '').startsWith('ott:'))
    .filter((item) => !isLiveEntry(item))
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export function isFavoriteItem(key) {
  ensureCache();
  if (isLiveKey(key)) return false; // never claim a save the list cannot show
  return Boolean((cache?.favorites || []).some((item) => item.key === key));
}

/** Returns the new favorite state (true = added, false = removed). */
export function toggleFavoriteItem(entry = {}) {
  if (!entry.key) return false;
  // A live channel My List can never show must not be addable either, or the
  // heart renders as saved for a row nobody can find. (/live keeps its own ★ list.)
  if (isLiveEntry(entry)) return false;
  ensureCache();
  const exists = (cache.favorites || []).some((item) => item.key === entry.key);
  if (exists) {
    cache.favorites = cache.favorites.filter((item) => item.key !== entry.key);
    persist(FAVORITES_KEY, cache.favorites);
    return false;
  }
  cache.favorites = [{ ...entry, addedAt: Date.now() }, ...(cache.favorites || [])].slice(0, FAVORITES_LIMIT);
  persist(FAVORITES_KEY, cache.favorites);
  return true;
}

export function removeFavoriteItem(key) {
  ensureCache();
  cache.favorites = (cache.favorites || []).filter((item) => item.key !== key);
  persist(FAVORITES_KEY, cache.favorites);
}

export function clearFavorites() {
  ensureCache();
  cache.favorites = [];
  persist(FAVORITES_KEY, []);
}

// ---------------------------------------------------------------------------
// Provider memory
// ---------------------------------------------------------------------------

export function getLastProvider(key) {
  ensureCache();
  return cache?.providers?.[key] || '';
}

export function setLastProvider(key, provider) {
  if (!key || !provider) return;
  ensureCache();
  cache.providers = { ...(cache.providers || {}), [key]: provider };
  persist(PROVIDERS_KEY, cache.providers);
}
