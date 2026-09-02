'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icons';

export default function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onClose ? onClose(!open) : null;
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        onClose ? onClose(true) : null;
      }
      if (e.key === 'Escape' && open) {
        onClose(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setStatus('idle');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setStatus('loading');
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Search failed');
        setResults(data.results || []);
        setStatus('ready');
        setSelectedIndex(0);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setResults([]);
        setStatus('error');
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const handleKeyDownList = (e) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const selected = results[selectedIndex];
      if (selected) {
        onClose(false);
        router.push(`/watch/${selected.type}/${selected.tmdbId}`);
      }
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center bg-black/80 p-3 pt-12 backdrop-blur-md sm:p-6 sm:pt-20"
      onClick={() => onClose(false)}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/15 bg-zinc-950/95 shadow-[0_25px_70px_rgba(0,0,0,0.85)] backdrop-blur-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6">
          <span className="text-lg text-zinc-400">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDownList}
            placeholder="Search Movies, Series, Live TV, Music... (↑↓ to navigate, ↵ to open)"
            className="w-full bg-transparent text-sm font-semibold text-white placeholder-zinc-500 outline-none sm:text-base"
          />
          <kbd className="hidden rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[10px] font-bold text-zinc-400 sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[min(65vh,28rem)] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="p-4 sm:p-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">Quick Navigation</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Link
                  href="/live"
                  onClick={() => onClose(false)}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-red-500/50 hover:bg-red-500/10"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-red-500/20 text-red-400">📺</span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white">Live TV</p>
                    <p className="truncate text-[10px] text-zinc-500">80+ Channels</p>
                  </div>
                </Link>
                <Link
                  href="/music"
                  onClick={() => onClose(false)}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-emerald-500/50 hover:bg-emerald-500/10"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/20 text-emerald-400">🎵</span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white">Music</p>
                    <p className="truncate text-[10px] text-zinc-500">Tamil Hits</p>
                  </div>
                </Link>
                <Link
                  href="/sports"
                  onClick={() => onClose(false)}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-amber-500/50 hover:bg-amber-500/10"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/20 text-amber-400">🏏</span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white">Sports</p>
                    <p className="truncate text-[10px] text-zinc-500">Live Cricket</p>
                  </div>
                </Link>
                <Link
                  href="/classics"
                  onClick={() => onClose(false)}
                  className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-amber-500/50 hover:bg-amber-500/10"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-xl bg-amber-500/20 text-amber-300">🎞️</span>
                  <div className="min-w-0">
                    <p className="text-xs font-black text-white">ReTro</p>
                    <p className="truncate text-[10px] text-zinc-500">Retro Cinema</p>
                  </div>
                </Link>
              </div>
            </div>
          ) : status === 'loading' ? (
            <div className="flex items-center justify-center gap-3 p-8 text-sm text-zinc-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-red-500" />
              Searching TMDB titles...
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              No results found for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            <div className="space-y-1">
              {results.map((item, index) => {
                const active = index === selectedIndex;
                return (
                  <Link
                    key={`${item.type}-${item.tmdbId}`}
                    href={`/watch/${item.type}/${item.tmdbId}`}
                    onClick={() => onClose(false)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`flex items-center gap-3.5 rounded-2xl p-2.5 transition ${
                      active
                        ? 'bg-gradient-to-r from-red-600/20 via-purple-600/20 to-transparent border border-red-500/40 text-white'
                        : 'text-zinc-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="h-16 w-11 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                      {item.posterUrl ? (
                        <img src={item.posterUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-xs text-zinc-600">🎬</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-black text-white">{item.title}</p>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                          item.type === 'series' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-red-500/20 text-red-300 border border-red-500/30'
                        }`}>
                          {item.type === 'series' ? 'Series' : 'Movie'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {item.releaseDate ? String(item.releaseDate).slice(0, 4) : ''}
                        {item.rating ? ` • ★ ${Number(item.rating).toFixed(1)}` : ''}
                      </p>
                      {item.synopsis ? (
                        <p className="mt-1 line-clamp-1 text-xs text-zinc-500">{item.synopsis}</p>
                      ) : null}
                    </div>
                    <span className="mr-2 text-xs text-zinc-500">→</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2.5 text-[11px] text-zinc-500">
          <div className="flex items-center gap-2">
            <span>Navigation:</span>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">↓</kbd>
            <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd>
          </div>
          <span>JaSH ViBeS Universal Search</span>
        </div>
      </div>
    </div>
  );
}
