/**
 * Sports data layer — the single place the Sports surface learns anything.
 *
 * Why this file exists: the feed used to be assembled in three places at once (the page fetched the FanCode
 * dump and the ICC schedule from the browser and re-normalised the rows inline, `/api/sports/score` had its
 * own BCCI normaliser, and `SportsMatchCenter.jsx` carried three more near-identical ones). Every one of them
 * disagreed about what "live" means, and none of them could tell you which upstream was empty. Now:
 *
 *  - every row from every source becomes ONE shape (`normalize*` below);
 *  - `mergeFeed` dedupes across sources by team pair + day, and reports per-source health;
 *  - nothing is invented. A match with no parsable start time is `tbc` and prints the source's own words;
 *    a panel whose feed is empty says which feed was empty. An absent total is never displayed as zero.
 *
 * Everything async takes `{ fetchImpl, env, now }` so a test can drive the real code path with a fake fetch —
 * the reason this surface has no tests today is that its logic was welded to `fetch` and to `useState`.
 */

import {
  commentaryView,
  dayLabel as viewDayLabel,
  feedLine as viewFeedLine,
  groupFeed as viewGroupFeed,
  timeLabel as viewTimeLabel,
} from './sportsFeedView.js';

export {
  channelCounts,
  channelLine,
  commentaryView,
  countdownLine,
  dotLabel,
  hubTabLabel,
  hubTabs,
  initials,
  panelNote,
  scorecardRows,
  sourceLine,
  stateChip,
  statusLine,
} from './sportsFeedView.js';

/* The display rules live in `sportsFeedView.js`, so a client component can use them without importing this
   file's fetchers. They are re-exported here so server code and the tests only need one module. */
export const groupFeed = viewGroupFeed;
export const timeLabel = viewTimeLabel;
export const dayLabel = viewDayLabel;
export const feedLine = viewFeedLine;

export const FANCODE_DUMP = 'https://raw.githubusercontent.com/doctor-8trange/zyphx8/refs/heads/main/data/fancode.json';

/** How long a feed read stays warm in the route. Live scores 20 s, everything else 5 min. */
export const FEED_TTL_LIVE_MS = 20_000;
export const FEED_TTL_IDLE_MS = 5 * 60_000;

const BCCI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://www.bcci.tv/',
  Origin: 'https://www.bcci.tv',
};

/* The ICC publishes its game feeds openly; these three constants are the same ones the ICC site's own player
   uses, and they are what makes `assets-icc.sportz.io` answer at all. */
const ICC_API = 'https://assets-icc.sportz.io/cricket/v1';
const ICC_CLIENT_ID = 'tPZJbRgIub3Vua93/DWtyQ==';
const ICC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.icc-cricket.com/',
  Origin: 'https://www.icc-cricket.com',
};

const FC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
};

export function sportsBackend(env = process.env) {
  return String(env.MOVIES1_BACKEND || env.SPORTS_BACKEND || 'https://movies1-backend.onrender.com').replace(/\/+$/, '');
}

/**
 * An ICC game feed: the public host first, then the same path through the score backend. Both were tried so a
 * blocked host degrades to "this feed is empty", never to a spinner.
 */
