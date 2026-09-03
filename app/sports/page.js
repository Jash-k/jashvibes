'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';
import Icon from '@/components/Icons';
import {
  FANCODE_FEED,
  bestFancodeVariant,
  encodeMatchHash,
  playerUrlFromHls,
} from '@/lib/sportsFeed';

const WILLOW_URL = 'https://m3u8-player-ashen.vercel.app/?sid=mzo8bm6chvg8&src=https%3A%2F%2Famg01269-amg01269c1-sportstribal-emea-5204.playouts.now.amagi.tv%2Fts-eu-w1-n2%2Fplaylist%2Famg01269-willowtvfast-willowplus-sportstribalemea%2Fcb7f3e1a7b7b6f8a9ac33e6cd9f143a5d1073183573a80303aac5e9e7792155d80b9f7c9b84aeb4a19e24094385631004262d519ce647c968d23f6156b3f4f7f8ae1ec3f8cc50274e38b1f5549a3120e50fe6114d54a543b99c80a188938827c0738e11d210361daf35aab664abef86ef603359bf1843a6c6d2d0acc0602fcb02dfbbdbe0010c76da5b802488b2f5be7922198824df9d9cb5e9d449875f7068993a38dd1438486967eaf50e0304409737bc8cd7bcb9c04fb88cc393cc82170401f57e2a1a1d42453eed19c71829de291279a3ac08d2c801258d162b97cf4fb0ef6c873c3c05da9acc1bf08216be6ac5f10ba36f020769a6113c4ac6a10c4df534fb9bc785954c06c970924349bfcdf15be1274fca30e8aae601134c1de10d5cdf2cbc2b18e439231c5d4fcc37d6b4077010ec670a3992df41a9d40e89f431e0d187bfad315e596c95235554a84ab57c05c4eea8cc5d0894e73e1482f77c42c99570c67c9744b79e626f6d37c4f813405883072aa0c6cce12b2e862a5e7e8e4003aa7d78817ac38a1e65ca09968cd420f193ac1957d0f7a1d28efb91c4a5a1fe44aebd4c6e4056c21fce7c1fbba3e1b0f2b185f09cbafa75fa8cef86b7a32c4402d747b001df4528089beb6b4d99faf0b36e6b65dc6267bd08a8272ae04501d%2F66%2F1920x1080_5859480%2Findex.m3u8&title=Willow-cricket-live';

function channelCardBase({ id, name, sub, group, color, logo, url, desc }) {
  return { id, name, sub, group, color, glow: `${color}4d`, border: `${color}40`, bg: `${color}12`, tag: sub || 'LIVE', logo, url, desc };
}

const BASE_CHANNELS = [
  channelCardBase({ id: 'willow', name: 'Willow TV', sub: 'English', group: 'Willow', color: '#f97316', logo: '/willow.svg', url: WILLOW_URL, desc: 'Willow by Cricbuzz live cricket' }),
];

function PulsingDot({ color = '#ef4444' }) { return <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />; }

function ChannelCard({ ch, active, onClick }) {
  return (
    <button type="button" onClick={() => onClick(ch)} className="relative w-full overflow-hidden rounded-2xl border text-left transition-all duration-300 active:scale-[0.98]" style={{ background: active ? ch.bg : 'rgba(255,255,255,0.025)', borderColor: active ? ch.border : 'rgba(255,255,255,0.07)', boxShadow: active ? `0 0 30px ${ch.glow}` : 'none' }}>
      <div className="relative flex items-center gap-3 p-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-white/[0.04]" style={{ borderColor: active ? ch.border : 'rgba(255,255,255,0.08)' }}>{ch.logo ? <img src={ch.logo} alt="" className="max-h-8 max-w-8 object-contain" /> : <span className="text-xl">🏏</span>}</div>
        <div className="min-w-0 flex-1"><div className="mb-1 flex items-center gap-1.5"><span className="rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.2em]" style={{ background: `${ch.color}20`, color: ch.color }}>{ch.tag}</span><PulsingDot color={ch.color} /></div><p className="truncate text-xs font-black uppercase text-white">{ch.name}</p><p className="mt-0.5 truncate text-[9px] text-gray-600">{ch.desc}</p></div>
        {active ? <div className="h-7 w-1.5 rounded-full" style={{ background: ch.color }} /> : null}
      </div>
    </button>
  );
}

