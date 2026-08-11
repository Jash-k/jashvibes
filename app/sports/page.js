'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';

const FANCODE_FEED = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';
const M3U8_PLAYER = 'https://m3u8-player-ashen.vercel.app/';

const WILLOW_URL = 'https://m3u8-player-ashen.vercel.app/?sid=mzo8bm6chvg8&src=https%3A%2F%2Famg01269-amg01269c1-sportstribal-emea-5204.playouts.now.amagi.tv%2Fts-eu-w1-n2%2Fplaylist%2Famg01269-willowtvfast-willowplus-sportstribalemea%2Fcb7f3e1a7b7b6f8a9ac33e6cd9f143a5d1073183573a80303aac5e9e7792155d80b9f7c9b84aeb4a19e24094385631004262d519ce647c968d23f6156b3f4f7f8ae1ec3f8cc50274e38b1f5549a3120e50fe6114d54a543b99c80a188938827c0738e11d210361daf35aab664abef86ef603359bf1843a6c6d2d0acc0602fcb02dfbbdbe0010c76da5b802488b2f5be7922198824df9d9cb5e9d449875f7068993a38dd1438486967eaf50e0304409737bc8cd7bcb9c04fb88cc393cc82170401f57e2a1a1d42453eed19c71829de291279a3ac08d2c801258d162b97cf4fb0ef6c873c3c05da9acc1bf08216be6ac5f10ba36f020769a6113c4ac6a10c4df534fb9bc785954c06c970924349bfcdf15be1274fca30e8aae601134c1de10d5cdf2cbc2b18e439231c5d4fcc37d6b4077010ec670a3992df41a9d40e89f431e0d187bfad315e596c95235554a84ab57c05c4eea8cc5d0894e73e1482f77c42c99570c67c9744b79e626f6d37c4f813405883072aa0c6cce12b2e862a5e7e8e4003aa7d78817ac38a1e65ca09968cd420f193ac1957d0f7a1d28efb91c4a5a1fe44aebd4c6e4056c21fce7c1fbba3e1b0f2b185f09cbafa75fa8cef86b7a32c4402d747b001df4528089beb6b4d99faf0b36e6b65dc6267bd08a8272ae04501d%2F66%2F1920x1080_5859480%2Findex.m3u8&title=Willow-cricket-live';
const FANCODE_PERMANENT_URL = 'https://m3u8-player-ashen.vercel.app/?sid=7cswis4w7cn1&chid=FRttXFtDHQ&t=g-emhBJmCgNJIxIWWVESYhcHDAFTLkEQYlQTAxobEhYSZ11YHQQ&lg=GwxGQEEPV0UeGARWVFFcVhcODEEQF18fQV4RBgUaA1VHQF5aGQ4aQBAVQR1fUBwDCEAgNB9GQRgoKyJBAxZV';

function playerUrlFromHls(url = '', title = 'Live') {
  const params = new URLSearchParams({ src: url, title });
  return `${M3U8_PLAYER}?${params.toString()}`;
}

function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (!matches.length) {
    const direct = text.match(/https?:\/\/[^\r\n]+\.m3u8[^\r\n]*/i)?.[0];
    return direct || '';
  }
  return matches
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]), url: match[3].trim() }))
    .sort((a, b) => (b.height * b.width) - (a.height * a.width))[0]?.url || '';
}

function channelCardBase({ id, name, sub, group, color, logo, url, desc }) {
  return {
    id, name, sub, group, color,
    glow: `${color}4d`, border: `${color}40`, bg: `${color}12`,
    tag: sub || 'LIVE', logo, url, desc,
  };
}

const BASE_CHANNELS = [
  channelCardBase({ id: 'fancode-live', name: 'FanCode', sub: 'Live', group: 'FanCode', color: '#ec1c24', logo: '/fancode.svg', url: FANCODE_PERMANENT_URL, desc: 'Current FanCode live match' }),
  channelCardBase({ id: 'willow', name: 'Willow TV', sub: 'English', group: 'Willow', color: '#f97316', logo: '/willow.svg', url: WILLOW_URL, desc: 'Willow by Cricbuzz live cricket' }),
];

function PulsingDot({ color = '#ef4444' }) {
  return <span className="inline-block h-2 w-2 rounded-full animate-pulse" style={{ background: color }} />;
}

