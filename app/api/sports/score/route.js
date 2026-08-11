import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MOVIES1_BACKEND = (process.env.MOVIES1_BACKEND || process.env.SPORTS_BACKEND || 'https://movies1-backend.onrender.com').replace(/\/+$/, '');

const BCCI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.bcci.tv/',
  Origin: 'https://www.bcci.tv',
};

const FEEDS = {
  live: 'https://scores2.bcci.tv/getLiveMatches?platform=international&previousMatchesCount=0&filterType=All&filters%5Bformat%5D%5B%5D=AllFormat&loadMore=false',
  upcoming: 'https://scores2.bcci.tv/getUpcomingMatches?platform=international&previousMatchesCount=0&filterType=All&filters%5Bformat%5D%5B%5D=AllFormat&loadMore=false',
  recent: 'https://scores2.bcci.tv/getRecentMatches?platform=international&previousMatchesCount=15&filterType=All&filters%5Bformat%5D%5B%5D=AllFormat&loadMore=false',
};

function pickArray(payload = {}, feed = 'live') {
  const preferred = {
    live: ['liveMatches', 'LiveMatches', 'matches', 'Matchsummary', 'MatchSummary'],
    upcoming: ['upcomingMatches', 'UpcomingMatches', 'matches', 'Matchsummary', 'MatchSummary'],
    recent: ['recentMatches', 'RecentMatches', 'matches', 'Matchsummary', 'MatchSummary'],
  }[feed] || [];
  for (const key of preferred) if (Array.isArray(payload?.[key])) return payload[key];
  for (const value of Object.values(payload || {})) if (Array.isArray(value)) return value;
  return [];
}

function teamCode(name = '') {
  const clean = String(name || '').trim();
  const map = {
    'India': 'IND', 'Australia': 'AUS', 'England': 'ENG', 'South Africa': 'SA',
    'New Zealand': 'NZ', 'Pakistan': 'PAK', 'Sri Lanka': 'SL', 'Bangladesh': 'BAN',
    'Afghanistan': 'AFG', 'West Indies': 'WI', 'Zimbabwe': 'ZIM', 'Ireland': 'IRE',
  };
  return map[clean] || clean.split(/\s+/).map((part) => part[0]).join('').slice(0, 4).toUpperCase() || 'TBD';
}

function normalizeMatch(row = {}, feed = 'live') {
  const home = row.HomeTeamName || row.HomeTeam || row.Team1 || row.FirstBattingTeamName || row.TeamA || '';
  const away = row.AwayTeamName || row.AwayTeam || row.Team2 || row.SecondBattingTeamName || row.TeamB || '';
  const id = String(row.MatchID || row.MatchId || row.matchID || row.smMatchId || row.GameID || row.id || '');
  const result = row.Comments || row.Commentss || row.MatchResult || row.Result || row.WinningTeam || '';
  const statusRaw = String(row.MatchStatus || row.Status || row.MatchState || '').toLowerCase();
  const complete = /post|complete|result|stumps|abandon/.test(statusRaw) || Boolean(result);
  const live = feed === 'live' || /live|in progress|innings|break/.test(statusRaw);

  return {
    id,
    source: 'BCCI',
    feed,
    competition: row.CompetitionName || row.SeriesName || row.TournamentName || 'Cricket',
    matchOrder: row.MatchOrder || row.MatchName || row.MatchNo || '',
    venue: row.GroundName || row.VenueName || row.Venue || '',
    date: row.MatchDateNew || row.MatchDate || row.StartDate || '',
    time: row.MatchTime || row.StartTime || '',
    home: home || teamCode(row.HomeTeamCode || row.Team1Code || ''),
    away: away || teamCode(row.AwayTeamCode || row.Team2Code || ''),
    homeCode: row.HomeTeamCode || row.FirstBattingTeamCode || teamCode(home),
    awayCode: row.AwayTeamCode || row.SecondBattingTeamCode || teamCode(away),
    score1: row['1Summary'] || row.FirstBattingSummary || (row['1FallScore'] ? `${row['1FallScore']}/${row['1FallWickets']} (${row['1FallOvers']} ov)` : ''),
    score2: row['2Summary'] || row.SecondBattingSummary || (row['2FallScore'] ? `${row['2FallScore']}/${row['2FallWickets']} (${row['2FallOvers']} ov)` : ''),
    result,
    status: complete ? 'completed' : live ? 'live' : 'upcoming',
  };
}

async function fetchBcci(feed) {
  const url = FEEDS[feed] || FEEDS.live;
  const response = await fetch(url, { headers: BCCI_HEADERS, cache: 'no-store' });
  if (!response.ok) throw new Error(`BCCI ${feed} returned HTTP ${response.status}`);
  const text = await response.text();
  return JSON.parse(text);
}

async function fetchMovies1Bcci(feed) {
  const url = `${MOVIES1_BACKEND}/api/bcci/${feed}`;
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`movies1 ${feed} returned HTTP ${response.status}`);
  return response.json();
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const feed = ['live', 'upcoming', 'recent'].includes(searchParams.get('feed')) ? searchParams.get('feed') : 'live';

  const errors = [];

  try {
    const payload = await fetchMovies1Bcci(feed);
    const matches = pickArray(payload, feed).map((row) => normalizeMatch(row, feed)).filter((item) => item.home || item.away || item.id);
    if (matches.length || !payload.upstreamUnavailable) {
      return NextResponse.json({ ok: true, feed, count: matches.length, matches, source: 'movies1-backend' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    errors.push(payload.error || `movies1 ${feed} unavailable`);
  } catch (error) {
    errors.push(error.message);
  }

  try {
    const payload = await fetchBcci(feed);
    const matches = pickArray(payload, feed).map((row) => normalizeMatch(row, feed)).filter((item) => item.home || item.away || item.id);
    return NextResponse.json({ ok: true, feed, count: matches.length, matches, source: 'direct-bcci' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    errors.push(error.message);
    return NextResponse.json({ ok: true, feed, count: 0, matches: [], unavailable: true, error: errors.join(' | ') }, { headers: { 'Cache-Control': 'no-store' } });
  }
}
