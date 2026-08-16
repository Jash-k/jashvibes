/**
 * Client-side personal library store.
 *
 * Powers three JaSH ViBeS features without any server/database cost:
 *   1. Continue Watching — history with season/episode + playback progress
 *   2. My List          — user-picked favorites
 *   3. Provider memory  — last manually selected server per title
 *
 * Everything is stored in localStorage so the feature works on free-tier
 * hosts with zero extra infrastructure. Import from client components only.
 */

import { useSyncExternalStore } from 'react';

const HISTORY_KEY = 'jash:library:continue:v1';
const FAVORITES_KEY = 'jash:library:favorites:v1';
const PROVIDERS_KEY = 'jash:library:providers:v1';
const HISTORY_LIMIT = 60;
const FAVORITES_LIMIT = 200;

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
  const history = readKey(HISTORY_KEY, []);
  const favorites = readKey(FAVORITES_KEY, []);
  const providers = readKey(PROVIDERS_KEY, {});
  cache = {
    history: Array.isArray(history) ? history : [],
    favorites: Array.isArray(favorites) ? favorites : [],
    providers: providers && typeof providers === 'object' && !Array.isArray(providers) ? providers : {},
  };
}

function persist(key, value) {
  ensureCache();
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
  version += 1;
  listeners.forEach((listener) => {
    try { listener(); } catch {}
  });
}

/**
 * Re-render hook: any component calling this re-renders whenever the library
 * changes (including changes from other browser tabs via the storage event).
 */
export function useLibraryVersion() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const onStorage = () => { cache = null; listener(); };
      try { window.addEventListener('storage', onStorage); } catch {}
      return () => {
        listeners.delete(listener);
        try { window.removeEventListener('storage', onStorage); } catch {}
      };
    },
    () => version,
    () => 0,
  );
}

/**
 * Stable identity for a watchable item. TMDB titles use `movie:597` /
 * `series:1396`. TamilOTT title-only items use `ott:<normalized title>`.
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
// Continue Watching (history)
// ---------------------------------------------------------------------------

export function getHistory() {
  ensureCache();
  return [...(cache?.history || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function getHistoryEntry(key) {
  ensureCache();
  return (cache?.history || []).find((item) => item.key === key) || null;
}

export function upsertHistoryEntry(entry = {}) {
  if (!entry.key) return;
  ensureCache();
  const now = Date.now();
  const list = cache.history || [];
  const index = list.findIndex((item) => item.key === entry.key);
  const existing = index >= 0 ? list[index] : null;
  const samePlayback =
    existing &&
    Number(existing.season || 0) === Number(entry.season || 0) &&
    Number(existing.episode || 0) === Number(entry.episode || 0) &&
    existing.href === entry.href;

  const merged = {
    ...(existing || {}),
    ...entry,
    progress: samePlayback ? Math.max(existing.progress || 0, entry.progress || 0) : Number(entry.progress || 0),
    duration: Number(entry.duration || 0) || (samePlayback ? existing.duration || 0 : 0),
    startedAt: existing?.startedAt || now,
    updatedAt: now,
  };

  if (index >= 0) list.splice(index, 1);
  list.unshift(merged);
  cache.history = list.slice(0, HISTORY_LIMIT);
  persist(HISTORY_KEY, cache.history);
}

export function saveWatchProgress(key, progress = 0, duration = 0) {
  if (!key) return;
  ensureCache();
  const item = (cache.history || []).find((entry) => entry.key === key);
  if (!item) return;
  item.progress = Math.max(0, Math.round(Number(progress) || 0));
  if (Number(duration) > 0) item.duration = Math.round(Number(duration));
  item.updatedAt = Date.now();
  persist(HISTORY_KEY, cache.history);
}

export function removeHistoryEntry(key) {
  ensureCache();
  cache.history = (cache.history || []).filter((item) => item.key !== key);
  persist(HISTORY_KEY, cache.history);
}

export function clearHistory() {
  ensureCache();
  cache.history = [];
  persist(HISTORY_KEY, []);
}

// ---------------------------------------------------------------------------
// My List (favorites)
// ---------------------------------------------------------------------------

export function getFavorites() {
  ensureCache();
  return [...(cache?.favorites || [])].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

export function isFavoriteItem(key) {
  ensureCache();
  return Boolean((cache?.favorites || []).some((item) => item.key === key));
}

/** Returns the new favorite state (true = added, false = removed). */
export function toggleFavoriteItem(entry = {}) {
  if (!entry.key) return false;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getProgressPercent(item) {
  if (!item?.duration) return 0;
  return Math.max(0, Math.min(100, Math.round(((item.progress || 0) / item.duration) * 100)));
}