function ChannelCard({ ch, active, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(ch)}
      className="relative w-full overflow-hidden rounded-2xl border text-left transition-all duration-300 active:scale-[0.98]"
      style={{ background: active ? ch.bg : 'rgba(255,255,255,0.025)', borderColor: active ? ch.border : 'rgba(255,255,255,0.07)', boxShadow: active ? `0 0 30px ${ch.glow}` : 'none' }}
    >
      <div className="relative flex items-center gap-3 p-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border bg-white/[0.04]" style={{ borderColor: active ? ch.border : 'rgba(255,255,255,0.08)' }}>
          {ch.logo ? <img src={ch.logo} alt="" className="max-h-8 max-w-8 object-contain" /> : <span className="text-xl">🏏</span>}
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <span className="rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.2em]" style={{ background: `${ch.color}20`, color: ch.color }}>{ch.tag}</span>
            <PulsingDot color={ch.color} />
          </div>
          <p className="truncate text-xs font-black uppercase text-white">{ch.name} <span style={{ color: ch.color }}>{ch.sub}</span></p>
          <p className="mt-0.5 truncate text-[9px] text-gray-600">{ch.desc}</p>
        </div>
        {active ? <div className="h-7 w-1.5 rounded-full" style={{ background: ch.color }} /> : null}
      </div>
    </button>
  );
}

function StreamPlayer({ channel, switching, playerRef }) {
  return (
    <div ref={playerRef} className="relative overflow-hidden rounded-3xl border bg-black shadow-2xl" style={{ borderColor: channel.border, boxShadow: `0 0 60px ${channel.glow}` }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: channel.border, background: `linear-gradient(90deg,${channel.bg},transparent)` }}>
        <div className="flex items-center gap-2 min-w-0">
          <PulsingDot color={channel.color} />
          {channel.logo ? <img src={channel.logo} alt="" className="h-4 w-auto object-contain" /> : null}
          <span className="truncate text-xs font-black uppercase tracking-widest" style={{ color: channel.color }}>{channel.name} {channel.sub}</span>
        </div>
        <button type="button" onClick={() => playerRef.current?.requestFullscreen?.()} className="rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-black text-zinc-300">⛶</button>
      </div>
      <div className="relative aspect-video w-full bg-black">
        {switching ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/90 text-xs font-black uppercase tracking-widest" style={{ color: channel.color }}>Switching…</div> : null}
        <iframe key={channel.id + channel.url} src={channel.url} className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen scrolling="no" />
      </div>
      <div className="border-t border-white/10 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-gray-700">Third-party player embedded in JaSH ViBeS</div>
    </div>
  );
}