async function loadIccJson({ path, params, fetchImpl = fetch, env = process.env }) {
  const q = new URLSearchParams(params).toString();
  const errors = [];
  for (const url of [`${ICC_API}/${path}?${q}`, `${sportsBackend(env)}/api/wt20/${path}?${q}`]) {
    try {
      return await getJson(url, { fetchImpl, headers: ICC_HEADERS });
    } catch (error) {
      errors.push(`${new URL(url).host}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function getJson(url, { fetchImpl = fetch, headers = {}, timeoutMs = 15_000, text = false } = {}) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const response = await fetchImpl(url, { cache: 'no-store', redirect: 'follow', headers, signal });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return text ? response.text() : response.json();
}

/* ------------------------------------------------------------------ primitives */

const TEXT = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const FIRST = (...values) => values.map(TEXT).find((value) => value) || '';
/* BCCI hands out UUIDs (`f126c6e3-0a51-4194-aded-8445fbe27e35`), so the alphabet keeps `-` and the cap is a
   whole UUID: truncating at 32 silently produced a match id that no endpoint recognises. */
const ID = (value) => TEXT(value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);

/** Codes only ever come from the feed; anything else stays the feed's own spelling. */
export function teamCode(name = '') {
  const clean = TEXT(name);
  const map = {
    India: 'IND', Australia: 'AUS', England: 'ENG', 'South Africa': 'SA', 'New Zealand': 'NZ',
    Pakistan: 'PAK', 'Sri Lanka': 'SL', Bangladesh: 'BAN', Afghanistan: 'AFG', 'West Indies': 'WI',
    Zimbabwe: 'ZIM', Ireland: 'IRE', Nepal: 'NEP', Netherlands: 'NED', Oman: 'OMA', Scotland: 'SCO',
    'India Women': 'IND-W', 'Australia Women': 'AUS-W', 'England Women': 'ENG-W',
  };
  if (map[clean]) return map[clean];
  const letters = clean.split(/\s+/).map((part) => part[0]).join('').toUpperCase();
  return letters.length >= 2 && letters.length <= 5 ? letters : clean.slice(0, 3).toUpperCase() || 'TBD';
}

const LIVE_WORDS = /\b(live|in progress|in-play|playing|1st innings|2nd innings|mid[- ]?innings|break|interval|haltime|half time|kick[- ]?off|1st set|2nd set|running|q[1-4])\b/i;
const DONE_WORDS = /\b(post|complete|result|stumps|concluded|abandon|washed|won by|drawn|tied|finished|retired|ended|match ended)\b/i;
/* `MatchResult` on a BCCI upcoming row is "Teams will be announced at the toss" — a sentence the feed files
   under "result" that is not one. Only text that actually decides a game may end one. */
const FINAL_RESULT = /\b(beat|won by|won the match|won the series|drew|drawn|tied|no result|abandoned|awarded|eliminated|qualified)\b/i;
/* BCCI files the live situation in `MatchResult` ("Namibia need 328 runs … with 10 wickets remaining"), and a
   Test lead is not a result either. Anything that still describes runs to get is mid-match, whatever the key
   it arrived under says. */
const NOT_FINAL = /remaining|yet to (bat|score|get)|need[s]? .{0,40}to (win|score|level)|lead(s|ing)? .{0,40}by|follow-?on/i;
const TBC_WORDS = /\b(to be (?:confirmed|announced|decided)|time (?:is )?yet|schedule (?:not|isn't) (?:finali[sz]ed|confirmed)|\btbc\b|unannounced)/i;
const UPCOMING_WORDS = /\b(forthcoming|scheduled|upcoming|not[- ]?started|not begun|yet to (begin|start|commence)|to be confirmed|teams will be announced|preview|match \d+ of)\b/i;

/**
 * One status decision for every source. `statusRaw` is the feed's own words, `score` is whether any line
 * exists, `startAt` may be null. Order matters: a result string beats a "live" word, because BCCI leaves
 * `MatchStatus` stale on some completed rows.
 */
export function deriveState({ statusRaw = '', result = '', hasScore = false, startAt = null, now = Date.now(), hasTime = true } = {}) {
  const words = `${statusRaw} ${result}`;
  const dayPassed = startAt ? (hasTime ? new Date(startAt).getTime() <= now : istDayEnd(startAt) <= now) : false;
  if ((FINAL_RESULT.test(result) || DONE_WORDS.test(statusRaw)) && !NOT_FINAL.test(`${result} ${statusRaw}`)) return 'done';
  /* The feed says the start is not fixed: that is its own answer, and it outranks both guesses. */
  if (TBC_WORDS.test(words)) return 'tbc';
  /* The feed still calls it forthcoming: an hour that has gone by is not a result, and no start time at all is
     not "starting soon" either. */
  if (UPCOMING_WORDS.test(words) && !hasScore) return startAt ? (dayPassed ? 'tbc' : 'soon') : 'tbc';
  if (LIVE_WORDS.test(words)) return 'live';
  if (hasScore) return 'live';
  if (!startAt) return 'tbc';
  if (hasTime) return new Date(startAt).getTime() > now ? 'soon' : 'done';
  /* A feed that says the day but not the hour has not told us the match is over: say "tbc", never guess "done". */
  return istDayEnd(startAt) > now ? 'soon' : 'tbc';
}

/** Last instant of the Indian-calendar day a UTC stamp falls in (IST midnight is 18:30 Z the day before). */
export function istDayEnd(iso = '') {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return 0;
  const istDay = new Date(at + 19_800_000).toISOString().slice(0, 10);
  return Date.parse(`${istDay}T18:59:59.999Z`);
}

/**
 * Best-effort instant from whatever the feed printed, plus the one fact the UI needs with it: whether the feed
 * ever gave a *clock*. `startAt: null` means "we do not know the day either". A row with a day but no time is
 * stamped at noon IST so grouping and cross-source dedupe have a day to compare, and `hasTime: false` is what
 * stops a card from printing that placeholder as a start time.
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Best-effort instant from whatever a feed printed, plus the one fact the UI needs with it: whether the feed
 * ever gave a *clock*. `startAt: null` means "not even the day". A row with a day but no time is stamped at
 * noon IST so grouping and cross-source dedupe have a day to compare, and `hasTime: false` is what stops a card
 * from printing that placeholder as a start time.
 *
 * Zones are the part people get wrong, so they are stated here:
 *  - `zone:'ist'` (default) — `match_date_ist`/`match_time_ist`/FanCode's `startTime` are Indian wall clock;
 *  - `zone:'utc'` — BCCI's `StartDateTimeUTC`, whose name is the only honest label on it;
 *  - a value that carries its own `Z` or `+05:30` wins over both, because it is self-declaring.
 * `order` tells apart `6/28/2026` (ICC, month first) from `28/06/2026` (day first) when both parts could be
 * a day; an impossible part (13-25) always decides itself.
 */
export function parseStartInfo(value = '', timeValue = '', { zone = 'ist', order = 'auto' } = {}) {
  const raw = TEXT(value);
  if (!raw) return { startAt: null, hasTime: false };

  const clock = TEXT(timeValue).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i);
  const toHours = (hour, meridiem) => {
    const h = Number(hour) % 12;
    return meridiem && /pm/i.test(meridiem) ? h + 12 : h;
  };
  let hour = clock ? toHours(clock[1], clock[3]) : null;
  if (clock && !clock[3] && Number(clock[1]) > 12) hour = Number(clock[1]);
  const minute = clock ? Number(clock[2]) : null;

  /* An offset is only ever read off a *timestamp*: `2026-09-06` ends in `-06`, and treating that as -06:00 is
     how a plain date comes out six hours in the future. */
  const tail = /\d{1,2}:\d{2}/.test(raw) ? raw.match(/(?:Z|([+-])(\d{2}):?(\d{2})?)$/) : null;
  const selfOffset = !tail ? null : /^z$/i.test(tail[0]) ? 0 : (tail[1] === '-' ? -1 : 1) * (Number(tail[2]) * 60 + Number(tail[3] || 0));
  const minutes = selfOffset === null ? (zone === 'utc' ? 0 : 330) : selfOffset;
  const stamp = (y, m, d, hh, mm) => {
    const at = Date.UTC(y, m - 1, d, Number.isFinite(hh) ? hh : 12, Number.isFinite(mm) ? mm : 0) - minutes * 60_000;
    return Number.isNaN(at) ? null : new Date(at).toISOString();
  };
  const clockKnown = Boolean(clock) || /\d{1,2}:\d{2}/.test(raw);

  if (selfOffset !== null) {
    const at = Date.parse(raw);
    if (!Number.isNaN(at)) return { startAt: new Date(at).toISOString(), hasTime: clockKnown };
  }

  /* `2026-09-06`, `2026-09-06 04:00:00`, `2026-09-11T18:30` — ISO-ish, always year first. */
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::\d{2})?)?/);
  if (iso) {
    const [, y, m, d, hh, mm] = iso;
    const hasClock = hh !== undefined || hour !== null;
    const useHour = hh === undefined ? hour : Number(hh);
    const useMinute = hh === undefined ? minute : Number(mm);
    return { startAt: stamp(Number(y), Number(m), Number(d), useHour, useMinute), hasTime: hasClock };
  }

  /* FanCode: `03 September 2026 02:30 PM`. `Date.parse` would read this in the server's own zone. */
  const named = raw.match(/^(\d{1,2})\s+([a-z]{3,9})\.?\s+(\d{4})(?:[,(\s]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?)?/i);
  if (named && MONTHS[named[2].slice(0, 3).toLowerCase()]) {
    const hasClock = named[4] !== undefined || hour !== null;
    const useHour = named[4] === undefined ? hour : toHours(named[4], named[6]);
    const useMinute = named[4] === undefined ? minute : Number(named[5]);
    return { startAt: stamp(Number(named[3]), MONTHS[named[2].slice(0, 3).toLowerCase()], Number(named[1]), useHour, useMinute), hasTime: hasClock };
  }

  /* `6/28/2026` (ICC) or `28/06/2026`, optionally with `T19:00` glued on the end. */
  const slashed = raw.match(/^(\d{1,2})([/-])(\d{1,2})\2(\d{4})(?:[,T ]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap]m)?))?/i);
  if (slashed) {
    const first = Number(slashed[1]);
    const second = Number(slashed[3]);
    /* Whichever part cannot be a month decides the order for us; only a genuinely ambiguous `6/7/2026`
       falls back to what the caller's feed is known to print. */
    const monthFirst = second > 12 ? true : first > 12 ? false : order === 'us';
    const month = monthFirst ? first : second;
    const day = monthFirst ? second : first;
    const hasClock = slashed[5] !== undefined || hour !== null;
    const useHour = slashed[5] === undefined ? hour : toHours(slashed[5], slashed[7]);
    const useMinute = slashed[5] === undefined ? minute : Number(slashed[6]);
    return { startAt: stamp(Number(slashed[4]), month, day, useHour, useMinute), hasTime: hasClock };
  }

  /* Epochs (seconds or milliseconds) appear in the odd BCCI payload. */
  const epoch = Number(raw);
  if (Number.isFinite(epoch) && epoch > 1_500_000_000) {
    return { startAt: new Date(epoch > 1e12 ? epoch : epoch * 1000).toISOString(), hasTime: true };
  }
  return { startAt: null, hasTime: false };
}

/** For callers that only want the instant (the score routes label nothing). */
export function parseStart(value = '', timeValue = '', options = {}) {
  return parseStartInfo(value, timeValue, options).startAt;
}

/* ------------------------------------------------------------------ the match shape */

/** The unit every source is normalised into. Every field is either the feed's own words or ''. */
function makeMatch(input = {}) {
  const home = TEXT(input.home);
  const away = TEXT(input.away);
  const homeCode = TEXT(input.homeCode) || (home ? teamCode(home) : '');
  const awayCode = TEXT(input.awayCode) || (away ? teamCode(away) : '');
  const scoreHome = TEXT(input.scoreHome);
  const scoreAway = TEXT(input.scoreAway);
  const startAt = input.startAt ?? null;
  const state = input.state || deriveState({
    statusRaw: input.statusRaw,
    result: input.result,
    hasScore: Boolean(scoreHome || scoreAway),
    startAt,
    now: input.now,
    hasTime: input.timeKnown !== false,
  });
  const id = ID(input.id);
  return {
    id,
    href: `/sports/hub/${ID(input.source)}/${id}`,
    source: input.source,
    sport: TEXT(input.sport) || 'cricket',
    competition: TEXT(input.competition),
    matchOrder: TEXT(input.matchOrder),
    venue: TEXT(input.venue),
    home,
    away,
    homeCode,
    awayCode,
    scoreHome,
    scoreAway,
    statusLine: TEXT(input.statusLine),
    result: TEXT(input.result),
    state,
    startAt,
    timeKnown: input.timeKnown !== false,
    startLabel: TEXT(input.startLabel),
    statusWords: TEXT(input.statusRaw),
    stream: TEXT(input.stream),
    videoId: ID(input.videoId),
    cardId: ID(input.cardId),
    inningsKind: TEXT(input.inningsKind),
    toss: TEXT(input.toss),
    playerOfMatch: TEXT(input.playerOfMatch),
    coverage: TEXT(input.coverage),
    standings: Boolean(input.standings),
    currentInnings: Number(input.currentInnings) || 0,
    battingSide: TEXT(input.battingSide),
    poster: TEXT(input.poster),
    competitionId: ID(input.competitionId),
    gameId: ID(input.gameId),
    dumpAt: TEXT(input.dumpAt),
    teamIds: input.teamIds && typeof input.teamIds === 'object' ? input.teamIds : {},
    links: input.links && typeof input.links === 'object' ? input.links : {},
    variants: Array.isArray(input.variants) ? input.variants : [],
    teams: [
      { code: homeCode, name: home, line: scoreHome, extra: TEXT(input.extraHome), batting: TEXT(input.battingSide) === homeCode },
      { code: awayCode, name: away, line: scoreAway, extra: TEXT(input.extraAway), batting: TEXT(input.battingSide) === awayCode },
    ].filter((team) => team.name || team.line),
    has: {
      scorecard: Boolean(input.cardId),
      commentary: Boolean(input.cardId) && state === 'live',
      watch: canWatch(input),
    },
  };
}

/** A variant is watchable when it has a url and the normaliser did not stamp a reason on it. */
const isPlayableVariant = (variant) => Boolean(variant && variant.url && !variant.unavailable);
const canWatch = (item = {}) => Boolean(TEXT(item.stream)) || (item.variants || []).some(isPlayableVariant);

/** Cross-source identity: the same game on two feeds must become one card. */
export function matchKey(match = {}) {
  const pair = [TEXT(match.homeCode || match.home), TEXT(match.awayCode || match.away)]
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .sort()
    .join('|');
  if (!pair) return `id:${match.source}:${match.id}`;
  const day = match.startAt ? match.startAt.slice(0, 10) : TEXT(match.competition).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  return `${pair}@${day || 'nodate'}`;
}

/* ------------------------------------------------------------------ per-source normalisers */

function bcciScores(row = {}, side) {
  const n = side === 1 ? '1' : '2';
  const summary = FIRST(row[`${n}Summary`], row[side === 1 ? 'FirstBattingSummary' : 'SecondBattingSummary']);
  if (summary) return summary;
  const runs = FIRST(row[`${n}FallScore`], row[side === 1 ? '1InnRuns' : '2InnRuns']);
  if (!runs) return '';
  const wickets = FIRST(row[`${n}FallWickets`], row[side === 1 ? '1InnWkts' : '2InnWkts']);
  const overs = FIRST(row[`${n}FallOvers`], row[side === 1 ? '1InnOvers' : '2InnOvers']);
  return `${runs}${wickets ? `/${wickets}` : ''}${overs ? ` (${overs} ov)` : ''}`;
}

/** `scores2.bcci.tv` rows, or the movies1 wrapper of them — same fields, both spell the keys differently. */
export function normalizeBcci(row = {}, { feed = 'live', now } = {}) {
  const home = FIRST(row.HomeTeamName, row.HomeTeam, row.Team1, row.FirstBattingTeamName, row.TeamA);
  const away = FIRST(row.AwayTeamName, row.AwayTeam, row.Team2, row.SecondBattingTeamName, row.TeamB);
  const statusRaw = FIRST(row.MatchStatus, row.Status, row.MatchState, row.match_display_status);
  /* BCCI labels one field with its own zone: `StartDateTimeUTC` is UTC (verified against a live Duleep Trophy
     row, whose `MatchTime` reads 04:00 — 09:30 IST, a first-class start). Only when that field is missing do we
     fall back to `MatchDateNew` + `MatchTime`, which the score site publishes as Indian wall clock. */
  const utc = parseStartInfo(FIRST(row.StartDateTimeUTC), '', { zone: 'utc' });
  const start = utc.startAt ? utc : parseStartInfo(FIRST(row.MatchDateNew, row.MatchDate, row.StartDate, row.match_date_ist), FIRST(row.MatchTime, row.StartTime, row.match_time_ist), { zone: 'ist' });
  const teamIds = {};
  if (row.FirstBattingTeamID && row.FirstBattingTeamName) teamIds[String(row.FirstBattingTeamID)] = TEXT(row.FirstBattingTeamName);
  if (row.SecondBattingTeamID && row.SecondBattingTeamName) teamIds[String(row.SecondBattingTeamID)] = TEXT(row.SecondBattingTeamName);
  return makeMatch({
    id: FIRST(row.MatchID, row.MatchId, row.matchID, row.smMatchId, row.GameID, row.GID, row.id),
    source: 'bcci',
    competition: FIRST(row.CompetitionName, row.SeriesName, row.TournamentName, 'Cricket'),
    matchOrder: ordinalLabel(FIRST(row.MatchOrder, row.MatchName, row.MatchNo)),
    venue: FIRST(row.GroundName, row.VenueName, row.Venue),
    home,
    away,
    homeCode: FIRST(row.HomeTeamCode, row.Team1Code),
    awayCode: FIRST(row.AwayTeamCode, row.Team2Code, row.SecondBattingTeamCode),
    scoreHome: bcciScores(row, 1),
    scoreAway: bcciScores(row, 2),
    statusLine: FIRST(row.Comments, row.Commentss, row.Result, row.MatchResultText, statusRaw),
    result: FIRST(row.MatchResult, row.Result, row.WinningTeam ? `${row.WinningTeam} won` : ''),
    statusRaw,
    startAt: start.startAt,
    timeKnown: start.hasTime,
    startLabel: FIRST(row.MatchTime, row.StartTime, row.MatchDateNew, row.MatchDate),
    feed,
    now,
    cardId: FIRST(row.MatchID, row.MatchId, row.matchID, row.smMatchId),
    competitionId: FIRST(row.CompetitionID, row.competitionID),
    inningsKind: FIRST(row.MatchType, row.MatchTypeName, row.Format),
    battingSide: FIRST(row.BattingTeamCode, row.FirstBattingTeamCode),
    teamIds,
    /* No stream on this feed, ever: the BCCI rows publish scores only, so the Video tab has nothing of ours to
       offer for a bcci-only match and says so. */
    stream: '',
  });
}

/** ICC `assets-icc.sportz.io` schedule rows (the WT20 feed). */
/**
 * `assets-icc.sportz.io/cricket/v1/schedule` rows. Every key below was read off a live response (game 262347,
 * Australia W v India W, 28 Jun 2026), including `other_info`, which is where the ICC publishes its own
 * match-centre, live and highlights links — the only honest source of a "watch this" button for these matches.
 */
export function normalizeWt20(row = {}, { now } = {}) {
  const scores = Array.isArray(row.scores) ? row.scores : [];
  const lineFor = (index) => {
    const entry = scores[index];
    if (!entry) return '';
    const runs = FIRST(entry.team_runs, entry.runs);
    if (!runs) return '';
    const wickets = FIRST(entry.team_wickets, entry.wickets);
    const overs = FIRST(entry.team_overs, entry.overs);
    return `${runs}${wickets ? `/${wickets}` : ''}${overs ? ` (${overs} ov)` : ''}`;
  };
  const nameOf = (teamId) => {
    const id = TEXT(teamId);
    if (!id) return '';
    if (id === TEXT(row.teama_id)) return FIRST(row.teama_display_name, row.teama);
    if (id === TEXT(row.teamb_id)) return FIRST(row.teamb_display_name, row.teamb);
    return '';
  };
  const other = row.other_info && typeof row.other_info === 'object' ? row.other_info : {};
  const statusRaw = FIRST(row.match_display_status, row.match_status, row.status);
  const start = parseStartInfo(FIRST(row.start_date, `${FIRST(row.match_date_ist, row.match_date)} ${FIRST(row.match_time_ist, row.match_time)}`.trim()), FIRST(row.match_time_ist, row.match_time), { zone: 'ist', order: 'us' });
  const award = Array.isArray(row.award) ? row.award[0] : null;
  const coverage = FIRST(row.coverage_level);
  const battingId = FIRST(row.current_batting_team_id);
  return makeMatch({
    id: FIRST(row.match_id, row.game_id, row.id),
    source: 'icc',
    competition: FIRST(row.series_short_display_name, row.series_name, row.tournament),
    matchOrder: FIRST(row.match_number, row.match_no, row.match_title),
    venue: FIRST(row.venue, row.ground),
    home: FIRST(row.teama_display_name, row.teama, row.teama_short),
    away: FIRST(row.teamb_display_name, row.teamb, row.teamb_short),
    homeCode: FIRST(row.teama_short),
    awayCode: FIRST(row.teamb_short),
    scoreHome: lineFor(0) || FIRST(row.score_a),
    scoreAway: lineFor(1) || FIRST(row.score_b),
    statusLine: FIRST(row.match_sub_status, row.match_info, row.status_text, statusRaw),
    result: FIRST(row.match_result, row.result),
    statusRaw: `${statusRaw} ${row.live === true || row.live === 'true' ? 'live' : ''}`,
    startAt: start.startAt,
    /* `is_provisional_time` is the feed's own way of saying "the day is fixed, the hour is not". */
    timeKnown: start.hasTime && row.is_provisional_time !== true,
    startLabel: FIRST(row.match_time_ist, row.match_date_ist, row.match_date),
    now,
    cardId: FIRST(row.match_id, row.game_id),
    gameId: FIRST(row.match_id, row.game_id),
    competitionId: FIRST(row.series_id),
    inningsKind: FIRST(row.match_type, row.comp_type),
    battingSide: battingId === TEXT(row.teama_id) ? FIRST(row.teama_short) : battingId === TEXT(row.teamb_id) ? FIRST(row.teamb_short) : '',
    currentInnings: FIRST(row.current_innings),
    standings: row.has_standings === true,
    coverage,
    playerOfMatch: FIRST(award?.player_name),
    toss: row.toss_won_by ? `${nameOf(row.toss_won_by) || `team ${ID(row.toss_won_by)}`} won the toss and chose to ${FIRST(row.toss_elected_to) || '—'}` : '',
    videoId: FIRST(row.video_id, row.highlight_id),
    stream: FIRST(row.stream_url, row.streaming_url),
    links: { match: FIRST(other.match_center), watch: FIRST(other.watch_live), highlight: FIRST(other.high_light) },
  });
}

/** The FanCode dump row: `auto_streams[0].auto` is an m3u8 master as text, so the best variant is parsed out. */
export function bestFancodeVariant(autoText = '') {
  const text = String(autoText || '');
  const variants = [...text.matchAll(/RESOLUTION=(\d+)x(\d+)[\s\S]*?\n(https?:\/\/[^\r\n]+)/g)];
  if (variants.length) {
    return variants
      .map(([, w, h, url]) => ({ pixels: Number(w) * Number(h), url: url.trim() }))
      .sort((a, b) => b.pixels - a.pixels)[0].url;
  }
  return text.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/i)?.[0] || '';
}

/** One `auto_streams` entry: a signed master plus the headers and the lifetime of its token. */
function fanVariants(row = {}) {
  const entries = Array.isArray(row.auto_streams) ? row.auto_streams : [];
  const headers = row.__headers && typeof row.__headers === 'object' ? row.__headers : {};
  return entries.map((entry, index) => {
    const url = bestFancodeVariant(entry?.auto || '');
    const cookieValid = Number(entry?.cookie_valid);
    return {
      id: `fan-${index}`,
      label: FIRST(entry?.language) || (entries.length > 1 ? `feed ${index + 1}` : 'match feed'),
      url,
      cookie: FIRST(entry?.cookie),
      referer: FIRST(headers.Referer, 'https://fancode.com/'),
      userAgent: FIRST(headers['User-Agent']),
      /* `cookie_valid` is the token expiry as a unix second — unambiguous, unlike the pretty
         `expire_date` string ("Friday, September 4, 2026, 2:21:06 PM") with no zone on it. */
      expiresAt: Number.isFinite(cookieValid) && cookieValid > 1_000_000_000 ? new Date(cookieValid * 1000).toISOString() : '',
      cookieValid: entry?.cookie_valid === true || Number.isFinite(cookieValid),
    };
  }).filter((variant) => variant.url);
}

/**
 * FanCode dump rows. Verified against the published file (41 rows, 2026-09-03): the score lives in
 * `team[].cricketScore[]`, the winner in `isWinner`, and `auto_streams[]` carries a signed token with the
 * headers it needs. `footballScore`/`kabaddiScore`/… hold the same idea for the other sports the dump covers.
 */
export function normalizeFancode(row = {}, { now } = {}) {
  const teams = Array.isArray(row.team) ? row.team : [];
  const title = FIRST(row.title);
  const split = title.split(/\s+v[s]?\s+|\sv\s|\sx\b/i);
  const statusRaw = FIRST(row.status, row.streamingStatus);
  const start = parseStartInfo(FIRST(row.startTime, row.start_time, row.startDate, row.date), FIRST(row.start_time_only, row.time), { zone: 'ist' });
  const variants = fanVariants(row);
  /* `streamingStatus` is FanCode's own switch, but a row can say LIVE without it (the dump is hand-published),
     and telling a user "the feed has not started" about a match the feed calls live is worse than the reverse. */
  const started = FIRST(row.streamingStatus) === 'STARTED' || /\b(live|playing|in progress|streaming|1st innings|2nd innings)\b/i.test(statusRaw);
  const playback = FIRST(row.STREAMING_CDN?.Primary_Playback_URL, row.streamingUrl);
  /* A token the feed already expired is not a stream. `needsHeaders` in the aside explains why. */
  const fresh = variants.filter((variant) => !variant.expiresAt || Date.parse(variant.expiresAt) > now);
  const playbackExpired = false;
  const chosen = (started ? fresh : []).map((variant) => variant.url);
  const stream = FIRST(...chosen) || (started && !variants.length && !playbackExpired ? playback : '');
  variants.forEach((variant) => {
    if (variant.unavailable) return;
    if (!started) variant.unavailable = 'the match feed has not started streaming this match yet';
    else if (variant.expiresAt && Date.parse(variant.expiresAt) <= now) variant.unavailable = `this stream link expired on ${new Date(variant.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — the dump that published it is from ${FIRST(row.__dumpAt) || 'an unknown time'}`;
  });
  const scoreLine = (team) => {
    const lists = ['cricketScore', 'footballScore', 'kabaddiScore', 'hockeyScore', 'basketBallScore'];
    for (const key of lists) {
      const rows = Array.isArray(team?.[key]) ? team[key] : [];
      const entry = rows[rows.length - 1];
      if (!entry) continue;
      const runs = FIRST(entry.runs, entry.goals, entry.points, entry.score);
      if (!runs) return '';
      const wickets = FIRST(entry.wickets);
      const overs = FIRST(entry.overs);
      return `${runs}${wickets ? `/${wickets}` : ''}${overs ? ` (${overs} ov)` : ''}`;
    }
    return FIRST(team?.score);
  };
  const winner = teams.find((team) => team?.isWinner === true);
  const loser = teams.find((team) => team?.isWinner === false);
  const batting = teams.find((team) => team?.status?.cricket?.isBatting === true);
  return makeMatch({
    id: FIRST(row.match_id, row.matchId, row.id, title),
    source: 'fancode',
    sport: FIRST(row.sport, row.category).toLowerCase().includes('cricket') ? 'cricket' : FIRST(row.sport, row.category).toLowerCase() || 'other',
    competition: FIRST(row.tournament, row.league, row.category, 'FanCode'),
    matchOrder: FIRST(row.match_title, row.series),
    venue: FIRST(row.venue, row.ground),
    home: FIRST(teams[0]?.name, teams[0]?.shortName, split[0]),
    away: FIRST(teams[1]?.name, teams[1]?.shortName, split[1]),
    homeCode: FIRST(teams[0]?.shortName),
    awayCode: FIRST(teams[1]?.shortName),
    scoreHome: scoreLine(teams[0]) || FIRST(row.score1, row.teamAScore),
    scoreAway: scoreLine(teams[1]) || FIRST(row.score2, row.teamBScore),
    statusLine: FIRST(row.status_text, row.commentary, row.description, statusRaw),
    result: FIRST(row.result, winner && loser ? `${FIRST(winner.name, winner.shortName)} beat ${FIRST(loser.name, loser.shortName)}` : winner ? `${FIRST(winner.name, winner.shortName)} won` : ''),
    statusRaw: `${statusRaw} ${started ? 'live' : ''}`,
    startAt: start.startAt,
    timeKnown: start.hasTime,
    startLabel: FIRST(row.startTime, row.start_time, row.startDate, row.date),
    now,
    cardId: /cricket/i.test(FIRST(row.sport, row.category)) ? FIRST(row.match_id, row.matchId) : '',
    inningsKind: FIRST(row.format, row.matchType),
    battingSide: FIRST(batting?.shortName),
    poster: FIRST(row.image),
    dumpAt: FIRST(row.__dumpAt),
    /* The FanCode URL we can build from a match id is the `x-{id}` form, which the site resolves; the pretty
       `/tour/{slug}/matches/{slug}-{id}/…` link comes from the match page itself in `loadFanCodeScorecard`. */
    links: { match: `https://www.fancode.com/${/cricket/i.test(FIRST(row.sport, row.category)) ? 'cricket' : 'x'}/tour/x/matches/x-${ID(row.match_id || row.matchId)}/live-match-info` },
    stream,
    variants: started ? variants : variants.map((variant) => ({ ...variant, unavailable: 'the feed has not started streaming this match yet' })),
  });
}

/** BCCI files a placeholder `Match 0` on series rows; printing it would look like a fact about the fixture. */
function ordinalLabel(value = '') {
  const clean = TEXT(value);
  if (!clean) return '';
  const digits = clean.match(/(\d+)\s*$/);
  if (digits && Number(digits[1]) === 0) return '';
  return clean;
}

/* ------------------------------------------------------------------ feed loaders */

export async function loadBcciFeed({ feed = 'live', fetchImpl = fetch, env = process.env } = {}) {
  const root = sportsBackend(env);
  const attempts = [
    { label: 'movies1', run: () => getJson(`${root}/api/bcci/${feed}`, { fetchImpl }) },
    { label: 'bcci', run: () => getJson(bcciScoreUrl(feed), { fetchImpl, headers: BCCI_HEADERS, text: true }).then((body) => JSON.parse(body)) },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const payload = await attempt.run();
      const rows = pickArray(payload, feed);
      if (rows.length) {
        return { ok: true, via: attempt.label, rows, note: attempt.label === 'movies1' ? '' : `${attempt.label} direct` };
      }
      errors.push(`${attempt.label}: empty`);
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }
  return { ok: false, rows: [], error: errors.join(' | ') || 'no rows' };
}

export function bcciScoreUrl(feed) {
  const query = new URLSearchParams({
    platform: 'international',
    previousMatchesCount: feed === 'recent' ? '15' : '0',
    filterType: 'All',
    loadMore: 'false',
  });
  query.append('filters[format][]', 'AllFormat');
  const verb = feed === 'upcoming' ? 'getUpcomingMatches' : feed === 'recent' ? 'getRecentMatches' : 'getLiveMatches';
  return `https://scores2.bcci.tv/${verb}?${query}`;
}

export function pickArray(payload = {}, feed = 'live') {
  if (Array.isArray(payload)) return payload;
  const preferred = {
    live: ['liveMatches', 'LiveMatches', 'matches', 'Matchsummary', 'MatchSummary'],
    upcoming: ['upcomingMatches', 'UpcomingMatches', 'matches', 'Matchsummary', 'MatchSummary'],
    recent: ['recentMatches', 'RecentMatches', 'matches', 'Matchsummary', 'MatchSummary'],
  }[feed] || [];
  for (const key of preferred) if (Array.isArray(payload?.[key])) return payload[key];
  for (const value of Object.values(payload || {})) if (Array.isArray(value)) return value;
  return [];
}

export async function loadWt20Feed({ fetchImpl = fetch, env = process.env } = {}) {
  try {
    const payload = await getJson(`${sportsBackend(env)}/api/wt20/schedule`, { fetchImpl });
    const rows = Array.isArray(payload?.data?.matches) ? payload.data.matches : (Array.isArray(payload?.matches) ? payload.matches : (Array.isArray(payload) ? payload : []));
    if (!rows.length) return { ok: false, rows: [], error: 'icc: empty schedule' };
    return { ok: true, via: 'movies1', rows };
  } catch (error) {
    return { ok: false, rows: [], error: `icc: ${error.message}` };
  }
}

export async function loadFancodeFeed({ fetchImpl = fetch, env = process.env } = {}) {
  try {
    const payload = await getJson(`${env.FANCODE_DUMP_URL || FANCODE_DUMP}?_=${Date.now()}`, { fetchImpl });
    const rows = Array.isArray(payload?.matches) ? payload.matches : (Array.isArray(payload) ? payload : []);
    if (!rows.length) return { ok: false, rows: [], error: 'fancode: dump had no matches' };
    /* The dump is a snapshot someone publishes by hand. Its `last_updated` and its stream headers are the two
       facts we must pass down: the first tells the user how old the board is, the second is what the token
       accepts. A row without them is a row that will 403 in the player. */
    const headers = payload?.headers && typeof payload.headers === 'object' ? payload.headers : {};
    const dumpAt = TEXT(payload?.last_updated);
    return {
      ok: true,
      via: 'dump',
      note: dumpAt ? `dump dated ${dumpAt}` : 'dump carries no date',
      rows: rows.map((row) => ({ ...row, __headers: headers, __dumpAt: dumpAt })),
    };
  } catch (error) {
    return { ok: false, rows: [], error: `fancode: ${error.message}` };
  }
}

/**
 * The whole Sports feed in one call: three sources, merged, deduped, grouped, with per-source honesty.
 * `now` is a parameter so "starts in 1 h 24 m" and the live/soon split are testable, not clock-dependent.
 */
export async function loadFeed({ fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  const [bcciLive, bcciSoon, bcciDone, wt20, fancode] = await Promise.allSettled([
    loadBcciFeed({ feed: 'live', fetchImpl, env }),
    loadBcciFeed({ feed: 'upcoming', fetchImpl, env }),
    loadBcciFeed({ feed: 'recent', fetchImpl, env }),
    loadWt20Feed({ fetchImpl, env }),
    loadFancodeFeed({ fetchImpl, env }),
  ]);
  const settled = (slot, normalizer) => {
    const value = slot.status === 'fulfilled' ? slot.value : { ok: false, rows: [], error: slot.reason?.message || 'failed' };
    return {
      ok: Boolean(value.ok),
      items: (value.rows || []).map((row) => normalizer(row, { now })),
      error: value.error || '',
      via: value.via || '',
      note: value.note || '',
    };
  };
  const batches = [
    settled(bcciLive, (row, opts) => normalizeBcci(row, { feed: 'live', ...opts })),
    settled(bcciSoon, (row, opts) => normalizeBcci(row, { feed: 'upcoming', ...opts })),
    settled(bcciDone, (row, opts) => normalizeBcci(row, { feed: 'recent', ...opts })),
    settled(wt20, normalizeWt20),
    settled(fancode, normalizeFancode),
  ];
  const merged = mergeFeed({ batches, now });
  const liveCount = merged.items.filter((item) => item.state === 'live').length;
  const labels = ['bcci-live', 'bcci-upcoming', 'bcci-recent', 'icc-wt20', 'fancode'];
  return {
    ok: merged.items.length > 0,
    generatedAt: new Date(now).toISOString(),
    ...merged,
    ttlMs: liveCount ? FEED_TTL_LIVE_MS : FEED_TTL_IDLE_MS,
    sources: batches.map((batch, index) => ({
      id: labels[index],
      ok: batch.ok,
      count: batch.items.length,
      /* The FanCode dump is published by hand, so its age is printed next to everything it claims. */
      at: batch.items.find((item) => item.dumpAt)?.dumpAt || '',
      note: batch.ok ? [batch.via && `via ${batch.via}`, batch.note].filter(Boolean).join(' · ') : `unavailable · ${batch.error}`,
    })),
  };
}

/**
 * The feed behind a per-process cache, shared by `/api/sports/feed` and `/api/sports/hub` so opening a match does
 * not re-read five upstreams a second time. Live scores stay warm 20 s, an idle board 5 min, and a failure is
 * remembered for 5 s only — long enough that a sleeping free backend is not hammered, short enough that the
 * next reload is real. Concurrent requests share one in-flight read through `pending`.
 *
 * This is deliberately in-process: no Mongo, no cron, nothing that wakes an idle service.
 */
const FAILURE_TTL_MS = 5_000;

export async function cachedFeed({ fetchImpl = fetch, env = process.env, now = Date.now(), force = false } = {}) {
  const state = (globalThis.__jashSportsFeed ||= { at: 0, ttl: 0, payload: null, pending: null });
  const fresh = state.payload && state.at + state.ttl > now;
  if (fresh && !force) return { ...state.payload, cached: true, cachedAt: state.at };
  if (state.pending && !force) return state.pending;
  const run = (async () => {
    const started = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    try {
      const feed = await loadFeed({ fetchImpl, env, now: started });
      /* A board that came back with no matches is a failure of the sources, not a fact about the day: it is
         retried in seconds, and the ttl on the payload is what the route puts in Cache-Control, so both the
         cache and the browser have to be told the same window. */
      const payload = {
        ...feed,
        ttlMs: feed.ok ? (feed.ttlMs || FEED_TTL_IDLE_MS) : FAILURE_TTL_MS,
        cached: false,
        cachedAt: started,
        unavailable: !feed.ok,
      };
      state.at = started;
      state.ttl = payload.ttlMs;
      state.payload = payload;
      return payload;
    } catch (error) {
      const payload = {
        ok: false,
        unavailable: true,
        items: [],
        counts: { live: 0, soon: 0, done: 0, tbc: 0 },
        sources: [],
        note: error.message || 'no feed answered',
        ttlMs: 5_000,
        cached: false,
        cachedAt: started,
      };
      state.at = started;
      state.ttl = FAILURE_TTL_MS;
      state.payload = payload;
      return payload;
    } finally {
      state.pending = null;
    }
  })();
  state.pending = run;
  return run;
}

/** The card for one match, or `null`. The hub route reads it here so a match URL never has to carry a payload. */
export function findFeedItem(feed = {}, source = '', id = '') {
  const wanted = String(id || '');
  return (feed.items || []).find((item) => item.source === source && String(item.id) === wanted) || null;
}

/**
 * Merge + dedupe. The winner for a match is the row with the most to show: a stream first (so the Watch panel
 * survives), then any score line, then the source order the user trusts (BCCI, ICC, FanCode).
 */
export function mergeFeed({ batches = [] } = {}) {
  const order = { bcci: 0, ipl: 1, icc: 2, fancode: 3 };
  const byKey = new Map();
  for (const batch of batches) {
    for (const item of batch.items || []) {
      if (!item.home && !item.away && !item.scoreHome) continue;
      const key = matchKey(item);
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, { ...item, also: [] });
        continue;
      }
      const richer = score(item) - score(current);
      const betterSource = (order[current.source] ?? 9) - (order[item.source] ?? 9);
      const also = new Set([...(current.also || []), current.source, ...(item.source !== current.source ? [item.source] : [])]);
      /* FanCode lists one match once per audio feed (HINDI, BHOJPURI, …), which arrive as separate rows with the
         same teams and day. Keeping both `variants` is what makes the language picker real. */
      const mergedVariants = unionBy([...(current.variants || []), ...(item.variants || [])], (variant) => `${variant.url}|${variant.label}`);
      const mergedLinks = { ...item.links, ...current.links };
      const winner = richer > 0 || (richer === 0 && betterSource < 0) ? item : current;
      const loser = winner === item ? current : item;
      byKey.set(key, {
        ...winner,
        also: [...also],
        stream: current.stream || item.stream,
        cardId: current.cardId || item.cardId,
        links: mergedLinks,
        variants: mergedVariants,
        /* A field the winner does not have is taken from the other row rather than dropped: BCCI knows the
           toss sentence and the ground, FanCode knows the stream, and neither would know both alone. */
        toss: winner.toss || loser.toss || '',
        venue: winner.venue || loser.venue || '',
        playerOfMatch: winner.playerOfMatch || loser.playerOfMatch || '',
        coverage: winner.coverage || loser.coverage || '',
        standings: Boolean(winner.standings || loser.standings),
        poster: winner.poster || loser.poster || '',
        competitionId: winner.competitionId || loser.competitionId || '',
        gameId: winner.gameId || loser.gameId || '',
        teamIds: { ...loser.teamIds, ...winner.teamIds },
      });
    }
  }
  const items = [...byKey.values()].map((item) => ({
    ...item,
    href: `/sports/hub/${item.source}/${item.id}`,
    has: {
      scorecard: Boolean(item.cardId) || item.source === 'fancode',
      commentary: item.state === 'live',
      watch: canWatch(item),
    },
  }));
  items.sort((a, b) => rank(a) - rank(b) || dayValue(b) - dayValue(a) || text(a.competition).localeCompare(text(b.competition)));
  return { items, counts: countStates(items) };
}

const unionBy = (values, key) => {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
};

const text = (value) => String(value ?? '');
const score = (item) => (item.stream ? 4 : 0) + (item.scoreHome ? 2 : 0) + (item.scoreAway ? 1 : 0) + (item.result ? 1 : 0);
const rank = (item) => ({ live: 0, soon: 1, tbc: 2, done: 3 }[item.state] ?? 4);
const dayValue = (item) => (item.startAt ? new Date(item.startAt).getTime() : 0);
const countStates = (items) => items.reduce((acc, item) => ({ ...acc, [item.state]: (acc[item.state] || 0) + 1 }), { live: 0, soon: 0, done: 0, tbc: 0 });

/* ------------------------------------------------------------------ hub panels */

export function parseFanCodeState(html = '') {
  let index = String(html).indexOf('window.__INIT_STATE__');
  if (index < 0) return null;
  index = String(html).indexOf('{', index);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let k = index; k < html.length; k += 1) {
    const char = html[k];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) { end = k + 1; break; }
    }
  }
  if (end < 0) return null;
  try { return JSON.parse(html.slice(index, end)); } catch { return null; }
}

