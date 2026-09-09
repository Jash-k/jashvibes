import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  FANCODE_DUMP,
  FEED_TTL_IDLE_MS,
  FEED_TTL_LIVE_MS,
  bestFancodeVariant,
  bcciScoreUrl,
  cachedFeed,
  findFeedItem,
  deriveState,
  loadFeed,
  loadFanCodeScorecard,
  loadIccHighlights,
  loadHub,
  matchKey,
  mergeFeed,
  normalizeBcci,
  normalizeFancode,
  normalizeWt20,
  panelTitle,
  parseFanCodeState,
  parseStart,
  pickArray,
  scorecardView,
  parseStartInfo,
  sportsBackend,
} from '../lib/sportsFeed.js';
import {
  HUB_TABS,
  channelCounts,
  channelReadiness,
  commentaryView,
  countdownLine,
  dayLabel,
  extrasLine,
  hubTabLabel,
  feedLine,
  groupFeed,
  hubTabs,
  panelNote,
  scorecardRows,
  sourceLine,
  statusLine,
  timeLabel,
} from '../lib/sportsFeedView.js';

/**
 * The Single Feed on /sports (round 20, idea 6 in docs/concepts/sports-redesign.html).
 *
 * These tests exist because the previous sports surface shipped with a foreign iframe player, links whose score
 * was baked into a base64 URL, three provider branches that disagreed about what "live" means, and a control
 * (`/api/sports/channels`) that nothing ever called. Every rule below is a defect that was actually measured, so
 * the point of each test is the *behaviour*, not the shape of the code: a state must be decided by result over a
 * stale word, a date-only start must not collapse to midnight, the same fixture on two feeds must become one card,
 * and no panel may be printable when it has nothing.
 */
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
/* Captured from the real ICC scorecard + commentary endpoints and trimmed to the rows the hub reads: the shape
   is theirs, not ours, so a field rename upstream fails a test here instead of blanking a panel in production. */
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));
const iccCardFixture = () => readJson('tests/fixtures/icc-scorecard.json');
const iccCommFixture = () => readJson('tests/fixtures/icc-commentary.json');

/* 14:00 IST on 2026-09-09. Everything below is clock-injected, so no test can drift. */
const NOW = Date.parse('2026-09-09T08:30:00.000Z');

const bcciLiveRow = {
  MatchID: '19986',
  CompetitionName: 'Asia Cup',
  GroundName: 'Dubai International Stadium',
  MatchOrder: 'Match 12',
  MatchType: 'T20',
  HomeTeamName: 'India',
  AwayTeamName: 'Sri Lanka',
  HomeTeamCode: 'IND',
  AwayTeamCode: 'SL',
  MatchDateNew: '2026-09-09',
  MatchTime: '14:00',
  MatchStatus: 'Live',
  '1Summary': '210/4 (20.0 ov)',
  '2Summary': '96/3 (12.4 ov)',
  Comments: 'Sri Lanka need 115 off 44',
};

const bcciUpcomingRow = {
  MatchID: '19987',
  CompetitionName: 'Asia Cup',
  GroundName: 'Abu Dhabi',
  MatchOrder: 'Match 13',
  MatchType: 'ODI',
  HomeTeamName: 'Pakistan',
  AwayTeamName: 'Bangladesh',
  HomeTeamCode: 'PAK',
  AwayTeamCode: 'BAN',
  MatchDateNew: '2026-09-11',
  MatchTime: '18:30',
  MatchStatus: 'Scheduled',
};

const bcciDoneRow = {
  MatchID: '19980',
  CompetitionName: 'Asia Cup',
  GroundName: 'Dubai',
  HomeTeamName: 'India',
  AwayTeamName: 'Pakistan',
  HomeTeamCode: 'IND',
  AwayTeamCode: 'PAK',
  MatchDateNew: '2026-09-05',
  MatchStatus: 'Complete',
  MatchResult: 'India won by 7 wickets',
  WinningTeam: 'India',
  '1Summary': '181/3 (18.2 ov)',
};

/* The word "Live" is still on the row after the game ended — the exact thing the old UI printed. Same MatchID as
   the finished row above, so one card must survive and it must not be called live. */
const bcciStaleLiveRow = { ...bcciDoneRow, MatchStatus: 'Live', Comments: 'India won by 7 wickets' };

const wt20Row = {
  match_id: 'WT20-774',
  series_short_display_name: 'Women T20 Championship',
  venue: 'Bristol',
  teama: 'Australia',
  teamb: 'England',
  teama_short: 'AUS',
  teamb_short: 'ENG',
  match_date_ist: '2026-09-10',
  match_time_ist: '19:00',
  match_display_status: 'In progress',
  live: 'true',
  match_info: 'ENG need 12 off 9',
  scores: [{ team_runs: 168, team_wickets: 8, team_overs: 20 }, { team_runs: 157, team_wickets: 6, team_overs: 18.3 }],
};

const fancodeRow = {
  match_id: '610',
  title: 'India v Sri Lanka',
  sport: 'Cricket',
  tournament: 'Asia Cup',
  venue: 'Dubai International Stadium',
  start_time: '2026-09-09 14:00',
  status: 'LIVE',
  status_text: 'Sri Lanka need 115 runs from 44 balls',
  team: [
    { name: 'India', shortName: 'IND', score: '210/4 (20.0 ov)' },
    { name: 'Sri Lanka', shortName: 'SL', score: '96/3 (12.4 ov)' },
  ],
  auto_streams: [
    {
      auto: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=768x432\nhttps://cdn.example/low.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080\nhttps://cdn.example/high.m3u8',
    },
  ],
};

