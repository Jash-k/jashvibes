'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { bestFancodeVariant, playerUrlFromHls } from '@/lib/sportsFeed';

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
  if (!hash) return null;
  const raw = Array.isArray(hash) ? hash.join('/') : String(hash);
  try {
    let clean = decodeURIComponent(raw.trim());
    const padded = clean.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(clean.length / 4) * 4, '=');
    if (typeof Buffer !== 'undefined') {
      return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    }
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    try {
      let clean = decodeURIComponent(raw.trim());
      const padded = clean.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(clean.length / 4) * 4, '=');
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch {
      try { return JSON.parse(atob(decodeURIComponent(raw))); } catch { return null; }
    }
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
    Netherlands: 'NED',
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

function resolvePlayer(id, teams = {}, preferredTeamId = '') {
  if (!id) return null;
  const idStr = String(id).trim();
  if (preferredTeamId && teams[preferredTeamId]?.Players?.[idStr]) {
    return teams[preferredTeamId].Players[idStr];
  }
  for (const team of Object.values(teams || {})) {
    const players = team?.Players || team?.players || {};
    if (players[idStr]) return players[idStr];
    for (const p of Object.values(players)) {
      if (String(p?.Id || p?.Player_Id || p?.player_id || p?.PlayerId) === idStr) return p;
    }
  }
  return null;
}

function resolvePlayerName(id, teams = {}, preferredTeamId = '') {
  if (!id) return '';
  const player = resolvePlayer(id, teams, preferredTeamId);
  if (player) {
    const fullName = player.Name_Full || player.Name || player.FullName || player.Player_Name;
    const shortName = player.Name_Short || player.Display_Name;
    const name = fullName || shortName;
    if (name) {
      const suffix = player.Is_Captain && player.Is_Keeper ? ' (c & wk)' : player.Is_Captain ? ' (c)' : player.Is_Keeper ? ' (wk)' : '';
      return `${name}${suffix}`;
    }
  }
  return String(id);
}

function resolveBatterName(row = {}, teams = {}, inn = {}) {
  const direct = pick(row, ['BatterName', 'BatsManName', 'BatsmanName', 'PlayerName', 'Name', 'StrikerName'], '');
  if (direct && isNaN(Number(direct))) return direct;
  const id = row.Batsman || row.Player_Id || row.PlayerID || row.PlayerId;
  const name = resolvePlayerName(id, teams, inn.Battingteam || inn.BattingTeam);
  if (name && isNaN(Number(name))) return name;
  return direct || (id ? `#${id}` : 'Batter');
}

function resolveBowlerName(row = {}, teams = {}, inn = {}) {
  const direct = pick(row, ['BowlerName', 'PlayerName', 'Name'], '');
  if (direct && isNaN(Number(direct))) return direct;
  const id = row.Bowler || row.Player_Id || row.PlayerID || row.PlayerId;
  const name = resolvePlayerName(id, teams, inn.Bowlingteam || inn.BowlingTeam);
  if (name && isNaN(Number(name))) return name;
  return direct || (id ? `#${id}` : 'Bowler');
}

function inningsArray(payload = {}) {
  return asArray(payload?.innings || payload?.Innings || payload?.data?.innings || payload?.data?.Innings);
}

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

