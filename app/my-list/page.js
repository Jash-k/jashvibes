'use client';

import Link from 'next/link';
import Icon from '@/components/Icons';
import { useEffect, useState } from 'react';
import { LibraryCard } from '@/components/LibraryCard';
import { clearFavorites, getFavorites, removeFavoriteItem, useLibraryVersion } from '@/lib/watchStore';
import { revealStyle, useReveal } from '@/lib/useReveal';

/**
 * /my-list — My List only.
 *
 * This page used to be tabbed: "My List" and "Continue" (watch history with
 * resume). Watch history was removed by request, so the page is one list again
 * — no tabs, no resume banner, and no `?tab=` state to restore. Old
 * `/my-list?tab=history` links still land here and simply show My List.
 *
 * Design system v2: the last hand-mixed greys are gone.
 *   • `text-zinc-600` (4.1:1 on ink) → `--txt-4` (5.6:1) for the footer line
 *   • surfaces are `--ink-*`, so day mode now flips by token instead of relying
 *     on the legacy blanket override that keyed off Tailwind class names
 *   • the loading state is a skeleton grid that matches the real card box, so the
 *     page does not reflow when the posters land
 */
export default function MyListPage() {
  const [mounted, setMounted] = useState(false);
  useLibraryVersion();

  useEffect(() => setMounted(true), []);

  const favorites = mounted ? getFavorites() : [];
  // Keyed on the length: removing a title shrinks the list and the surviving nodes
  // may be re-rendered. Anything already revealed keeps its state.
  const revealRef = useReveal(`${mounted}|${favorites.length}`);

  const handleClearAll = () => {
    if (typeof window !== 'undefined' && !window.confirm('Remove every title from My List?')) return;
    clearFavorites();
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-ink-0 text-txt-1">
      <header className="hidden border-b border-line-1 bg-ink-1 sm:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="jv-btn jv-btn-ghost jv-btn-sm">
            <span aria-hidden="true">←</span>
            <span className="hidden sm:inline">Back to JaSH ViBeS</span>
            <span className="sm:hidden">Back</span>
          </Link>
          <h1 className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight text-txt-1">
            <Icon name="heart" className="h-5 w-5 text-brand-text" />
            My List
          </h1>
          {favorites.length ? (
            <button type="button" onClick={handleClearAll} className="jv-btn jv-btn-danger jv-btn-sm">
              Clear all
            </button>
          ) : (
            <span className="w-16" aria-hidden="true" />
          )}
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 sm:pt-10 lg:px-8 lg:pb-10">
        {/* Phone header: the desktop bar above is hidden, and without this the
            page had no title and no way back under 640px. */}
        <div className="mb-6 flex items-center justify-between gap-3 sm:hidden">
          <Link href="/" className="jv-btn jv-btn-ghost jv-btn-sm">
            <span aria-hidden="true">←</span> Back
          </Link>
          <h1 className="inline-flex items-center gap-2 text-base font-extrabold tracking-tight text-txt-1">
            <Icon name="heart" className="h-4 w-4 text-brand-text" />
            My List
          </h1>
          {favorites.length ? (
            <button type="button" onClick={handleClearAll} className="jv-chip jv-chip-brand">Clear</button>
          ) : (
            <span className="w-14" aria-hidden="true" />
          )}
        </div>

        {!mounted ? (
          <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-busy="true" aria-label="Loading your list">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index}>
                <div className="jv-skel aspect-[2/3] w-full" />
                <div className="jv-skel mt-2 h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="jv-empty">
            <span className="jv-chip jv-chip-gold">Empty list</span>
            <p className="jv-empty-title">Nothing saved yet</p>
            <p className="jv-empty-hint">
              Open any movie or series and tap <span className="font-bold text-txt-2">☆ My List</span> on the watch page, or the
              heart on any poster. Your list is saved on this device — no account needed.
            </p>
            <Link href="/" className="jv-btn jv-btn-brand mt-1">Browse titles →</Link>
          </div>
        ) : (
          <div ref={revealRef} className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {favorites.map((item, index) => (
              <div
                key={item.key}
                data-reveal
                style={revealStyle(index, 8)}
                className="[&>div]:w-full [&>div]:sm:w-full"
              >
                <LibraryCard item={item} onRemove={removeFavoriteItem} />
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-xs leading-5 text-txt-4">
          Your list is stored locally on this device (no account needed).
        </p>
      </section>
    </main>
  );
}
