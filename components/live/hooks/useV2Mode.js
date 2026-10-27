'use client';
import { useCallback, useEffect, useState } from 'react';

const MODE_KEY = 'jash_live_v2_mode';

/**
 * V1/V2 mode for /live. Persisted in localStorage and mirrored to ?v2=1 so a
 * reload or shared link keeps the mode; the V1 experience is the default and
 * stays untouched while the flag is off.
 */
export default function useV2Mode() {
  const [v2, setV2State] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlOn = params.get('v2') === '1';
      const storedOn = localStorage.getItem(MODE_KEY) === '1';
      setV2State(urlOn || storedOn);
    } catch { /* private mode etc. — default V1 */ }
  }, []);

  const setV2 = useCallback((on) => {
    const next = Boolean(on);
    setV2State(next);
    try { localStorage.setItem(MODE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('v2', '1');
      else url.searchParams.delete('v2');
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
  }, []);

  return [v2, setV2];
}
