'use client';
import { useCallback, useMemo, useState } from 'react';
import { LIVE_CATALOGS } from '@/lib/liveCatalogs';

/**
 * Owner quick-hide straight from /live — no trip to Admin.
 * Inside a fixed catalogue it removes ONLY that catalogue membership from
 * every variant of the logical group; in All/Favorites it performs a full
 * hide. Requires the admin session cookie; the API answers 401 otherwise.
 *
 * @param {boolean}  isAdmin       gate from useAdminSession
 * @param {string}   activeCatalog current tab (fixed id, 'all' or 'fav')
 * @param {Array}    filtered      currently visible groups (zap-after-hide)
 * @param {Function} pick          tune a group; pick(null) clears the stage
 * @param {Function} onRemoved     called after a successful write (reload)
 */
export default function useQuickHide(isAdmin, activeCatalog, filtered, pick, onRemoved) {
  const [hideError, setHideError] = useState('');
  const fixedCatalogIds = useMemo(() => new Set(LIVE_CATALOGS.map((c) => c.id)), []);

  const removeChannel = useCallback(async (group) => {
    if (!group || !isAdmin) return;
    const ids = (group.variants || []).map((v) => v.channelId).filter(Boolean);
    if (!ids.length) return;
    const scopeCatalog = fixedCatalogIds.has(activeCatalog) ? activeCatalog : '';
    if (!scopeCatalog && !window.confirm(`Hide “${group.displayName}” from every catalogue and /live? Re-enable it later in Admin → TV.`)) return;
    const idx = filtered.findIndex((g) => g.logicalId === group.logicalId);
    const nextGroup = filtered.length > 1 ? filtered[((idx < 0 ? 0 : idx) + 1) % filtered.length] : null;
    try {
      const res = await fetch('/api/live/admin/channels', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scopeCatalog
          ? { ids, action: 'setCatalog', catalogId: scopeCatalog, enabled: false }
          : { ids, action: 'hide' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
      setHideError('');
      pick(nextGroup); // null when the removed card was the last one visible
      onRemoved?.(); // model write hook already bumped the cache; this refetches
    } catch (e) {
      setHideError(e.message);
    }
  }, [isAdmin, activeCatalog, filtered, pick, onRemoved, fixedCatalogIds]);

  return { removeChannel, hideError, setHideError };
}
