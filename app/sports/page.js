'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandLogo from '@/components/BrandLogo';

const FANCODE_FEED = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';
const M3U8_PLAYER = 'https://m3u8-player-ashen.vercel.app/';
const WILLOW_URL = 'https://m3u8-player-ashen.vercel.app/?sid=mzo8bm6chvg8&src=https%3A%2F%2Famg01269-amg01269c1-sportstribal-emea-5204.playouts.now.amagi.tv%2Fts-eu-w1-n2%2Fplaylist%2Famg01269-willowtvfast-willowplus-sportstribalemea%2Fcb7f3e1a7b7b6f8a9ac33e6cd9f143a5d1073183573a80303aac5e9e7792155d80b9f7c9b84aeb4a19e24094385631004262d519ce647c968d23f6156b3f4f7f8ae1ec3f8cc50274e38b1f5549a3120e50fe6114d54a543b99c80a188938827c0738e11d210361daf35aab664abef86ef603359bf1843a6c6d2d0acc0602fcb02dfbbdbe0010c76da5b802488b2f5be7922198824df9d9cb5e9d449875f7068993a38dd1438486967eaf50e0304409737bc8cd7bcb9c04fb88cc393cc82170401f57e2a1a1d42453eed19c71829de291279a3ac08d2c801258d162b97cf4fb0ef6c873c3c05da9acc1bf08216be6ac5f10ba36f020769a6113c4ac6a10c4df534fb9bc785954c06c970924349bfcdf15be1274fca30e8aae601134c1de10d5cdf2cbc2b18e439231c5d4fcc37d6b4077010ec670a3992df41a9d40e89f431e0d187bfad315e596c95235554a84ab57c05c4eea8cc5d0894e73e1482f77c42c99570c67c9744b79e626f6d37c4f813405883072aa0c6cce12b2e862a5e7e8e4003aa7d78817ac38a1e65ca09968cd420f193ac1957d0f7a1d28efb91c4a5a1fe44aebd4c6e4056c21fce7c1fbba3e1b0f2b185f09cbafa75fa8cef86b7a32c4402d747b001df4528089beb6b4d99faf0b36e6b65dc6267bd08a8272ae04501d%2F66%2F1920x1080_5859480%2Findex.m3u8&title=Willow-cricket-live';
const FANCODE_PERMANENT_URL = 'https://m3u8-player-ashen.vercel.app/?sid=7cswis4w7cn1&chid=FRttXFtDHQ&t=g-emhBJmCgNJIxIWWVESYhcHDAFTLkEQYlQTAxobEhYSZ11YHQQ&lg=GwxGQEEPV0UeGARWVFFcVhcODEEQF18fQV4RBgUaA1VHQF5aGQ4aQBAVQR1fUBwDCEAgNB9GQRgoKyJBAxZV';

function encodeMatchHash(payload) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

function matchCenterHref(payload) {
  const hash = encodeMatchHash(payload);
  return hash ? `/match-center/${hash}` : '/sports';
}

function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (!matches.length) return text.match(/https?:\/\/[^\r\n]+\.m3u8[^\r\n]*/i)?.[0] || '';
  return matches.map((match) => ({ width: Number(match[1]), height: Number(match[2]), url: match[3].trim() })).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url || '';
}

function playerUrlFromHls(url = '', title = 'Live') {
  return `${M3U8_PLAYER}?${new URLSearchParams({ src: url, title }).toString()}`;
}

function channelCardBase({ id, name, sub, group, color, logo, url, desc }) {
  return { id, name, sub, group, color, glow: `${color}4d`, border: `${color}40`, bg: `${color}12`, tag: sub || 'LIVE', logo, url, desc };
}

const BASE_CHANNELS = [
  channelCardBase({ id: 'fancode-live', name: 'FanCode', sub: 'Live', group: 'FanCode', color: '#ec1c24', logo: '/fancode.svg', url: FANCODE_PERMANENT_URL, desc: 'Current FanCode live event' }),
  channelCardBase({ id: 'willow', name: 'Willow TV', sub: 'English', group: 'Willow', color: '#f97316', logo: '/willow.svg', url: WILLOW_URL, desc: 'Willow by Cricbuzz live cricket' }),
];

function pickArray(payload = {}, preferredKeys = []) {
  for (const key of preferredKeys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const value of Object.values(payload || {})) if (Array.isArray(value)) return value;
  return [];
}

