'use client';
import { useCallback, useEffect, useState } from 'react';

const FAV_KEY = 'jash_live_favs';
// Legacy key from the previous release; read once so favourites survive.
const LEGACY_FAV_KEY = 'jash_live_v13_favs';

function readStored() {
  try {
    const raw = localStorage.getItem(FAV_KEY) || localStorage.getItem(LEGACY_FAV_KEY);
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persisted logical-channel favourites, shared by the rail/chips and TV mode. */
export default function useFavourites() {
  const [favs, setFavs] = useState([]);

  useEffect(() => { setFavs(readStored()); }, []);

  const toggleFav = useCallback((id) => {
    setFavs((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  return { favs, toggleFav };
}