/** FanCode's `cricketScore.innings[]` rows, as published on the scorecard page. */
function fcInnings(inn = {}, teams = {}) {
  const attributes = (row = {}) => row.attributes || {};
  const nameOf = (value) => {
    const id = TEXT(value?.id ?? value?.Player_Id ?? value);
    return TEXT(value?.name ?? value?.Name_Full ?? value?.shortName) || TEXT(teams[id]) || TEXT(value?.shortName) || id;
  };
  return {
    number: inn.number,
    desc: TEXT(inn.inningDescription) || TEXT(inn.inningType),
    team: TEXT(inn.battingTeamShortName) || TEXT(teams[inn.battingTeamId]),
    runs: inn.runs,
    wickets: inn.wickets,
    overs: TEXT(inn.overs),
    runRate: inn.runRate,
    status: TEXT(inn.status),
    extras: inn.extras,
    fallOfWickets: Array.isArray(inn.fow) ? inn.fow.map((row) => ({
      runs: row?.runs,
      wicket: row?.wicketNo ?? row?.order,
      over: TEXT(row?.overBall ?? row?.overs),
      who: nameOf(row?.player),
    })) : [],
    partnerships: Array.isArray(inn.partnerships) ? inn.partnerships.map((row) => ({
      runs: row?.runs,
      balls: row?.balls,
      forWicket: row?.wicket ?? row?.forWicket,
      batsmen: (row?.batsmen || []).map((b) => ({ name: nameOf(b), runs: b?.runs, balls: b?.balls })),
    })) : [],
    batsmen: (inn.batsmen || []).map((b) => ({
      name: nameOf(b),
      runs: attributes(b).runs ?? b.runs ?? '',
      balls: attributes(b).balls ?? b.balls ?? '',
      fours: attributes(b).fours ?? b.fours ?? '',
      sixes: attributes(b).sixes ?? b.sixes ?? '',
      sr: attributes(b).strikeRate ?? b.strikeRate ?? '',
      dismissal: TEXT(b.description) || (b.status === 'OUT' ? 'out' : 'not out'),
      out: b.status === 'OUT',
    })),
    bowlers: (inn.bowlers || []).map((b) => ({
      name: nameOf(b),
      overs: attributes(b).overs ?? b.overs ?? '',
      maidens: attributes(b).maiden ?? b.maidens ?? '',
      runs: attributes(b).runs ?? b.runs ?? '',
      wickets: attributes(b).wickets ?? b.wickets ?? '',
      econ: attributes(b).econ ?? b.economy ?? '',
    })),
  };
}

