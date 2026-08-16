'use client';

/**
 * Shared sports feed normalizers used by the /sports page, the home-page Live
 * Sports block, and the match-center Watch-Live picker. Single source of
 * truth so every surface renders the same match/identity card for a feed row.
 */

export const FANCODE_FEED = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';
const M3U8_PLAYER = 'https://m3u8-player-ashen.vercel.app/';

export function encodeMatchHash(payload) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  } catch {
    return '';
  }
}

export function matchCenterHref(payload) {
  const hash = encodeMatchHash(payload);
  return hash ? `/match-center/${hash}` : '/sports';
}

export function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const matches = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (!matches.length) return text.match(/https?:\/\/[^\r\n]+\.m3u8[^\r\n]*/i)?.[0] || '';
  return matches.map((match) => ({ width: Number(match[1]), height: Number(match[2]), url: match[3].trim() })).sort((a, b) => (b.width * b.height) - (a.width * a.height))[0]?.url || '';
}

export function playerUrlFromHls(url = '', title = 'Live') {
  return `${M3U8_PLAYER}?${new URLSearchParams({ src: url, title }).toString()}`;
}

export function pickArray(payload = {}, preferredKeys = []) {
  for (const key of preferredKeys) if (Array.isArray(payload?.[key])) return payload[key];
  for (const value of Object.values(payload || {})) if (Array.isArray(value)) return value;
  return [];
}

export function teamCode(name = '') {
  const clean = String(name || '').trim();
  const map = { India: 'IND', Australia: 'AUS', England: 'ENG', Pakistan: 'PAK', 'South Africa': 'SA', 'New Zealand': 'NZ', 'Sri Lanka': 'SL', Bangladesh: 'BAN', Afghanistan: 'AFG', 'West Indies': 'WI' };
  return map[clean] || clean.split(/\s+/).map((part) => part[0]).join('').slice(0, 4).toUpperCase() || 'TBD';
}

export function isSeniorMenBcci(row = {}) {
  const text = `${row.CompetitionName || ''} ${row.SeriesName || ''} ${row.HomeTeamName || ''} ${row.AwayTeamName || ''}`.toLowerCase();
  return !/(women|u-?19|under\s*19|india\s*a|emerging|academy|girls)/i.test(text);
}

export function normalizeBcciMatch(row = {}, feed = 'live') {
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
    matchPayload: { sport: 'cricket', type: 'bcci', matchData },
  };
}

export function normalizeWt20Match(row = {}) {
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
    matchPayload: { sport: 'cricket', type: 'wt20', matchId: row.match_id, matchData: row },
  };
}

export function normalizeIplMatch(row = {}) {
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
    matchPayload: { sport: 'cricket', type: 'ipl', matchId: id, matchData: row },
  };
}

/**
 * FanCode live event rows (mixed sports — football, kabaddi, cricket…).
 */
export function normalizeFancodeEvent(row = {}) {
  const stream = bestFancodeVariant(row.auto_streams?.[0]?.auto || '') || row.STREAMING_CDN?.Primary_Playback_URL || '';
  const category = String(row.category || row.sport || 'Other').trim();
  const status = String(row.status || '').toUpperCase();
  return {
    id: String(row.match_id || row.title || ''),
    provider: 'FanCode',
    type: 'fancode',
    status: status === 'LIVE' ? 'live' : status === 'COMPLETED' ? 'completed' : 'upcoming',
    title: row.title || 'FanCode Event',
    subtitle: row.tournament || category,
    competition: row.tournament || 'FanCode',
    category: category.toLowerCase(),
    venue: '',
    date: row.start_time || row.date || '',
    score1: '',
    score2: '',
    result: '',
    href: stream ? playerUrlFromHls(stream, row.title || 'FanCode') : '',
    external: true,
  };
}

export function isCricketFeedItem(item = {}) {
  const text = `${item.provider || ''} ${item.type || ''} ${item.category || ''} ${item.competition || ''} ${item.title || ''}`.toLowerCase();
  return item.type === 'bcci' || item.type === 'wt20' || item.type === 'ipl' || text.includes('cricket') || text.includes('t20') || text.includes('odi') || text.includes('ipl');
}
