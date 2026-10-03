'use client';

import Link from 'next/link';
import { POSTER_ROW_SIZES_ATTR, tmdbImageSrcSet } from '@/lib/tmdbPoster';

/**
 * LibraryCard — one saved title, as it appears in My List.
 *
 * Was `components/LibraryRows.js`, which also exported a `LibraryRows` home-page
 * row. That row was dead: nothing rendered it (the home page's library surface
 * is RailFocus), so it is gone and the file is now named for the component that
 * is actually used.
 */

export function LibraryCard({ item, onRemove }) {
  return (
    <div className="group relative w-32 shrink-0 snap-start sm:w-40">
      <Link
        href={item.href || '/'}
        className="block overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-lg shadow-black/25 transition duration-300 hover:-translate-y-1 hover:border-red-500/60 sm:rounded-3xl"
      >
        <div className="relative aspect-[2/3] overflow-hidden bg-zinc-900">
          {item.posterUrl ? (
            <img
              src={item.posterUrl}
              srcSet={tmdbImageSrcSet(item.posterUrl, ['w185', 'w342']) || undefined}
              sizes={tmdbImageSrcSet(item.posterUrl, ['w185', 'w342']) ? POSTER_ROW_SIZES_ATTR : undefined}
              alt={`${item.title} poster`}
              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-950 to-black p-3 text-center">
              <span className="text-xs font-black text-zinc-200">{item.title}</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/15 to-transparent opacity-95" />
          <span className="absolute left-2 top-2 rounded-full bg-black/75 px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white backdrop-blur">
            {item.type === 'series' ? 'Series' : 'Movie'}
          </span>
        </div>
        <div className="p-2.5 sm:p-3">
          <p className="line-clamp-2 text-xs font-black leading-4 text-white">{item.title}</p>
          {item.year ? <p className="mt-1 text-[10px] font-bold text-zinc-500">{item.year}</p> : null}
        </div>
      </Link>
      {onRemove ? (
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove(item.key);
          }}
          title="Remove"
          aria-label={`Remove ${item.title}`}
          className="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/10 bg-black/70 text-[10px] font-black text-zinc-300 opacity-0 backdrop-blur transition hover:border-red-500 hover:text-white focus:opacity-100 group-hover:opacity-100"
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}

export default LibraryCard;
