'use client';
import { useCallback, useEffect, useState } from 'react';
import { sourceBrowseGroups } from '@/lib/live/sourceBrowse';
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
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeLogical, setActiveLogical] = useState(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/live/channels', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load');
      setCatalogs(Array.isArray(data.catalogs) ? data.catalogs : []);
      const registry = Array.isArray(data.sources) ? data.sources : [];
      setSources(registry);
      const playable = sourceBrowseGroups(data.logical || [], registry).filter((g) => g.variants?.some((v) => !!v.url));
      setGroups(playable);
      setActiveLogical((prev) => {
        if (prev?.logicalId && playable.some((g) => g.logicalId === prev.logicalId)) return playable.find(g => g.logicalId === prev.logicalId);
        return pickLandingGroup(playable);
      });
      if (!playable.length) setError('No visible channels in enabled sources — sync sources in Admin → TV.');
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
    sources,
    status,
    error,
    setReloadKey,
    load,
    activeLogical,
    setActiveLogical,
  };
}
