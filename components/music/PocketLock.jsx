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
 * **Nothing is written on it.** The screen is the blurred surround, the lyrics (or the sleeve),
 * and one drag handle at the bottom — no lock glyph, no "Focus locked", no "swipe down to
 * unlock", no explanatory paragraph. Advice printed permanently over the thing you locked the
 * screen to look at defeats the point of locking it. The drag itself is the feedback: the guard
 * fades as you pull, so the gesture answers before it commits.
 *
 * Four ways out, in order of how people actually leave:
 *   1. swipe down anywhere (the fast one);
 *   2. slide the puck right (deliberate, and the only one that is also keyboard reachable);
 *   3. Escape (desktop);
 *   4. the browser Back button / Android back. The shell pushes one history entry when focus
 *      starts, so back leaves focus instead of leaving the Music section.
 *
 * It is not an `aria-modal` dialog: one control outside it is meant to be used, and claiming
 * modality while leaving a live control outside would be a lie to assistive tech. Because the
 * visible words are gone, the state change and the wake-lock outcome are announced by the
 * shell's status region instead — removing the caption must not remove the announcement.
 */

const SWIPE_COMMIT = 120; // px of downward travel that unlocks

export default function PocketLock({ onUnlock }) {
  const slider = useRef(null);
  const [drag, setDrag] = useState(0);          // swipe-down progress, 0…1
  const [slideProgress, setSlideProgress] = useState(0); // puck progress, 0…1
  const swipe = useRef(null);
  const slide = useRef(null);
  const dragRef = useRef(0); // the value pointerup should judge, even if React has not re-rendered yet

  const unlock = useRef(onUnlock); unlock.current = onUnlock;

  useEffect(() => {
    const previous = document.activeElement;
    slider.current?.querySelector('button')?.focus();
    return () => { previous?.focus?.(); };
  }, []);

  // ── swipe down ────────────────────────────────────────────────────────────
  function swipeStart(event) {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target.closest?.('.mc-pocket-slider')) return; // the slider owns its own gesture
    swipe.current = { id: event.pointerId, y: event.clientY, x: event.clientX };
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

  return (
    <section
      className="mc-pocket-lock"
      role="region"
      aria-label="Focus mode"
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
      {/* The only thing this layer draws: the handle you can drag out. No label, no glyph but
          the direction of the drag. */}
      <div className="mc-pocket-slider" ref={slider}>
        <button
          type="button"
          aria-label="Drag right to leave focus mode; keyboard: Control Shift U"
          style={{ transform: `translateX(${Math.max(0, (slider.current?.clientWidth || 56) - 56) * slideProgress}px)` }}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            slide.current = { id: event.pointerId, x: event.clientX, progress: 0 };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={slideMove}
          onPointerUp={slideEnd}
          onPointerCancel={() => { slide.current = null; setSlideProgress(0); }}
          onLostPointerCapture={() => { slide.current = null; setSlideProgress(0); }}
        >
          <MusicIcon name="back" />
        </button>
      </div>
    </section>
  );
}
