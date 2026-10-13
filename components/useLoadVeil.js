'use client';

import { useEffect, useState } from 'react';
import {
  readLoad, subscribeLoad, noteCommitted, installFetchTracker,
} from '@/lib/loadProgress';

/**
 * useLoadVeil — the shell's coarse view of "is a section opening, and should the content be
 * blurred right now?".
 *
 * Only coarse: it subscribes to store *events*, never to frames, so a route switch does not
 * re-render the app sixty times a second. The sixty-times-a-second part lives in
 * `LoadVeil`, which subscribes to `subscribeFrame`.
 *
 * Returns:
 *   visible   a load is real enough to show (200 ms rule already applied)
 *   revealing the arc has closed — unblur now, the veil is on its way out
 *   blurring  visible and not yet revealing — the content wrapper gets the blur
 *   label     which section is opening, for the ring's caption
 */
export default function useLoadVeil(pathname) {
  const [state, setState] = useState(() => coarse(readLoad()));

  useEffect(() => { installFetchTracker(); }, []);

  // The route committed: the store can now measure "requests done" against the new page.
  useEffect(() => { noteCommitted(pathname); }, [pathname]);

  useEffect(() => subscribeLoad(() => setState((prev) => {
    const next = coarse(readLoad());
    const same = prev.visible === next.visible && prev.revealing === next.revealing
      && prev.label === next.label && prev.suppressed === next.suppressed;
    return same ? prev : next;
  })), []);

  return state;
}

function coarse(load) {
  return {
    visible: load.visible,
    revealing: Boolean(load.done),
    blurring: load.visible && !load.done,
    label: load.label,
    suppressed: load.suppressed,
  };
}
