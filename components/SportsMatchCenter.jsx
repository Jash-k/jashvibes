'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import MatchWatchLive from '@/components/MatchWatchLive';

function pick(obj, keys, fallback = '') {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function decodeMatchHash(hash = '') {
  try {
    const padded = String(hash).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(hash.length / 4) * 4, '=');
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch {
    try { return JSON.parse(atob(hash)); } catch { return null; }
  }
}

function normalizePayload(payload = {}) {
  if (payload?.payload) return payload.payload;
  if (payload?.type) return payload;
  if (payload?.data?.type) return payload.data;
  return payload || {};
}

function teamShort(name = '') {
  const value = String(name || '').trim();
  if (!value) return 'TBD';
  const common = {
    India: 'IND', Australia: 'AUS', England: 'ENG', Pakistan: 'PAK', 'South Africa': 'SA',
    'New Zealand': 'NZ', 'Sri Lanka': 'SL', Bangladesh: 'BAN', Afghanistan: 'AFG',
    'West Indies': 'WI', Zimbabwe: 'ZIM', Ireland: 'IRE', Nepal: 'NEP', Scotland: 'SCO',
  };
  return common[value] || value.split(/\s+/).map((part) => part[0]).join('').slice(0, 4).toUpperCase();
}

function teamScore(match = {}, side = 'home') {
  if (side === 'home') {
    return pick(match, ['HomeTeamScore', 'HomeTeamSummary', 'FirstBattingSummary', '1Summary', 'Innings1Summary', 'Team1Score', 'score1'], '');
  }
  return pick(match, ['AwayTeamScore', 'AwayTeamSummary', 'SecondBattingSummary', '2Summary', 'Innings2Summary', 'Team2Score', 'score2'], '');
}

function matchStatusFrom(summary = {}, fallback = {}) {
  const raw = summary?.data || summary;
  const md = raw?.Matchdetail || raw?.MatchDetails || raw?.matchDetail || raw?.match || raw;
  const text = String(pick(md, ['MatchStatus', 'matchStatus', 'Status', 'Comments', 'Result', 'ResultText'], pick(fallback, ['MatchStatus', 'status'], ''))).toLowerCase();
  const hasResult = Boolean(pick(md, ['WinningTeamID', 'WinningTeamId', 'WinningTeam', 'Result', 'Comments'], ''));
  if (/live|progress|innings|break/.test(text)) return 'live';
  if (/result|post|complete|ended|won|beat/.test(text) || hasResult) return 'completed';
  return 'upcoming';
}

function encodeQuery(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') q.set(key, String(value));
  });
  return q.toString();
}

function playerNameFromTeams(id, teams = {}) {
  if (!id) return '';
  for (const team of Object.values(teams || {})) {
    const players = team?.Players || team?.players || {};
    const player = players?.[id] || Object.values(players).find((p) => String(p?.Id || p?.Player_Id || p?.player_id) === String(id));
    if (player) return pick(player, ['Name_Full', 'Name', 'Player_Name', 'FullName', 'Display_Name'], String(id));
  }
  return String(id);
}

function resolveBatterName(row = {}, teams = {}) {
  return pick(row, ['BatterName', 'BatsManName', 'BatsmanName', 'PlayerName', 'Name', 'StrikerName'], '')
    || playerNameFromTeams(row.Batsman || row.Player_Id || row.PlayerID, teams)
    || 'Batter';
}

function resolveBowlerName(row = {}, teams = {}) {
  return pick(row, ['BowlerName', 'Bowler', 'PlayerName', 'Name'], '')
    || playerNameFromTeams(row.Bowler || row.Player_Id || row.PlayerID, teams)
    || 'Bowler';
}

function inningsArray(payload = {}) {
  return asArray(payload?.innings || payload?.Innings || payload?.data?.innings || payload?.data?.Innings);
}

// One-line score for a team, taken from the scorecard's own innings so the
// header always reflects THIS match — e.g. "158/6 (20 ov)".
function inningsScoreLine(innings = [], teamId = '') {
  if (!teamId) return '';
  const owned = innings.filter((inn) => String(
    inn.Battingteam || inn.BattingTeam || inn.battingteam || inn.teamId || '',
  ) === String(teamId));
  const inn = owned[owned.length - 1];
  if (!inn) return '';
  const total = pick(inn, ['Total', 'Runs', 'TotalRuns'], '');
  if (total === '') return '';
  const wickets = pick(inn, ['Wickets', 'Wkts'], '');
  const overs = pick(inn, ['Overs', 'Ov'], '');
  return `${total}${wickets !== '' ? `/${wickets}` : ''}${overs !== '' ? ` (${overs} ov)` : ''}`;
}

