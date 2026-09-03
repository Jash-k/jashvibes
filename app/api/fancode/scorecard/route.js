import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

function fcExtractInitState(html) {
  let i = html.indexOf('window.__INIT_STATE__');
  if (i < 0) return null;
  i = html.indexOf('{', i);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let k = i; k < html.length; k++) {
    const c = html[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = k + 1;
          break;
        }
      }
    }
  }
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(i, end));
  } catch {
    return null;
  }
}

const fcInnings = (inn) => ({
  number: inn.number,
  desc: inn.inningDescription,
  team: inn.battingTeamShortName,
  runs: inn.runs,
  wickets: inn.wickets,
  overs: inn.overs,
  balls: inn.balls,
  runRate: inn.runRate,
  status: inn.status,
  extras: inn.extras,
  fallOfWickets: inn.fow || [],
  batsmen: (inn.batsmen || []).map((b) => ({
    name: b.name,
    shortName: b.shortName,
    img: b.avatar?.src || '',
    runs: b.attributes?.runs ?? b.runs,
    balls: b.attributes?.balls ?? b.balls,
    fours: b.attributes?.fours ?? b.fours,
    sixes: b.attributes?.sixes ?? b.sixes,
    sr: b.attributes?.strikeRate ?? b.strikeRate,
    dismissal: b.description || (b.status === 'OUT' ? 'out' : 'not out'),
    out: b.status === 'OUT',
  })),
  bowlers: (inn.bowlers || []).map((b) => ({
    name: b.name,
    shortName: b.shortName,
    img: b.avatar?.src || '',
    overs: b.attributes?.overs ?? b.overs,
    maidens: b.attributes?.maiden ?? b.maidens,
    runs: b.attributes?.runs ?? b.runs,
    wickets: b.attributes?.wickets ?? b.wickets,
    econ: b.attributes?.econ ?? b.economy,
    wides: b.attributes?.wides ?? b.wides,
    noBalls: b.attributes?.noBall ?? b.noBalls,
  })),
});

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const matchId = String(searchParams.get('matchId') || searchParams.get('id') || '').replace(/\D/g, '');

  if (!matchId) {
    return NextResponse.json({ ok: false, error: 'matchId required' }, { status: 400 });
  }

  try {
    const url = `https://www.fancode.com/cricket/tour/x/matches/x-${matchId}/scorecard`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': FC_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    const html = await response.text();
    const state = fcExtractInitState(html);
    const cs = state?.[`match-detail/${matchId}/CricketScorecard`]?.matchWithScore?.scorecard?.cricketScore;

    if (!cs || !Array.isArray(cs.innings)) {
      return NextResponse.json({
        ok: true,
        available: false,
        matchId: Number(matchId),
        innings: [],
      }, {
        headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' },
      });
    }

    return NextResponse.json({
      ok: true,
      available: true,
      matchId: Number(matchId),
      description: cs.description || '',
      currentRunRate: cs.currentRunRate,
      requiredRunRate: cs.requiredRunRate,
      innings: cs.innings.map(fcInnings),
    }, {
      headers: { 'Cache-Control': 'public, max-age=20, s-maxage=20' },
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      available: false,
      matchId: Number(matchId),
      innings: [],
      error: error.message,
    });
  }
}