function teamCode(name = '') {
  const clean = String(name || '').trim();
  const map = { India: 'IND', Australia: 'AUS', England: 'ENG', Pakistan: 'PAK', 'South Africa': 'SA', 'New Zealand': 'NZ', 'Sri Lanka': 'SL', Bangladesh: 'BAN', Afghanistan: 'AFG', 'West Indies': 'WI' };
  return map[clean] || clean.split(/\s+/).map((part) => part[0]).join('').slice(0, 4).toUpperCase() || 'TBD';
}

function isSeniorMenBcci(row = {}) {
  const text = `${row.CompetitionName || ''} ${row.SeriesName || ''} ${row.HomeTeamName || ''} ${row.AwayTeamName || ''}`.toLowerCase();
  return !/(women|u-?19|under\s*19|india\s*a|emerging|academy|girls)/i.test(text);
}

function normalizeBcciMatch(row = {}, feed = 'live') {
  const home = row.HomeTeamName || row.HomeTeam || row.Team1 || row.FirstBattingTeamName || '';
  const away = row.AwayTeamName || row.AwayTeam || row.Team2 || row.SecondBattingTeamName || '';
  const statusRaw = String(row.MatchStatus || row.Status || '').toLowerCase();
  const result = row.Comments || row.MatchResult || row.Result || '';
  const status = /post|result|complete|ended/.test(statusRaw) || result ? 'completed' : (feed === 'live' || /live|progress|innings|break/.test(statusRaw)) ? 'live' : 'upcoming';
  const matchData = {
    ...row,
    MatchID: row.MatchID || row.MatchId || row.matchID || row.id,
    CompetitionID: row.CompetitionID || row.CompetitionId || row.SeriesID,
    MatchOrder: row.MatchOrder || row.MatchName || row.MatchNo,
    CompetitionName: row.CompetitionName || row.SeriesName || row.TournamentName,
    HomeTeamName: home,
    AwayTeamName: away,
    GroundName: row.GroundName || row.VenueName || row.Venue,
  };
  return {
    id: String(matchData.MatchID || `${home}-${away}-${feed}`),
    provider: 'BCCI',
    type: 'bcci',
    status,
    title: `${teamCode(home)} vs ${teamCode(away)}`,
    subtitle: `${home || 'Team A'} vs ${away || 'Team B'}`,
    competition: matchData.CompetitionName || 'BCCI Cricket',
    venue: matchData.GroundName || '',
    date: row.MatchDateNew || row.MatchDate || row.StartDate || '',
    score1: row['1Summary'] || row.FirstBattingSummary || row.HomeTeamScore || '',
    score2: row['2Summary'] || row.SecondBattingSummary || row.AwayTeamScore || '',
    result,
    href: matchCenterHref({ sport: 'cricket', type: 'bcci', matchData }),
  };
}

function normalizeWt20Match(row = {}) {
  const live = row.live === true || row.Live === true;
  const recent = row.recent === true || /ended|complete|won|beat/.test(String(row.match_status || row.match_result || '').toLowerCase());
  const status = live ? 'live' : recent ? 'completed' : 'upcoming';
  const home = row.teama || row.home || row.teama_short || 'Team A';
  const away = row.teamb || row.away || row.teamb_short || 'Team B';
  return {
    id: String(row.match_id || row.game_id || `${home}-${away}`),
    provider: 'ICC',
    type: 'wt20',
    status,
    title: `${row.teama_short || teamCode(home)} vs ${row.teamb_short || teamCode(away)}`,
    subtitle: `${home} vs ${away}`,
    competition: row.series_name || 'ICC WT20',
    venue: row.venue_name || row.ground_name || '',
    date: row.match_date_ist || row.start_date || '',
    score1: row.teama_score || '',
    score2: row.teamb_score || '',
    result: row.match_result || row.match_status || '',
    href: matchCenterHref({ sport: 'cricket', type: 'wt20', matchId: row.match_id, matchData: row }),
  };
}

