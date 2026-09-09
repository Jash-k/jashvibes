'use client';

import Link from 'next/link';

/**
 * RailFocus — the banner half of Rail OS: one title, its own artwork, and the way back into it.
 *
 * The poster strip that used to sit under the copy is gone by request, and it was the right call: the
 * two catalogue rows below already *are* the browser, so a thumbnail rail inside the hero was a control
 * nested inside a control, and its ring competed with the row cards. What is left is deliberately still
 * — no timer, no autoplay, nothing to pause — and it shows the thing you are most likely to press:
 * the last half-watched title, or the freshest one when there isn't one.
 *
 * The banner is painted dark in *both* themes, which is a layout decision rather than a colour one:
 * day mode's blankets (`app/globals.css`) repaint anything carrying a Tailwind `bg-*`/`text-*` class, so
 * a light panel with a dark title over a dark poster is exactly the "hero is not visible and the title
 * looks blurred" report. Artwork keeps its own light.
 */
export default function RailFocus({ slide = null, eyebrow = 'Now on your shelf', onAir = null }) {
  if (!slide) return null;

  const art = slide.backdropUrl || slide.posterUrl;
  const meta = [slide.year, slide.type === 'series' ? 'Series' : 'Movie', ...(slide.chips || [])].filter(Boolean).join('  ·  ');

  return (
    <section aria-label="Featured title" className="jv-focus relative overflow-hidden border-b border-white/10">
      {art ? (
        <img
          src={art}
          alt=""
          aria-hidden="true"
          className="jv-focus-art"
          loading="eager"
          decoding="async"
        />
      ) : null}
      <div className="jv-focus-shade" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-3.5 px-4 pb-8 pt-9 sm:px-6 lg:min-h-[44svh] lg:justify-end lg:px-8 lg:pb-10 lg:pt-16">
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
        {meta ? <p className="jv-focus-meta">{meta}</p> : null}
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
              Not matched yet — bind it in the rows below
            </span>
          )}
          {slide.href && slide.progress > 0 ? (
            <Link href={slide.libraryHref || '/my-list?tab=history'} className="jv-focus-ghost">
              All unfinished
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
