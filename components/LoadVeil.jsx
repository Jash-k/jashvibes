'use client';

import { useEffect, useState } from 'react';
import RingLogo from '@/components/RingLogo';
import { readLoad, subscribeFrame } from '@/lib/loadProgress';

/**
 * LoadVeil — the ring over the blurred section.
 *
 * The blur itself is CSS on the content wrapper (`.jv-route-content.is-loading`).
 * This component draws the ring, the caption and the scrim, and sits above the content but
 * *below* the rail and the dock, which stay sharp and clickable: the shell must never look
 * like it died.
 *
 * It is deliberately not inside the keyed route wrapper. Next keeps the old page mounted for
 * the whole transition and swaps it in a single commit, so a veil nested in that wrapper would
 * unmount and remount at exactly the wrong frame and the ring would blink. Living outside, the
 * ring is continuous across the swap — which is also why it can blur the section you are
 * *leaving* and then hand the same ring to the section you are entering.
 */
export default function LoadVeil({ revealing = false, label = 'section' }) {
  const [progress, setProgress] = useState(() => readLoad().progress);

  useEffect(() => subscribeFrame((load) => setProgress(load.progress)), []);

  return (
    <div className={`jv-veil${revealing ? ' is-revealing' : ''}`} role="status" aria-live="polite" aria-busy={!revealing}>
      <div className="jv-veil-inner">
        <RingLogo progress={progress} />
        <p className="jv-veil-label">{revealing ? 'Ready' : `Opening ${label}…`}</p>
      </div>
    </div>
  );
}
