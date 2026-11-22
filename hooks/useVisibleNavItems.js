'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { visibleNavItems } from '@/components/navItems';

let enabled = false;
let pending = null;
let revision = 0;
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const snapshot = () => enabled;
const serverSnapshot = () => false;
function publish(value) {
  if (enabled === value) return;
  enabled = value;
  listeners.forEach(listener => listener());
}
async function refresh() {
  if (pending) return pending;
  const version = revision;
  pending = fetch('/api/providers', { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error('Provider settings unavailable');
      const data = await response.json();
      if (version === revision) publish(data.providers?.some(p => p.id === 'stremio' && p.enabled === true) === true);
    })
    .catch(() => { if (version === revision) publish(false); })
    .finally(() => { pending = null; });
  return pending;
}

/** One shared store keeps desktop/mobile consistent; fail closed until loaded. */
export default function useVisibleNavItems() {
  const pathname = usePathname();
  const stremioEnabled = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    refresh();
    const update = event => {
      if (typeof event.detail?.enabled === 'boolean') {
        revision++;
        publish(event.detail.enabled);
      } else refresh();
    };
    const focus = () => refresh();
    const visible = () => { if (!document.hidden) refresh(); };
    const timer = setInterval(visible, 30000);
    window.addEventListener('jash:stremio-access', update);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('jash:stremio-access', update);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [pathname]);
  return visibleNavItems(stremioEnabled);
}
