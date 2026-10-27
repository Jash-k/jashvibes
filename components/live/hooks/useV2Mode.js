'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * V1/V2 mode for /live.
 *
 * V1 is ALWAYS the default when the Live section is opened. V2 is only entered
 * by an explicit choice: pressing the header V2 toggle (which mirrors ?v2=1 in
 * the URL so a reload or a shared link keeps V2 for that session). Closing the
 * tab or navigating back to /live without the param returns to V1 — mode is no
 * longer restored from localStorage, so a V2 session can never hijack the
 * default Live landing on a later visit.
 */
export default function useV2Mode() {
  const [v2, setV2State] = useState(false);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      setV2State(params.get('v2') === '1');
    } catch { /* default V1 */ }
  }, []);

  const setV2 = useCallback((on) => {
    const next = Boolean(on);
    setV2State(next);
    try {
      const url = new URL(window.location.href);
      if (next) url.searchParams.set('v2', '1');
      else url.searchParams.delete('v2');
      window.history.replaceState(null, '', url);
    } catch { /* ignore */ }
  }, []);

  return [v2, setV2];
}
