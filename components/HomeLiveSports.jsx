'use client';

/**
 * HomeLiveSports — sports-first block at the top of the home page
 * (1anchormovies.buzz/sports style):
 *
 *   🔴 Live Now — Cricket        → cards open match-center (stream + scorecard)
 *   🟠 Other Sports — Live       → FanCode mixed-sport live streams
 *   📺 Live Sports TV            → our Live TV sports-catalog channels
 *   🗓 Upcoming Cricket          → next fixtures (compact)
 *
 * Data: /api/bcci/{live,upcoming,recent}, /api/wt20/schedule,
 * /api/ipl/2026/all-matches, the FanCode public feed, and /api/live-tv.
 * Paints from session cache instantly and refreshes every 60s.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  FANCODE_FEED,
  isCricketFeedItem,
  isSeniorMenBcci,
  normalizeBcciMatch,
  normalizeFancodeEvent,
  normalizeIplMatch,
  normalizeWt20Match,
  pickArray,
} from '@/lib/sportsFeed';
import { channelSlug } from '@/lib/livePlaybackClient';
import { getChannelCatalogIds } from '@/lib/liveCatalogs';

const CACHE_KEY = 'jash:home:sports:v1';
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

function MatchStripCard({ match }) {
  const inner = (
    <div className={`group flex h-full w-56 shrink-0 flex-col rounded-xl border p-3 text-left transition ${
      match.status === 'live'
        ? 'border-rose-500/30 bg-gradient-to-b from-rose-950/40 to-zinc-950 hover:border-rose-400/60'
        : match.status === 'completed'
          ? 'border-white/10 bg-zinc-950/70 hover:border-white/25'
          : 'border-sky-500/20 bg-gradient-to-b from-sky-950/30 to-zinc-950 hover:border-sky-400/50'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
          match.status === 'live' ? 'bg-rose-500/15 text-rose-300' : match.status === 'completed' ? 'bg-white/10 text-white/50' : 'bg-sky-500/15 text-sky-300'
        }`}>
          {match.status === 'live' ? <LiveDot /> : null}
          {match.status === 'live' ? 'Live' : match.status === 'completed' ? 'Result' : 'Upcoming'}
        </span>
        <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/50">
          {match.provider}
        </span>
      </div>
      <p className="mt-2 truncate text-[13px] font-black text-white">{match.title}</p>
      <div className="mt-1 space-y-0.5">
        {match.score1 ? <p className="truncate text-[11px] font-semibold text-white/80">{match.score1}</p> : null}
        {match.score2 ? <p className="truncate text-[11px] font-semibold text-white/80">{match.score2}</p> : null}
      </div>
      {match.result ? <p className="mt-1 truncate text-[10px] font-semibold text-emerald-300/90">{match.result}</p> : null}
      <p className="mt-auto truncate pt-2 text-[9px] text-white/40">{match.competition || match.subtitle}</p>
    </div>
  );

  if (match.external) {
    return (
      <a href={match.href} target="_blank" rel="noreferrer" className="shrink-0 focus:outline-none">
        {inner}
      </a>
    );
  }
  return (
    <Link href={match.href || '/sports'} prefetch={false} className="shrink-0 focus:outline-none">
      {inner}
    </Link>
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
    const next = { cricketLive: [], cricketUpcoming: [], otherLive: [], tvChannels: [] };
    try {
      const [bcciLive, bcciUpcoming, wt20, ipl, fancode, liveTv] = await Promise.all([
        fetch('/api/bcci/live', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/bcci/upcoming', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        // game_count large enough to retain today's live matches (backend
        // windows small counts by series).
        fetch('/api/wt20/schedule?game_count=50', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/ipl/2026/all-matches', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/live-tv?playable=1', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      ]);

      const bcciMatches = pickArray(bcciLive, ['liveMatches'])
        .filter(isSeniorMenBcci)
        .map((row) => normalizeBcciMatch(row, 'live'))
        .filter((m) => m.status === 'live');
      const wt20Matches = pickArray(wt20?.data || wt20, ['matches']).map(normalizeWt20Match);
      const iplMatches = pickArray(ipl, ['matches', 'Matchsummary', 'MatchSummary']).map(normalizeIplMatch);

      const seen = new Set();
      const dedupe = (m) => {
        const key = `${m.type}-${m.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      };
      next.cricketLive = [
        ...bcciMatches,
        ...wt20Matches.filter((m) => m.status === 'live').map((m) => ({ ...m, provider: 'ICC' })),
        ...iplMatches.filter((m) => m.status === 'live'),
      ].filter(dedupe);

      next.cricketUpcoming = [
        ...pickArray(bcciUpcoming, ['upcomingMatches'])
          .filter(isSeniorMenBcci)
          .map((row) => normalizeBcciMatch(row, 'upcoming')),
        ...wt20Matches.filter((m) => m.status === 'upcoming'),
        ...iplMatches.filter((m) => m.status === 'upcoming'),
      ]
        .filter((m) => m.status !== 'live')
        .filter(dedupe)
        .slice(0, 8);

      const fancodeEvents = (Array.isArray(fancode?.matches) ? fancode.matches : [])
        .filter((m) => String(m.status || '').toUpperCase() === 'LIVE')
        .slice(0, 16)
        .map(normalizeFancodeEvent)
        .filter((m) => m.href);
      next.otherLive = fancodeEvents.filter((m) => !isCricketFeedItem(m));
      next.cricketLive = [
        ...next.cricketLive,
        ...fancodeEvents.filter((m) => isCricketFeedItem(m)),
      ];

      const channels = Array.isArray(liveTv?.channels) ? liveTv.channels : [];
      next.tvChannels = channels.filter((c) => c && c.url !== undefined && isSportsChannel(c)).slice(0, 14);
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

  const { cricketLive = [], cricketUpcoming = [], otherLive = [], tvChannels = [] } = data || {};
  const hasAnything = cricketLive.length || cricketUpcoming.length || otherLive.length || tvChannels.length;

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

  const viewAllLink = (
    <Link href="/sports" className="shrink-0 text-[10px] font-black uppercase tracking-[0.18em] text-amber-400/90 hover:text-amber-300">
      /sports →
    </Link>
  );

  return (
    <section className="mx-auto max-w-7xl space-y-4 px-4 pt-5 sm:px-6 sm:pt-7 lg:px-8">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/35">Cricket · Football · Live TV</p>
          <h2 className="mt-0.5 text-lg font-black uppercase tracking-tight text-white sm:text-xl">
            Live <span className="text-rose-400">Sports</span>
          </h2>
        </div>
        <Link href="/live" className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white/70 hover:bg-white/10">
          All Live TV
        </Link>
      </div>

      {cricketLive.length ? (
        <SectionShell icon="🏏" title="Cricket — Live Now" count={cricketLive.length} accent="#fb7185" right={viewAllLink}>
          {cricketLive.map((m) => <MatchStripCard key={`c-${m.type}-${m.id}`} match={m} />)}
        </SectionShell>
      ) : null}

      {otherLive.length ? (
        <SectionShell icon="🌍" title="Other Sports — Live" count={otherLive.length} accent="#fbbf24">
          {otherLive.map((m) => <MatchStripCard key={`o-${m.type}-${m.id}`} match={m} />)}
        </SectionShell>
      ) : null}

      {tvChannels.length ? (
        <SectionShell icon="📺" title="Live Sports TV" count={tvChannels.length} accent="#34d399">
          {tvChannels.map((channel) => <TvChannelCard key={channel.id || channel.name} channel={channel} />)}
        </SectionShell>
      ) : null}

      {cricketUpcoming.length ? (
        <SectionShell icon="🗓" title="Upcoming Cricket" count={cricketUpcoming.length} accent="#38bdf8">
          {cricketUpcoming.map((m) => <MatchStripCard key={`u-${m.type}-${m.id}`} match={m} />)}
        </SectionShell>
      ) : null}
    </section>
  );
}
