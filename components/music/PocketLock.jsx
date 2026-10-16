'use client';

import { useEffect, useRef, useState } from 'react';
import { MusicIcon } from './CanvasBits';

/**
 * PocketLock — the touch guard behind focus mode.
 *
 * Focus mode (the lock button in the transport) does three things at once: the surrounding
 * UI blurs away, the screen is asked to stay awake, and this layer locks touches so a phone
 * carried in a pocket (or resting on a chest while you sing) cannot pause, skip or seek by
 * accident. Only the lyrics — or the sleeve, in artwork mode — and the Artwork/Lyrics toggle
 * stay sharp; the toggle is deliberately raised above this layer so you can change what the
 * focus shows without unlocking.
 *
 * Four ways out, in order of how people actually leave:
 *   1. swipe down anywhere (the fast one — the vignette fades as you pull, so the gesture has
 *      visible feedback before it commits);
 *   2. slide the puck right (deliberate, and the only one that is also keyboard reachable);
 *   3. Escape (desktop);
 *   4. the browser Back button / Android back. The shell pushes one history entry when focus
 *      starts, so back leaves focus instead of leaving the Music section.
 *
 * It is not an `aria-modal` dialog: one control outside it is meant to be used, and claiming
 * modality while leaving a live control outside would be a lie to assistive tech. The state
 * change itself is announced by the shell's status region.
 */

const SWIPE_COMMIT = 120; // px of downward travel that unlocks

export default function PocketLock({ onUnlock, awake = 'idle' }) {
  const slider = useRef(null);
  const hintTimer = useRef(0);
  const [drag, setDrag] = useState(0);          // swipe-down progress, 0…1
  const [slideProgress, setSlideProgress] = useState(0); // puck progress, 0…1
  const [hint, setHint] = useState(true);
  const swipe = useRef(null);
  const slide = useRef(null);
  const dragRef = useRef(0); // the value pointerup should judge, even if React has not re-rendered yet

  const unlock = useRef(onUnlock); unlock.current = onUnlock;

  useEffect(() => {
    const previous = document.activeElement;
    slider.current?.querySelector('button')?.focus();
    // The hint is only useful the first few seconds; it comes back if you touch the screen.
    hintTimer.current = window.setTimeout(() => setHint(false), 3600);
    return () => {
      window.clearTimeout(hintTimer.current);
      previous?.focus?.();
    };
  }, []);

  function wakeHint() {
    setHint(true);
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(false), 3600);
  }

  // ── swipe down ────────────────────────────────────────────────────────────
  function swipeStart(event) {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target.closest?.('.mc-pocket-slider')) return; // the slider owns its own gesture
    swipe.current = { id: event.pointerId, y: event.clientY, x: event.clientX };
    wakeHint();
  }
  function swipeMove(event) {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    const dy = event.clientY - start.y;
    const dx = Math.abs(event.clientX - start.x);
    if (dy <= 0 || dx > Math.abs(dy)) { setDrag(0); return; } // only downward, mostly vertical
    event.preventDefault();
    dragRef.current = Math.min(1, dy / SWIPE_COMMIT);
    setDrag(dragRef.current);
  }
  function swipeEnd(event) {
    const start = swipe.current;
    if (!start || start.id !== event.pointerId) return;
    swipe.current = null;
    const committed = dragRef.current >= 0.96;
    dragRef.current = 0;
    setDrag(0);
    if (committed) unlock.current?.('swipe');
  }
  function swipeCancel() { swipe.current = null; dragRef.current = 0; setDrag(0); }

  // ── slide right (kept: deliberate, and keyboard reachable) ────────────────
  function slideMove(event) {
    const start = slide.current;
    if (!start || start.id !== event.pointerId) return;
    const distance = Math.max(1, slider.current.clientWidth - 56);
    const next = Math.max(0, Math.min(1, (event.clientX - start.x) / distance));
    start.progress = next;
    setSlideProgress(next);
  }
  function slideEnd(event) {
    const start = slide.current;
    if (!start || start.id !== event.pointerId) return;
    slideMove(event);
    const complete = start.progress >= 0.95;
    slide.current = null;
    setSlideProgress(0);
    if (complete) unlock.current?.('slide');
  }

  const awakeLine = awake === 'active' ? 'Screen stays awake' : 'This browser will not hold the screen awake';

  return (
    <section
      className={`mc-pocket-lock${hint ? ' is-hinting' : ''}`}
      role="region"
      aria-label="Focus locked"
      tabIndex={-1}
      style={{ '--mc-pocket-drag': drag }}
      onPointerDown={swipeStart}
      onPointerMove={swipeMove}
      onPointerUp={swipeEnd}
      onPointerCancel={swipeCancel}
      onLostPointerCapture={swipeCancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); unlock.current?.('escape'); }
        // Keyboard alternative requires a deliberate chord, not Space/Escape touches.
        if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') { event.preventDefault(); unlock.current?.('keyboard'); }
      }}
    >
      <div className="mc-pocket-grab" aria-hidden="true">
        <span />
        <small>Swipe down to unlock</small>
      </div>

      <div className="mc-pocket-copy">
        <MusicIcon name="lock" size={30} />
        <h2>Focus locked</h2>
        <p>Only your lyrics stay sharp — everything else is blurred out. Your music keeps playing, touches are locked, and {awakeLine.toLowerCase()}.</p>
      </div>

      <div className="mc-pocket-slider" ref={slider}>
        <span aria-hidden="true">Slide to unlock →</span>
        <button
          type="button"
          aria-label="Drag right to unlock focus; keyboard: Control Shift U"
          style={{ transform: `translateX(${Math.max(0, (slider.current?.clientWidth || 56) - 56) * slideProgress}px)` }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            slide.current = { id: event.pointerId, x: event.clientX, progress: 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
            wakeHint();
          }}
          onPointerMove={slideMove}
          onPointerUp={slideEnd}
          onPointerCancel={() => { slide.current = null; setSlideProgress(0); }}
          onLostPointerCapture={() => { slide.current = null; setSlideProgress(0); }}
        >
          <MusicIcon name="back" />
        </button>
      </div>

      <small className="mc-pocket-foot">Escape on a keyboard, or the Back button, also unlocks</small>
    </section>
  );
}