/**
 * `assets-icc.sportz.io/cricket/v1/game/scorecard`. The rows key players by numeric id (`Batsman: "63992"`),
 * so `data.Teams{} → Players{}` is resolved first: without that map a scorecard of numbers is all you get.
 */
function iccScorecard(payload = {}) {
  const data = payload?.data || payload || {};
  /* `Teams` is keyed by team id and its `Players` by player id, and the innings rows point at both. Keeping one
     map for both is how a scorecard ends up reading `team 1121 · First` instead of `England · 1st innings`. */
  const teams = {};
  const players = {};
  for (const [teamId, team] of Object.entries(data.Teams || {})) {
    teams[teamId] = TEXT(team?.Name_Full, team?.Name_Short);
    for (const [id, player] of Object.entries(team?.Players || {})) players[id] = TEXT(player?.Name_Full, player?.Name_Short);
  }
  const inningsLabel = (inn = {}) => TEXT(inn.Inning) || ({ First: '1st innings', Second: '2nd innings', Third: '3rd innings', Fourth: '4th innings' })[TEXT(inn.Number)] || `Innings ${TEXT(inn.Number) || ''}`.trim();
  const extrasOf = (inn = {}) => ({
    byes: inn.Byes, legByes: inn.Legbyes, wides: inn.Wides, noBalls: inn.Noballs, penalties: inn.Penalty,
    total: [inn.Byes, inn.Legbyes, inn.Wides, inn.Noballs, inn.Penalty].reduce((sum, value) => sum + (Number(value) || 0), 0),
  });
  const innings = (Array.isArray(data.Innings) ? data.Innings : []).map((inn, index) => ({
    number: Number(inn.Number) || index + 1,
    desc: inningsLabel(inn),
    team: TEXT(inn.BattingTeam) || teams[String(inn.Battingteam)] || `team ${inn.Battingteam ?? ''}`.trim(),
    runs: FIRST(inn.Total, inn.Runs),
    wickets: FIRST(inn.Wickets),
    overs: TEXT(inn.Overs),
    runRate: FIRST(inn.Runrate, inn.RunRate),
    status: TEXT(inn.Status),
    extras: extrasOf(inn),
    fallOfWickets: (inn.FallofWickets || []).map((row) => ({
      runs: row?.Score, wicket: row?.Wicket_No, over: row?.Overs, who: players[String(row?.Batsman)] || TEXT(row?.Batsman),
    })),
    partnerships: (inn.Partnerships || []).map((row) => ({
      runs: row?.Runs,
      balls: row?.Balls,
      forWicket: row?.ForWicket,
      batsmen: (row?.Batsmen || []).map((b) => ({ name: players[String(b?.Batsman)] || TEXT(b?.Batsman), runs: b?.Runs, balls: b?.Balls })),
    })),
    powerplay: (inn.PowerPlayDetails || []).map((row) => ({ label: TEXT(row?.Name), overs: TEXT(row?.Overs), runs: row?.Runs, wickets: row?.Wickets })),
    batsmen: (inn.Batsmen || []).map((b) => ({
      name: players[String(b?.Batsman)] || TEXT(b?.Name_Full) || `player ${b?.Batsman ?? ''}`.trim(),
      runs: FIRST(b?.Runs), balls: FIRST(b?.Balls), fours: FIRST(b?.Fours), sixes: FIRST(b?.Sixes),
      dots: FIRST(b?.Dots), sr: FIRST(b?.Strikerate, b?.StrikeRate),
      dismissal: TEXT(b?.Howout_short) || TEXT(b?.Howout) || TEXT(b?.Dismissal) || (Number(b?.DismissalId) ? 'out' : 'not out'),
      out: Boolean(b?.Dismissal) && TEXT(b.Dismissal).toLowerCase() !== 'not out',
    })),
    bowlers: (inn.Bowlers || []).map((b) => ({
      name: players[String(b?.Bowler)] || TEXT(b?.Bowler) || `player ${b?.Bowler ?? ''}`.trim(),
      overs: FIRST(b?.Overs), maidens: FIRST(b?.Maidens), runs: FIRST(b?.Runs), wickets: FIRST(b?.Wickets),
      econ: FIRST(b?.Economyrate, b?.Economy), wides: FIRST(b?.Wides), noBalls: FIRST(b?.Noballs),
    })),
  }));
  const match = data.Matchdetail?.Match || {};
  const equation = data.Matchequation || {};
  const notes = Object.values(data.Notes || {}).flat().map(TEXT).filter(Boolean);
  /* The scorecard rows carry `wicket_url` — a page for the dismissal itself. These are the only videos the
     match's own data points at, so they are what the Video tab lists for an ICC match. */
  const videos = [];
  for (const inn of Array.isArray(data.Innings) ? data.Innings : []) {
    for (const b of inn.Batsmen || []) {
      const url = TEXT(b?.wicket_url);
      if (/^https:\/\//i.test(url)) videos.push({ kind: 'wicket', title: `${players[String(b?.Batsman)] || 'Wicket'} · ${TEXT(inn.Battingteam) && teams[String(inn.Battingteam)] ? `${teams[String(inn.Battingteam)]} ` : ''}dismissal`, url });
    }
  }
  return {
    innings,
    videos,
    /* Three URLs the ICC publishes on the match itself. They are the only honest way out of a match this app
       cannot stream, so the hub prints them as links rather than pretending to a player. */
    links: (() => {
      const at = (value) => {
        const raw = TEXT(value);
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        return `https://www.icc-cricket.com${raw.startsWith('/') ? '' : '/'}${raw}`;
      };
      const info = data.other_info || {};
      const out = { match: at(info.match_center), watch: at(info.watch_live), highlight: at(info.high_light) };
      return Object.fromEntries(Object.entries(out).filter(([, value]) => value));
    })(),
    summary: {
      match: TEXT(match.Number),
      venue: TEXT(data.Matchdetail?.Venue?.Name, data.Matchdetail?.Ground?.Name, data.Matchdetail?.Ground?.Name_Full),
      competition: TEXT(data.Matchdetail?.Series?.Name),
      date: TEXT(match.Date),
      type: TEXT(match.Type),
      status: TEXT(equation.Eq_type),
      result: TEXT(equation.Equation),
      playerOfMatch: TEXT((data.Matchdetail?.Awards || [])[0]?.Player_Name),
      live: TEXT(match.Live) === 'yes',
      coverage: TEXT(match.Coverage_level),
    },
    notes,
  };
}

function fanPageUrl(matchId, page) {
  return `https://www.fancode.com/cricket/tour/x/matches/x-${matchId}/${page}`;
}

/** `match-detail/{id}/CricketCommentary` → our ball rows, whatever spelling this build of the page used. */
function fanCommentaryRows(state, matchId) {
  const blob = state?.[`match-detail/${matchId}/CricketCommentary`];
  const rows = blob?.commentaryResponse;
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows;
}

/**
 * The two FanCode pages a hub needs: the scorecard page (the card itself, plus the canonical link) and the
 * commentary page (ball-by-ball, which the dump never carries). Both are scraped rather than fetched as JSON
 * because FanCode publishes this data only inside `window.__INIT_STATE__`; a page that has moved on is reported
 * as "no card", never as a zero.
 */
export async function loadFanCodeScorecard({ matchId, fetchImpl = fetch } = {}) {
  const clean = String(matchId || '').replace(/\D/g, '');
  if (!clean) return { ok: false, available: false, innings: [], commentaryRows: [], links: {}, error: 'no numeric match id on this card' };
  const [cardRes, commRes] = await Promise.allSettled([
    getJson(fanPageUrl(clean, 'scorecard'), { fetchImpl, headers: FC_HEADERS, text: true, timeoutMs: 12_000 }),
    getJson(fanPageUrl(clean, 'commentary'), { fetchImpl, headers: FC_HEADERS, text: true, timeoutMs: 12_000 }),
  ]);
  if (cardRes.status !== 'fulfilled') {
    return { ok: false, available: false, innings: [], commentaryRows: [], links: {}, error: cardRes.reason?.message || 'the scorecard page did not answer' };
  }
  const state = parseFanCodeState(cardRes.value);
  const detail = state?.[`match-detail/${clean}`];
  const links = {
    /* The pretty URL from the page is the one a human should land on; the `x-{id}` form we built to get there is
       the fallback, so an external link is never a dead end. */
    match: TEXT(detail?.matchUrl ? `https://www.fancode.com${detail.matchUrl}` : '') || TEXT(detail?.shareUrl) || fanPageUrl(clean, 'live-match-info'),
    scorecard: fanPageUrl(clean, 'scorecard'),
    commentary: fanPageUrl(clean, 'commentary'),
  };
  const commentaryRows = commRes.status === 'fulfilled' ? fanCommentaryRows(parseFanCodeState(commRes.value), clean) : [];
  const cricketScore = state?.[`match-detail/${clean}/CricketScorecard`]?.matchWithScore?.scorecard?.cricketScore;
  if (!cricketScore || !Array.isArray(cricketScore.innings) || !cricketScore.innings.length) {
    return { ok: true, available: false, innings: [], commentaryRows, links, description: '', error: 'the scorecard page carried no innings' };
  }
  const teams = {};
  for (const inn of cricketScore.innings) if (inn?.battingTeamShortName) teams[String(inn.battingTeamId ?? '')] = TEXT(inn.battingTeamShortName);
  return {
    ok: true,
    available: true,
    innings: cricketScore.innings.map((inn) => fcInnings(inn, teams)),
    commentaryRows,
    links,
    description: TEXT(cricketScore.description),
    currentRunRate: cricketScore.currentRunRate ?? null,
    requiredRunRate: cricketScore.requiredRunRate ?? null,
    atTheCrease: (cricketScore.cricketCurrentOverDetails?.batsmen || []).map((b) => ({
      name: TEXT(b?.name, b?.shortName),
      runs: FIRST(b?.attributes?.runs),
      balls: FIRST(b?.attributes?.balls),
      striker: TEXT(b?.status) === 'STRIKE',
    })).filter((b) => b.name),
  };
}

/** BCCI/IPL innings tables come through the same proxy the old hub used; shape is defensive because it varies. */
/**
 * `{MOVIES1_BACKEND}/api/cricket/innings` — verified live against a Duleep Trophy match, where the innings are
 * `BattingCard` / `BowlingCard` / `Extras[0]` / `FallOfWickets[]`. Reading `batsmen`/`batting` alone used to
 * return an empty card for every domestic match, which is why the scoreboard looked broken while the API was fine.
 */
function backendInnings(payload, teamIds = {}) {
  const raw = payload?.innings || payload?.data?.innings || payload?.Innings || payload?.data?.Innings || (Array.isArray(payload) ? payload : null);
  if (!Array.isArray(raw)) return [];
  const name = (player = {}) => TEXT(player.PlayerName, player.BatsmanName, player.BowlerName, player.battingPlayerName, player.name, player.shortName);
  const extrasOf = (inn) => {
    const box = Array.isArray(inn.Extras) ? inn.Extras[0] : (inn.Extras || inn.extras);
    if (!box || typeof box !== 'object') return null;
    return {
      byes: FIRST(box.Byes, box.byes), legByes: FIRST(box.LegByes, box.legByes, box.Legbyes),
      wides: FIRST(box.Wides, box.wides), noBalls: FIRST(box.NoBalls, box.Noballs, box.noBalls),
      penalties: FIRST(box.Penalty, box.Penalties, box.penalties), total: FIRST(box.Total, box.total),
    };
  };
  return raw.map((inn, index) => ({
    number: Number(inn.number || inn.inningsNumber || inn.Number) || index + 1,
    desc: TEXT(inn.inningsDescription || inn.desc || inn.inningDescription || inn.Inning),
    team: TEXT(inn.battingTeamShortName || inn.teamShortName || inn.team) || TEXT(teamIds[String(inn.BattingTeamID ?? '')]) || '',
    battingTeamId: TEXT(inn.BattingTeamID, inn.Battingteam),
    runs: FIRST(inn.Total, inn.runs, inn.total),
    wickets: FIRST(inn.Wickets, inn.wickets, inn.totalWickets),
    overs: TEXT(inn.Overs ?? inn.overs ?? inn.totalOvers),
    runRate: FIRST(inn.RunRate, inn.runRate),
    status: TEXT(inn.status ?? ''),
    extras: extrasOf(inn),
    fallOfWickets: (inn.FallOfWickets || inn.fows || []).map((row) => ({
      runs: FIRST(row.Runs, row.runs, row.Score),
      wicket: FIRST(row.Wickets, row.Wicket_No, row.wicket),
      over: FIRST(row.Overs, row.overs),
      who: name(row.player) || TEXT(row.PlayerName, row.playerName, row.batsman),
    })),
    partnerships: (inn.PartnershipScores || inn.partnerships || []).map((row) => ({
      runs: FIRST(row.Runs, row.runs),
      balls: FIRST(row.Balls, row.balls),
      forWicket: FIRST(row.ForWicket, row.forWicket),
      batsmen: (row.Batsmen || row.batsmen || []).map((b) => ({ name: name(b), runs: FIRST(b.Runs, b.runs), balls: FIRST(b.Balls, b.balls) })),
    })),
    batsmen: (inn.BattingCard || inn.battings || inn.batsmen || []).map((b) => ({
      name: name(b),
      runs: FIRST(b.Runs, b.runs, b.R),
      balls: FIRST(b.Balls, b.balls, b.B),
      fours: FIRST(b.Fours, b.fours, b['4s']),
      sixes: FIRST(b.Sixes, b.sixes, b['6s']),
      dots: FIRST(b.Dots, b.dots),
      sr: FIRST(b.StrikeRate, b.strikeRate, b.SR),
      dismissal: TEXT(b.HowOut, b.OutDesc, b.dismissalText, b.dismissals),
      out: b.IsOut === true || (b.isOut !== false && Boolean(b.HowOut || b.OutDesc)),
      battingOrder: FIRST(b.BattingOrder, b.Number),
    })).filter((b) => b.name),
    bowlers: (inn.BowlingCard || inn.bowlings || inn.bowlers || []).map((b) => ({
      name: name(b),
      overs: FIRST(b.Overs, b.overs, b.O),
      maidens: FIRST(b.Maidens, b.maidens, b.M),
      runs: FIRST(b.Runs, b.runs, b.R),
      wickets: FIRST(b.Wickets, b.wickets, b.W),
      econ: FIRST(b.Economy, b.economy, b.Econ),
      wides: FIRST(b.Wides, b.wides),
      noBalls: FIRST(b.NoBalls, b.noballs),
    })).filter((b) => b.name),
  }));
}

/** Innings are the scoreboard: pick the newest one and say which innings it is. */
export function scorecardView(innings = []) {
  if (!innings.length) return { innings: [], activeIndex: 0, available: false };
  return { innings, activeIndex: innings.length - 1, available: true };
}

function summaryFields(summary = {}) {
  const raw = summary?.data || summary?.MatchSummary || summary?.Matchsummary || summary || {};
  const pick = (...keys) => FIRST(...keys.map((key) => raw?.[key]));
  return {
    competition: pick('CompetitionName', 'SeriesName'),
    venue: pick('GroundName', 'VenueName', 'Venue'),
    match: pick('MatchOrder', 'MatchName', 'MatchNo'),
    date: pick('MatchDate', 'MatchDateNew'),
    toss: pick('TossDetails', 'Toss', 'TossText'),
    result: pick('Comments', 'Result', 'MatchResult', 'ResultText'),
    statusText: pick('MatchStatus', 'Status'),
    format: pick('MatchType', 'Format'),
    homeLine: bcciScores(raw, 1),
    awayLine: bcciScores(raw, 2),
    home: FIRST(raw.HomeTeamName, raw.Team1Name, raw.team1, raw.home),
    away: FIRST(raw.AwayTeamName, raw.Team2Name, raw.team2, raw.away),
  };
}

/** What the hub can say about a match from the feed row alone — the labels on the Info tab. */
function seedFields(seed = {}) {
  const out = {
    competition: TEXT(seed.competition),
    match: TEXT(seed.matchOrder),
    venue: TEXT(seed.venue),
    home: TEXT(seed.home),
    away: TEXT(seed.away),
    result: TEXT(seed.result),
    statusText: TEXT(seed.statusLine),
    format: TEXT(seed.inningsKind),
    toss: TEXT(seed.toss),
    playerOfMatch: TEXT(seed.playerOfMatch),
    coverage: TEXT(seed.coverage),
  };
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

function mergeFields(...groups) {
  const out = {};
  for (const group of groups) for (const [key, value] of Object.entries(group || {})) if (value && !out[key]) out[key] = value;
  return out;
}

const COMMENT_SOURCE = {
  icc: 'ICC ball-by-ball',
  fancode: 'FanCode commentary page',
};

/**
 * The ICC's own published video list (17 items, no per-match key on it). Nothing here claims to be *this* match's
 * highlights unless the title names both teams or the series, and that is printed as the reason it is showing.
 */
export async function loadIccHighlights({ fetchImpl = fetch, env = process.env, item = {} } = {}) {
  const needles = [item.home, item.away, item.homeCode, item.awayCode, item.competition, item.series]
    .map((value) => TEXT(value).toLowerCase())
    .filter((value) => value.length > 2);
  try {
    const payload = await getJson(`${sportsBackend(env)}/api/icc/highlights?limit=24`, { fetchImpl });
    const rows = Array.isArray(payload?.videos) ? payload.videos : [];
    const videos = rows.map((row) => {
      const title = TEXT(row?.title);
      const matched = needles.length > 1 && needles.filter((needle) => title.toLowerCase().includes(needle)).length >= 2;
      return { kind: 'video', id: TEXT(row?.uuid), title, image: TEXT(row?.image), matched };
    }).filter((video) => video.id && video.title);
    if (!videos.length) return { ok: false, videos: [], error: 'the highlights feed answered with no videos' };
    return { ok: true, videos: videos.sort((a, b) => Number(b.matched) - Number(a.matched)) };
  } catch (error) {
    return { ok: false, videos: [], error: `highlights: ${error.message}` };
  }
}

/**
 * Everything the hub shows for one match, in one response — four requests at most (scorecard, commentary,
 * summary, innings) and only the ones this source can answer. A panel that has nothing says which feed was
 * empty, so the page never has to print a blank shell and never has to invent a number to fill it.
 */
export async function loadHub({ source = 'bcci', id = '', seed = {}, fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  const clean = ID(id);
  if (!clean) return { ok: false, error: 'This match id is not something a feed gave us, so there is nothing to open.' };
  const panels = {};
  const fail = (label, error) => ({ state: 'unavailable', source: label, note: `waking the score feed · ${error.message || error}` });
  const live = seed.state === 'live';
  let links = { ...(seed.links || {}) };
  let commentaryRows = [];
  let commentarySource = COMMENT_SOURCE[source] || 'the match feed';
  let iccVideos = [];
  let iccVideoNote = '';
  let extrasFromCard = {};

  if (source === 'fancode') {
    const fc = await loadFanCodeScorecard({ matchId: clean, fetchImpl });
    panels.scorecard = fc.available
      ? { state: 'ok', source: 'FanCode scorecard page', ...scorecardView(fc.innings) }
      : { state: 'empty', source: 'FanCode scorecard page', note: fc.error || 'no innings on the page' };
    commentaryRows = fc.commentaryRows || [];
    links = { ...links, ...(fc.links || {}) };
    if (fc.description) extrasFromCard = { result: fc.description };
    if (fc.atTheCrease?.length) extrasFromCard.atTheCrease = fc.atTheCrease;
    if (fc.currentRunRate) extrasFromCard.currentRunRate = fc.currentRunRate;
    if (fc.requiredRunRate) extrasFromCard.requiredRunRate = fc.requiredRunRate;
  } else if (source === 'icc') {
    const cardTask = loadIccJson({ path: 'game/scorecard', params: { client_id: ICC_CLIENT_ID, feed_format: 'json', game_id: clean, lang: 'en' }, fetchImpl, env });
    const wantsCommentary = live || /ball[- ]by[- ]ball/i.test(TEXT(seed.coverage));
    const commTask = wantsCommentary
      ? loadIccJson({ path: 'game/commentary', params: { client_id: ICC_CLIENT_ID, feed_format: 'json', game_id: clean, inning: ID(seed.currentInnings) || '1', key_event: 'false', lang: 'en', page_number: '1', page_size: '80' }, fetchImpl, env })
      : Promise.reject(new Error('this match is not flagged for ball-by-ball coverage'));
    const [cardRes, commRes, highRes] = await Promise.allSettled([cardTask, commTask, loadIccHighlights({ fetchImpl, env, item: seed })]);
    let iccCard = null;
    if (cardRes.status === 'fulfilled') {
      const card = iccScorecard(cardRes.value);
      iccCard = card;
      links = { ...links, ...(card.links || {}) };
      panels.scorecard = card.innings.length
        ? { state: 'ok', source: 'ICC sportz.io', ...scorecardView(card.innings) }
        : { state: 'empty', source: 'ICC sportz.io', note: 'the scorecard endpoint answered with no innings' };
      extrasFromCard = { ...seedFields({ ...card.summary }), ...(card.notes?.length ? { notes: card.notes } : {}) };
      if (!iccCard.summary?.venue && seed.venue) extrasFromCard.venue = TEXT(seed.venue);
      if (!live && !extrasFromCard.result) extrasFromCard.result = '';
    } else {
      panels.scorecard = fail('ICC scorecard', cardRes.reason);
    }
    if (commRes.status === 'fulfilled') commentaryRows = commRes.value?.data?.Commentary || commRes.value?.Commentary || [];
    /* An unflagged match rejects its own commentary task on purpose, so that rejection is a sentence about the
       source, not a failure to report. `fail` is only for a request that was actually made. */
    else if (!wantsCommentary) panels.commentary = { state: 'empty', source: 'ICC ball-by-ball', note: 'the ICC feed flags this match as scores-only, so there are no ball rows to list' };
    else panels.commentary = fail('ICC commentary', commRes.reason);
    iccVideos = [...((highRes.status === 'fulfilled' && highRes.value.ok) ? highRes.value.videos : []), ...(iccCard?.videos || [])];
    if (highRes.status === 'fulfilled' && !highRes.value.ok) iccVideoNote = highRes.value.error;
  } else {
    const summaryQuery = new URLSearchParams({ matchID: clean });
    if (seed.competitionId) summaryQuery.set('competitionID', ID(seed.competitionId));
    if (seed.matchOrder) summaryQuery.set('matchOrder', TEXT(seed.matchOrder).slice(0, 24));
    const inningsQuery = new URLSearchParams({ type: source === 'ipl' ? 'ipl' : 'bcci', id: clean });
    if (/test|first-class/i.test(TEXT(seed.inningsKind))) inningsQuery.set('test', '1');
    const summaryTask = source === 'ipl'
      ? getJson(`${sportsBackend(env)}/api/match/${encodeURIComponent(clean)}/summary`, { fetchImpl })
      : getJson(`${sportsBackend(env)}/api/bcci/match?${summaryQuery}`, { fetchImpl });
    const inningsTask = getJson(`${sportsBackend(env)}/api/cricket/innings?${inningsQuery}`, { fetchImpl });
    const [summaryRes, inningsRes] = await Promise.allSettled([summaryTask, inningsTask]);
    const fields = summaryRes.status === 'fulfilled' ? summaryFields(summaryRes.value) : {};
    if (summaryRes.status === 'fulfilled') panels.summary = { state: 'ok', source: source === 'ipl' ? 'movies1 match summary' : 'BCCI match', fields };
    else panels.summary = fail(source === 'ipl' ? 'IPL summary' : 'BCCI match', summaryRes.reason);
    if (inningsRes.status === 'fulfilled') {
      const innings = backendInnings(inningsRes.value, seed.teamIds);
      panels.scorecard = innings.length
        ? { state: 'ok', source: `${source === 'ipl' ? 'IPL' : 'BCCI'} innings`, ...scorecardView(innings) }
        : { state: 'empty', source: `${source === 'ipl' ? 'IPL' : 'BCCI'} innings`, note: 'the innings endpoint answered with no card' };
    } else {
      panels.scorecard = fail(`${source === 'ipl' ? 'IPL' : 'BCCI'} innings`, inningsRes.reason);
    }
    /* BCCI/IPL publish summaries, not ball-by-ball. There is no commentary tab for these, by their own design. */
    panels.commentary = { state: 'empty', source: 'no commentary feed for this source', note: 'this feed publishes the summary line only, so there is no ball-by-ball list to show' };
    extrasFromCard = fields;
  }

  if (panels.scorecard?.state === 'empty' && panels.summary?.state === 'ok') {
    panels.scorecard = { ...panels.scorecard, note: `${panels.scorecard.note}; the Match info panel still has this feed's own lines` };
  }

  const commentary = commentaryView(commentaryRows);
  if (panels.commentary?.state !== 'empty') {
    panels.commentary = commentary.available
      ? { state: 'ok', source: commentarySource, ...commentary }
      : { state: 'empty', source: commentarySource, note: 'the commentary endpoint answered and had no balls for this innings yet' };
  }

  panels.info = {
    state: 'ok',
    source: panels.summary?.state === 'ok' ? panels.summary.source : 'the match feed',
    fields: mergeFields(extrasFromCard, panels.summary?.state === 'ok' ? panels.summary.fields : {}, seedFields(seed)),
    links,
    startAt: seed.startAt || null,
    timeKnown: seed.timeKnown !== false,
    standings: Boolean(seed.standings),
  };
  delete panels.summary;

  const variants = (seed.variants || []).filter((variant) => variant && variant.url);
  const extraVideos = source === 'icc' ? iccVideos : [];
  const playable = variants.filter((variant) => !variant.unavailable && variant.url);
  const reasons = [];
  if (!playable.length) {
    if (!variants.length) reasons.push(source === 'bcci' || source === 'ipl' ? 'this feed publishes scores only — no stream is offered for it here' : 'the match feed carried no stream for this match');
    else reasons.push(FIRST(...variants.map((variant) => variant.unavailable)) || 'the stream on this card is not playable right now');
  }
  if (extraVideos.length) {
    const library = extraVideos.filter((video) => video.kind === 'video');
    const clips = extraVideos.filter((video) => video.kind === 'wicket');
    const matched = library.filter((video) => video.matched).length;
    reasons.length = 0;
    if (library.length) reasons.push(matched ? `${matched} of ${library.length} titles on the video feed name both sides of this fixture` : `${library.length} videos on this feed, none of them titled for this fixture`);
    if (clips.length) reasons.push(`${clips.length} dismissal clip${clips.length === 1 ? '' : 's'} the scorecard itself points at`);
  } else if (iccVideoNote) {
    reasons.push(iccVideoNote);
  }
  panels.video = {
    state: playable.length || extraVideos.length || links.match || links.highlight || links.watch ? 'ok' : 'empty',
    source: 'the match feed',
    playable,
    items: extraVideos,
    variants,
    links,
    note: playable.length ? `${playable.length} stream${playable.length > 1 ? 's' : ''} the player can take${extraVideos.length ? ` · ${extraVideos.length} video${extraVideos.length === 1 ? '' : 's'}` : ''}` : reasons.join(' · '),
  };

  return {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    match: {
      ...seed,
      ...panels.info.fields,
      source,
      id: clean,
      href: `/sports/hub/${source}/${clean}`,
      links,
      variants,
      panels: Object.keys(panels).filter((key) => panels[key]?.state === 'ok'),
    },
    panels,
    refreshInMs: live && panels.scorecard?.state === 'ok' ? FEED_TTL_LIVE_MS : FEED_TTL_IDLE_MS,
  };
}

/** Tab titles, exactly one place. */
export function panelTitle(key) {
  return { live: 'Live Score', video: 'Video Highlights', info: 'Match Info', scorecard: 'Scorecard', commentary: 'Ball by ball' }[key] || key;
}
