'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  getFavorites,
  getHistory,
  getProgressPercent,
  removeHistoryEntry,
  useLibraryVersion,
} from '@/lib/watchStore';

function itemBadge(item) {
  if (item.type === 'series') {
    return item.episode ? `S${item.season || 1} • E${item.episode}` : 'Series';
  }
  return 'Movie';
}

/**
 * Poster card used by the home-page library rows and the /my-list page.
 * Renders an optional progress bar (Continue Watching) and remove button.
 */
export function LibraryCard({ item, showProgress = false, onRemove }) {
  const percent = showProgress ? getProgressPercent(item) : 0;

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
            {itemBadge(item)}
          </span>
          {showProgress && percent > 0 ? (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div className="h-full bg-red-500" style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </div>
        <div className="p-2.5 sm:p-3">
          <p className="line-clamp-2 text-xs font-black leading-4 text-white">{item.title}</p>
          {showProgress && percent > 0 ? (
            <p className="mt-1 text-[10px] font-bold text-red-400">{percent}% watched</p>
          ) : null}
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

function RowHeader({ icon, title, count, viewAllHref }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-2xl border border-white/10 bg-white/[0.04] text-base">
          {icon}
        </span>
        <div>
          <h2 className="text-xl font-black text-white sm:text-2xl">{title}</h2>
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-500">
            {count} {count === 1 ? 'title' : 'titles'}
          </p>
        </div>
      </div>
      {viewAllHref ? (
        <Link
          href={viewAllHref}
          className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-bold text-zinc-300 transition hover:border-red-500/60 hover:text-white"
        >
          View all →
        </Link>
      ) : null}
    </div>
  );
}

/**
 * "Continue Watching" + "My List" rows for the home page.
 * Renders nothing until mounted (data lives in localStorage) and nothing at
 * all when the library is empty.
 */
export default function LibraryRows({ historyLimit = 12, favoritesLimit = 12 }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useLibraryVersion();

  if (!mounted) return null;

  const history = getHistory()
    .filter((item) => item.type === 'series' || getProgressPercent(item) < 97)
    .slice(0, historyLimit);
  const favorites = getFavorites().slice(0, favoritesLimit);

  if (!history.length && !favorites.length) return null;

  return (
    <section className="mx-auto max-w-7xl space-y-8 px-4 pt-6 sm:px-6 sm:pt-10 lg:px-8">
      {history.length ? (
        <div>
          <RowHeader
            icon="▶"
            title="Continue Watching"
            count={history.length}
            viewAllHref="/my-list?tab=history"
          />
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {history.map((item) => (
              <LibraryCard key={item.key} item={item} showProgress onRemove={removeHistoryEntry} />
            ))}
          </div>
        </div>
      ) : null}

      {favorites.length ? (
        <div>
          <RowHeader
            icon="❤"
            title="My List"
            count={favorites.length}
            viewAllHref="/my-list"
          />
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {favorites.map((item) => (
              <LibraryCard key={item.key} item={item} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