function normalizeIplMatch(row = {}) {
  const id = row.MatchID || row.matchId || row.id;
  const home = row.Team1Name || row.HomeTeamName || row.team1 || row.TeamA || row.home || row.HomeTeamShortName || 'Team A';
  const away = row.Team2Name || row.AwayTeamName || row.team2 || row.TeamB || row.away || row.AwayTeamShortName || 'Team B';
  const result = row.Comments || row.Result || row.result || row.MatchResult || '';
  const statusText = String(row.MatchStatus || row.status || '').toLowerCase();
  const completed = result || /complete|post|result|ended/.test(statusText) || row.IsMatchEnd === '1';
  return {
    id: String(id || `${home}-${away}`),
    provider: 'IPL',
    type: 'ipl',
    status: completed ? 'completed' : /live|innings/.test(statusText) ? 'live' : 'upcoming',
    title: row.title || `${teamCode(home)} vs ${teamCode(away)}`,
    subtitle: `${home} vs ${away}`,
    competition: row.CompetitionName || row.competition || 'IPL',
    venue: row.GroundName || row.venue || row.Venue || '',
    date: row.MatchDate || row.date || '',
    score1: row['1Summary'] || row.score1 || '',
    score2: row['2Summary'] || row.score2 || '',
    result,
    href: matchCenterHref({ sport: 'cricket', type: 'ipl', matchId: id, matchData: row }),
  };
}

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
      <div className="relative aspect-video w-full bg-black">{switching ? <div className="absolute inset-0 z-20 grid place-items-center bg-black/90 text-xs font-black uppercase tracking-widest" style={{ color: channel.color }}>Switching…</div> : null}<iframe key={channel.id + channel.url} src={channel.url} className="h-full w-full border-0" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen scrolling="no" /></div>
    </div>
  );
}

function MatchCard({ match, compact = false }) {
  const statusClass = match.status === 'live' ? 'border-red-400/30 bg-red-500/10 text-red-200' : match.status === 'completed' ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200' : 'border-amber-400/25 bg-amber-500/10 text-amber-100';
  return (
    <Link href={match.href} className="group block rounded-2xl border border-white/10 bg-white/[0.025] p-3 transition hover:border-amber-400/40 hover:bg-amber-500/10">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-gray-500">{match.provider} · {match.competition}</p><p className="mt-1 truncate text-sm font-black text-white group-hover:text-amber-100">{match.title}</p><p className="mt-0.5 truncate text-[10px] text-zinc-500">{match.venue || match.date || 'Match Center'}</p></div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${statusClass}`}>{match.status}</span>
      </div>
      {!compact ? <div className="mt-3 grid gap-1.5 text-xs"><div className="flex justify-between gap-3"><span className="truncate text-zinc-400">{match.subtitle.split(' vs ')[0]}</span><span className="font-mono text-white">{match.score1 || '-'}</span></div><div className="flex justify-between gap-3"><span className="truncate text-zinc-400">{match.subtitle.split(' vs ')[1]}</span><span className="font-mono text-white">{match.score2 || '-'}</span></div></div> : null}
      {match.result ? <p className="mt-2 line-clamp-2 text-[10px] font-bold text-emerald-300">{match.result}</p> : null}
    </Link>
  );
}

function Section({ title, kicker, children, right }) {
  return <section className="space-y-3"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.26em] text-gray-600">{kicker}</p><h2 className="text-xl font-black uppercase italic tracking-tight text-white sm:text-2xl">{title}</h2></div>{right}</div>{children}</section>;
}

function HighlightCard({ video, source }) {
  const title = video.title || video.name || 'Highlight';
  const image = video.image || video.thumbnail || video.thumbnail_image || video.poster || '';
  const href = source === 'icc'
    ? `/sports/player?iccVideoId=${encodeURIComponent(video.uuid || video.id || video.videoId)}&title=${encodeURIComponent(title)}`
    : video.video_url
      ? `/sports/player?url=${encodeURIComponent(video.video_url)}&title=${encodeURIComponent(title)}`
      : (video.share || '#');
  return (
    <Link href={href} target={href.startsWith('http') ? '_blank' : undefined} className="group min-w-[230px] max-w-[230px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition hover:border-amber-400/40 hover:bg-amber-500/10">
      <div className="aspect-video bg-zinc-900">{image ? <img src={image} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <div className="grid h-full place-items-center text-3xl">🎞️</div>}</div>
      <div className="p-3"><p className="mb-1 text-[9px] font-black uppercase tracking-[0.2em] text-amber-400">{source.toUpperCase()} Highlight</p><p className="line-clamp-2 text-xs font-bold leading-5 text-white">{title}</p><p className="mt-1 text-[10px] text-zinc-600">{video.duration || video.date || 'Play'}</p></div>
    </Link>
  );
}