function battingRows(inn = {}) {
  return asArray(inn.BattingCard || inn.Batsmen || inn.batsmen || inn.batting || inn.Batting);
}

function bowlingRows(inn = {}) {
  return asArray(inn.BowlingCard || inn.Bowlers || inn.bowlers || inn.bowling || inn.Bowling);
}

function extrasText(inn = {}) {
  const extras = inn.Extras;
  if (Array.isArray(extras)) {
    const total = extras.reduce((sum, item) => sum + Number(pick(item, ['Runs', 'Total', 'Value'], 0) || 0), 0);
    return total ? String(total) : extras.map((item) => Object.values(item).join(' ')).join(', ');
  }
  if (extras && typeof extras === 'object') return Object.entries(extras).map(([key, value]) => `${key}: ${value}`).join(' · ');
  return extras || pick(inn, ['ExtrasTotal', 'Extras'], '-');
}

function inningsTitle(inn = {}, index = 0, teams = {}) {
  const teamId = inn.Battingteam || inn.BattingTeam || inn.BattingTeamID;
  const team = teams?.[teamId];
  const teamName = pick(team, ['Name_Full', 'Name', 'Team_Name', 'ShortName'], '') || pick(inn, ['BattingTeamName', 'TeamName', 'Name'], '');
  return `${teamName || `Innings ${inn.number || inn.Number || index + 1}`} ${pick(inn, ['Total', 'Runs'], '')}${pick(inn, ['Wickets'], '') !== '' ? `/${pick(inn, ['Wickets'], '')}` : ''}${pick(inn, ['Overs'], '') ? ` (${pick(inn, ['Overs'], '')} ov)` : ''}`;
}

function StatusPill({ status }) {
  const style = status === 'live'
    ? 'border-red-400/35 bg-red-500/15 text-red-200'
    : status === 'completed'
      ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-200'
      : 'border-amber-400/35 bg-amber-500/15 text-amber-100';
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${style}`}>{status}</span>;
}

function Hero({ provider, title, subtitle, status, scoreA, scoreB, meta }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] shadow-2xl shadow-black/40">
      <div className="relative p-5 sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.18),transparent_45%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.14),transparent_40%)]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">{provider}</span>
              <StatusPill status={status} />
            </div>
            <h1 className="text-2xl font-black uppercase italic leading-none tracking-tight text-white sm:text-4xl">{title}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">{subtitle}</p>
          </div>
          <div className="grid min-w-[260px] gap-2 rounded-2xl border border-white/10 bg-black/35 p-4">
            <div className="flex items-center justify-between gap-4"><span className="text-sm font-black text-white">{scoreA?.team || 'Team A'}</span><span className="font-mono text-sm text-amber-100">{scoreA?.score || '-'}</span></div>
            <div className="flex items-center justify-between gap-4"><span className="text-sm font-black text-white">{scoreB?.team || 'Team B'}</span><span className="font-mono text-sm text-amber-100">{scoreB?.score || '-'}</span></div>
          </div>
        </div>
        {meta?.length ? (
          <div className="relative z-10 mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {meta.map((item) => <div key={item.label} className="rounded-2xl border border-white/10 bg-black/25 p-3"><p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">{item.label}</p><p className="mt-1 truncate text-xs font-bold text-zinc-200">{item.value || '-'}</p></div>)}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/30 p-2">
      {tabs.map((tab) => (
        <button key={tab} type="button" onClick={() => onChange(tab)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black uppercase tracking-[0.12em] transition ${active === tab ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:bg-white/10 hover:text-white'}`}>{tab}</button>
      ))}
    </div>
  );
}

function OverviewGrid({ items }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{item.label}</p><p className="mt-2 text-sm font-bold text-white">{item.value || '-'}</p></div>)}
    </div>
  );
}