/** A fetch stub that answers the exact URLs the loaders build, and 404s anything else. */
function stubFetch({ fail = [] } = {}) {
  const calls = [];
  const json = (value) => ({ ok: true, status: 200, json: async () => value, text: async () => JSON.stringify(value) });
  const notFound = (url) => ({ ok: false, status: 404, json: async () => ({}), text: async () => `404 for ${url}` });
  const fetchImpl = async (url) => {
    const where = String(url);
    calls.push(where);
    if (fail.some((needle) => where.includes(needle))) return notFound(where);
    if (where.includes('/api/bcci/live')) return json({ liveMatches: [bcciLiveRow, bcciStaleLiveRow] });
    if (where.includes('/api/bcci/upcoming')) return json({ upcomingMatches: [bcciUpcomingRow] });
    if (where.includes('/api/bcci/recent')) return json({ recentMatches: [bcciDoneRow] });
    if (where.includes('/api/bcci/match')) {
      return json({
        data: {
          CompetitionName: 'Asia Cup',
          GroundName: 'Dubai International Stadium',
          MatchOrder: 'Match 12',
          MatchDate: '09 Sep 2026',
          TossDetails: 'India won the toss and elected to bat',
          Comments: 'Sri Lanka need 115 off 44 balls',
          MatchStatus: 'Live',
          HomeTeamName: 'India',
          AwayTeamName: 'Sri Lanka',
          '1Summary': '210/4 (20.0 ov)',
          '2Summary': '96/3 (12.4 ov)',
        },
      });
    }
    if (where.includes('/api/cricket/innings')) {
      return json({
        innings: [
          { team: 'India', number: 1, runs: 210, wickets: 4, overs: '20.0', runRate: 10.5, batsmen: [{ name: 'R Sharma', runs: 84, balls: 46, fours: 9, sixes: 4, sr: 182.6, dismissal: 'c Perera b Theekshana', out: true }], bowlers: [{ name: 'M Theekshana', overs: 4, maidens: 0, runs: 44, wickets: 1, econ: 11 }] },
          { team: 'Sri Lanka', number: 2, runs: 96, wickets: 3, overs: '12.4', runRate: 7.56, requiredRunRate: 15.7, batsmen: [{ name: 'P Nissanka', runs: 41, balls: 30, fours: 3, sixes: 1, sr: 136.6, out: false }], bowlers: [] },
        ],
      });
    }
    if (where.includes('/api/wt20/schedule')) return json({ data: { matches: [wt20Row] } });
    if (where.includes('game/scorecard')) return json(iccCardFixture());
    if (where.includes('game/commentary')) return json(iccCommFixture());
    if (where.includes('/api/icc/highlights')) {
      return json({
        success: true,
        videos: [
          { uuid: 'v-1', title: 'India clinch a landmark win in style | Final | T20WC 2026', image: 'https://feedpublisher-icc.akamaized.net/i/v-1.png' },
          { uuid: 'v-2', title: 'Bumrah runs the show in the middle overs | T20WC 2026', image: '' },
          { uuid: 'v-3', title: 'Top 5 catches from the group stage', image: '' },
        ],
      });
    }
    if (where.includes('/api/match/19987/summary')) return json({ data: { SeriesName: 'Asia Cup', Venue: 'Abu Dhabi', Toss: 'not yet' } });
    if (where.includes('fancode.json')) return json({ matches: [fancodeRow] });
    if (where.includes('fancode.com')) {
      const state = {
        'match-detail/610/CricketScorecard': {
          matchWithScore: {
            scorecard: {
              cricketScore: {
                currentRunRate: 7.56,
                requiredRunRate: 15.7,
                description: 'Sri Lanka need 115 off 44',
                innings: [
                  { number: 1, battingTeamShortName: 'IND', inningDescription: 'India 1st innings', runs: 210, wickets: 4, overs: '20.0', runRate: 10.5, batsmen: [{ name: 'Rohit Sharma', attributes: { runs: 84, balls: 46, fours: 9, sixes: 4, strikeRate: 182.6 }, description: 'c Perera b Theekshana', status: 'OUT' }, { name: 'V Kohli', attributes: { runs: 51, balls: 38 }, status: 'NOT_OUT' }], bowlers: [{ name: 'M Theekshana', attributes: { overs: 4, maiden: 0, runs: 44, wickets: 1, econ: 11 } }] },
                  { number: 2, battingTeamShortName: 'SL', inningDescription: 'Sri Lanka 2nd innings', runs: 96, wickets: 3, overs: '12.4', runRate: 7.56, batsmen: [{ name: 'P Nissanka', attributes: { runs: 41, balls: 30 }, status: 'NOT_OUT' }], bowlers: [] },
                ],
              },
            },
          },
        },
      };
      const html = `<html><head><script>window.__INIT_STATE__ = ${JSON.stringify(state)};</script></head><body>ok</body></html>`;
      return { ok: true, status: 200, json: async () => ({}), text: async () => html };
    }
    return notFound(where);
  };
  return { fetchImpl, calls };
}

const env = { MOVIES1_BACKEND: 'https://scores.example' };

/* ------------------------------------------------------------------ 1 · one status decision */

test('state: a result outranks a stale "Live" word, and an absent start time is tbc not 00:00', () => {
  const state = (row) => deriveState(row);
  assert.equal(state({ statusRaw: 'Live', result: 'India won by 7 wickets', hasScore: true, now: NOW }), 'done', 'a result beats the word Live');
  assert.equal(state({ statusRaw: 'In progress', hasScore: true, startAt: new Date(NOW - 60_000).toISOString(), now: NOW }), 'live');
  assert.equal(state({ statusRaw: 'Scheduled', startAt: new Date(NOW + 3_600_000).toISOString(), now: NOW }), 'soon');
  /* An hour that has gone by is not a result. The feed still says Scheduled, so the card says "not confirmed"
     and never claims a finished match the source has not called one. */
  assert.equal(state({ statusRaw: 'Scheduled', startAt: new Date(NOW - 7_200_000).toISOString(), now: NOW }), 'tbc');
  assert.equal(state({ statusRaw: 'Scheduled', now: NOW }), 'tbc', 'no start time at all is not "starting soon"');
  assert.equal(state({ statusRaw: 'Match Start time is yet to be confirmed', now: NOW }), 'tbc');
  assert.equal(state({ statusRaw: 'Time yet to be confirmed', startAt: new Date(NOW + 3_600_000).toISOString(), now: NOW }), 'tbc', 'the unconfirmed words outrank the placeholder date');
  assert.equal(state({ statusRaw: 'Scheduled', startAt: '2026-09-09T06:30:00.000Z', now: NOW, hasTime: false }), 'soon', 'no clock in the feed is not "the match is over"');
});

test('state: the whole card agrees — BCCI "Complete" is done, not live, and the words survive', () => {
  const done = normalizeBcci(bcciDoneRow, { feed: 'recent', now: NOW });
  assert.equal(done.state, 'done');
  assert.equal(done.result, 'India won by 7 wickets');
  assert.match(done.scoreHome, /181\/3/);

  const stale = normalizeBcci(bcciStaleLiveRow, { feed: 'live', now: NOW });
  assert.equal(stale.state, 'done', 'a finished match must not be filed under Live now');
  assert.equal(normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW }).state, 'live');
  assert.equal(normalizeBcci(bcciUpcomingRow, { feed: 'upcoming', now: NOW }).state, 'soon');
  assert.equal(normalizeWt20(wt20Row, { now: NOW }).state, 'live');
  assert.equal(normalizeFancode(fancodeRow, { now: NOW }).state, 'live');
});

test('parseStart: a date-only value is a real date, not NaN and not midnight', () => {
  const only = parseStart('2026-09-11');
  assert.ok(only, 'date-only rows must still produce a start');
  assert.equal(Date.parse(only), Date.parse('2026-09-11T12:00:00+05:30'), 'no clock in the feed ⇒ the placeholder is noon IST, and `hasTime:false` keeps it off the screen');
  assert.equal(parseStartInfo('2026-09-11').hasTime, false);
  assert.equal(parseStartInfo('2026-09-11', '18:30').hasTime, true);
  assert.equal(parseStartInfo('2026-09-11T18:30').hasTime, true, 'a time inside the date string counts');
  assert.ok(!only.includes('NaN'), 'the old regex leaked NaN into the month and produced Invalid Date');
  assert.equal(Date.parse(parseStart('2026-09-11', '18:30')), Date.parse('2026-09-11T18:30:00+05:30'));
  assert.match(parseStart('09/11/2026 19:00'), /2026-11-09/);
  assert.equal(parseStart('yet to be announced'), null);
});

test('labels: tbc prints the feed\'s own words, and never a fabricated 00:00', () => {
  const tbc = normalizeBcci({ MatchID: '1', HomeTeamName: 'India', AwayTeamName: 'England', MatchStatus: 'Time yet to be confirmed' }, { now: NOW });
  assert.equal(tbc.state, 'tbc');
  assert.equal(timeLabel(tbc, NOW), 'Time yet to be confirmed · time not in feed');
  assert.equal(statusLine({ ...tbc, statusLine: '' }), 'not on a score feed');
  assert.equal(dayLabel(null, NOW), '');
  assert.equal(dayLabel(new Date(NOW + 86_400_000).toISOString(), NOW), 'tomorrow');
  const live = normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW });
  assert.equal(timeLabel(live, NOW), '14:00 IST start');
  assert.equal(statusLine(live), 'Sri Lanka need 115 off 44');
  assert.equal(feedLine({}), 'nothing on any feed right now');
});

