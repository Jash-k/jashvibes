'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * RailFocus — the homepage's one big thing, and the strip you aim it with.
 *
 * This replaces the hero carousel, and the difference is not cosmetic. The carousel advanced on a
 * 50 ms interval, so a smart-TV box was redrawing every frame of a rotation nobody on a personal app
 * asked for, and the only thing it ever showed was a promo. Here the *focused* title is chosen by you
 * (arrows, Tab, or a tap), the backdrop is that title's own art, and the primary button is the place
 * you stopped in it when there is one. No timer, no autoplay, nothing to pause.
 */
export default function RailFocus({ slides = [], eyebrow = 'Focused', onAir = null }) {
  const [index, setIndex] = useState(0);
  const stripRef = useRef(null);
  const tileRefs = useRef([]);
  const count = slides.length;

  // A shorter list can arrive on the next catalog page — clamp instead of reading a hole.
  const safe = count ? Math.min(index, count - 1) : 0;
  const slide = count ? slides[safe] : null;

  const move = useCallback((delta) => {
    setIndex((current) => {
      if (!count) return 0;
      const capped = Math.min(current, count - 1);
      return (capped + delta + count) % count;
    });
  }, [count]);

  useEffect(() => {
    const node = tileRefs.current[safe];
    node?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [safe]);

  const onStripKey = (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    }
    else if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setIndex(Math.max(0, count - 1)); }
  };

  if (!slide) return null;

  const art = slide.backdropUrl || slide.posterUrl;

  return (
    <section aria-label="Featured title" className="jv-focus relative overflow-hidden border-b border-white/10">
      {art ? (
        <img
          key={art}
          src={art}
          alt=""
          aria-hidden="true"
          className="jv-focus-art"
          loading="eager"
          decoding="async"
        />
      ) : null}
      <div className="jv-focus-shade" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-6 px-4 pb-5 pt-8 sm:px-6 sm:pt-12 lg:min-h-[46svh] lg:justify-end lg:px-8 lg:pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="jv-focus-eyebrow">{eyebrow}</p>
          {onAir ? (
            <Link href="/live" className="jv-focus-onair" title="Open Live TV">
              <span className="jv-focus-dot" aria-hidden="true" />
              <span className="min-w-0 truncate">
                <span className="font-black text-white">{onAir.channel}</span>
                {' · '}
                {onAir.title}
                {onAir.minutesLeft ? ` · ${onAir.minutesLeft} min left` : ''}
              </span>
            </Link>
          ) : null}
        </div>
        <h2 className="jv-focus-title">{slide.title}</h2>
        <p className="jv-focus-meta">
          {[slide.year, slide.type === 'series' ? 'Series' : 'Movie', ...(slide.chips || [])].filter(Boolean).join('  ·  ')}
        </p>
        {slide.note ? <p className="jv-focus-note">{slide.note}</p> : null}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {slide.href ? (
            <Link href={slide.href} className="jv-focus-cta">
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {slide.progress > 0 ? `Resume · ${slide.progress}%` : 'Watch now'}
            </Link>
          ) : (
            <span className="jv-focus-cta jv-focus-cta-muted" title="This release has no TMDB match yet">
              Not matched yet — bind it in the grid below
            </span>
          )}
          {slide.href && slide.progress > 0 ? (
            <Link href={slide.libraryHref || '/my-list?tab=history'} className="jv-focus-ghost">
              All unfinished
            </Link>
          ) : null}
          {slide.infoHref ? <Link href={slide.infoHref} className="jv-focus-ghost">Details</Link> : null}
        </div>

        <div
          ref={stripRef}
          role="listbox"
          aria-label="Featured titles"
          aria-activedescendant={slide.id ? `jv-focus-tile-${slide.id}` : undefined}
          tabIndex={0}
          onKeyDown={onStripKey}
          className="jv-focus-strip"
        >
          {slides.map((entry, position) => {
            const focused = position === safe;
            return (
              <button
                key={entry.id || `${entry.title}-${position}`}
                id={entry.id ? `jv-focus-tile-${entry.id}` : undefined}
                ref={(node) => { tileRefs.current[position] = node; }}
                type="button"
                role="option"
                aria-selected={focused}
                tabIndex={focused ? 0 : -1}
                onClick={() => setIndex(position)}
                onFocus={() => setIndex(position)}
                title={entry.title}
                className={`jv-focus-tile${focused ? ' jv-focus-tile-on' : ''}`}
              >
                {entry.posterUrl ? (
                  <img src={entry.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black p-2 text-center text-[9px] font-black text-zinc-200">
                    {entry.title}
                  </span>
                )}
                {entry.progress > 0 ? (
                  <span className="jv-focus-tile-progress" style={{ width: `${Math.min(100, entry.progress)}%` }} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
