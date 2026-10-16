'use client';

import { useEffect, useState } from 'react';
import { installFocusWakeLock } from '@/lib/wakeLock';

/**
 * useWakeLock(active) — keeps the screen awake while `active`, and reports what really happened.
 *
 * The status matters: `unsupported` (iOS before 16.4, some in-app browsers) and `denied`
 * (battery saver, permissions policy) both mean the screen may still sleep, so the focus
 * screen can say so instead of promising something it cannot deliver. `active` is the focus
 * state, so the lock is released the moment focus ends, Music is left, or this unmounts.
 */
export default function useWakeLock(active) {
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    if (!active) { setStatus('idle'); return undefined; }
    const lock = installFocusWakeLock();
    setStatus(lock.status);
    const unsubscribe = lock.subscribe(() => setStatus(lock.status));
    return () => { unsubscribe(); lock.stop(); };
  }, [active]);

  return status;
}
