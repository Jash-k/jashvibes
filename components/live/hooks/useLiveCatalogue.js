'use client';
import { useCallback, useEffect, useState } from 'react';
import { pickLandingGroup } from '@/lib/live/landing';

/**
 * Single full-catalogue fetch plus the currently tuned logical group.
 * Catalog/source/search switches are pure client-side filtering afterwards,
 * so tab changes make zero network calls. `reload()` re-fetches after an
 * owner write while preserving the tuned channel when it still exists.
 */
export default function useLiveCatalogue() {
  const [groups, setGroups] = useState([]);
  const [catalogs, setCatalogs] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeLogical, setActiveLogical] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/live/channels?tamilOnly=1', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      if (data.needSync) throw new Error(data.hint || 'No channels synced yet — open Admin → TV → Sync All Tamil');
      setCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      const playable = (data.logical || []).filter((g) => g.variants?.some((v) => !!v.url));
      setGroups(playable);
      setActiveLogical((prev) => {
        if (prev?.logicalId && playable.some((g) => g.logicalId === prev.logicalId)) return prev;
        return pickLandingGroup(playable);
      });
      if (!playable.length) setError('No Tamil channels found — sync sources in Admin → TV.');
      setStatus('ready');
    } catch (e) {
      setError(e.message);
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  return {
    groups,
    catalogs,
    status,
    error,
    setReloadKey,
    load,
    activeLogical,
    setActiveLogical,
  };
}
