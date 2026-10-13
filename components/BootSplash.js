'use client';

import { useEffect, useState } from 'react';
import RingLogo from '@/components/RingLogo';
import { SPLASH_MIN_MS, splashProgress } from '@/lib/bootPhase';

/**
 * BootSplash — the branded first paint, and the same object as every section switch:
 * logo in a progress ring, on the app's own background.
 *
 * Replaces the bare grey spinner that used to sit on flat black, and replaces the linear
 * bar of the previous pass — the user asked for the ring to *be* the progress, so the splash
 * now shares `RingLogo` with the switch veil and the maths with `lib/bootPhase.js`.
 *
 * The splash keeps two promises:
 *   1. it is up for at least SPLASH_MIN_MS, so a gate that answers in 40 ms still reads as
 *      intentional instead of a flash;
 *   2. it leaves exactly when its ring closes (see `splashProgress`), and the unlock card is
 *      hosted on the same background, so the hand-off is a swap of the middle of the screen.
 *
 * The ring runs on its own animation frame rather than the parent's 120 ms timer: a clock
 * that ticks eight times a second makes a progress arc look broken.
 */
export default function BootSplash({ phase = 'brand', status = 'checking', elapsedMs = 0, wordmark = 'JaSH ViBeS', hint = '' }) {
  const [now, setNow] = useState(elapsedMs);
  const [answeredAt, setAnsweredAt] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now() - elapsedMs;
    const tick = () => { setNow(performance.now() - start); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [elapsedMs]);

  const answered = status === 'unlocked' || status === 'locked';
  const closing = answered && now >= SPLASH_MIN_MS;

  // When the gate actually answered. Recorded from an effect rather than during render, and
  // never before the minimum: the minimum and the ring then agree, so the last 8% is always
  // the 250 ms immediately before the page appears.
  useEffect(() => {
    if (answered) setAnsweredAt((prev) => prev || Math.max(SPLASH_MIN_MS, now));
  }, [answered, now]);

  const progress = splashProgress({ elapsedMs: now, answered: closing, answeredAtMs: answeredAt || SPLASH_MIN_MS });

  return (
    <div className="jv-boot" data-phase={phase} aria-busy="true">
      <div className="jv-boot-splash" role="status" aria-live="polite">
        <RingLogo progress={progress} />
        <p className="jv-boot-word">{wordmark}</p>
        <p className="jv-boot-note">{phase === 'slow' ? (hint || 'Still checking your access…') : 'Checking access…'}</p>
      </div>
    </div>
  );
}