function MatchCard({ match }) {
  const statusClass = match.status === 'live' ? 'text-red-300 border-red-400/30 bg-red-500/10' : match.status === 'completed' ? 'text-green-300 border-green-400/25 bg-green-500/10' : 'text-yellow-100 border-yellow-400/25 bg-yellow-500/10';
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">{match.competition || match.tournament || 'Cricket'}</p>
          <p className="mt-1 truncate text-sm font-black text-white">{match.homeCode || match.home} vs {match.awayCode || match.away}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${statusClass}`}>{match.status}</span>
      </div>
      <div className="mt-3 grid gap-1.5 text-xs">
        <div className="flex justify-between gap-3"><span className="text-zinc-400">{match.home || match.homeCode}</span><span className="font-mono text-white">{match.score1 || '-'}</span></div>
        <div className="flex justify-between gap-3"><span className="text-zinc-400">{match.away || match.awayCode}</span><span className="font-mono text-white">{match.score2 || '-'}</span></div>
      </div>
      {match.result ? <p className="mt-2 text-[10px] font-bold text-green-300">{match.result}</p> : null}
    </div>
  );
}

export default function SportsPage() {
  const [channels, setChannels] = useState(BASE_CHANNELS);
  const [active, setActive] = useState(BASE_CHANNELS[0]);
  const [switching, setSwitching] = useState(false);
  const [matches, setMatches] = useState([]);
  const [scoreError, setScoreError] = useState('');
  const playerRef = useRef(null);

  const selectChannel = useCallback((channel) => {
    if (channel.id === active?.id) return;
    setSwitching(true);
    setTimeout(() => { setActive(channel); setSwitching(false); }, 280);
  }, [active?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadFanCode() {
      try {
        const response = await fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        const live = (data.matches || [])
          .filter((m) => String(m.status || '').toUpperCase() === 'LIVE' && m.auto_streams?.[0]?.auto)
          .slice(0, 8)
          .map((m) => {
            const stream = bestFancodeVariant(m.auto_streams?.[0]?.auto || '') || m.STREAMING_CDN?.Primary_Playback_URL || '';
            return channelCardBase({
              id: `fc-${m.match_id}`,
              name: m.title || 'FanCode',
              sub: 'FanCode',
              group: 'FanCode',
              color: '#ec1c24',
              logo: m.image_cdn?.LOGO || '/fancode.svg',
              url: stream ? playerUrlFromHls(stream, m.title || 'FanCode') : FANCODE_PERMANENT_URL,
              desc: m.tournament || 'Live FanCode event',
            });
          });
        if (!cancelled && live.length) {
          setChannels([...live, ...BASE_CHANNELS]);
          setActive((current) => live.some((item) => item.id === current?.id) ? current : live[0]);
        }
      } catch {}
    }
    loadFanCode();
    const timer = window.setInterval(loadFanCode, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadScores() {
      try {
        const feeds = await Promise.all(['live', 'upcoming', 'recent'].map((feed) => fetch(`/api/sports/score?feed=${feed}`, { cache: 'no-store' }).then((r) => r.json())));
        const combined = feeds.flatMap((payload) => payload.matches || []);
        if (!cancelled) {
          setMatches(combined);
          setScoreError(feeds.find((payload) => payload.unavailable)?.error || '');
        }
      } catch (error) {
        if (!cancelled) setScoreError(error.message || 'Score feed unavailable');
      }
    }
    loadScores();
    const timer = window.setInterval(loadScores, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const liveMatches = useMemo(() => matches.filter((match) => match.status === 'live'), [matches]);
  const shownMatches = liveMatches.length ? liveMatches : matches.slice(0, 8);

  return (
    <main className="min-h-screen overflow-x-hidden bg-gray-950 text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(245,158,11,0.15),transparent_65%)]" />
      <header className="relative z-10 border-b border-white/5 bg-gray-950/80 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300">← Home</Link>
          <div className="flex flex-col items-center gap-1">
            <BrandLogo size="compact" />
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Live Sports</p>
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">● Live</span>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-5xl px-4 py-5 pb-24">
        <div className="mb-5">
          <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.3em] text-gray-600">🏏 Live Cricket</p>
          <h1 className="text-3xl font-black uppercase italic leading-none tracking-tighter sm:text-4xl">Cricket <span className="text-amber-400">Live TV</span></h1>
          <p className="mt-1 text-[11px] text-gray-600">FanCode · Willow · Star Sports · public scorecards</p>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {channels.slice(0, 8).map((channel) => <ChannelCard key={channel.id} ch={channel} active={active?.id === channel.id} onClick={selectChannel} />)}
            </div>
            {active ? <StreamPlayer channel={active} switching={switching} playerRef={playerRef} /> : null}
            <div className="flex flex-wrap items-center gap-2">
              <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-gray-700">Switch</span>
              {channels.map((channel) => (
                <button key={channel.id} type="button" onClick={() => selectChannel(channel)} className="rounded-xl border px-3 py-1.5 text-[9px] font-black uppercase transition" style={{ background: active?.id === channel.id ? channel.bg : 'rgba(255,255,255,0.02)', borderColor: active?.id === channel.id ? channel.border : 'rgba(255,255,255,0.06)', color: active?.id === channel.id ? channel.color : '#4b5563' }}>{channel.sub}</button>
              ))}
            </div>
          </div>

          <aside className="w-full shrink-0 lg:w-[340px]">
            <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div><p className="text-[10px] font-black uppercase tracking-[0.25em] text-gray-500">Scorecards</p><h2 className="text-xl font-black text-white">Live Center</h2></div>
                <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-1 text-[8px] font-black uppercase text-amber-400">60s</span>
              </div>
              {scoreError ? <p className="mb-3 rounded-2xl border border-yellow-400/20 bg-yellow-500/10 p-3 text-[10px] leading-5 text-yellow-100">{scoreError}</p> : null}
              <div className="space-y-2">
                {shownMatches.map((match, index) => <MatchCard key={`${match.id}-${index}`} match={match} />)}
                {!shownMatches.length ? <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-center text-xs text-gray-500">No public scorecard feed available right now.</div> : null}
              </div>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
