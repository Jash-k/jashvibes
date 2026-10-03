'use client';

import Link from 'next/link';
import Icon from '@/components/Icons';
import { useEffect, useState } from 'react';
import { LibraryCard } from '@/components/LibraryCard';
import { clearFavorites, getFavorites, removeFavoriteItem, useLibraryVersion } from '@/lib/watchStore';

/**
 * /my-list — My List only.
 *
 * This page used to be tabbed: "My List" and "Continue" (watch history with
 * resume). Watch history was removed by request, so the page is one list again
 * — no tabs, no resume banner, and no `?tab=` state to restore. Old
 * `/my-list?tab=history` links still land here and simply show My List.
 */
export default function MyListPage() {
  const [mounted, setMounted] = useState(false);
  useLibraryVersion();

  useEffect(() => setMounted(true), []);

  const favorites = mounted ? getFavorites() : [];

  const handleClearAll = () => {
    if (typeof window !== 'undefined' && !window.confirm('Remove every title from My List?')) return;
    clearFavorites();
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050505] text-zinc-100">
      <header className="hidden sm:block sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
          <Link
            href="/"
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">← Back</span>
            <span className="hidden sm:inline">← Back to JaSH ViBeS</span>
          </Link>
          <h1 className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight text-white sm:text-xl">
            <Icon name="heart" className="h-5 w-5 text-rose-400" />
            My List
          </h1>
          {favorites.length ? (
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-100 transition hover:border-red-400 hover:bg-red-500/20"
            >
              Clear all
            </button>
          ) : (
            <span className="w-16" />
          )}
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pt-6 pb-28 sm:px-6 sm:pt-10 lg:px-8 lg:pb-10">
        <div className="mb-6 flex items-center justify-between gap-3 sm:hidden">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white">← Back</Link>
          <h1 className="inline-flex items-center gap-2 text-base font-extrabold tracking-tight text-white">
            <Icon name="heart" className="h-4 w-4 text-rose-400" />
            My List
          </h1>
          {favorites.length ? (
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded-full border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-100 transition hover:border-red-400 hover:bg-red-500/20"
            >
              Clear
            </button>
          ) : (
            <span className="w-14" />
          )}
        </div>

        {!mounted ? (
          <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="aspect-[2/3] animate-pulse rounded-2xl border border-white/5 bg-white/[0.04] sm:rounded-3xl" />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="text-4xl" aria-hidden="true">❤</div>
            <h2 className="mt-4 text-xl font-black text-white">Your list is empty</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">
              Open any movie or series and tap <span className="font-bold text-zinc-200">☆ My List</span> on the watch page, or the heart on any poster. Your list is saved on this device.
            </p>
            <Link
              href="/"
              className="mt-6 inline-block rounded-full border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-black text-red-100 transition hover:border-red-400 hover:bg-red-500/20"
            >
              Browse titles →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {favorites.map((item) => (
              <div key={item.key} className="[&>div]:w-full [&>div]:sm:w-full">
                <LibraryCard item={item} onRemove={removeFavoriteItem} />
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-xs leading-5 text-zinc-600">
          Your list is stored locally on this device (no account needed).
        </p>
      </section>
    </main>
  );
}
