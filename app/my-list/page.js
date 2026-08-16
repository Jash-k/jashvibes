'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LibraryCard } from '@/components/LibraryRows';
import {
  clearFavorites,
  clearHistory,
  getFavorites,
  getHistory,
  getProgressPercent,
  removeFavoriteItem,
  removeHistoryEntry,
  useLibraryVersion,
} from '@/lib/watchStore';

function TabButton({ active, children, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition active:scale-[0.99] sm:px-5 ${
        active
          ? 'border-red-500/60 bg-red-600 text-white shadow-lg shadow-red-950/30'
          : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-red-500/40 hover:text-white'
      }`}
    >
      <span className="block text-[10px] font-black uppercase tracking-[0.22em] opacity-75 sm:text-xs sm:tracking-[0.25em]">{children}</span>
      <span className="mt-1 block text-xl font-black sm:text-2xl">{count}</span>
    </button>
  );
}

function EmptyState({ icon, title, hint }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
      <div className="text-4xl">{icon}</div>
      <h2 className="mt-4 text-xl font-black text-white">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-400">{hint}</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full border border-red-500/40 bg-red-500/10 px-5 py-2.5 text-sm font-black text-red-100 transition hover:border-red-400 hover:bg-red-500/20"
      >
        Browse titles →
      </Link>
    </div>
  );
}

export default function MyListPage() {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState('favorites');
  useLibraryVersion();

  useEffect(() => {
    setMounted(true);
    try {
      if (new URLSearchParams(window.location.search).get('tab') === 'history') {
        setTab('history');
      }
    } catch {}
  }, []);

  const favorites = mounted ? getFavorites() : [];
  const history = mounted ? getHistory() : [];
  const isFavoritesTab = tab === 'favorites';
  const items = isFavoritesTab ? favorites : history;

  const handleClearAll = () => {
    const label = isFavoritesTab ? 'My List' : 'Continue Watching history';
    if (typeof window !== 'undefined' && !window.confirm(`Remove every title from ${label}?`)) return;
    if (isFavoritesTab) clearFavorites();
    else clearHistory();
  };

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050505] text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
          <Link
            href="/"
            className="rounded-full border border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200 transition hover:border-red-500 hover:text-white sm:px-4 sm:text-sm"
          >
            <span className="sm:hidden">← Back</span>
            <span className="hidden sm:inline">← Back to JaSH ViBeS</span>
          </Link>
          <h1 className="text-lg font-black tracking-tight text-white sm:text-xl">My❤Library</h1>
          {items.length ? (
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

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        <div className="sticky top-[60px] z-30 -mx-1 mb-6 grid grid-cols-2 gap-2 rounded-3xl border border-white/10 bg-[#050505]/90 p-1.5 backdrop-blur sm:top-[68px] sm:mx-0 sm:w-max sm:min-w-96 sm:gap-3">
          <TabButton active={isFavoritesTab} count={favorites.length} onClick={() => setTab('favorites')}>
            ❤ My List
          </TabButton>
          <TabButton active={!isFavoritesTab} count={history.length} onClick={() => setTab('history')}>
            ▶ Continue
          </TabButton>
        </div>

        {!mounted ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center text-sm text-zinc-500">
            Loading your library...
          </div>
        ) : items.length === 0 ? (
          isFavoritesTab ? (
            <EmptyState
              icon="❤"
              title="Your list is empty"
              hint="Open any movie or series and tap the ♡ My List button on the watch page. Favorites are saved on this device."
            />
          ) : (
            <EmptyState
              icon="▶"
              title="Nothing in progress"
              hint="Titles you play appear here automatically so you can resume where you stopped — including the exact episode and playback position for direct streams."
            />
          )
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {items.map((item) => (
              <div key={item.key} className="[&>div]:w-full [&>div]:sm:w-full">
                <LibraryCard
                  item={item}
                  showProgress={!isFavoritesTab && getProgressPercent(item) > 0}
                  onRemove={isFavoritesTab ? removeFavoriteItem : removeHistoryEntry}
                />
              </div>
            ))}
          </div>
        )}

        <p className="mt-10 text-center text-xs leading-5 text-zinc-600">
          Your library is stored locally on this device (no account needed).
        </p>
      </section>
    </main>
  );
}