function ScorecardTable({ innings, teams }) {
  const rows = battingRows(innings);
  if (!rows.length) return <EmptyPanel text="Batting card not available yet." />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <tr><th className="px-4 py-3">Batter</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row, index) => (
            <tr key={index} className="text-zinc-200">
              <td className="px-4 py-3 font-bold text-white">{resolveBatterName(row, teams)}</td>
              <td className="max-w-[240px] truncate pr-3 text-xs text-zinc-500">{pick(row, ['Dismissal', 'Howout', 'HowOut', 'OutDesc', 'WicketText', 'Howout_short'], 'not out')}</td>
              <td className="font-mono">{pick(row, ['Runs', 'R'], '0')}</td>
              <td className="font-mono">{pick(row, ['Balls', 'B'], '0')}</td>
              <td className="font-mono">{pick(row, ['Fours', '4s', 'F'], '0')}</td>
              <td className="font-mono">{pick(row, ['Sixes', '6s', 'S'], '0')}</td>
              <td className="font-mono">{pick(row, ['StrikeRate', 'Strikerate', 'SR'], '-')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-white/10 px-4 py-3 text-xs font-bold text-zinc-400">Extras: {extrasText(innings)}</div>
    </div>
  );
}

function BowlingTable({ innings, teams }) {
  const rows = bowlingRows(innings);
  if (!rows.length) return <EmptyPanel text="Bowling card not available yet." />;
  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/30">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-white/[0.04] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          <tr><th className="px-4 py-3">Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rows.map((row, index) => (
            <tr key={index} className="text-zinc-200">
              <td className="px-4 py-3 font-bold text-white">{resolveBowlerName(row, teams)}</td>
              <td className="font-mono">{pick(row, ['Overs', 'OversBowled', 'O'], '-')}</td>
              <td className="font-mono">{pick(row, ['Maidens', 'M'], '0')}</td>
              <td className="font-mono">{pick(row, ['Runs', 'RunsConceded', 'R'], '0')}</td>
              <td className="font-mono">{pick(row, ['Wickets', 'W'], '0')}</td>
              <td className="font-mono">{pick(row, ['Economy', 'Econ'], '-')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InningsPicker({ innings, active, setActive, teams }) {
  if (!innings.length) return null;
  return (
    <div className="mb-4 flex gap-2 overflow-x-auto">
      {innings.map((inn, index) => {
        const num = Number(inn.number || inn.Number || index + 1);
        return <button key={num} type="button" onClick={() => setActive(num)} className={`rounded-xl border px-3 py-2 text-xs font-black ${active === num ? 'border-amber-400 bg-amber-500 text-black' : 'border-white/10 bg-white/[0.03] text-zinc-400'}`}>{inningsTitle(inn, index, teams)}</button>;
      })}
    </div>
  );
}

function EmptyPanel({ text = 'No data available.' }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center text-sm text-zinc-500">{text}</div>;
}

function BallChip({ ball }) {
  const wicket = String(ball.IsWicket) === '1';
  const six = String(ball.IsSix) === '1';
  const four = String(ball.IsFour) === '1';
  const wide = String(ball.IsWide) === '1';
  const noBall = String(ball.IsNoBall) === '1';
  const label = wicket ? 'W' : wide ? 'WD' : noBall ? 'NB' : six ? '6' : four ? '4' : String(ball.Runs || ball.BallRuns || ball.ActualRuns || '0');
  const cls = wicket ? 'bg-red-500 text-white' : six ? 'bg-purple-500 text-white' : four ? 'bg-emerald-500 text-black' : wide || noBall ? 'bg-amber-500 text-black' : label === '0' ? 'bg-zinc-800 text-zinc-400' : 'bg-blue-500 text-white';
  return <span className={`grid h-8 w-8 place-items-center rounded-full text-[10px] font-black ${cls}`} title={ball.Commentry || ball.NewCommentry || ''}>{label}</span>;
}

function BallByBall({ providerType, matchId, activeInning }) {
  const [state, setState] = useState({ status: 'idle', overs: [], error: '' });
  useEffect(() => {
    if (!matchId || !activeInning || providerType === 'wt20') return;
    let cancelled = false;
    async function load() {
      try {
        setState((cur) => ({ ...cur, status: 'loading', error: '' }));
        const res = await fetch(`/api/cricket/balls?${encodeQuery({ type: providerType, id: matchId, inning: activeInning })}`, { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Ball feed failed');
        if (!cancelled) setState({ status: 'ready', overs: data.overs || [], error: '' });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', overs: [], error: error.message });
      }
    }
    load();
    return () => { cancelled = true; };
  }, [providerType, matchId, activeInning]);

  if (providerType === 'wt20') return <EmptyPanel text="ICC commentary endpoint exists but is not enabled in this Match Center yet." />;
  if (state.status === 'loading') return <EmptyPanel text="Loading ball-by-ball…" />;
  if (state.error) return <EmptyPanel text={state.error} />;
  if (!state.overs.length) return <EmptyPanel text="Ball-by-ball is not available yet." />;
  return (
    <div className="space-y-3">
      {state.overs.map((over) => (
        <div key={over.overNo} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><p className="text-xs font-black uppercase tracking-[0.16em] text-white">Over {over.overNo}</p><p className="text-xs font-bold text-zinc-400">{over.runs} runs · {over.wickets} wk · {over.scoreAfter}</p></div>
          <div className="flex flex-wrap gap-2">{(over.balls || []).map((ball, index) => <BallChip key={index} ball={ball} />)}</div>
        </div>
      ))}
    </div>
  );
}

function SharedBcciIplCenter({ payload, providerType }) {
  const matchData = payload.matchData || {};
  const matchId = String(payload.matchId || matchData.MatchID || matchData.MatchId || matchData.id || '').trim();
  const [summary, setSummary] = useState(null);
  const [inningsPayload, setInningsPayload] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Overview');
  const [activeInning, setActiveInning] = useState(1);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    async function load() {
      try {
        setError('');
        const summaryUrl = providerType === 'ipl'
          ? `/api/match/${encodeURIComponent(matchId)}/summary`
          : `/api/bcci/match?${encodeQuery({ competitionID: matchData.CompetitionID || matchData.CompetitionId, matchID: matchId, matchOrder: matchData.MatchOrder, seriesName: matchData.CompetitionName || matchData.SeriesName })}`;
        const inningsUrl = `/api/cricket/innings?${encodeQuery({ type: providerType, id: matchId, test: /test/i.test(matchData.MatchType || matchData.MatchTypeName || '') ? 1 : '' })}`;
        const [summaryRes, inningsRes] = await Promise.allSettled([
          fetch(summaryUrl, { cache: 'no-store' }).then((r) => r.json()),
          fetch(inningsUrl, { cache: 'no-store' }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setSummary(summaryRes.status === 'fulfilled' ? summaryRes.value : null);
        setInningsPayload(inningsRes.status === 'fulfilled' ? inningsRes.value : { innings: [] });
        const inn = inningsArray(inningsRes.status === 'fulfilled' ? inningsRes.value : {});
        if (inn.length) setActiveInning(Number(inn[0].number || inn[0].Number || 1));
        setStatus('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Match center failed'); setStatus('error'); }
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [matchId, providerType]);

  const rawSummary = summary?.data || summary?.MatchSummary || summary?.Matchsummary || summary || {};
  const statusValue = matchStatusFrom(rawSummary, matchData);
  const innings = inningsArray(inningsPayload);
  const activeInn = innings.find((inn, index) => Number(inn.number || inn.Number || index + 1) === activeInning) || innings[0] || {};
  const home = pick(matchData, ['HomeTeamName', 'Team1Name', 'team1', 'home'], pick(rawSummary, ['HomeTeamName', 'Team1Name'], 'Team A'));
  const away = pick(matchData, ['AwayTeamName', 'Team2Name', 'team2', 'away'], pick(rawSummary, ['AwayTeamName', 'Team2Name'], 'Team B'));

  const tabs = providerType === 'bcci' ? ['Overview', 'Scorecard', 'Bowling', 'Ball by Ball', 'Squads', 'Summary'] : ['Overview', 'Scorecard', 'Bowling', 'Ball by Ball'];
  const overview = [
    { label: 'Competition', value: pick(matchData, ['CompetitionName', 'SeriesName'], pick(rawSummary, ['CompetitionName', 'SeriesName'])) },
    { label: 'Venue', value: pick(matchData, ['GroundName', 'VenueName', 'Venue'], pick(rawSummary, ['GroundName', 'VenueName', 'Venue'])) },
    { label: 'Match', value: pick(matchData, ['MatchOrder', 'MatchName', 'MatchNo'], pick(rawSummary, ['MatchOrder', 'MatchName', 'MatchNo'])) },
    { label: 'Date', value: pick(matchData, ['MatchDate', 'MatchDateNew'], pick(rawSummary, ['MatchDate', 'MatchDateNew'])) },
    { label: 'Toss', value: pick(rawSummary, ['TossDetails', 'Toss', 'TossText']) },
    { label: 'Result', value: pick(rawSummary, ['Comments', 'Result', 'MatchResult', 'ResultText']) },
  ];

  return (
    <div className="space-y-5">
      <Hero
        provider={providerType === 'bcci' ? 'BCCI' : 'IPL'}
        title={`${teamShort(home)} vs ${teamShort(away)}`}
        subtitle={`${home} vs ${away}`}
        status={statusValue}
        scoreA={{ team: home, score: teamScore(rawSummary, 'home') || teamScore(matchData, 'home') }}
        scoreB={{ team: away, score: teamScore(rawSummary, 'away') || teamScore(matchData, 'away') }}
        meta={overview.slice(0, 4)}
      />
      <MatchWatchLive isLive={statusValue === 'live'} />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {status === 'loading' ? <EmptyPanel text="Loading match center…" /> : null}
      {error ? <EmptyPanel text={error} /> : null}
      {tab === 'Overview' ? <OverviewGrid items={overview} /> : null}
      {['Scorecard', 'Bowling', 'Ball by Ball'].includes(tab) ? <InningsPicker innings={innings} active={activeInning} setActive={setActiveInning} teams={{}} /> : null}
      {tab === 'Scorecard' ? <ScorecardTable innings={activeInn} teams={{}} /> : null}
      {tab === 'Bowling' ? <BowlingTable innings={activeInn} teams={{}} /> : null}
      {tab === 'Ball by Ball' ? <BallByBall providerType={providerType} matchId={matchId} activeInning={activeInning} /> : null}
      {tab === 'Squads' ? <BcciExtra endpoint="squad" matchId={matchId} /> : null}
      {tab === 'Summary' ? <BcciExtra endpoint="matchsummary" matchId={matchId} /> : null}
    </div>
  );
}

function BcciExtra({ endpoint, matchId }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bcci/${endpoint}?matchID=${encodeURIComponent(matchId)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setState({ status: 'ready', data, error: '' }); })
      .catch((error) => { if (!cancelled) setState({ status: 'error', data: null, error: error.message }); });
    return () => { cancelled = true; };
  }, [endpoint, matchId]);
  if (state.status === 'loading') return <EmptyPanel text="Loading…" />;
  if (state.error) return <EmptyPanel text={state.error} />;
  return <pre className="max-h-[520px] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-4 text-xs leading-6 text-zinc-300">{JSON.stringify(state.data, null, 2)}</pre>;
}

function Wt20MatchCenter({ payload }) {
  const matchData = payload.matchData || {};
  const matchId = String(payload.matchId || matchData.match_id || matchData.MatchID || '').trim();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [activeInning, setActiveInning] = useState(1);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/wt20/scorecard?game_id=${encodeURIComponent(matchId)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'ICC scorecard failed');
        if (!cancelled) {
          const inner = json.data || json;
          setData(inner);
          const inn = inningsArray(inner);
          if (inn.length) setActiveInning(Number(inn[0].Number || inn[0].number || 1));
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'ICC scorecard failed');
      }
    }
    load();
    const timer = window.setInterval(load, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [matchId]);

  const md = data?.Matchdetail || {};
  const teams = data?.Teams || {};
  const innings = inningsArray(data || {});
  const activeInn = innings.find((inn, index) => Number(inn.Number || inn.number || index + 1) === activeInning) || innings[0] || {};
  const homeTeam = teams?.[md?.Team_Home] || {};
  const awayTeam = teams?.[md?.Team_Away] || {};
  const home = pick(matchData, ['teama', 'home'], pick(homeTeam, ['Name_Full', 'Name', 'Team_Name'], 'Team A'));
  const away = pick(matchData, ['teamb', 'away'], pick(awayTeam, ['Name_Full', 'Name', 'Team_Name'], 'Team B'));
  // Canonical state from the scorecard itself, not from the listing payload:
  // live only when the feed marks it live, completed when it carries a result.
  const resultText = String(md?.Result?.Text || md?.Equation || matchData.match_result || '').trim();
  const isLive = md?.Match?.Live === true || md?.Match?.live === true || matchData.live === true || matchData.Live === true;
  const status = isLive
    ? 'live'
    : (resultText || innings.some((inn) => pick(inn, ['Total', 'Runs'], ''))) ? 'completed' : 'upcoming';
  // Hero scores come from this match's innings (backend-canonical), with the
  // schedule payload's scores as fallback while the card is still upcoming.
  const homeScore = inningsScoreLine(innings, md?.Team_Home)
    || matchData.teama_score || matchData.score1 || '';
  const awayScore = inningsScoreLine(innings, md?.Team_Away)
    || matchData.teamb_score || matchData.score2 || '';
  const overview = [
    { label: 'Series', value: md?.Series?.Name || matchData.series_name },
    { label: 'Venue', value: md?.Venue?.Name || matchData.venue_name },
    { label: 'Match', value: md?.Match?.Number || matchData.match_number },
    { label: 'Date', value: md?.Match?.Date || matchData.match_date_ist },
    { label: 'Toss', value: md?.Tosswonby || md?.Toss?.Text || md?.Toss },
    { label: 'Result', value: md?.Result?.Text || matchData.match_result || md?.Equation },
  ];

  return (
    <div className="space-y-5">
      <Hero provider="ICC WT20" title={`${teamShort(home)} vs ${teamShort(away)}`} subtitle={resultText || `${home} vs ${away}`} status={status} scoreA={{ team: home, score: homeScore }} scoreB={{ team: away, score: awayScore }} meta={overview.slice(0, 4)} />
      <MatchWatchLive isLive={status === 'live'} />
      <TabBar tabs={['Overview', 'Scorecard', 'Bowling']} active={tab} onChange={setTab} />
      {error ? <EmptyPanel text={error} /> : null}
      {!data && !error ? <EmptyPanel text="Loading ICC scorecard…" /> : null}
      {tab === 'Overview' ? <OverviewGrid items={overview} /> : null}
      {['Scorecard', 'Bowling'].includes(tab) ? <InningsPicker innings={innings} active={activeInning} setActive={setActiveInning} teams={teams} /> : null}
      {tab === 'Scorecard' ? <ScorecardTable innings={activeInn} teams={teams} /> : null}
      {tab === 'Bowling' ? <BowlingTable innings={activeInn} teams={teams} /> : null}
    </div>
  );
}

function FanCodeMatchCenter({ payload }) {
  const match = payload.matchData || payload;
  return (
    <div className="space-y-5">
      <Hero provider="FanCode" title={match.title || 'FanCode Match'} subtitle={match.tournament || 'Live FanCode event'} status={String(match.status || '').toLowerCase() === 'live' ? 'live' : 'upcoming'} scoreA={{ team: match.team_1 || 'Team A' }} scoreB={{ team: match.team_2 || 'Team B' }} meta={[{ label: 'Category', value: match.category }, { label: 'Tournament', value: match.tournament }, { label: 'Status', value: match.status }]} />
      <EmptyPanel text="FanCode scorecard support is wired as a Match Center type. Detailed score fields depend on the FanCode feed payload for that event." />
    </div>
  );
}

export default function SportsMatchCenter({ hash = '', initialPayload = null, slug = '' }) {
  const [resolvedPayload, setResolvedPayload] = useState(initialPayload || (hash ? decodeMatchHash(hash) : null));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!slug || resolvedPayload) return;
    let cancelled = false;
    fetch(`/api/match-resolve?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const payload = normalizePayload(data.payload || data.match || data);
        if (payload?.type) setResolvedPayload(payload);
        else setError(data.error || 'Unable to resolve match URL');
      })
      .catch((err) => { if (!cancelled) setError(err.message || 'Unable to resolve match URL'); });
    return () => { cancelled = true; };
  }, [slug, resolvedPayload]);

  const payload = normalizePayload(resolvedPayload || {});
  const type = String(payload.type || '').toLowerCase();

  return (
    <main className="min-h-screen bg-[#070709] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(245,158,11,0.12),transparent_65%)]" />
      <header className="relative z-10 border-b border-white/10 bg-black/50 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/sports" className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-zinc-300 hover:border-amber-400 hover:text-white">← Sports</Link>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Match Center</p>
          <Link href="/" className="rounded-full border border-white/10 px-4 py-2 text-xs font-bold text-zinc-500 hover:text-white">Home</Link>
        </div>
      </header>
      <section className="relative z-10 mx-auto max-w-6xl px-4 py-6 pb-24">
        {error ? <EmptyPanel text={error} /> : null}
        {!payload?.type && !error ? <EmptyPanel text="Loading match center…" /> : null}
        {type === 'bcci' ? <SharedBcciIplCenter payload={payload} providerType="bcci" /> : null}
        {type === 'ipl' ? <SharedBcciIplCenter payload={payload} providerType="ipl" /> : null}
        {type === 'wt20' || type === 'icc' ? <Wt20MatchCenter payload={payload} /> : null}
        {type === 'fancode' ? <FanCodeMatchCenter payload={payload} /> : null}
        {payload?.type && !['bcci', 'ipl', 'wt20', 'icc', 'fancode'].includes(type) ? <EmptyPanel text={`Unsupported match type: ${payload.type}`} /> : null}
      </section>
    </main>
  );
}

export { decodeMatchHash };
