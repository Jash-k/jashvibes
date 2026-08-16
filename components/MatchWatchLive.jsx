'use client';

/**
 * MatchWatchLive — embeds a live TV stream next to a match scorecard.
 *
 * Picks the best cricket channel from the Live TV catalog (see
 * pickCricketChannel) and plays it inline via LiveChannelPlayer, so the
 * match-center page = stream + scorecard, like 1anchormovies /sports cards.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LiveChannelPlayer from '@/components/LiveChannelPlayer';
import { pickCricketChannel } from '@/lib/livePlaybackClient';

const CHANNELS_CACHE_KEY = 'jash:watch-live:channels:v1';
const CHANNELS_CACHE_TTL = 5 * 60 * 1000;

function readCachedChannels() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CHANNELS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > CHANNELS_CACHE_TTL) return null;
    return Array.isArray(parsed.channels) ? parsed.channels : null;
  } catch {
    return null;
  }
}

function writeCachedChannels(channels) {
  try {
    window.sessionStorage.setItem(CHANNELS_CACHE_KEY, JSON.stringify({ t: Date.now(), channels }));
  } catch {}
}

export default function MatchWatchLive({ isLive = true }) {
  const [channel, setChannel] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadChannels() {
      const cached = readCachedChannels();
      if (cached) {
        if (!cancelled) {
          setChannel(pickCricketChannel(cached));
          setLoading(false);
        }
        return;
      }
      try {
        const response = await fetch('/api/live-tv?playable=1', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        const channels = Array.isArray(data?.channels) ? data.channels : [];
        writeCachedChannels(channels);
        if (!cancelled) setChannel(pickCricketChannel(channels));
      } catch {
        if (!cancelled) setChannel(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadChannels();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white/80">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
          Loading Live TV stream…
        </div>
        <div className="mt-3 aspect-video w-full animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-white/80">
            📺 Watch Live
          </div>
          <Link href="/live" className="rounded-lg border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-500/20">
            Open Live TV →
          </Link>
        </div>
        <p className="mt-3 text-xs text-white/50">
          No cricket channel is available right now. Open Live TV for the full channel list.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-rose-500/25 bg-zinc-950/70 shadow-lg shadow-rose-950/20">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {isLive && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />}
          <span className="truncate text-sm font-black text-white">
            📺 Watch Live{isLive ? '' : ' TV'} · <span className="text-rose-200">{channel.name}</span>
          </span>
        </div>
        <Link href={`/live#${(channel.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-bold text-white/70 hover:bg-white/10">
          Full Live TV
        </Link>
      </div>
      <LiveChannelPlayer channel={channel} className="rounded-none" />
    </div>
  );
}