function StreamPlayer({ channel, switching, playerRef }) {
  return (
    <div ref={playerRef} className="relative overflow-hidden rounded-3xl border bg-black shadow-2xl" style={{ borderColor: channel.border, boxShadow: `0 0 60px ${channel.glow}` }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: channel.border, background: `linear-gradient(90deg,${channel.bg},transparent)` }}>
        <div className="flex min-w-0 items-center gap-2"><PulsingDot color={channel.color} />{channel.logo ? <img src={channel.logo} alt="" className="h-4 w-auto object-contain" /> : null}<span className="truncate text-xs font-black uppercase tracking-widest" style={{ color: channel.color }}>{channel.name}</span></div>
        <button type="button" onClick={() => playerRef.current && (window.jashRequestFullscreen ? window.jashRequestFullscreen(playerRef.current) : playerRef.current.requestFullscreen?.())} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-black text-zinc-300">⛶</button>
      </div>
      <div className="relative aspect-video w-full bg-black">{switching ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/90 text-xs font-black uppercase tracking-widest" style={{ color: channel.color }}>Switching…</div> : null}<iframe key={channel.id + channel.url} src={channel.url} className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" scrolling="no" /></div>
    </div>
  );
}

function Section({ title, kicker, children, right }) {
  return <section className="space-y-3"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.26em] text-gray-600">{kicker}</p><h2 className="text-xl font-black uppercase italic tracking-tight text-white sm:text-2xl">{title}</h2></div>{right}</div>{children}</section>;
}

