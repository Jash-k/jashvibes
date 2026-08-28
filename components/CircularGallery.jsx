'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

// ReactBits "Circular Gallery" — zero-dep CSS-3D port (official API shape:
// items[{image, text}], bend, scrollSpeed/scrollEase feel). A curved ring of
// cards you can drag (or use the mouse wheel) to spin; cruises slowly on its
// own and snaps the front card into focus.
export default function CircularGallery({ items = [], onItemClick, bend = 3, height = 360 }) {
  const cards = useMemo(() => (items || []).slice(0, 12), [items]);
  const count = cards.length;
  const step = count ? 360 / count : 0;
  const radius = useMemo(() => Math.min(360, Math.max(230, 130 + count * 22)), [count]);

  const rootRef = useRef(null);
  const targetRef = useRef(0);
  const angleRef = useRef(0);
  const dragRef = useRef(null);       // { startX, startAngle, moved }
  const lastInteractRef = useRef(0);
  const snapTimerRef = useRef(null);
  const [angle, setAngle] = useState(0);

  // Eased rAF loop + slow auto-cruise
  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(48, now - last);
      last = now;
      if (!dragRef.current) {
        if (now - lastInteractRef.current > 2200 && count > 1) {
          targetRef.current -= (dt / 1000) * 11; // gentle cruise, full ring in ~32s
        }
        angleRef.current += (targetRef.current - angleRef.current) * 0.085;
      }
      const next = Math.round(angleRef.current * 1000) / 1000;
      setAngle((prev) => (prev === next ? prev : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [count]);

  // Wheel spin (native listener so we can preventDefault)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      lastInteractRef.current = performance.now();
      targetRef.current += (Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX) * 0.22;
      scheduleSnap();
    };
    const scheduleSnap = () => {
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => {
        targetRef.current = Math.round(targetRef.current / step) * step;
      }, 240);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(snapTimerRef.current); };
  }, [step]);

  const onPointerDown = (event) => {
    lastInteractRef.current = performance.now();
    dragRef.current = { startX: event.clientX, startAngle: targetRef.current, moved: false };
    rootRef.current?.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    if (Math.abs(dx) > 6) drag.moved = true;
    targetRef.current = drag.startAngle + dx * 0.3;
    angleRef.current += (targetRef.current - angleRef.current) * 0.5;
  };
  const onPointerUp = (event) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    lastInteractRef.current = performance.now();
    const dx = event.clientX - drag.startX;
    targetRef.current += dx * 0.12; // flick inertia
    clearTimeout(snapTimerRef.current);
    snapTimerRef.current = setTimeout(() => {
      targetRef.current = Math.round(targetRef.current / step) * step;
    }, 140);
  };

  const activeIndex = count ? ((Math.round(-angle / step) % count) + count) % count : 0;

  if (!count) return null;

  return (
    <div
      ref={rootRef}
      className="jv-cgal relative w-full touch-pan-y select-none overflow-hidden rounded-3xl"
      style={{ height }}
      role="listbox"
      aria-label="Circular gallery"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div className="absolute inset-0" style={{ perspective: '1200px', perspectiveOrigin: `50% ${46 + bend * 3}%` }}>
        <div className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transformStyle: 'preserve-3d' }}>
          {cards.map((card, index) => {
            const cardAngle = index * step + angle;
            const rel = (((cardAngle % 360) + 360) % 360 + 360) % 360 - 180; // -180..180, 0 = front
            const depth = Math.cos(((rel) * Math.PI) / 180); // 1 = front
            const opacity = Math.max(0, (depth + 0.32) / 1.32);
            const blur = Math.max(0, (1 - depth)) * 2.4;
            const focused = index === activeIndex;
            return (
              <button
                key={card.key || `${card.text}-${index}`}
                type="button"
                role="option"
                aria-selected={focused}
                onClick={() => { if (!dragRef.current?.moved) onItemClick?.(card); }}
                className={`jv-cgal-card group absolute h-[13.75rem] w-[10rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border text-left outline-none transition-[box-shadow,border-color] duration-300 sm:h-56 sm:w-44 ${
                  focused ? 'border-amber-300/70 shadow-[0_0_42px_rgba(245,158,11,0.35)]' : 'border-white/10'
                }`}
                style={{
                  transform: `translate(-50%, -50%) rotateY(${cardAngle}deg) translateZ(${radius}px)`,
                  opacity,
                  filter: blur > 0.6 ? `blur(${blur.toFixed(1)}px)` : undefined,
                  zIndex: Math.round((depth + 1) * 100),
                }}
              >
                {card.image ? (
                  <img src={card.image} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable="false" />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-gradient-to-br from-fuchsia-950 via-black to-zinc-950 text-4xl">♫</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-2.5">
                  <p className="line-clamp-2 text-[11px] font-black leading-4 text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.9)]">{card.text}</p>
                  {card.sub ? <p className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-fuchsia-200/80">{card.sub}</p> : null}
                </div>
                {focused ? <div className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-amber-300/50" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
        {cards.map((card, index) => (
          <span key={`dot-${index}`} className={`h-1 rounded-full transition-all duration-300 ${index === activeIndex ? 'w-5 bg-gradient-to-r from-amber-400 to-fuchsia-400' : 'w-1 bg-white/30'}`} />
        ))}
      </div>
    </div>
  );
}