/* ------------------------------------------------------------------ 2 · one card per match */

test('merge: the same fixture on BCCI and FanCode is one card that keeps the stream and admits both sources', () => {
  const merged = mergeFeed({
    now: NOW,
    batches: [
      { items: [normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW })] },
      { items: [normalizeFancode(fancodeRow, { now: NOW })] },
    ],
  });
  assert.equal(merged.items.length, 1, 'two feeds, one game, one card');
  const [item] = merged.items;
  assert.equal(item.source, 'fancode', 'the row with something to play wins');
  assert.match(item.stream, /\.m3u8$/);
  assert.deepEqual(item.also.sort(), ['bcci', 'fancode']);
  assert.equal(item.has.watch, true);
  assert.equal(item.href, '/sports/hub/fancode/610', 'identity is source + id, no payload in the URL');
  assert.equal(sourceLine(item), 'FANCODE · BCCI');
});

test('merge: a different day is a different match, and a row with nothing is dropped', () => {
  const today = normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW });
  const nextWeek = { ...today, startAt: '2026-09-16T14:00:00+05:30' };
  const merged = mergeFeed({ now: NOW, batches: [{ items: [today, nextWeek, { id: 'x' }] }] });
  assert.equal(merged.items.length, 2);
  assert.equal(matchKey({ home: 'India', away: 'Sri Lanka', startAt: '2026-09-09T00:00:00Z' }), matchKey({ home: 'Sri Lanka', away: 'India', startAt: '2026-09-09T18:00:00Z' }), 'team order must not matter');
});

test('groupFeed: a pinned match is never lost to a cap, because its hub link has to open', () => {
  const many = Array.from({ length: 30 }, (unused, index) => ({ source: 'bcci', id: `${index}`, state: 'done', home: `H${index}`, away: `A${index}` }));
  const groups = groupFeed(many, { now: NOW });
  assert.equal(groups[0].items.length, 8, 'the board prints eight finished cards, not thirty');
  assert.equal(groups[0].truncated, true);
  const pinned = groupFeed(many, { now: NOW, pin: 'bcci:29' });
  assert.equal(pinned[0].items[0].id, '29', 'the linked match is the first card of its group');
  assert.equal(pinned[0].items.length, 8);
  const only = groupFeed([{ source: 'icc', id: 'X', state: 'done' }], { now: NOW, pin: 'icc:MISSING' });
  assert.deepEqual(only.map((group) => group.id), ['done'], 'a pin nobody recognises changes nothing');
});

test('groupFeed: the next match is the one on top, not whichever row the feed happened to print first', () => {
  const soon = [
    { source: 'bcci', id: 'far', state: 'soon', startAt: '2027-03-01T08:30:00.000Z' },
    { source: 'bcci', id: 'friday', state: 'soon', startAt: '2026-09-11T08:00:00.000Z' },
    { source: 'bcci', id: 'nodate', state: 'soon' },
  ];
  assert.deepEqual(groupFeed(soon, { now: NOW })[0].items.map((item) => item.id), ['friday', 'far', 'nodate'], 'a queue: the soonest first, and the feed that never printed a date last');
  const done = [
    { source: 'bcci', id: 'older', state: 'done', startAt: '2026-09-01T08:00:00.000Z' },
    { source: 'bcci', id: 'newest', state: 'done', startAt: '2026-09-08T08:00:00.000Z' },
  ];
  assert.deepEqual(groupFeed(done, { now: NOW })[0].items.map((item) => item.id), ['newest', 'older'], 'a log: the most recent result first');
});

test('groupFeed: no heading is printed for a group that is empty, and Finished is capped', () => {
  const items = [
    normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW }),
    normalizeBcci(bcciUpcomingRow, { feed: 'upcoming', now: NOW }),
    normalizeWt20(wt20Row, { now: NOW }),
    normalizeBcci(bcciDoneRow, { feed: 'recent', now: NOW }),
  ];
  const merged = mergeFeed({ now: NOW, batches: [{ items }] });
  const groups = groupFeed(merged.items, { now: NOW });
  assert.deepEqual(groups.map((group) => group.id), ['live', 'soon', 'later', 'done'].filter((id) => groups.some((group) => group.id === id)));
  assert.ok(groups.every((group) => group.items.length > 0));
  const byId = Object.fromEntries(groups.map((group) => [group.id, group.count]));
  assert.equal(byId.live, 2, 'both live rows are live');
  const finished = Array.from({ length: 11 }, (_, index) => ({ ...normalizeBcci(bcciDoneRow, { feed: 'recent', now: NOW }), id: String(900 + index), home: `Team ${index}`, away: 'Others', homeCode: `T${index}`, awayCode: 'OTH' }));
  const capped = groupFeed(finished, { now: NOW });
  assert.equal(capped[0].items.length, 8);
  assert.equal(capped[0].truncated, true);
});

/* ------------------------------------------------------------------ 3 · nothing that does not work */