export default function SportsPage() {
  const [channels, setChannels] = useState(BASE_CHANNELS);
  const [active, setActive] = useState(BASE_CHANNELS[0]);
  const [switching, setSwitching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'matches'
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matchFilter, setMatchFilter] = useState('all'); // 'all' | 'live' | 'icc' | 'fancode'
  const playerRef = useRef(null);

  const selectChannel = useCallback((channel) => {
    if (channel.id === active?.id) return;
    setSwitching(true);
    setTimeout(() => { setActive(channel); setSwitching(false); }, 260);
  }, [active?.id]);

  const loadAllMatches = useCallback(async () => {
    setMatchesLoading(true);
    try {
      const [fcRes, wt20Res] = await Promise.allSettled([
        fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/wt20/schedule', { cache: 'no-store' }).then((r) => r.json()),
      ]);

      const normalized = [];

      // 1. Process WT20 ICC fixtures
      if (wt20Res.status === 'fulfilled' && wt20Res.value) {
        const wtData = wt20Res.value.data?.matches || (Array.isArray(wt20Res.value) ? wt20Res.value : []);
        wtData.forEach((m) => {
          if (!m.match_id) return;
          const isLive = Boolean(m.live);
          const isCompleted = Boolean(m.match_result || m.match_status === 'Match Ended' || m.match_display_status === 'Result');
          const status = isLive ? 'LIVE' : isCompleted ? 'COMPLETED' : 'UPCOMING';
          const scoreA = m.scores?.[0] ? `${m.scores[0].team_short_name || m.teama_short || 'Team 1'} ${m.scores[0].team_runs}/${m.scores[0].team_wickets} (${m.scores[0].team_overs} ov)` : '';
          const scoreB = m.scores?.[1] ? `${m.scores[1].team_short_name || m.teamb_short || 'Team 2'} ${m.scores[1].team_runs}/${m.scores[1].team_wickets} (${m.scores[1].team_overs} ov)` : '';

          normalized.push({
            id: `wt20-${m.match_id}`,
            type: 'wt20',
            source: 'ICC WT20',
            matchId: m.match_id,
            title: `${m.teama || m.teama_short || 'Team A'} vs ${m.teamb || m.teamb_short || 'Team B'}`,
            tournament: m.series_short_display_name || m.series_name || "ICC Women's T20 World Cup, 2026",
            category: 'Cricket',
            status,
            startTime: m.match_date_ist ? `${m.match_date_ist}${m.match_time_ist ? ` · ${m.match_time_ist} IST` : ''}` : 'Today',
            venue: m.venue || '',
            result: m.match_result || '',
            scoreA,
            scoreB,
            stream: '',
            matchHash: encodeMatchHash({
              sport: 'cricket',
              type: 'wt20',
              matchId: String(m.match_id),
              homeCode: m.teama_short || '',
              awayCode: m.teamb_short || '',
              homeName: m.teama || '',
              awayName: m.teamb || '',
              leagueLabel: m.series_short_display_name || m.series_name || "ICC Women's T20 World Cup, 2026",
              scoreA,
              scoreB,
              result: m.match_result || '',
              status,
              venue: m.venue || '',
              startTime: m.match_date_ist ? `${m.match_date_ist}${m.match_time_ist ? ` · ${m.match_time_ist} IST` : ''}` : 'Today',
            }),
          });
        });
      }

      // 2. Process FanCode fixtures
      if (fcRes.status === 'fulfilled' && fcRes.value) {
        const rawFc = fcRes.value.matches || [];
        rawFc.forEach((m) => {
          const isLive = String(m.status || '').toUpperCase() === 'LIVE' || m.streamingStatus === 'STARTED';
          const isCompleted = String(m.status || '').toUpperCase() === 'COMPLETED';
          const status = isLive ? 'LIVE' : isCompleted ? 'COMPLETED' : 'UPCOMING';
          const stream = bestFancodeVariant(m.auto_streams?.[0]?.auto || '') || m.STREAMING_CDN?.Primary_Playback_URL || '';

          normalized.push({
            id: `fc-${m.match_id || m.title}`,
            type: 'fancode',
            source: 'FanCode',
            matchId: m.match_id,
            title: m.title || 'Live Match',
            tournament: m.tournament || m.category || 'FanCode Cricket',
            category: m.category || 'Cricket',
            status,
            startTime: m.startTime || m.startDate || 'Today',
            venue: '',
            result: '',
            scoreA: m.team?.[0]?.name ? `${m.team[0].name}${m.team[0].shortName ? ` (${m.team[0].shortName})` : ''}` : '',
            scoreB: m.team?.[1]?.name ? `${m.team[1].name}${m.team[1].shortName ? ` (${m.team[1].shortName})` : ''}` : '',
            stream,
            matchHash: encodeMatchHash({
              sport: 'cricket',
              type: 'fancode',
              matchId: String(m.match_id || ''),
              title: m.title || '',
              tournament: m.tournament || m.category || 'FanCode Event',
              category: m.category || 'Sports',
              startTime: m.startTime || m.startDate || 'Today',
              teamA: m.team?.[0]?.name || '',
              teamB: m.team?.[1]?.name || '',
              codeA: m.team?.[0]?.shortName || '',
              codeB: m.team?.[1]?.shortName || '',
              status,
              stream,
            }),
          });
        });
      }

      setMatches(normalized);
    } catch {} finally {
      setMatchesLoading(false);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' });
      const data = await response.json();
      const rawMatches = data.matches || [];
      const live = rawMatches
        .filter((m) => String(m.status || '').toUpperCase() === 'LIVE' && m.auto_streams?.[0]?.auto)
        .slice(0, 8)
        .map((m) => {
          const stream = bestFancodeVariant(m.auto_streams?.[0]?.auto || '') || m.STREAMING_CDN?.Primary_Playback_URL || '';
          return stream ? channelCardBase({ id: `fc-${m.match_id}`, name: m.title || 'FanCode', sub: 'FanCode', group: 'FanCode', color: '#ec1c24', logo: m.image_cdn?.LOGO || '/fancode.svg', url: playerUrlFromHls(stream, m.title || 'FanCode'), desc: m.tournament || 'Live FanCode event' }) : null;
        })
        .filter(Boolean);
      const nextChannels = [...live, ...BASE_CHANNELS];
      setChannels(nextChannels);
      setActive((current) => nextChannels.some((item) => item.id === current?.id) ? current : nextChannels[0]);
    } catch {} finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (activeTab === 'matches' && !matches.length) {
      loadAllMatches();
    }
  }, [activeTab, matches.length, loadAllMatches]);

  const filteredMatches = useMemo(() => {
    if (matchFilter === 'live') return matches.filter((m) => m.status === 'LIVE');
    if (matchFilter === 'icc') return matches.filter((m) => m.type === 'wt20');
    if (matchFilter === 'fancode') return matches.filter((m) => m.type === 'fancode');
    return matches;
  }, [matches, matchFilter]);

  return (
    <main className="min-h-screen bg-[#070709] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(245,158,11,0.12),transparent_65%)]" />

      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 hover:border-amber-400 hover:text-white transition">
            ← Home
          </Link>
          <div className="flex flex-col items-center gap-1">
            <BrandLogo size="mini" />
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Live Sports Center</p>
          </div>
          <button
            type="button"
            onClick={loadChannels}
            className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3.5 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-amber-300 transition hover:border-amber-400/60"
          >
            {refreshing ? 'Syncing…' : '↻ Refresh'}
          </button>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl space-y-8 px-4 py-6 pb-24">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Global Cricket & Live Match Hub</p>
            <h1 className="inline-flex flex-wrap items-center gap-3 text-3xl font-black uppercase italic leading-none tracking-tighter sm:text-5xl">
              Live <span className="text-amber-400">Sports</span>
              <span className="jv-badge-live not-italic text-xs"><span className="jv-livepulse" />On Air</span>
            </h1>
          </div>

          <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1 backdrop-blur">
            <button
              type="button"
              onClick={() => setActiveTab('live')}
              className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                activeTab === 'live' ? 'bg-amber-500 text-black shadow-lg shadow-amber-950/40' : 'text-zinc-400 hover:text-white'
              }`}
            >
              📺 Live Feeds
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('matches')}
              className={`rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition ${
                activeTab === 'matches' ? 'bg-amber-500 text-black shadow-lg shadow-amber-950/40' : 'text-zinc-400 hover:text-white'
              }`}
            >
              🏏 Match Hub
            </button>
          </div>
        </div>

        {activeTab === 'live' ? (
          <Section kicker="Instant Broadcast" title="Live Cricket Feeds">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  ch={channel}
                  active={active?.id === channel.id}
                  onClick={selectChannel}
                />
              ))}
            </div>

            {active ? (
              <div className="mt-6">
                <StreamPlayer channel={active} switching={switching} playerRef={playerRef} />
              </div>
            ) : null}
          </Section>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <div>
                <h2 className="text-xl font-black text-white">Live Matches & Tournaments</h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Select any match below to open its live scorecard, batting/bowling statistics, and ball-by-ball overview.
                </p>
              </div>
              <Link
                href="/match/live"
                className="inline-flex items-center justify-center gap-2 shrink-0 rounded-2xl bg-amber-500 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-black shadow-lg shadow-amber-950/40 hover:bg-amber-400 transition"
              >
                Featured Live Match →
              </Link>
            </div>

            {/* Category Filter Chips */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-4">
              {[
                { key: 'all', label: `All Fixtures (${matches.length})` },
                { key: 'live', label: `🔴 Live Now (${matches.filter((m) => m.status === 'LIVE').length})` },
                { key: 'icc', label: `🏆 ICC WT20 (${matches.filter((m) => m.type === 'wt20').length})` },
                { key: 'fancode', label: `⚡ FanCode (${matches.filter((m) => m.type === 'fancode').length})` },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setMatchFilter(f.key)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-bold transition ${
                    matchFilter === f.key
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/30 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {matchesLoading ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-zinc-400">
                Loading live matches & fixtures...
              </div>
            ) : filteredMatches.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-8 text-center text-sm text-zinc-400">
                No fixtures found matching this filter.
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMatches.map((m) => {
                  const isLive = m.status === 'LIVE';
                  const isCompleted = m.status === 'COMPLETED';

                  return (
                    <div
                      key={m.id || m.matchId}
                      className="group flex flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-amber-400/50 hover:bg-white/[0.05]"
                    >
                      <div>
                        {/* Top info */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] font-black uppercase tracking-wider text-amber-400/90">
                            {m.tournament}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                              isLive
                                ? 'border border-red-500/40 bg-red-500/20 text-red-300'
                                : isCompleted
                                  ? 'bg-zinc-800 text-zinc-400'
                                  : 'border border-amber-400/30 bg-amber-500/15 text-amber-300'
                            }`}
                          >
                            {m.status}
                          </span>
                        </div>

                        {/* Title linking directly to Match Center */}
                        <Link href={`/match-center/${m.matchHash}`} className="block mt-3 group-hover:text-amber-300 transition">
                          <h3 className="text-base font-black text-white group-hover:text-amber-300 transition line-clamp-2 leading-snug">
                            {m.title}
                          </h3>
                        </Link>

                        {/* Live / Completed Scores if available */}
                        {m.scoreA || m.scoreB ? (
                          <div className="mt-3 space-y-1 rounded-2xl border border-white/5 bg-black/40 p-2.5 font-mono text-xs">
                            {m.scoreA ? (
                              <div className="flex justify-between text-zinc-200">
                                <span>{m.scoreA}</span>
                              </div>
                            ) : null}
                            {m.scoreB ? (
                              <div className="flex justify-between text-zinc-200">
                                <span>{m.scoreB}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Result or Start Time */}
                        <div className="mt-3 text-xs text-zinc-400">
                          {m.result ? (
                            <p className="text-emerald-400 font-bold text-[11px] line-clamp-1">{m.result}</p>
                          ) : (
                            <p className="text-zinc-500 text-[11px]">{m.startTime || m.venue || 'Today'}</p>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="mt-5 flex items-center gap-2 pt-3 border-t border-white/5">
                        <Link
                          href={`/match-center/${m.matchHash}`}
                          className="flex-1 rounded-2xl border border-amber-400/30 bg-amber-500/15 py-2.5 text-center text-xs font-black text-amber-200 transition hover:bg-amber-500 hover:text-black"
                        >
                          {m.type === 'wt20' ? '📊 Match Scorecard →' : '⚡ Match Details'}
                        </Link>
                        {m.stream ? (
                          <a
                            href={playerUrlFromHls(m.stream, m.title)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-2xl bg-red-600 px-4 py-2.5 text-center text-xs font-black text-white shadow-md transition hover:bg-red-500"
                          >
                            ▶ Watch
                          </a>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
