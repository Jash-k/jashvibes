'use client';

/**
 * HomeLiveSports — live sports streams block at the top of the home page.
 *
 *   🌍 Other Sports — Live       → FanCode mixed-sport live streams (external player)
 *   📺 Live Sports TV            → our Live TV sports-catalog channels
 *
 * Live cricket matches (recent/live/upcoming) live on the /sports page as
 * hero cards — the home page links there via the "🏏 Cricket →" button.
 *
 * Data: the FanCode public feed + /api/live-tv. Paints from session cache
 * instantly and refreshes every 60s.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FANCODE_FEED,
  isCricketFeedItem,
  normalizeFancodeEvent,
} from '@/lib/sportsFeed';
import { channelSlug } from '@/lib/livePlaybackClient';
import { getChannelCatalogIds } from '@/lib/liveCatalogs';

const CACHE_KEY = 'jash:home:sports:v2';
const CACHE_TTL = 90 * 1000;

function readCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.t > CACHE_TTL) return null;
    return parsed.data || null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), data }));
  } catch {}
}

function isSportsChannel(channel = {}) {
  if (getChannelCatalogIds(channel).includes('sports')) return true;
  return /sport|cricket|football|ten |fancode|willow|astro cricket|sony ten|star sports/i.test(
    `${channel.name || ''} ${channel.category || ''}`
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
    </span>
  );
}

function StreamCard({ match }) {
  return (
    <a href={match.href} target="_blank" rel="noreferrer" className="shrink-0 focus:outline-none">
      <div className="group flex h-full w-56 shrink-0 flex-col rounded-xl border border-rose-500/30 bg-gradient-to-b from-rose-950/40 to-zinc-950 p-3 text-left transition hover:border-rose-400/60">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-300">
            <LiveDot /> Live
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/50">
            {match.provider}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[13px] font-black leading-4 text-white">{match.title}</p>
        <p className="mt-auto truncate pt-2 text-[9px] text-white/40">{match.competition || match.category}</p>
      </div>
    </a>
  );
}

function TvChannelCard({ channel }) {
  return (
    <Link
      href={`/live#${channelSlug(channel.name || channel.id)}`}
      prefetch={false}
      className="group flex w-40 shrink-0 flex-col gap-1.5 rounded-xl border border-emerald-500/20 bg-gradient-to-b from-emerald-950/30 to-zinc-950 p-3 transition hover:border-emerald-400/50"
    >
      <div className="flex items-center gap-1.5">
        <LiveDot />
        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-emerald-300">TV</span>
      </div>
      <p className="truncate text-[12px] font-black text-white group-hover:text-emerald-100">{channel.name}</p>
      <p className="truncate text-[9px] text-white/40">{channel.category || 'Sports Channel'}</p>
    </Link>
  );
}

function SectionShell({ icon, title, count, accent = '#ef4444', children, right }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{icon}</span>
          <h3 className="text-sm font-black uppercase tracking-wider text-white/90">{title}</h3>
          {typeof count === 'number' ? (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: `${accent}22`, color: accent }}>
              {count}
            </span>
          ) : null}
        </div>
        {right}
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {children}
      </div>
    </div>
  );
}

export default function HomeLiveSports() {
  const [data, setData] = useState(() => readCache() || null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const next = { otherLive: [], tvChannels: [] };
    try {
      const [fancode, liveTv] = await Promise.all([
        fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/live-tv?playable=1', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      ]);

      next.otherLive = (Array.isArray(fancode?.matches) ? fancode.matches : [])
        .filter((m) => String(m.status || '').toUpperCase() === 'LIVE')
        .slice(0, 16)
        .map(normalizeFancodeEvent)
        .filter((m) => m.href && !isCricketFeedItem(m));

      const channels = Array.isArray(liveTv?.channels) ? liveTv.channels : [];
      next.tvChannels = channels.filter((c) => c && c.url && isSportsChannel(c)).slice(0, 14);
    } catch {}

    writeCache(next);
    setData(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  const { otherLive = [], tvChannels = [] } = data || {};
  const hasAnything = otherLive.length || tvChannels.length;

  if (!data && !loaded) {
    return (
      <section className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-4">
          <div className="h-4 w-44 animate-pulse rounded bg-white/10" />
          <div className="flex gap-2.5 overflow-hidden">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 w-56 shrink-0 animate-pulse rounded-xl bg-white/5" />)}
          </div>
        </div>
      </section>
    );
  }

  if (loaded && !hasAnything) return null;

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 pt-5 sm:px-6 sm:pt-7 lg:px-8">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/35">Football · Kabaddi · Live TV</p>
          <h2 className="mt-0.5 text-lg font-black uppercase tracking-tight text-white sm:text-xl">
            Live <span className="text-rose-400">Sports</span>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/sports" className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300 hover:bg-amber-500/20">
            🏏 Cricket →
          </Link>
          <Link href="/live" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10">
            All Live TV
          </Link>
        </div>
      </div>

      {otherLive.length ? (
        <SectionShell icon="🌍" title="Other Sports — Live Now" count={otherLive.length} accent="#fbbf24">
          {otherLive.map((m) => <StreamCard key={`o-${m.type}-${m.id}`} match={m} />)}
        </SectionShell>
      ) : null}

      {tvChannels.length ? (
        <SectionShell icon="📺" title="Live Sports TV" count={tvChannels.length} accent="#34d399">
          {tvChannels.map((channel) => <TvChannelCard key={channel.id || channel.name} channel={channel} />)}
        </SectionShell>
      ) : null}
    </section>
  );
}