function StatusPill({ status }) {
  const isLive = String(status).toLowerCase() === 'live';
  const isCompleted = String(status).toLowerCase() === 'completed';
  const style = isLive
    ? 'border-red-400/40 bg-red-500/20 text-red-200 shadow-lg shadow-red-500/20'
    : isCompleted
      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
      : 'border-amber-400/40 bg-amber-500/20 text-amber-100';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${style}`}>
      {isLive ? <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-ping" /> : null}
      {status}
    </span>
  );
}

function Hero({ provider, title, subtitle, status, scoreA, scoreB, meta }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] shadow-2xl shadow-black/60 backdrop-blur">
      <div className="relative p-5 sm:p-7">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_50%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_45%)]" />
        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                {provider}
              </span>
              <StatusPill status={status} />
            </div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-white sm:text-4xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 text-sm font-semibold leading-relaxed text-amber-300/90 sm:text-base">
                {subtitle}
              </p>
            ) : null}
          </div>

          {(scoreA?.score || scoreB?.score) ? (
            <div className="grid min-w-[280px] gap-2.5 rounded-2xl border border-white/10 bg-black/50 p-4 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-black text-white">{scoreA?.team || 'Team 1'}</span>
                <span className="font-mono text-sm font-bold text-amber-300">{scoreA?.score || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-black text-white">{scoreB?.team || 'Team 2'}</span>
                <span className="font-mono text-sm font-bold text-amber-300">{scoreB?.score || '-'}</span>
              </div>
            </div>
          ) : null}
        </div>

        {meta?.length ? (
          <div className="relative z-10 mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {meta.map((item) => (
              <div key={item.label} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">{item.label}</p>
                <p className="mt-1 truncate text-xs font-bold text-zinc-200">{item.value || '-'}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-1.5">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`whitespace-nowrap rounded-xl px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] transition ${
            active === tab
              ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
              : 'text-zinc-400 hover:bg-white/10 hover:text-white'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function OverviewGrid({ items }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{item.label}</p>
          <p className="mt-2 text-sm font-bold text-white">{item.value || '-'}</p>
        </div>
      ))}
    </div>
  );
}

