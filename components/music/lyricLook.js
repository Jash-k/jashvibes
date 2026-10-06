'use client';

import { useCallback, useEffect, useState } from 'react';

/*
 * The lyric "look": canvas, type size, typeface, offset, translation and follow.
 *
 * All six are one persisted object. Resonāda keeps these in Settings and makes you
 * leave the lyrics to change them; here the same object drives both the inline strip
 * on the lyrics screen and the full panel in Settings, so the two can never disagree.
 *
 * Persistence is localStorage under one key, matching how favourites and recents are
 * already stored in MusicProvider.
 */

export const LYRIC_CANVASES = [
  { id: 'void', label: 'Void', hint: 'Nothing but type on black.' },
  { id: 'aura', label: 'Aura', hint: 'A glow follows the line being sung.' },
  { id: 'kinetic', label: 'Kinetic', hint: 'Left-aligned, the sung line steps forward.' },
  { id: 'prism', label: 'Prism', hint: 'Colour splits across the stage.' },
  { id: 'monolith', label: 'Monolith', hint: 'Slab rules, one inverted bar.' },
  { id: 'gradient', label: 'Gradient', hint: 'A wash from the accent down to black.' },
  { id: 'noir', label: 'Noir', hint: 'Silver, grain, hard contrast.' },
  { id: 'bloom', label: 'Bloom', hint: 'Orbs of colour breathing behind the words.' },
  { id: 'cinema', label: 'Cinema', hint: 'Letterbox and a warm grade.' },
  { id: 'fluid', label: 'Fluid', hint: 'The cover art as a wash, type on the left.' },
];

export const LYRIC_SIZES = [
  { id: 'xs', label: 'XS', px: 19 },
  { id: 's', label: 'S', px: 24 },
  { id: 'm', label: 'M', px: 29 },
  { id: 'l', label: 'L', px: 34 },
  { id: 'xl', label: 'XL', px: 42 },
];

export const LYRIC_FACES = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
];

const KEY = 'jash_music_look';

export const DEFAULT_LOOK = {
  canvas: 'aura',
  size: 'm',
  face: 'sans',
  offset: 0,
  translate: true,
  follow: true,
};

export function readLook() {
  if (typeof window === 'undefined') return { ...DEFAULT_LOOK };
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) || '{}');
    const canvas = LYRIC_CANVASES.some((item) => item.id === raw.canvas) ? raw.canvas : DEFAULT_LOOK.canvas;
    const size = LYRIC_SIZES.some((item) => item.id === raw.size) ? raw.size : DEFAULT_LOOK.size;
    const face = LYRIC_FACES.some((item) => item.id === raw.face) ? raw.face : DEFAULT_LOOK.face;
    return {
      canvas,
      size,
      face,
      offset: Number.isFinite(Number(raw.offset)) ? Number(raw.offset) : DEFAULT_LOOK.offset,
      translate: raw.translate !== false,
      follow: raw.follow !== false,
    };
  } catch {
    return { ...DEFAULT_LOOK };
  }
}

export function useLyricLook() {
  const [look, setLook] = useState(DEFAULT_LOOK);
  const [ready, setReady] = useState(false);

  // Read after mount only: the server has no localStorage, and reading during render
  // would make the first paint disagree with the client.
  useEffect(() => {
    setLook(readLook());
    setReady(true);
  }, []);

  const update = useCallback((patch) => {
    setLook((prev) => {
      const next = { ...prev, ...patch };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const reset = useCallback(() => update(DEFAULT_LOOK), [update]);

  const step = useCallback((key, direction) => {
    const list = key === 'size' ? LYRIC_SIZES : LYRIC_FACES;
    setLook((prev) => {
      const index = Math.max(0, list.findIndex((item) => item.id === prev[key]));
      const nextIndex = Math.max(0, Math.min(list.length - 1, index + direction));
      const next = { ...prev, [key]: list[nextIndex].id };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const nudgeOffset = useCallback((delta) => {
    setLook((prev) => {
      const next = { ...prev, offset: Math.round((prev.offset + delta) * 100) / 100 };
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  return { look, ready, update, reset, step, nudgeOffset };
}
