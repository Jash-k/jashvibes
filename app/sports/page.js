'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';

function cleanHex(value = '') {
  return String(value || '').trim().replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

function buildClearKeys(channel) {
  const kid = cleanHex(channel?.keyId || '');
  const key = cleanHex(channel?.key || '');
  return kid && key && kid !== 'null' && key !== 'null' ? { [kid]: key } : {};
}

function appendCookieToken(uri = '', cookie = '') {
  const token = String(cookie || '').trim();
  if (!token) return uri;
  const cookieName = token.includes('__hdnea__') ? '__hdnea__' : token.includes('hdnea') ? 'hdnea' : '';
  if (!cookieName) return uri;
  const tokenValue = token.includes('=') ? token.slice(token.indexOf('=') + 1) : token;
  if (!tokenValue) return uri;
  if (uri.includes(`${cookieName}=`)) return uri.replace(new RegExp(`(${cookieName}=)[^&"'\\s;]+`), `$1${tokenValue}`);
  return `${uri}${uri.includes('?') ? '&' : '?'}${cookieName}=${tokenValue}`;
}

function isSportsChannel(channel = {}) {
  const text = `${channel.name || ''} ${channel.category || ''} ${channel.source || ''}`.toLowerCase();
  return /sports|cricket|fancode|willow|ten 4|star sports|sony sports/.test(text);
}

function MatchCard({ match }) {
  const statusClass = match.status === 'live' ? 'text-green-300 border-green-400/30 bg-green-500/10' : match.status === 'completed' ? 'text-zinc-300 border-white/10 bg-white/[0.04]' : 'text-yellow-100 border-yellow-400/25 bg-yellow-500/10';
  return (
    <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-4 shadow-xl shadow-black/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-black uppercase tracking-[0.22em] text-fuchsia-300">{match.competition || 'Cricket'}</p>
          <h3 className="mt-2 text-lg font-black text-white">{match.homeCode || match.home} vs {match.awayCode || match.away}</h3>
          <p className="mt-1 text-xs text-zinc-500">{match.matchOrder || match.venue || match.date || 'Match'}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${statusClass}`}>{match.status}</span>
      </div>
      <div className="mt-4 grid gap-2 rounded-2xl bg-black/35 p-3 text-sm">
        <div className="flex items-center justify-between gap-3"><span className="font-black text-zinc-200">{match.home || match.homeCode}</span><span className="font-mono text-zinc-100">{match.score1 || '-'}</span></div>
        <div className="flex items-center justify-between gap-3"><span className="font-black text-zinc-200">{match.away || match.awayCode}</span><span className="font-mono text-zinc-100">{match.score2 || '-'}</span></div>
      </div>
      {match.result ? <p className="mt-3 text-xs font-bold leading-5 text-green-200">{match.result}</p> : null}
    </div>
  );
}

export default function SportsPage() {
  const videoRef = useRef(null);
  const shakaRef = useRef(null);
  const [channels, setChannels] = useState([]);
  const [active, setActive] = useState(null);
  const [channelStatus, setChannelStatus] = useState('loading');
  const [matches, setMatches] = useState([]);
  const [scoreStatus, setScoreStatus] = useState('loading');
  const [scoreError, setScoreError] = useState('');
  const [playerError, setPlayerError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadChannels() {
      try {
        setChannelStatus('loading');
        const response = await fetch('/api/live-tv?playable=1', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || 'Unable to load sports channels');
        const sports = (data.channels || []).filter(isSportsChannel);
        if (!cancelled) {
          setChannels(sports);
          setActive(sports[0] || null);
          setChannelStatus('ready');
        }
      } catch (error) {
        if (!cancelled) { setChannelStatus('error'); setPlayerError(error.message || 'Unable to load sports channels'); }
      }
    }
    loadChannels();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadScores() {
      try {
        setScoreStatus('loading');
        setScoreError('');
        const feeds = await Promise.all(['live', 'upcoming', 'recent'].map((feed) => fetch(`/api/sports/score?feed=${feed}`, { cache: 'no-store' }).then((r) => r.json())));
        const combined = feeds.flatMap((payload) => payload.matches || []);
        if (!cancelled) {
          setMatches(combined);
          setScoreError(feeds.find((payload) => payload.unavailable)?.error || '');
          setScoreStatus('ready');
        }
      } catch (error) {
        if (!cancelled) { setScoreStatus('error'); setScoreError(error.message || 'Score feed unavailable'); }
      }
    }
    loadScores();
    const timer = window.setInterval(loadScores, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active?.url) return;
    let cancelled = false;

    async function destroy() {
      if (shakaRef.current) { try { await shakaRef.current.destroy(); } catch {} shakaRef.current = null; }
    }

    async function load() {
      try {
        setPlayerError('');
        await destroy();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();

        const shakaModule = await import('shaka-player/dist/shaka-player.ui.js');
        const shaka = shakaModule.default || window.shaka || shakaModule;
        shaka.polyfill?.installAll?.();
        const player = new shaka.Player();
        shakaRef.current = player;
        await player.attach(video);
        const clearKeys = buildClearKeys(active);
        player.configure({
          drm: Object.keys(clearKeys).length ? { clearKeys } : {},
          streaming: { bufferingGoal: 12, rebufferingGoal: 2, lowLatencyMode: true },
          abr: { enabled: true, defaultBandwidthEstimate: 1_000_000 },
        });
        player.getNetworkingEngine()?.registerRequestFilter((requestType, request) => {
          const uri = request.uris?.[0] || '';
          const isJio = uri.includes('jiotv') || uri.includes('jio.com');
          if (active.referer) request.headers.Referer = active.referer;
          else if (isJio) request.headers.Referer = 'https://www.jiotv.co/';
          if (active.userAgent) request.headers['User-Agent'] = active.userAgent;
          else if (isJio) request.headers['User-Agent'] = 'plaYtv/7.1.5 (Linux;Android 13) ExoPlayerLib/2.11.6';
          if (active.cookie && isJio) request.uris[0] = appendCookieToken(uri, active.cookie);
        });
        await player.load(active.url, undefined, active.format === 'hls' ? 'application/x-mpegurl' : undefined);
        if (!cancelled) video.play().catch(() => {});
      } catch (error) {
        if (!cancelled) setPlayerError(`Sports player error: ${error.message || 'Stream failed'}`);
      }
    }
    load();
    return () => { cancelled = true; destroy(); };
  }, [active?.id]);

  const liveMatches = useMemo(() => matches.filter((match) => match.status === 'live'), [matches]);
  const shownMatches = liveMatches.length ? liveMatches : matches.slice(0, 8);

  return (
    <main className="min-h-dvh overflow-x-hidden bg-[#050711] pb-10 text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-zinc-950/90 px-4 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300 transition hover:border-green-400/50 hover:text-white">← Home</Link>
          <div className="flex flex-col items-center gap-1 text-center">
            <BrandLogo size="compact" />
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-green-300">Live Sports</p>
          </div>
          <span className="hidden w-20 lg:block" />
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[1.45fr_0.85fr] lg:px-8">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black shadow-2xl shadow-black/50">
            <div className="relative aspect-video bg-black">
              {active ? <video ref={videoRef} className="h-full w-full bg-black object-fill" controls playsInline autoPlay poster={active.logo || undefined} /> : <div className="grid h-full place-items-center p-8 text-center text-zinc-400">Choose a sports channel</div>}
              {playerError ? <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-red-400/30 bg-red-950/80 p-3 text-xs text-red-100">{playerError}</div> : null}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-4">
            <h1 className="text-2xl font-black text-white sm:text-4xl">Sports Player</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Separate sports hub using your existing Live TV sources. Public scorecards update independently.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {channelStatus === 'loading' ? <div className="col-span-full rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-zinc-400">Loading sports channels...</div> : null}
              {channels.map((channel) => (
                <button key={channel.id} type="button" onClick={() => setActive(channel)} className={`rounded-2xl border p-3 text-left transition ${active?.id === channel.id ? 'border-green-400/60 bg-green-500/15' : 'border-white/10 bg-white/[0.04] hover:border-green-400/40'}`}>
                  <div className="flex items-center gap-2">
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-white/5">{channel.logo ? <img src={channel.logo} alt="" className="max-h-full max-w-full object-contain" /> : '⚽'}</div>
                    <div className="min-w-0"><p className="truncate text-sm font-black text-white">{channel.name}</p><p className="truncate text-[10px] text-zinc-500">{channel.source}</p></div>
                  </div>
                </button>
              ))}
              {channelStatus === 'ready' && !channels.length ? <div className="col-span-full rounded-2xl border border-white/10 bg-black/30 p-5 text-sm text-zinc-400">No sports channels found in current Live TV sources.</div> : null}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[2rem] border border-white/10 bg-zinc-950/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">Scorecards</h2>
              <span className="rounded-full border border-green-400/25 bg-green-500/10 px-3 py-1 text-[10px] font-black uppercase text-green-200">Public Feed</span>
            </div>
            {scoreStatus === 'loading' ? <p className="mt-4 text-sm text-zinc-500">Loading scores...</p> : null}
            {scoreError ? <p className="mt-3 rounded-2xl border border-yellow-400/25 bg-yellow-500/10 p-3 text-xs leading-5 text-yellow-100">{scoreError}</p> : null}
            <div className="mt-4 grid gap-3">
              {shownMatches.map((match, index) => <MatchCard key={`${match.id}-${index}`} match={match} />)}
              {scoreStatus === 'ready' && !shownMatches.length ? <div className="rounded-3xl border border-white/10 bg-black/25 p-5 text-sm text-zinc-400">No live scorecards available right now. This will auto-update when the public feed is up.</div> : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  );
}
