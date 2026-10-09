'use client';

import Link from 'next/link';
import { HERO_SRCSET_SIZES, tmdbImageSrcSet } from '@/lib/tmdbPoster';
import { useParallax } from '@/lib/useParallax';

/**
 * RailFocus — the banner half of Rail OS: one title, its own artwork, and the way back into it.
 *
 * The poster strip that used to sit under the copy is gone by request, and it was the right call: the
 * two catalogue rows below already *are* the browser, so a thumbnail rail inside the hero was a control
 * nested inside a control, and its ring competed with the row cards. What is left is deliberately still
 * — no timer, no autoplay, nothing to pause — and it shows the freshest scraped title.
 *
 * It also no longer carries resume state ("Resume · 42%", "Cancel resume", "All unfinished"): watch
 * history was removed, so a percentage here would be a permanent 0 and the two ghost buttons would
 * point at a list that does not exist.
 *
 * Type note (design system v2): the hero is the one place the display serif is allowed — a Playfair
 * title over a dark scrim is the whole "Tamil Marquee" idea, and it costs nothing because the font is
 * already self-hosted for the wordmark. Section headings elsewhere stay in the UI font with a gold
 * hairline rule, so the warmth reads as branding rather than decoration.
 *
 * The banner is painted dark in *both* themes, which is a layout decision rather than a colour one:
 * day mode's blankets (`app/globals.css`) repaint anything carrying a Tailwind `bg-*`/`text-*` class, so
 * a light panel with a dark title over a dark poster is exactly the "hero is not visible and the title
 * looks blurred" report. Artwork keeps its own light.
 */
export default function RailFocus({ slide = null, eyebrow = 'Now on your shelf', onWatchOpen = null }) {
  // Called before the `!slide` guard on purpose: hooks must run in the same order
  // on every render, and this component returns early when there is no slide.
  const artRef = useParallax({ strength: 0.07, max: 22 });

  if (!slide) return null;

  const art = slide.backdropUrl || slide.posterUrl;
  const meta = [slide.year, slide.type === 'series' ? 'Series' : 'Movie', ...(slide.chips || [])].filter(Boolean).join('  ·  ');

  const handleWatch = (event) => {
    if (!onWatchOpen || !slide.href) return;
    event.preventDefault();
    onWatchOpen(slide);
  };

  return (
    <section aria-label="Featured title" className="jv-focus relative overflow-hidden border-b border-white/10">
      {art ? (
        <img
          src={art}
          srcSet={tmdbImageSrcSet(art, HERO_SRCSET_SIZES) || undefined}
          sizes={tmdbImageSrcSet(art, HERO_SRCSET_SIZES) ? '100vw' : undefined}
          alt=""
          aria-hidden="true"
          ref={artRef}
          className="jv-focus-art"
          loading="eager"
          fetchPriority="high"
          decoding="async"
        />
      ) : null}
      <div className="jv-focus-shade" aria-hidden="true" />

      <div className="relative mx-auto flex w-full max-w-[1500px] flex-col gap-3.5 px-4 pb-8 pt-9 sm:px-6 lg:min-h-[44svh] lg:justify-end lg:px-8 lg:pb-10 lg:pt-16">
        {eyebrow ? <p className="jv-focus-eyebrow">{eyebrow}</p> : null}

        <div>
          <h2 className="jv-focus-title">{slide.title}</h2>
          {meta ? <p className="jv-focus-meta">{meta}</p> : null}
        </div>
        {slide.note ? <p className="jv-focus-note">{slide.note}</p> : null}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {slide.href ? (
            <Link href={slide.href} className="jv-focus-cta" onClick={handleWatch}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch now
            </Link>
          ) : (
            <span className="jv-focus-cta jv-focus-cta-muted" title="This release has no TMDB match yet">
              Not matched yet — bind it in the rows below
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
