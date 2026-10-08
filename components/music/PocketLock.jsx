'use client';

import { useEffect, useRef, useState } from 'react';
import { MusicIcon } from './CanvasBits';

// App-level touch protection only; browser/OS gestures and media buttons remain available.
export default function PocketLock({ onUnlock }) {
  const panel = useRef(null), track = useRef(null), gesture = useRef(null);
  const [progress, setProgress] = useState(0);
  const unlock = useRef(onUnlock); unlock.current = onUnlock;
  useEffect(() => {
    const previous = document.activeElement;
    const background = document.querySelector('.mc-app-content');
    const inert = background?.inert;
    if (background) background.inert = true;
    panel.current?.focus();
    return () => { if (background) background.inert = inert; previous?.focus?.(); };
  }, []);
  const move = (event) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const distance = Math.max(1, track.current.clientWidth - 56);
    const next = Math.max(0, Math.min(1, (event.clientX - start.x) / distance));
    start.progress = next;
    setProgress(next);
  };
  const finish = (event) => {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    move(event);
    const complete = start.progress >= .95;
    gesture.current = null;
    setProgress(0);
    if (complete) unlock.current();
  };
  return <section ref={panel} className="mc-pocket-lock" role="dialog" aria-modal="true" aria-label="Pocket mode" tabIndex={-1} onKeyDown={(event) => {
    // Keyboard alternative requires a deliberate chord, not Space/Escape touches.
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') { event.preventDefault(); unlock.current(); }
    if (event.key === 'Tab') { event.preventDefault(); track.current?.querySelector('button')?.focus(); }
  }}>
    <MusicIcon name="lock" size={38}/><h2>Pocket mode</h2><p>Touches are locked. Your music keeps playing.</p>
    <div className="mc-pocket-slider" ref={track}>
      <span aria-hidden="true">Slide to unlock →</span>
      <button type="button" aria-label="Drag right to unlock pocket mode; keyboard: Control Shift U" style={{ transform: `translateX(${progress * Math.max(0, (track.current?.clientWidth || 56) - 56)}px)` }}
        onPointerDown={(event) => { if (!event.isPrimary || event.button !== 0) return; event.preventDefault(); gesture.current = { id: event.pointerId, x: event.clientX, progress: 0 }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { gesture.current = null; setProgress(0); }} onLostPointerCapture={() => { gesture.current = null; setProgress(0); }}>
        <MusicIcon name="back"/>
      </button>
    </div>
    <small>Keyboard unlock: Ctrl + Shift + U</small>
  </section>;
}