export default function SportsPage() {
  const [channels, setChannels] = useState(BASE_CHANNELS);
  const [active, setActive] = useState(BASE_CHANNELS[0]);
  const [switching, setSwitching] = useState(false);
  const [matches, setMatches] = useState([]);
  const [feedError, setFeedError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const playerRef = useRef(null);

  const selectChannel = useCallback((channel) => {
    if (channel.id === active?.id) return;
    setSwitching(true);
    setTimeout(() => { setActive(channel); setSwitching(false); }, 260);
  }, [active?.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadFanCode() {
      try {
        const response = await fetch(`${FANCODE_FEED}?_=${Date.now()}`, { cache: 'no-store' });
        const data = await response.json();
        const live = (data.matches || []).filter((m) => String(m.status || '').toUpperCase() === 'LIVE' && m.auto_streams?.[0]?.auto).slice(0, 8).map((m) => {
          const stream = bestFancodeVariant(m.auto_streams?.[0]?.auto || '') || m.STREAMING_CDN?.Primary_Playback_URL || '';
          return channelCardBase({ id: `fc-${m.match_id}`, name: m.title || 'FanCode', sub: 'FanCode', group: 'FanCode', color: '#ec1c24', logo: m.image_cdn?.LOGO || '/fancode.svg', url: stream ? playerUrlFromHls(stream, m.title || 'FanCode') : FANCODE_PERMANENT_URL, desc: m.tournament || 'Live FanCode event' });
        });
        if (!cancelled) {
          const nextChannels = live.length ? [...live, ...BASE_CHANNELS] : BASE_CHANNELS;
          setChannels(nextChannels);
          setActive((current) => nextChannels.some((item) => item.id === current?.id) ? current : nextChannels[0]);
        }
      } catch {}
    }
    loadFanCode();
    const timer = window.setInterval(loadFanCode, 60000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const loadSports = useCallback(async () => {
    setRefreshing(true);
    setFeedError('');
    try {
      const [bcciLive, wt20, ipl] = await Promise.all([
        fetch('/api/bcci/live', { cache: 'no-store' }).then((r) => r.json()).catch((error) => ({ liveMatches: [], unavailable: true, error: error.message })),
        fetch('/api/wt20/schedule?series_ids=12672&game_count=8', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ data: { matches: [] } })),
        fetch('/api/ipl/2026/all-matches', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ matches: [] })),
      ]);

      const bcci = pickArray(bcciLive, ['liveMatches'])
        .filter(isSeniorMenBcci)
        .map((row) => normalizeBcciMatch(row, 'live'))
        .filter((match) => match.status === 'live');
      const wt20Matches = pickArray(wt20?.data || wt20, ['matches'])
        .map(normalizeWt20Match)
        .filter((match) => match.status === 'live');
      const iplRows = pickArray(ipl, ['matches', 'Matchsummary', 'MatchSummary'])
        .map(normalizeIplMatch)
        .filter((match) => match.id && match.status === 'live');

      setMatches([...bcci, ...wt20Matches, ...iplRows]);
      if (bcciLive?.upstreamUnavailable || bcciLive?.unavailable) setFeedError(bcciLive.error || 'BCCI live feed is unavailable right now.');
    } catch (err) {
      setFeedError(err.message || 'Sports feeds unavailable');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadSports();
    const timer = window.setInterval(loadSports, 60000);
    return () => window.clearInterval(timer);
  }, [loadSports]);

  const liveMatches = useMemo(() => matches.filter((m) => m.status === 'live'), [matches]);

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#070709] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(245,158,11,0.15),transparent_65%)]" />
      <header className="relative z-10 border-b border-white/5 bg-[#070709]/85 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300">← Home</Link>
          <div className="flex flex-col items-center gap-1"><BrandLogo size="compact" /><p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Live Sports</p></div>
          <button type="button" onClick={loadSports} className="rounded-full border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">{refreshing ? 'Sync…' : 'Refresh'}</button>
        </div>
      </header>

      <section className="relative z-10 mx-auto max-w-6xl space-y-8 px-4 py-5 pb-24">
        <div>
          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.3em] text-gray-600">FanCode · Willow</p>
          <h1 className="text-3xl font-black uppercase italic leading-none tracking-tighter sm:text-5xl">Live <span className="text-amber-400">Sports</span></h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{channels.slice(0, 8).map((channel) => <ChannelCard key={channel.id} ch={channel} active={active?.id === channel.id} onClick={selectChannel} />)}</div>
            {active ? <StreamPlayer channel={active} switching={switching} playerRef={playerRef} /> : null}
          </div>
          <aside className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
            {feedError ? <p className="mb-3 rounded-2xl border border-yellow-400/20 bg-yellow-500/10 p-3 text-[10px] leading-5 text-yellow-100">{feedError}</p> : null}
            <div className="space-y-2">{liveMatches.map((match, index) => <MatchCard key={`${match.provider}-${match.id}-${index}`} match={match} />)}{!liveMatches.length ? <div className="rounded-2xl border border-white/10 bg-black/25 p-5 text-center text-xs text-gray-500">No live match right now.</div> : null}</div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function EmptyHighlights() {
  return <div className="min-w-full rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center text-sm text-zinc-500">No highlights loaded right now.</div>;
}