function ScorecardTable({ innings, teams }) {
  const allBatters = battingRows(innings);
  const battedRows = allBatters.filter((row) => row.Balls !== '' || row.Runs !== '' || row.Howout !== '' || row.Dismissal !== '');
  const didNotBatRows = allBatters.filter((row) => row.Balls === '' && row.Runs === '' && !row.Howout && !row.Dismissal);

  if (!battedRows.length) return <EmptyPanel text="Batting scorecard not available yet." />;

  const extrasSum = (Number(innings.Byes || 0) + Number(innings.Legbyes || 0) + Number(innings.Wides || 0) + Number(innings.Noballs || 0) + Number(innings.Penalty || 0)) || Number(innings.ExtrasTotal || 0);

  const extrasBreakdown = [
    innings.Byes ? `b ${innings.Byes}` : null,
    innings.Legbyes ? `lb ${innings.Legbyes}` : null,
    innings.Wides ? `w ${innings.Wides}` : null,
    innings.Noballs ? `nb ${innings.Noballs}` : null,
    innings.Penalty ? `p ${innings.Penalty}` : null,
  ].filter(Boolean).join(', ');

  const totalRuns = pick(innings, ['Total', 'Runs', 'TotalRuns'], '0');
  const totalWkts = pick(innings, ['Wickets', 'Wkts'], '0');
  const totalOvers = pick(innings, ['Overs', 'Ov'], '0');
  const runRate = pick(innings, ['Runrate', 'RunRate', 'runRate'], (Number(totalRuns) / Math.max(Number(totalOvers) || 1, 1)).toFixed(2));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 shadow-xl">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-white/10 bg-white/[0.04] text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
            <tr>
              <th className="px-4 py-3.5">Batter</th>
              <th className="px-3 py-3.5">Dismissal</th>
              <th className="px-3 py-3.5 text-right font-black">R</th>
              <th className="px-3 py-3.5 text-right">B</th>
              <th className="px-3 py-3.5 text-right">4s</th>
              <th className="px-3 py-3.5 text-right">6s</th>
              <th className="px-4 py-3.5 text-right">SR</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {battedRows.map((row, index) => {
              const name = resolveBatterName(row, teams, innings);
              const howout = pick(row, ['Howout', 'Dismissal', 'HowOut', 'OutDesc', 'WicketText', 'Howout_short'], 'not out');
              const isNotOut = /not out/i.test(howout);
              const runs = pick(row, ['Runs', 'R'], '0');
              const balls = pick(row, ['Balls', 'B'], '0');
              const fours = pick(row, ['Fours', '4s', 'F'], '0');
              const sixes = pick(row, ['Sixes', '6s', 'S'], '0');
              const sr = pick(row, ['StrikeRate', 'Strikerate', 'SR'], '-');

              return (
                <tr key={index} className="transition hover:bg-white/[0.02]">
                  <td className="px-4 py-3 font-bold text-white">
                    {name}
                  </td>
                  <td className={`px-3 py-3 text-xs leading-relaxed max-w-[280px] ${isNotOut ? 'font-bold text-emerald-400' : 'text-zinc-400'}`}>
                    {howout}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-black text-amber-300">
                    {runs}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-zinc-300">
                    {balls}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-zinc-300">
                    {fours}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-zinc-300">
                    {sixes}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-zinc-400">
                    {sr}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-white/10 bg-white/[0.03] text-xs font-bold text-zinc-300">
            <tr>
              <td colSpan={2} className="px-4 py-3.5 text-zinc-400 font-semibold">
                Extras: <span className="font-mono text-zinc-200">{extrasSum}</span> {extrasBreakdown ? <span className="text-zinc-500 font-normal">({extrasBreakdown})</span> : null}
              </td>
              <td colSpan={5} className="px-4 py-3.5 text-right">
                <span className="text-zinc-400 font-semibold">Total: </span>
                <span className="font-mono text-base font-black text-amber-300">{totalRuns}/{totalWkts}</span>
                <span className="text-zinc-400 font-normal ml-2">({totalOvers} Ov, RR: {runRate})</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Did Not Bat / Yet to Bat */}
      {didNotBatRows.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2.5">Yet to Bat</p>
          <div className="flex flex-wrap gap-2">
            {didNotBatRows.map((row, idx) => (
              <span key={idx} className="rounded-full border border-white/10 bg-black/40 px-3 py-1 text-xs font-semibold text-zinc-300">
                {resolveBatterName(row, teams, innings)}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Fall of Wickets */}
      {innings.FallofWickets && innings.FallofWickets.length ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500 mb-2.5">Fall of Wickets</p>
          <div className="flex flex-wrap gap-2">
            {innings.FallofWickets.map((fow, idx) => {
              const batterName = resolvePlayerName(fow.Batsman, teams, innings.Battingteam);
              return (
                <div key={idx} className="rounded-xl border border-white/5 bg-black/40 px-3 py-1.5 text-xs">
                  <span className="font-mono font-bold text-amber-400">{fow.Wicket_No}-{fow.Score}</span>
                  <span className="text-zinc-300 ml-1.5">({batterName}, {fow.Overs} ov)</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BowlingTable({ innings, teams }) {
  const allBowlers = bowlingRows(innings);
  const activeBowlers = allBowlers.filter((row) => Number(row.Balls_Bowled || row.Overs || 0) > 0 || Number(row.Runs || row.RunsConceded || 0) > 0);

  if (!activeBowlers.length) return <EmptyPanel text="Bowling scorecard not available yet." />;

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/40 shadow-xl">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-white/10 bg-white/[0.04] text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
          <tr>
            <th className="px-4 py-3.5">Bowler</th>
            <th className="px-3 py-3.5 text-right">O</th>
            <th className="px-3 py-3.5 text-right">M</th>
            <th className="px-3 py-3.5 text-right">R</th>
            <th className="px-3 py-3.5 text-right font-black text-amber-300">W</th>
            <th className="px-3 py-3.5 text-right">Econ</th>
            <th className="px-3 py-3.5 text-right">Dots</th>
            <th className="px-4 py-3.5 text-right">Wd/Nb</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {activeBowlers.map((row, index) => {
            const name = resolveBowlerName(row, teams, innings);
            const overs = pick(row, ['Overs', 'OversBowled', 'O'], '0');
            const maidens = pick(row, ['Maidens', 'M'], '0');
            const runs = pick(row, ['Runs', 'RunsConceded', 'R'], '0');
            const wickets = pick(row, ['Wickets', 'W'], '0');
            const econ = pick(row, ['Economyrate', 'Economy', 'Econ'], (Number(runs) / Math.max(Number(overs) || 1, 1)).toFixed(2));
            const dots = pick(row, ['Dots', 'DotBalls'], '-');
            const wides = pick(row, ['Wides', 'W'], '0');
            const noballs = pick(row, ['Noballs', 'NB'], '0');

            return (
              <tr key={index} className="transition hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-bold text-white">
                  {name}
                </td>
                <td className="px-3 py-3 text-right font-mono text-zinc-300">
                  {overs}
                </td>
                <td className="px-3 py-3 text-right font-mono text-zinc-400">
                  {maidens}
                </td>
                <td className="px-3 py-3 text-right font-mono text-zinc-300">
                  {runs}
                </td>
                <td className="px-3 py-3 text-right font-mono font-black text-amber-300">
                  {wickets}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-zinc-300">
                  {econ}
                </td>
                <td className="px-3 py-3 text-right font-mono text-xs text-zinc-500">
                  {dots}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-zinc-500">
                  {wides}/{noballs}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InningsPicker({ innings = [], activeIndex = 0, setActiveIndex, teams = {} }) {
  if (!innings.length) return null;

  return (
    <div className="flex flex-wrap gap-2.5 rounded-2xl border border-white/10 bg-black/40 p-1.5">
      {innings.map((inn, idx) => {
        const teamId = inn.Battingteam || inn.BattingTeam;
        const teamObj = teams[teamId];
        const teamName = teamObj?.Name_Full || teamObj?.Name || inn.BattingTeamName || `Innings ${idx + 1}`;
        const total = pick(inn, ['Total', 'Runs'], '');
        const wkts = pick(inn, ['Wickets', 'Wkts'], '');
        const overs = pick(inn, ['Overs', 'Ov'], '');
        const scoreText = total !== '' ? `${total}/${wkts !== '' ? wkts : '0'} (${overs} ov)` : '';
        const isSelected = activeIndex === idx;

        return (
          <button
            key={idx}
            type="button"
            onClick={() => setActiveIndex(idx)}
            className={`flex-1 min-w-[200px] flex items-center justify-between gap-3 px-4 py-3 rounded-xl font-bold text-xs transition ${
              isSelected
                ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/20'
                : 'bg-white/[0.03] text-zinc-400 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            <span className="uppercase tracking-wider">
              {idx === 0 ? '1st' : idx === 1 ? '2nd' : `${idx + 1}th`} Innings · {teamName}
            </span>
            {scoreText ? (
              <span className={`font-mono text-xs ${isSelected ? 'text-black font-black' : 'text-amber-400'}`}>
                {scoreText}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyPanel({ text = 'No data available.' }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 text-center text-sm text-zinc-500">{text}</div>;
}

function SharedBcciIplCenter({ payload, providerType }) {
  const matchData = payload.matchData || {};
  const matchId = String(payload.matchId || matchData.MatchID || matchData.MatchId || matchData.id || '').trim();
  const [summary, setSummary] = useState(null);
  const [inningsPayload, setInningsPayload] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Scorecard');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    async function load() {
      try {
        setError('');
        setActiveIndex(0);
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
        setStatus('ready');
      } catch (err) {
        if (!cancelled) { setError(err.message || 'Match center failed'); setStatus('error'); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [matchId, providerType, matchData.CompetitionID, matchData.CompetitionId, matchData.MatchOrder, matchData.CompetitionName, matchData.SeriesName, matchData.MatchType, matchData.MatchTypeName]);

  const rawSummary = summary?.data || summary?.MatchSummary || summary?.Matchsummary || summary || {};
  const statusValue = matchStatusFrom(rawSummary, matchData);
  const innings = inningsArray(inningsPayload);
  const activeInn = innings[activeIndex] || innings[0] || {};
  const home = pick(payload, ['homeName', 'teamA'], pick(matchData, ['HomeTeamName', 'Team1Name', 'team1', 'home'], pick(rawSummary, ['HomeTeamName', 'Team1Name'], 'Team A')));
  const away = pick(payload, ['awayName', 'teamB'], pick(matchData, ['AwayTeamName', 'Team2Name', 'team2', 'away'], pick(rawSummary, ['AwayTeamName', 'Team2Name'], 'Team B')));

  const tabs = ['Scorecard', 'Bowling', 'Overview'];
  const overview = [
    { label: 'Competition', value: pick(matchData, ['CompetitionName', 'SeriesName'], pick(rawSummary, ['CompetitionName', 'SeriesName'])) },
    { label: 'Venue', value: pick(matchData, ['GroundName', 'VenueName', 'Venue'], pick(rawSummary, ['GroundName', 'VenueName', 'Venue'])) },
    { label: 'Match', value: pick(matchData, ['MatchOrder', 'MatchName', 'MatchNo'], pick(rawSummary, ['MatchOrder', 'MatchName', 'MatchNo'])) },
    { label: 'Date', value: pick(matchData, ['MatchDate', 'MatchDateNew'], pick(rawSummary, ['MatchDate', 'MatchDateNew'])) },
    { label: 'Toss', value: pick(rawSummary, ['TossDetails', 'Toss', 'TossText']) },
    { label: 'Result', value: pick(rawSummary, ['Comments', 'Result', 'MatchResult', 'ResultText']) },
  ];

  return (
    <div className="space-y-6">
      <Hero
        provider={providerType === 'bcci' ? 'BCCI' : 'IPL'}
        title={`${teamShort(home)} vs ${teamShort(away)}`}
        subtitle={`${home} vs ${away}`}
        status={statusValue}
        scoreA={{ team: home, score: teamScore(rawSummary, 'home') || teamScore(matchData, 'home') }}
        scoreB={{ team: away, score: teamScore(rawSummary, 'away') || teamScore(matchData, 'away') }}
        meta={overview.slice(0, 4)}
      />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {status === 'loading' ? <EmptyPanel text="Loading match center…" /> : null}
      {error ? <EmptyPanel text={error} /> : null}
      {innings.length > 1 && ['Scorecard', 'Bowling'].includes(tab) ? (
        <InningsPicker innings={innings} activeIndex={activeIndex} setActiveIndex={setActiveIndex} teams={{}} />
      ) : null}
      {tab === 'Scorecard' ? <ScorecardTable innings={activeInn} teams={{}} /> : null}
      {tab === 'Bowling' ? <BowlingTable innings={activeInn} teams={{}} /> : null}
      {tab === 'Overview' ? <OverviewGrid items={overview} /> : null}
    </div>
  );
}

function Wt20MatchCenter({ payload }) {
  const matchId = String(payload.matchId || '').trim();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('Scorecard');
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError('');
        setActiveIndex(0);
        const res = await fetch(`/api/wt20/scorecard?game_id=${encodeURIComponent(matchId)}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || 'ICC scorecard failed');
        if (!cancelled) {
          const inner = json.data || json;
          setData(inner);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'ICC scorecard failed');
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [matchId]);

  const md = data?.Matchdetail || {};
  const teams = data?.Teams || {};
  const innings = inningsArray(data || {});
  const activeInn = innings[activeIndex] || innings[0] || {};
  const homeTeam = teams?.[md?.Team_Home] || {};
  const awayTeam = teams?.[md?.Team_Away] || {};
  const home = pick(homeTeam, ['Name_Full', 'Name', 'Team_Name'], payload.homeName || payload.homeCode || 'Team A');
  const away = pick(awayTeam, ['Name_Full', 'Name', 'Team_Name'], payload.awayName || payload.awayCode || 'Team B');

  const resultText = String(md?.Result?.Text || md?.Equation || payload.result || '').trim();
  const isLive = md?.Match?.Live === true || md?.Match?.live === true || payload.status === 'LIVE';
  const status = isLive
    ? 'live'
    : (resultText || innings.some((inn) => pick(inn, ['Total', 'Runs'], ''))) ? 'completed' : 'upcoming';

  const homeScore = inningsScoreLine(innings, md?.Team_Home) || payload.scoreA || '';
  const awayScore = inningsScoreLine(innings, md?.Team_Away) || payload.scoreB || '';

  const potmName = resolvePlayerName(md?.Player_Match, teams) || md?.Player_Match_Name || md?.Player_Match;

  const overview = [
    { label: 'Series', value: md?.Series?.Name || payload.leagueLabel },
    { label: 'Venue', value: md?.Venue?.Name || payload.venue },
    { label: 'Match', value: md?.Match?.Number || `Match ${payload.matchId}` },
    { label: 'Date', value: md?.Match?.Date || payload.startTime },
    { label: 'Toss', value: md?.Tosswonby ? `${teams?.[md.Tosswonby]?.Name_Full || md.Tosswonby} won the toss` : md?.Toss?.Text || md?.Toss },
    { label: 'Player of the Match', value: potmName },
    { label: 'Result', value: resultText },
    { label: 'Umpires', value: [md?.Officials?.Umpires, md?.Officials?.Referee].filter(Boolean).join(' · ') || md?.Umpires },
  ].filter((item) => item.value);

  const battingTeamName = teams[activeInn.Battingteam]?.Name_Full || activeInn.BattingTeamName || (activeIndex === 0 ? home : away);
  const bowlingTeamName = teams[activeInn.Bowlingteam]?.Name_Full || activeInn.BowlingTeamName || (activeIndex === 0 ? away : home);

  return (
    <div className="space-y-6">
      <Hero
        provider="ICC WT20"
        title={`${home} vs ${away}`}
        subtitle={resultText || `${home} vs ${away}`}
        status={status}
        scoreA={{ team: home, score: homeScore }}
        scoreB={{ team: away, score: awayScore }}
        meta={overview.slice(0, 4)}
      />

      <TabBar tabs={['Scorecard', 'Bowling', 'Full Match', 'Overview']} active={tab} onChange={setTab} />

      {loading ? <EmptyPanel text="Loading ICC scorecard…" /> : null}
      {error ? <EmptyPanel text={error} /> : null}

      {!loading && !error && (
        <>
          {innings.length > 1 && ['Scorecard', 'Bowling'].includes(tab) ? (
            <InningsPicker innings={innings} activeIndex={activeIndex} setActiveIndex={setActiveIndex} teams={teams} />
          ) : null}

          {tab === 'Scorecard' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black uppercase tracking-wider text-white">
                  {battingTeamName} Batting
                </h3>
                <span className="text-xs font-bold text-zinc-400">
                  {activeInn.Total}/{activeInn.Wickets} ({activeInn.Overs} ov)
                </span>
              </div>
              <ScorecardTable innings={activeInn} teams={teams} />
            </div>
          ) : null}

          {tab === 'Bowling' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-base font-black uppercase tracking-wider text-white">
                  {bowlingTeamName} Bowling
                </h3>
              </div>
              <BowlingTable innings={activeInn} teams={teams} />
            </div>
          ) : null}

          {tab === 'Full Match' ? (
            <div className="space-y-8">
              {innings.map((inn, idx) => {
                const bName = teams[inn.Battingteam]?.Name_Full || inn.BattingTeamName || `Team ${idx + 1}`;
                const bwName = teams[inn.Bowlingteam]?.Name_Full || inn.BowlingTeamName || `Team ${idx === 0 ? 2 : 1}`;
                return (
                  <div key={idx} className="space-y-5 rounded-3xl border border-white/10 bg-white/[0.02] p-5">
                    <div className="flex items-center justify-between border-b border-white/10 pb-3">
                      <h3 className="text-lg font-black uppercase tracking-wider text-amber-400">
                        {idx === 0 ? '1st' : '2nd'} Innings · {bName}
                      </h3>
                      <span className="font-mono text-sm font-black text-white">
                        {inn.Total}/{inn.Wickets} ({inn.Overs} ov)
                      </span>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-black uppercase tracking-wider text-zinc-400">{bName} Batting</p>
                      <ScorecardTable innings={inn} teams={teams} />
                    </div>

                    <div className="space-y-2 pt-3">
                      <p className="text-xs font-black uppercase tracking-wider text-zinc-400">{bwName} Bowling</p>
                      <BowlingTable innings={inn} teams={teams} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {tab === 'Overview' ? <OverviewGrid items={overview} /> : null}
        </>
      )}
    </div>
  );
}

function FanCodeMatchCenter({ payload }) {
  const match = payload.matchData || payload;
  const teamA = payload.teamA || match.team?.[0]?.name || match.team_1 || match.title?.split(' Vs ')?.[0] || 'Team 1';
  const teamB = payload.teamB || match.team?.[1]?.name || match.team_2 || match.title?.split(' Vs ')?.[1] || 'Team 2';
  const isLive = String(payload.status || match.status || '').toUpperCase() === 'LIVE';
  const rawStream = payload.stream || (match.auto_streams?.[0]?.auto && bestFancodeVariant(match.auto_streams[0].auto)) || match.STREAMING_CDN?.Primary_Playback_URL || '';
  const playerUrl = rawStream ? playerUrlFromHls(rawStream, payload.title || match.title || 'FanCode') : '';

  const meta = [
    { label: 'Tournament', value: payload.tournament || match.tournament },
    { label: 'Category', value: payload.category || match.category || 'Sports' },
    { label: 'Start Time', value: payload.startTime || match.startTime || match.startDate },
    { label: 'Status', value: isLive ? 'LIVE' : (payload.status || match.status || 'UPCOMING') },
  ].filter((item) => item.value);

  return (
    <div className="space-y-6">
      <Hero
        provider="FanCode"
        title={payload.title || match.title || `${teamA} vs ${teamB}`}
        subtitle={payload.tournament || match.tournament || 'FanCode Live Stream'}
        status={isLive ? 'live' : String(payload.status || match.status || '').toLowerCase() === 'completed' ? 'completed' : 'upcoming'}
        scoreA={{ team: teamA, score: payload.codeA || match.team?.[0]?.shortName || '' }}
        scoreB={{ team: teamB, score: payload.codeB || match.team?.[1]?.shortName || '' }}
        meta={meta.slice(0, 4)}
      />

      {playerUrl ? (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
              <span className="text-xs font-black uppercase tracking-wider text-red-400">Live Stream Broadcast</span>
            </div>
            <a
              href={playerUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] font-bold text-zinc-300 transition hover:bg-white/10 hover:text-white"
            >
              Open in Popout ↗
            </a>
          </div>
          <div className="relative aspect-video w-full bg-black">
            <iframe
              src={playerUrl}
              className="h-full w-full border-0"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              scrolling="no"
            />
          </div>
        </div>
      ) : null}

      <OverviewGrid items={meta} />
    </div>
  );
}

export default function SportsMatchCenter({ hash = '', initialPayload = null, slug = '' }) {
  const [resolvedPayload, setResolvedPayload] = useState(() => {
    if (initialPayload) return initialPayload;
    if (hash) return decodeMatchHash(hash);
    return null;
  });
  const [loading, setLoading] = useState(!resolvedPayload);
  const [error, setError] = useState('');

  // 1. Direct Hash decoding
  useEffect(() => {
    if (hash) {
      setLoading(true);
      setError('');
      const decoded = decodeMatchHash(hash);
      if (decoded && (decoded.matchId || decoded.type)) {
        setResolvedPayload(decoded);
        setLoading(false);
      } else {
        setError('Invalid match payload hash');
        setLoading(false);
      }
    }
  }, [hash]);

  // 2. Slug / Live resolver (runs ONLY when hash is empty and slug is set)
  useEffect(() => {
    if (hash || !slug) return;
    let cancelled = false;
    async function resolveSlug() {
      try {
        setLoading(true);
        setError('');
        if (slug === 'live') {
          // Priority 1: Check FanCode for live broadcasts
          try {
            const fcRes = await fetch('https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json', { cache: 'no-store' });
            const fcData = await fcRes.json();
            const liveMatch = (fcData.matches || []).find((m) => String(m.status || '').toUpperCase() === 'LIVE');
            if (liveMatch && !cancelled) {
              setResolvedPayload({
                sport: 'cricket',
                type: 'fancode',
                matchId: String(liveMatch.match_id || ''),
                title: liveMatch.title || '',
                tournament: liveMatch.tournament || '',
                category: liveMatch.category || 'Sports',
                startTime: liveMatch.startTime || liveMatch.startDate || 'Live',
                teamA: liveMatch.team?.[0]?.name || '',
                teamB: liveMatch.team?.[1]?.name || '',
                codeA: liveMatch.team?.[0]?.shortName || '',
                codeB: liveMatch.team?.[1]?.shortName || '',
                status: 'LIVE',
                stream: liveMatch.STREAMING_CDN?.Primary_Playback_URL || '',
                auto_streams: liveMatch.auto_streams,
              });
              setLoading(false);
              return;
            }
          } catch {}

          // Priority 2: Check WT20 schedule for live match
          try {
            const wtRes = await fetch('/api/wt20/schedule', { cache: 'no-store' });
            const wtJson = await wtRes.json();
            const matches = wtJson.data?.matches || (Array.isArray(wtJson) ? wtJson : []);
            const liveWt = matches.find((m) => m.live);
            if (liveWt && !cancelled) {
              setResolvedPayload({
                sport: 'cricket',
                type: 'wt20',
                matchId: String(liveWt.match_id),
                homeCode: liveWt.teama_short,
                awayCode: liveWt.teamb_short,
                homeName: liveWt.teama,
                awayName: liveWt.teamb,
                leagueLabel: liveWt.series_short_display_name || liveWt.series_name,
              });
              setLoading(false);
              return;
            }

            // Priority 3: Fallback to latest tournament match
            const latestMatch = matches[matches.length - 1] || matches[0];
            if (latestMatch && !cancelled) {
              setResolvedPayload({
                sport: 'cricket',
                type: 'wt20',
                matchId: String(latestMatch.match_id),
                homeCode: latestMatch.teama_short,
                awayCode: latestMatch.teamb_short,
                homeName: latestMatch.teama,
                awayName: latestMatch.teamb,
                leagueLabel: latestMatch.series_short_display_name || latestMatch.series_name,
              });
              setLoading(false);
              return;
            }
          } catch {}

          if (!cancelled) {
            setError('No live matches currently in progress');
            setLoading(false);
          }
          return;
        }

        const res = await fetch(`/api/match-resolve?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;
        const payload = normalizePayload(data.payload || data.match || data);
        if (payload?.type) {
          setResolvedPayload(payload);
        } else {
          setError(data.error || 'Unable to resolve match');
        }
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Unable to resolve match');
          setLoading(false);
        }
      }
    }
    resolveSlug();
    return () => { cancelled = true; };
  }, [hash, slug]);

  const payload = normalizePayload(resolvedPayload || {});
  const type = String(payload.type || '').toLowerCase();

  return (
    <main className="min-h-screen bg-[#070709] text-white">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_60%_35%_at_50%_0%,rgba(245,158,11,0.12),transparent_65%)]" />
      <header className="relative z-10 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link href="/sports" className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-zinc-300 hover:border-amber-400 hover:text-white transition">
            ← Sports
          </Link>
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-amber-400">Match Center</p>
          <Link href="/" className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold text-zinc-400 hover:text-white transition">
            Home
          </Link>
        </div>
      </header>
      <section className="relative z-10 mx-auto max-w-6xl px-4 py-6 pb-24">
        {loading && !payload?.type ? <EmptyPanel text="Loading match center…" /> : null}
        {error ? <EmptyPanel text={error} /> : null}
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
