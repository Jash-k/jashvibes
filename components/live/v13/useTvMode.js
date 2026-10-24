'use client';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'jash_live_tv_mode';

/**
 * useTvMode — 10-foot mode detection with a manual override.
 *
 * Auto-detection treats a device as a TV when it has no hover and only a coarse
 * pointer (D-pad/remote) on a room-sized viewport. Phones match the pointer
 * part but fail the size check. The user's explicit toggle is persisted and
 * always wins, so a phone can force TV mode and a desktop browser can leave it.
 */
function detectLivingRoom() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const remoteLike = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const roomSized = window.innerWidth >= 720 && window.innerHeight >= 480;
  return Boolean(remoteLike && roomSized);
}

export default function useTvMode() {
  const [tvMode, setTvModeState] = useState(false);

  useEffect(() => {
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
    const apply = () => {
      setTvModeState(saved === 'on' ? true : saved === 'off' ? false : detectLivingRoom());
    };
    apply();
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    const onChange = () => { if (saved === null) setTvModeState(detectLivingRoom()); };
    mq.addEventListener?.('change', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      mq.removeEventListener?.('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  const setTvMode = useCallback((on) => {
    const value = Boolean(on);
    setTvModeState(value);
    try { localStorage.setItem(STORAGE_KEY, value ? 'on' : 'off'); } catch { /* storage unavailable */ }
  }, []);

  return { tvMode, setTvMode };
}
