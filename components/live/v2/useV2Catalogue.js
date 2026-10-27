'use client';
import { useCallback, useEffect, useState } from 'react';

/**
 * V2 catalogue hook — one fetch to /api/live/v2/channels, all category/search
 * filtering afterwards is pure client-side (same no-network-switch contract
 * as the V1 useLiveCatalogue hook).
 */
export default function useV2Catalogue() {
  const [groups, setGroups] = useState([]);
  const [flat, setFlat] = useState([]);
  const [tokenState, setTokenState] = useState({ hasToken: false, tokenExpiry: 0 });
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/live/v2/channels', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data?.error || 'Failed to load V2 catalogue');
      setGroups(Array.isArray(data.groups) ? data.groups : []);
      setFlat(Array.isArray(data.flat) ? data.flat : []);
      setTokenState(data.tokenState || { hasToken: false, tokenExpiry: 0 });
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  return { groups, flat, tokenState, status, error, reload: () => setReloadKey((k) => k + 1) };
}