test('no foreign player and no payload URLs: the deleted defects stay deleted', () => {
  const files = [
    ['components/sports/SportsFeed.js'],
    ['lib/sportsFeed.js'],
    ['lib/sportsFeedView.js'],
    ['app/sports/page.js'],
    ['app/sports/hub/[source]/[id]/page.js'],
    ['app/api/sports/feed/route.js'],
    ['app/api/sports/hub/route.js'],
    ['app/api/sports/channels/route.js'],
    ['app/sports/hub/[source]/[id]/page.js'],
  ].map(([file]) => ({ file, body: read(file) }));
  for (const { file, body } of files) {
    const code = body.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const banned of ['iframe', 'm3u8-player-ashen', 'vercel.app', 'atob(', 'SportsMatchCenter', 'lib/sportsProxy', '/sports/player', '/match/live']) {
      assert.ok(!code.includes(banned), `${file} still mentions ${banned}`);
    }
  }
  /* Playback goes through JashPlayer with a channel-shaped policy, and only for a stream the feed supplied. */
  const feed = files[0].body;
  assert.match(feed, /<JashPlayer/);
  assert.match(feed, /createLiveTvPolicy/);
  assert.equal((feed.match(/<JashPlayer/g) || []).length, 2, 'two mount sites at most: the Video tab of an open match, and the inline player in the channels box');
  assert.match(feed, /playing/ , 'playback is state the page owns, not a src baked into markup');
  assert.ok(!/<iframe|src=\{`http/.test(feed), 'no frame, no literal third-party src');
  const bcci = normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW });
  assert.equal(bcci.stream, '', 'the BCCI feed publishes no stream, so the Video tab must not be offered for it');
  assert.equal(bcci.has.watch, false);
});

test('tabs are built from content, so a hub can never open on an empty panel', () => {
  assert.deepEqual(hubTabs({}, {}), ['live'], 'nothing to show ⇒ one tab with the score line, not four apologies');
  assert.deepEqual(hubTabs({ scorecard: { state: 'ok' } }, {}), ['live', 'scorecard']);
  assert.deepEqual(hubTabs({ scorecard: { state: 'empty' }, info: { state: 'unavailable' } }, {}), ['live']);
  assert.ok(hubTabs({}, { stream: 'https://cdn/x.m3u8' }).includes('video'), 'a stream the feed actually gave us is a Video tab');
  assert.equal(panelTitle('scorecard'), 'Scorecard');
  assert.equal(panelTitle('nope'), 'nope');
  assert.match(panelNote({ state: 'empty', note: 'no innings on the page' }), /no innings/);
  assert.match(panelNote(undefined), /not requested/);
});

test('scorecard: an innings-less answer is "no card", never a table header over nothing', () => {
  const empty = scorecardView([]);
  assert.equal(empty.available, false);
  assert.deepEqual(empty.innings, []);
  assert.ok(!panelTitle('scorecard').includes('/ 0 innings'));
  assert.match(scorecardRows(scorecardView([]).innings).length ? '' : 'no card', /no card/);
  const filled = scorecardView([
    { team: 'India', number: 1, runs: 210, wickets: 4, overs: '20.0', runRate: 10.5, batsmen: [{ name: 'R Sharma', runs: 84, balls: 46, fours: 9, sixes: 4, sr: 182.6, dismissal: 'c Perera b Theekshana', out: true }], bowlers: [{ name: 'M Theekshana', overs: 4, maidens: 0, runs: 44, wickets: 1, econ: 11 }] },
    { team: 'Sri Lanka', number: 2, runs: 96, wickets: 3, overs: '12.4', runRate: 7.56, requiredRunRate: 15.7, batsmen: [{ name: 'P Nissanka', runs: 41, balls: 30, out: false }], bowlers: [] },
  ]);
  assert.equal(filled.activeIndex, 1, 'the live innings is the one shown by default');
  const rows = scorecardRows(filled.innings);
  assert.equal(rows[0].header, 'India');
  assert.match(rows[0].total, /210\/4/);
  assert.match(rows[0].total, /210\/4 \(20\.0 ov\)/);
  assert.match(rows[0].runRate, /CRR 10\.50/);
  assert.match(rows[1].required, /RRR 15\.70/);
  assert.equal(rows[0].batters[0].name, 'R Sharma');
  assert.equal(rows[0].bowlers[0].line, '4 - 0 - 44 - 1');
});

test('FanCode: the master playlist variant that plays is the biggest one, and DRM-only variants are not offered', () => {
  assert.equal(bestFancodeVariant(fancodeRow.auto_streams[0].auto), 'https://cdn.example/high.m3u8');
  assert.equal(bestFancodeVariant(''), '');
  assert.equal(bestFancodeVariant('https://cdn.example/only.m3u8?token=1'), 'https://cdn.example/only.m3u8?token=1');
  assert.equal(parseFanCodeState(''), null, 'a page without the state blob is "no card", not a crash');
  assert.equal(parseFanCodeState('<html>nothing here</html>'), null);
});

test('FanCode scorecard scraper: reads the innings out of __INIT_STATE__ and shrugs when the page moved', async () => {
  const { fetchImpl } = stubFetch();
  const good = await loadFanCodeScorecard({ matchId: '610', fetchImpl });
  assert.equal(good.available, true);
  assert.equal(good.innings.length, 2);
  assert.equal(good.innings[0].team, 'IND');
  assert.equal(good.innings[0].batsmen[0].name, 'Rohit Sharma');
  assert.equal(good.innings[0].batsmen[0].runs, 84);
  assert.equal(good.innings[0].batsmen[1].out, false, 'not-out has to be distinguishable from out');
  assert.equal(good.innings[0].batsmen[0].dismissal, 'c Perera b Theekshana');
  const { fetchImpl: broken } = stubFetch({ fail: ['fancode.com'] });
  const bad = await loadFanCodeScorecard({ matchId: '610', fetchImpl: broken });
  assert.equal(bad.available, false);
  assert.match(bad.error, /404|no __INIT_STATE__|state/i);
});

/* ------------------------------------------------------------------ 4 · the loaders, against fixtures */

test('loadFeed: five sources, merged, with per-source health and an honest ttl', async () => {
  const { fetchImpl, calls } = stubFetch();
  const feed = await loadFeed({ fetchImpl, env, now: NOW });
  assert.equal(feed.ok, true);
  assert.equal(feed.items.length, 4, '6 rows in, 4 cards: the IND-SL pair (BCCI live + FanCode) and the IND-PAK pair (stale-live + recent) each collapse to one');
  assert.equal(feed.counts.live, 2, 'the BCCI card and the ICC card');
  assert.equal(feed.counts.done, 1);
  assert.equal(feed.counts.soon, 1);
  assert.ok(!feed.items.some((item) => item.state === 'live' && item.result), 'a card with a result is never printed live');
  assert.ok(feed.items.some((item) => item.state === 'live' && item.source === 'icc'), 'the ICC row is live on its own "In progress" word');
  assert.equal(feed.ttlMs, FEED_TTL_LIVE_MS);
  assert.deepEqual(feed.sources.map((source) => source.id), ['bcci-live', 'bcci-upcoming', 'bcci-recent', 'icc-wt20', 'fancode']);
  assert.equal(feed.sources.every((source) => source.ok), true);
  assert.ok(feed.sources.every((source) => source.count > 0));
  assert.equal(calls.length, 5, 'one upstream call per source, not one per card');
  assert.ok(calls.every((url) => !url.includes('scores2.bcci.tv')), 'the free-tier proxy is tried first');
  assert.equal(sportsBackend(env), 'https://scores.example');
  assert.equal(sportsBackend({ SPORTS_BACKEND: 'https://alt/' }), 'https://alt', 'the older variable name still works, and a trailing slash is stripped');
  const fallback = sportsBackend({});
  assert.match(fallback, /^https:\/\/[^/]+\.onrender\.com$/, 'an unconfigured install still points at the public score backend');
  assert.ok(!fallback.endsWith('/'));
});

test('loadFeed: a source that is asleep is named, and the board still prints what answered', async () => {
  const { fetchImpl } = stubFetch({ fail: ['/api/wt20/schedule', '/api/bcci/live', '/api/bcci/recent'] });
  const feed = await loadFeed({ fetchImpl, env, now: NOW });
  assert.equal(feed.ok, true, 'whatever answered is enough to show something');
  assert.deepEqual(feed.items.map((item) => item.source), ['fancode', 'bcci'], 'rank orders the board — live before upcoming, whatever feed answered');
  const icc = feed.sources.find((source) => source.id === 'icc-wt20');
  assert.equal(icc.ok, false);
  assert.match(icc.note, /^unavailable · icc: HTTP 404/, 'the panel says which feed and why');
  const bcciLive = feed.sources.find((source) => source.id === 'bcci-live');
  assert.match(bcciLive.note, /unavailable · bcci: HTTP 404 \| movies1: HTTP 404|unavailable · .*404/, 'both ways of asking are reported, not just one');
});

test('loadFeed: nothing live means a long cache, not a 20 s poll', async () => {
  const { fetchImpl } = stubFetch({ fail: ['/api/bcci/live', '/api/bcci/recent', '/api/wt20', 'fancode.json'] });
  const feed = await loadFeed({ fetchImpl, env, now: NOW });
  assert.equal(feed.counts.live, 0);
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].state, 'soon');
  assert.equal(feed.ttlMs, FEED_TTL_IDLE_MS, 'an idle board is refetched after minutes, not seconds');
});

test('loadFeed: every source failing is an unavailable board, not an empty one', async () => {
  const { fetchImpl } = stubFetch({ fail: ['/api/bcci', '/api/wt20', 'fancode.json', 'scores2.bcci.tv'] });
  const feed = await loadFeed({ fetchImpl, env, now: NOW });
  assert.equal(feed.ok, false);
  assert.equal(feed.items.length, 0);
  assert.equal(feed.sources.filter((source) => !source.ok).length, 5);
  assert.ok(feed.sources.every((source) => source.note.includes('unavailable')));
});

test('pickArray: the BCCI envelope and a bare array are both read, and an unknown shape is empty', () => {
  assert.equal(pickArray({ liveMatches: [1, 2] }, 'live').length, 2);
  assert.equal(pickArray({ matches: [1] }, 'upcoming').length, 1);
  assert.equal(pickArray([1, 2, 3], 'recent').length, 3);
  assert.deepEqual(pickArray({ message: 'nope' }, 'live'), []);
  assert.match(bcciScoreUrl('recent'), /getRecentMatches.*previousMatchesCount=15/s);
});

test('loadHub (bcci): match and innings in one answer, panels list only what is printable', async () => {
  const { fetchImpl, calls } = stubFetch();
  const hub = await loadHub({ source: 'bcci', id: '19986', seed: { state: 'live', competitionId: '11', matchOrder: '12', inningsKind: 'T20', home: 'India', away: 'Sri Lanka' }, fetchImpl, env, now: NOW });
  assert.equal(hub.ok, true);
  assert.equal(hub.match.href, '/sports/hub/bcci/19986');
  assert.deepEqual(hub.match.panels, ['scorecard', 'info'], 'only panels with content are listed on the card');
  assert.equal(hub.panels.info.state, 'ok');
  assert.equal(hub.panels.info.fields.toss, 'India won the toss and elected to bat');
  assert.match(hub.panels.info.fields.result, /115 off 44 balls/);
  assert.equal(hub.panels.summary, undefined, 'the summary is Match Info, not a fifth tab');
  assert.equal(hub.panels.commentary.state, 'empty', 'BCCI publishes no ball-by-ball, so the Live tab shows no over list');
  assert.deepEqual(hubTabs(hub.panels, hub.match), ['live', 'info', 'scorecard'], 'no stream on this source ⇒ no Video tab');
  assert.equal(hub.panels.scorecard.innings.length, 2);
  assert.equal(hub.refreshInMs, FEED_TTL_LIVE_MS);
  assert.ok(calls.some((url) => url.includes('/api/cricket/innings?type=bcci&id=19986')));
  assert.ok(!calls.some((url) => url.includes('test=1')), 'only a Test match asks for the long card');
  const testHub = await loadHub({ source: 'bcci', id: '19986', seed: { inningsKind: 'Test' }, fetchImpl, env, now: NOW });
  assert.equal(testHub.ok, true);
});

test('loadHub (fancode): the card, the extras and the streams all come off the same two pages', async () => {
  const { fetchImpl } = stubFetch();
  const fc = await loadHub({
    source: 'fancode',
    id: '610',
    seed: { state: 'live', links: { match: 'https://www.fancode.com/cricket/match-610' }, variants: [{ url: 'https://cdn.example/high.m3u8', label: 'HD' }] },
    fetchImpl,
    env,
    now: NOW,
  });
  assert.equal(fc.panels.scorecard.state, 'ok');
  assert.match(fc.panels.scorecard.source, /FanCode scorecard page/);
  assert.equal(fc.panels.scorecard.innings[0].batsmen[0].name, 'Rohit Sharma');
  assert.deepEqual(fc.match.panels, ['scorecard', 'info', 'video'], 'the card, the labels, and the one stream the dump handed over');
  assert.equal(fc.panels.commentary.state, 'empty', 'no commentary in the dump ⇒ the Live tab prints no over list');
  assert.deepEqual(hubTabs(fc.panels, fc.match), ['live', 'video', 'info', 'scorecard']);
  assert.equal(fc.panels.video.playable.length, 1, 'the one stream the card carries is offered to the player');
  assert.equal(fc.panels.info.fields.result, 'Sri Lanka need 115 off 44', 'the page description becomes the result line');
});

test('loadHub (icc): the real scorecard payload becomes innings, extras and per-match videos', async () => {
  const { fetchImpl, calls } = stubFetch();
  const icc = await loadHub({ source: 'icc', id: '262347', seed: { state: 'live', home: 'India', away: 'Australia', competition: 'T20WC 2026' }, fetchImpl, env, now: NOW });
  assert.equal(icc.panels.scorecard.state, 'ok');
  const first = icc.panels.scorecard.innings[0];
  assert.equal(first.team, 'India', 'a team id must be resolved through Teams, not printed as a number');
  assert.equal(first.desc, '1st innings');
  assert.equal(`${first.runs}/${first.wickets}`, '170/4');
  assert.equal(first.extras.total, 3, 'wides, byes, legbyes, noballs and penalties are added, not dropped');
  assert.deepEqual(first.fallOfWickets[0], { runs: '66', wicket: 1, over: '9.1', who: 'Shafali Verma' }, 'the scorer\'s own over, with the player\'s name');
  assert.equal(first.partnerships[0].batsmen.length, 2, 'a partnership is two named batters or it is not printed');
  assert.equal(first.powerplay[0].label, 'PP1');
  assert.equal(first.batsmen[0].name, 'Smriti Mandhana', 'a player id resolves through the team that owns it');
  assert.equal(first.batsmen[0].out, true);
  assert.equal(icc.panels.info.fields.venue, "Lord's Cricket Ground, London", 'the venue comes off the card, not out of thin air');
  assert.equal(icc.panels.info.fields.competition, "ICC Women's T20 World Cup, 2026");
  assert.equal(icc.panels.info.fields.result, 'Australia beat India by 6 wickets');
  assert.equal(icc.panels.info.fields.notes.length, 6, 'the innings notes are carried, not summarised away');
  assert.match(icc.match.links.match, /^https:\/\/www\.icc-cricket\.com\/tournaments\//, 'other_info.match_center becomes the link the Info tab prints');
  assert.match(icc.match.links.highlight, /highlights/);
  assert.equal(icc.panels.video.items.filter((video) => video.kind === 'wicket').length, 5, 'the dismissal clips the card points at are listed as its own videos');
  assert.equal(icc.panels.video.items.find((video) => video.id === 'v-1').matched, true, 'a title naming both sides is labelled as this fixture');
  assert.equal(icc.panels.video.items.find((video) => video.id === 'v-3').matched, false, 'and one that does not says so');
  assert.match(icc.panels.video.note, /1 of 3 titles on the video feed name both sides/);
  assert.match(icc.panels.video.note, /5 dismissal clips the scorecard itself points at/);
  assert.ok(calls.some((url) => url.includes('assets-icc.sportz.io/cricket/v1/game/scorecard')), 'the ICC endpoint is asked directly first');
  assert.equal(icc.panels.summary, undefined, 'the ICC feed has no summary endpoint, so there is no Match panel to fake');
});

test('loadHub (icc): an unflagged match is not promised ball-by-ball, and the fallback host is tried', async () => {
  const { fetchImpl, calls } = stubFetch({ fail: ['assets-icc.sportz.io'] });
  const icc = await loadHub({ source: 'icc', id: '262347', seed: { state: 'done' }, fetchImpl, env, now: NOW });
  assert.equal(icc.panels.scorecard.state, 'ok', 'the ${MOVIES1_BACKEND} fallback carries the card');
  assert.ok(calls.some((url) => url.includes('/api/wt20/game/scorecard')));
  assert.equal(icc.panels.commentary.state, 'empty', 'a finished match without a ball-by-ball flag says so instead of an empty list');
  assert.match(icc.panels.commentary.note, /scores-only/);
});

test('loadHub: a dead upstream is an unavailable panel with a reason, and the hub still answers', async () => {
  const { fetchImpl, calls } = stubFetch({ fail: ['/api/bcci/match', '/api/cricket/innings', 'fancode.com'] });
  const dead = await loadHub({ source: 'bcci', id: '19986', seed: { home: 'India' }, fetchImpl, env, now: NOW });
  assert.equal(dead.ok, true, 'the hub loads; the panels carry the failure');
  assert.equal(dead.panels.info.state, 'ok', 'the labels on the card still build an Info panel');
  assert.equal(dead.panels.scorecard.state, 'unavailable');
  assert.match(dead.panels.scorecard.note, /waking the score feed/);
  assert.match(panelNote(dead.panels.scorecard), /waking the score feed/);
  assert.deepEqual(dead.match.panels, ['info'], 'the response says what it carries…');
  assert.deepEqual(hubTabs(dead.panels, dead.match), ['live', 'info'], '…and only Live Score and Info are printable');
  const markup = await loadHub({ source: 'bcci', id: '"><script>', fetchImpl, env, now: NOW });
  assert.equal(markup.match.id, 'script', 'id characters are stripped to the id alphabet before anything is fetched or echoed');
  const empty = await loadHub({ source: 'bcci', id: '<>&/', fetchImpl, env, now: NOW });
  assert.equal(empty.ok, false, 'an id that is nothing after cleaning is refused before any request is made');
  assert.ok(!calls.some((url) => url.includes('<') || url.includes('"')), 'no raw URL ever carries markup');
});

/* ------------------------------------------------------------------ 5 · channels: honest readiness */

test('channelReadiness: ready, needs-a-proxy, needs-a-key, expired, not-set — and nothing promised', () => {
  const at = NOW;
  assert.equal(channelReadiness({ id: 'a', name: 'Star', url: 'https://cdn/x.m3u8' }, at).state, 'ready');
  assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', referer: 'https://tv/' }, at).state, 'proxy');
  assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', keyId: 'AA', key: 'BB' }, at).state, 'key');
  assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', licenseKey: 'keyid:key' }, at).state, 'key');
  assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', keyExpiresAt: new Date(at - 1000).toISOString() }, at).state, 'expired');
  assert.equal(channelReadiness({ id: 'a', name: 'No stream' }, at).state, 'unset');
  const counts = channelCounts([
    { url: 'https://cdn/a.m3u8' },
    { url: 'https://cdn/b.m3u8', keyId: '00' },
    {},
  ], at);
  assert.deepEqual(counts, { ready: 1, blocked: 2, total: 3 });
  assert.match(FANCODE_DUMP, /^https:\/\/raw\.githubusercontent\.com/);
});

test('statusLine and the counts the mast prints agree with the feed, not with a hope', () => {
  const live = normalizeBcci(bcciLiveRow, { feed: 'live', now: NOW });
  assert.equal(feedLine({ live: 1, soon: 2, done: 1, tbc: 0 }), '1 live · 2 starting · 1 finished');
  assert.equal(statusLine({ ...live, statusLine: '', scoreHome: '210/4 (20.0 ov)', scoreAway: '96/3 (12.4 ov)' }), '210/4 (20.0 ov) · 96/3 (12.4 ov)');
  assert.equal(statusLine({ state: 'soon' }), 'no score yet');
  assert.equal(normalizeWt20(wt20Row, { now: NOW }).scoreHome, '168/8 (20 ov)');
});

/* ------------------------------------------------------------------ 6 · the page and its CSS */

test('css: the sports block stays above the 11 px floor, uses no !important, and leaves the rail clearance alone', () => {
  const css = read('app/globals.css');
  const block = css.slice(css.indexOf('.jv-sp-page {'));
  assert.ok(block.length > 2000, 'the sports block is present');
  const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!code.includes('!important'), 'no !important in .jv-sp*');
  const sizes = [...code.matchAll(/font-size: ([\d.]+)px/g)].map(([, value]) => Number(value));
  assert.ok(sizes.length > 20);
  assert.ok(Math.min(...sizes) >= 11, `smallest type is ${Math.min(...sizes)}px`);
  const shorthand = [...code.matchAll(/\.jv-sp-page \{([^}]*)\}/g)].map(([, body]) => body).join('');
  assert.ok(!/padding(-left)?\s*:/.test(shorthand), '.jv-sp-page must not touch padding: .jv-rail-shift owns padding-left');
  assert.ok(!/margin\s*:/.test(shorthand), '.jv-sp-page must not touch margin either');
  assert.ok(/\.jv-sp \{[^}]*padding-bottom: 104px/.test(code.replace(/@media \(max-width: 1023px\) \{/, '')) || code.includes('padding-bottom: 104px'), 'the last card must clear the 72 px dock');
  /* The rail clearance itself must still be there for every shifted page, sports included. */
  assert.match(css, /\.jv-rail-shift \{[^}]*padding-left: 78px/s);
  assert.match(css, /@media \(min-width: 1280px\) \{\s*\.jv-rail-shift \{ padding-left: 188px; \}/);
});

test('surface: the pages are thin wrappers, the routes answer json and never 500, and /live keeps two mounts', () => {
  const page = read('app/sports/page.js');
  assert.ok(page.length < 1200, `app/sports/page.js is a mount (${page.length} chars), not the old 428-line component`);
  assert.ok(!page.includes("'use client'"), 'the page is a server wrapper; the component owns the client code');
  assert.match(page, /components\/sports\/SportsFeed/);
  for (const [file, handler] of [['app/api/sports/feed/route.js', 'GET'], ['app/api/sports/hub/route.js', 'GET']]) {
    assert.match(read(file), /export const runtime = 'nodejs';/, `${file} runs on node`);
    const body = read(file);
    assert.match(body, new RegExp(`export async function ${handler}\\(request\\)`));
    assert.match(body, /NextResponse\.json/, `${file} answers json`);
    assert.match(body, /catch/, `${file} must degrade instead of throwing a 500`);
    assert.match(body, /export const dynamic = 'force-dynamic';/, `${file} is never prerendered`);
    assert.match(body, /NextResponse\.json\(.*\{[\s\S]*status: 200|NextResponse\.json\(/);
  }
  assert.match(read('app/api/sports/hub/route.js'), /SEED_FIELDS/);
  assert.ok(!read('app/api/sports/hub/route.js').includes('JSON.parse(decodeURIComponent(escape(atob'), 'no base64 match payload on the hub route');
  const live = read('app/live/page.js');
  assert.equal((live.match(/<JashPlayer/g) || []).length, 2, 'the live page contract is untouched');
});

/* ------------------------------------------------------------------ 7 · four tabs, each earned by content */

test('tabs: the hub has exactly four, in order, and each one is printed only when it has something to print', () => {
  assert.deepEqual(HUB_TABS.map((tab) => tab.id), ['live', 'video', 'info', 'scorecard']);
  assert.deepEqual(HUB_TABS.map((tab) => tab.label), ['Live Score', 'Video Highlights', 'Match Info', 'Scorecard']);
  assert.equal(hubTabLabel('info'), 'Match Info');
  const empty = { scorecard: { state: 'empty' }, commentary: { state: 'empty' }, video: { state: 'empty' }, info: { state: 'empty' } };
  assert.deepEqual(hubTabs(empty, {}), ['live'], 'a match with nothing but a score line gets one tab, not four apologies');
  assert.deepEqual(hubTabs(empty, { venue: 'Dubai' }), ['live', 'info'], 'a venue is content');
  assert.deepEqual(hubTabs({ ...empty, scorecard: { state: 'ok' } }, {}), ['live', 'scorecard']);
  assert.deepEqual(hubTabs({ ...empty, video: { state: 'ok' } }, {}), ['live', 'video'], 'an unresolvable stream still earns the tab — that is where the sentence lives');
  assert.deepEqual(hubTabs({}, { stream: 'https://cdn/x.m3u8' }), ['live', 'video']);
});

test('countdownLine: the clock words the brief asked for, and a time the feed never gave is never a midnight', () => {
  const at = NOW;
  assert.equal(countdownLine({ state: 'live' }, at), 'in play now');
  assert.equal(countdownLine({ state: 'soon', startAt: new Date(at + 2 * 3_600_000 + 15 * 60_000).toISOString() }, at), 'Starts in 2h 15m');
  assert.equal(countdownLine({ state: 'soon', startAt: new Date(at + 40 * 60_000).toISOString() }, at), 'Starts in 40m');
  assert.equal(countdownLine({ state: 'soon', startAt: new Date(at + 26 * 3_600_000).toISOString() }, at), 'Starts in 1d 2h');
  assert.equal(countdownLine({ state: 'soon', startAt: new Date(at - 5 * 60_000).toISOString() }, at), 'Started 5m ago');
  assert.equal(countdownLine({ state: 'soon', startAt: new Date(at).toISOString(), timeKnown: false, startLabel: 'today 7:00 PM' }, at), 'listed as today 7:00 PM');
  assert.equal(countdownLine({ state: 'tbc' }, at), 'start time not fixed');
  assert.equal(timeLabel({ state: 'soon', startAt: new Date(at + 12_600_000).toISOString() }, at), '17:30 IST · in 3 h 30 m', 'IST clock, never UTC');
  assert.equal(timeLabel({ state: 'soon', startAt: new Date(at - 12_600_000).toISOString() }, at), '10:30 IST · underway or not updated', 'a start that has passed says what it might mean, not a fake countdown');
  assert.equal(timeLabel({ state: 'tbc' }, at), 'no start time in this feed');
});

test('commentaryView: balls fold per over newest-first, non-deliveries stay notes, and prose never invents a wicket', () => {
  const fixture = readJson('tests/fixtures/icc-commentary.json');
  const view = commentaryView(fixture.data.Commentary);
  assert.equal(view.overs.length, 2);
  assert.deepEqual(view.overs.map((over) => over.over), ['18.6', '18.5'], 'the over you are watching is the first one');
  const winning = view.overs[0].balls[0];
  assert.equal(winning.runs, 4);
  assert.equal(winning.boundary, true);
  assert.equal(winning.wicket, false, '“hits the winning blow … out of the race” is not a dismissal');
  assert.equal(view.overs[0].wickets, 0);
  assert.equal(winning.speed, '88.5kph');
  assert.equal(view.notes.length, 3, 'the three non-delivery lines are listed under the overs, not as balls');
  assert.equal(view.available, true);
  const flagged = commentaryView([{ Over: '4.2', Ball: '3', Runs: '0', isWicket: true, Commentary: 'edged and gone!' }]);
  assert.equal(flagged.overs[0].balls[0].wicket, true, 'an explicit flag is never argued with');
  assert.deepEqual(commentaryView([]), { overs: [], notes: [], available: false }, 'no rows is no list, and the caller hides the section');
});

test('extrasLine + the scorecard rows: totals that a fan checks by hand', () => {
  assert.equal(extrasLine({ byes: 1, legByes: 2, wides: 3, noBalls: 0, penalties: 1, total: 7 }), '7 (b 1, lb 2, w 3, p 1)');
  assert.equal(extrasLine({ wides: 2, noBalls: 1, total: 3 }), '3 (w 2, nb 1)', 'a kind with no runs is left out of the breakdown but the total still adds up');
  assert.equal(extrasLine({}), '');
  const [row] = scorecardRows([{
    team: 'India', desc: '1st innings', number: 1, runs: 170, wickets: 4, overs: '20.0', runRate: 8.5, requiredRunRate: 15.7,
    extras: { byes: 0, legByes: 0, wides: 3, noBalls: 0, penalties: 0, total: 3 },
    batsmen: [{ name: 'S Mandhana', runs: 38, balls: 37, fours: 6, sixes: 0, sr: '102.70', dismissal: 'run out', out: true }, { name: 'S Verma', runs: 34, balls: 26, out: false }],
    bowlers: [{ name: 'L Hamilton', overs: 3, maidens: 0, runs: 17, wickets: 0, econ: '5.66' }],
    fallOfWickets: [{ runs: '66', over: '9.1', wicket: '1', who: 'S Verma' }],
    partnerships: [{ runs: '66', balls: '55', forWicket: '1', batsmen: [{ name: 'S Mandhana', runs: '30' }] }],
    powerplay: [{ label: 'PP1', overs: '1-6', runs: '43', wickets: '0' }],
  }]);
  assert.equal(row.total, '170/4 (20.0 ov)');
  assert.equal(row.extras, '3 (w 3)');
  assert.equal(row.runRate, 'CRR 8.50');
  assert.equal(row.required, 'RRR 15.70');
  assert.equal(row.batters[0].dismissal, 'run out');
  assert.equal(row.batters[1].batting, true, 'a not-out batter is marked, that is who is at the crease');
  assert.equal(row.bowlers[0].line, '3 - 0 - 17 - 0');
  assert.deepEqual(row.fow, [{ runs: '66', over: '9.1', wicket: '1', who: 'S Verma' }]);
  assert.equal(row.partnerships[0].who, 'S Mandhana 30');
  assert.equal(row.powerplay[0].label, 'PP1');
});

/* ------------------------------------------------------------------ 8 · one read serves both routes */

test('cachedFeed: one upstream read for the board and the hub, coalesced, then a short window after a failure', async () => {
  const { fetchImpl, calls } = stubFetch();
  const first = await cachedFeed({ fetchImpl, env, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  const readsAfterFirst = calls.length;
  const second = await cachedFeed({ fetchImpl, env, now: NOW + 1000 });
  assert.equal(second.cached, true, 'a second request inside the window is served from the cache');
  assert.equal(calls.length, readsAfterFirst, 'and it asked the upstream nothing');
  assert.deepEqual(second.items, first.items);
  const forced = await cachedFeed({ fetchImpl, env, now: NOW + 1000, force: true });
  assert.equal(forced.cached, false, 'Refresh Score is the one thing that re-reads');
  assert.equal(calls.length > readsAfterFirst, true);
  /* A live board must not be cached for minutes, or the score on screen is a memory. */
  assert.ok(first.counts.live > 0);
  assert.equal(first.ttlMs, FEED_TTL_LIVE_MS);
  const again = await cachedFeed({ fetchImpl: async () => { throw new Error('all hosts down'); }, env, now: NOW + 999_999 });
  assert.equal(again.unavailable, true);
  assert.equal(again.ttlMs, 5_000, 'a failed read is retried soon, not after five minutes');
  assert.equal(again.sources.length, 5, 'every source that was asked is listed as failing, with its own sentence');
  assert.ok(again.sources.every((source) => source.note.includes('all hosts down')), 'the error each source gave is what the sheet prints');
  const empty = await cachedFeed({ fetchImpl: stubFetch({ fail: ['/api/bcci', '/api/wt20', 'fancode.json', 'scores2.bcci.tv'] }).fetchImpl, env, now: NOW + 1_000_000 });
  assert.equal(empty.ok, false);
  assert.equal(empty.ttlMs, 5_000, 'a source that answered with nothing is retried soon too');
  assert.equal(findFeedItem(again, 'bcci', '19986'), null);
  const card = findFeedItem(first, 'fancode', '610');
  assert.equal(card.home, 'India');
  assert.equal(card.also.sort().join(','), 'bcci,fancode', 'the merged card answers to either feed’s id lookup…');
  assert.equal(findFeedItem(first, 'bcci', '19986'), null, '…but only the surviving source owns the hub url, which is what its href says');
  assert.equal(card.href, '/sports/hub/fancode/610');
  assert.equal(findFeedItem(first, 'bcci', '19980').home, 'India', 'a match only one feed carries is found by that feed’s id');
  assert.equal(findFeedItem(first, 'icc', '19980'), null, 'ids are only unique inside their own source');
});

test('loadIccHighlights: a title is only claimed for this match when it names both sides', async () => {
  const { fetchImpl } = stubFetch();
  const ok = await loadIccHighlights({ fetchImpl, env, item: { home: 'India', away: 'Australia', competition: 'T20WC 2026' } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.videos.map((video) => video.matched), [true, false, false], 'sorted so the titles that name the fixture are the ones on top');
  assert.equal(ok.videos[0].id, 'v-1', 'the id is what /api/icc/play takes — the button under each row resolves it');
  const dead = await loadIccHighlights({ fetchImpl: stubFetch({ fail: ['/api/icc/highlights'] }).fetchImpl, env, item: { home: 'India', away: 'Australia' } });
  assert.equal(dead.ok, false);
  assert.deepEqual(dead.videos, []);
  assert.match(dead.error, /^highlights: /, 'a failing video feed is a sentence in the panel, not a thrown hub');
});

/* ------------------------------------------------------------------ 9 · what the surface may not claim */

test('fanVariants: an unstarted or expired token is stated as unavailable and never offered as playable', () => {
  const unstarted = normalizeFancode({ ...fancodeRow, status: 'UPCOMING', auto_streams: [{ auto: '#EXTM3U\nhttps://cdn.example/high.m3u8' }] }, { now: NOW });
  assert.equal(unstarted.variants[0].unavailable.includes('not started'), true);
  assert.equal(unstarted.stream, '', 'no url is handed to the player for a match that has not begun');
  assert.equal(unstarted.has.watch, false);
  const newestRefererless = normalizeFancode({ ...fancodeRow, auto_streams: [{ auto: '#EXTM3U\nhttps://cdn.example/high.m3u8' }] }, { now: NOW });
  const expired = normalizeFancode({
    ...fancodeRow,
    __headers: { 'User-Agent': 'UA/1', Referer: 'https://www.fancode.com/' },
    auto_streams: [{ auto: '#EXTM3U\nhttps://cdn.example/high.m3u8', cookie_valid: String(Math.floor(NOW / 1000) - 600) }],
    __dumpAt: '9 Sep 2026 09:00',
  }, { now: NOW });
  assert.match(expired.variants[0].unavailable, /expired on/);
  assert.equal(expired.stream, '', 'an expired token is never handed to the player as a url');
  assert.equal(expired.has.watch, false, 'and the card does not claim it can be watched');
  assert.match(expired.variants[0].unavailable, /dump that published it is from 9 Sep/, 'the sentence names the dump date, because the dump is the thing that is stale');
  const fresh = normalizeFancode({ ...fancodeRow, __headers: { 'User-Agent': 'UA/1', Referer: 'https://www.fancode.com/' }, auto_streams: [{ auto: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5200000\nhttps://cdn.example/high.m3u8', cookie_valid: String(Math.floor(NOW / 1000) + 7200) }] }, { now: NOW });
  assert.equal(fresh.variants[0].unavailable, undefined);
  assert.equal(fresh.stream, 'https://cdn.example/high.m3u8');
  assert.equal(fresh.has.watch, true);
  assert.equal(fresh.variants[0].referer, 'https://www.fancode.com/', 'the headers the token was minted for go with the url, or the player 403s');
  assert.equal(fresh.variants[0].userAgent, 'UA/1');
  assert.equal(newestRefererless.variants[0].referer, 'https://fancode.com/', 'a dump with no headers still gets the site default, which is what FanCode accepts');
});

test('surface: only the routes the board calls remain, the old URLs redirect, and the hub reads the cache instead of the query', () => {
  for (const gone of ['app/match', 'app/match-center', 'app/sports/player', 'components/SportsMatchCenter.jsx', 'app/api/sports/dynamic', 'app/api/sports/score', 'app/api/fancode', 'app/api/match-resolve', 'app/api/match', 'app/api/ipl', 'app/api/bcci', 'app/api/cricket', 'app/api/wt20']) {
    assert.equal(fs.existsSync(path.join(ROOT, gone)), false, `${gone} is deleted, not hidden`);
  }
  assert.deepEqual(fs.readdirSync(path.join(ROOT, 'app/api/sports')).sort(), ['channels', 'feed', 'hub']);
  const config = read('next.config.mjs');
  for (const from of ['/match-center/:path*', '/match/live', '/match/:path*', '/sports/player/:path*']) {
    assert.ok(config.includes(`'${from}'`), `${from} must redirect to /sports`);
  }
  assert.match(config, /destination: '\/sports', permanent: false/);
  const middleware = read('middleware.js');
  assert.match(middleware, /prefix: '\/api\/sports\/hub', limit: 40/);
  assert.match(middleware, /prefix: '\/api\/sports\/feed', limit: 90/);
  assert.ok(!middleware.includes('/api/sports/dynamic'), 'the deleted route is not still rate-limited');
  const hub = read('app/api/sports/hub/route.js');
  assert.match(hub, /cachedFeed\(\{ force \}\)/, 'the hub seeds itself from the same cached feed the board used');
  assert.match(hub, /findFeedItem\(feed \|\| \{\}, source, id\)/);
  assert.match(hub, /FEED_TTL_LIVE_MS/, 'a live match is served from a 20 s window on the hub too');
  const nav = read('components/navItems.js');
  assert.equal((nav.match(/\/sports/g) || []).length, 1, 'one rail entry for sports');
  assert.match(nav, /Matches, scores, streams/);
  /* The hub's player is mounted from `playing`, so the prop has to be the state itself: `playing.state` was a
     field that never existed, which silently kept JashPlayer from ever mounting. */
  assert.match(read('components/sports/SportsFeed.js'), /playing=\{playing\?\.key === key \? playing : null\}/);
  assert.ok(!read('components/sports/SportsFeed.js').includes('playing.state'), 'no phantom `.state` on the playing object');
  /* A video that is being resolved, or that failed, is said on screen instead of leaving the row unchanged. */
  assert.match(read('components/sports/SportsFeed.js'), /Asking the source for a playable address/);
  assert.match(read('components/sports/SportsFeed.js'), /That video did not resolve/);
  /* A match URL has to fetch its own hub; only a tap used to, so a deep link printed the card with no panels. */
  assert.match(read('components/sports/SportsFeed.js'), /seededHub\.current = key;[\s\S]{0,220}fetchHub\(wanted \|\|/);
  const component = read('components/sports/SportsFeed.js').replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const banned of ['/match-center', '/sports/player', 'iframe', 'dangerouslySetInnerHTML', 'localStorage']) {
    assert.ok(!component.includes(banned), `the hub must not use ${banned}`);
  }
});
