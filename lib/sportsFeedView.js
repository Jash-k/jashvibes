/**
 * Sports view helpers — pure, clock-injected, safe to import from a client component.
 *
 * `lib/sportsFeed.js` owns the fetching and the normalising; this file owns only what the page is allowed to
 * print. The split exists so the client bundle never carries a fetch, an env var or a scraper, and so the
 * honesty rules ("no invented totals", "a group with nothing in it is not rendered") live in one place both
 * sides and the tests use.
 */

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const IST_CLOCK = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
const IST_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });

export function istClock(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : IST_CLOCK.format(date);
}

export function dayLabel(iso, now = Date.now()) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const today = IST_DAY.format(new Date(now));
  const value = IST_DAY.format(then);
  if (value === today) return 'today';
  if (value === IST_DAY.format(new Date(now + 86_400_000))) return 'tomorrow';
  if (value === IST_DAY.format(new Date(now - 86_400_000))) return 'yesterday';
  return IST_DATE.format(then);
}

/** One line per state, always derived from the feed's own fields — and never a clock the feed did not print. */
export function timeLabel(item = {}, now = Date.now()) {
  if (!item.startAt) return item.statusWords ? `${item.statusWords} · time not in feed` : 'no start time in this feed';
  if (item.timeKnown === false) return `${dayLabel(item.startAt, now)} · time not in feed`;
  const clock = istClock(item.startAt);
  if (item.state === 'live') return `${clock} IST start`;
  if (item.state === 'done') return `${dayLabel(item.startAt, now)} ${clock} IST`;
  const diff = new Date(item.startAt).getTime() - now;
  if (diff <= 0) return `${clock} IST · underway or not updated`;
  const mins = Math.round(diff / 60_000);
  const units = [];
  if (mins >= 1440) units.push(`${Math.floor(mins / 1440)} d`);
  if (mins >= 60) units.push(`${Math.floor(mins / 60) % 24} h`);
  if (mins < 1440) units.push(`${mins % 60} m`);
  return `${clock} IST · in ${units.filter((unit) => !unit.startsWith('0 ')).join(' ') || 'under a minute'}`;
}

/**
 * The countdown the user asked for on an upcoming match. Only ever derived from `startAt`, so a feed that did
 * not print a clock gets "time not fixed", never a fake "in 0 m".
 */
export function countdownLine(item = {}, now = Date.now()) {
  if (item.state === 'live') return 'in play now';
  if (!item.startAt || item.timeKnown === false) return item.startLabel ? `listed as ${item.startLabel}` : 'start time not fixed';
  const diff = new Date(item.startAt).getTime() - now;
  if (!Number.isFinite(diff)) return 'start time not fixed';
  const mins = Math.round(Math.abs(diff) / 60_000);
  const parts = [];
  if (mins >= 1440) parts.push(`${Math.floor(mins / 1440)}d`, `${Math.floor(mins / 60) % 24}h`);
  else if (mins >= 60) parts.push(`${Math.floor(mins / 60)}h`, `${mins % 60}m`);
  else parts.push(`${mins}m`);
  const pretty = parts.filter((part) => !part.startsWith('0')).join(' ');
  return diff > 0 ? `Starts in ${pretty || 'under a minute'}` : `Started ${pretty || 'a moment'} ago`;
}

export function feedLine(counts = {}) {
  const parts = [];
  if (counts.live) parts.push(`${counts.live} live`);
  if (counts.soon) parts.push(`${counts.soon} starting`);
  if (counts.done) parts.push(`${counts.done} finished`);
  if (counts.tbc) parts.push(`${counts.tbc} unscheduled`);
  return parts.join(' · ') || 'nothing on any feed right now';
}

/**
 * The groups the page prints, in order. An empty group is dropped, so the UI cannot render a heading whose
 * only content is an absence. `live` and `soon` are today's items; anything still marked `tbc` after today
 * goes to the last group instead of being filed under 00:00.
 */
/**
 * `pin` is a `source:id` key that must survive the caps: a shared or bookmarked match URL opens its own hub, and
 * a card the group cap happened to drop would leave that page with nothing to attach the hub to.
 */
/**
 * The board's four groups. `pin` is a `source:id` key that must survive the caps: a shared or bookmarked match
 * URL opens its own hub, and a card the cap dropped would leave that page with nothing to hang the hub on.
 */
export function groupFeed(items = [], { now = Date.now(), pin = '' } = {}) {
  const keyOf = (item) => `${item.source}:${item.id}`;
  const toFront = (list) => (pin ? [list.find((item) => keyOf(item) === pin), ...list.filter((item) => keyOf(item) !== pin)].filter(Boolean) : list);
  const today = IST_DAY.format(new Date(now));
  const isToday = (item) => Boolean(item.startAt) && IST_DAY.format(new Date(item.startAt)) === today;
  const groups = [
    { id: 'live', label: 'Live now', newestLast: false, items: items.filter((item) => item.state === 'live') },
    { id: 'soon', label: 'Starting today', newestLast: false, items: items.filter((item) => (item.state === 'soon' && isToday(item)) || (item.state === 'tbc' && isToday(item))) },
    { id: 'later', label: 'Later', newestLast: false, items: items.filter((item) => (item.state === 'soon' && !isToday(item)) || (item.state === 'tbc' && !isToday(item))) },
    { id: 'done', label: 'Finished', newestLast: true, items: items.filter((item) => item.state === 'done') },
  ];
  const atOf = (item, newestLast) => {
    const at = Date.parse(item.startAt || '');
    // A row the feed gave no date sorts to the bottom of its own group, whichever way the group runs.
    if (Number.isFinite(at)) return at;
    return newestLast ? 0 : Number.MAX_SAFE_INTEGER;
  };
  return groups
    .filter((group) => group.items.length > 0)
    .map((group) => {
      const cap = group.id === 'done' ? 8 : 24;
      /* Upcoming matches read as a queue, so the next one is on top; finished ones read as a log, so the most
         recent is. Ordering by the feed's own row order is what put a March 2027 fixture above one on Friday. */
      const ordered = toFront([...group.items].sort((a, b) => (group.newestLast ? atOf(b, true) - atOf(a, true) : atOf(a, false) - atOf(b, false))));
      return {
        id: group.id,
        label: group.label,
        count: ordered.length,
        items: ordered.slice(0, cap),
        truncated: ordered.length > cap,
      };
    });
}
export function stateChip(item = {}) {
  if (item.state === 'live') return { label: 'live', tone: 'live' };
  if (item.state === 'soon') return { label: 'soon', tone: 'soon' };
  if (item.state === 'done') return { label: item.result ? 'result' : 'finished', tone: 'muted' };
  return { label: 'tbc', tone: 'muted' };
}

/** The card's one status line: the feed's words first, never a paraphrase that could be wrong. */
export function statusLine(item = {}) {
  const primary = text(item.statusLine) || text(item.result);
  if (item.state === 'live') {
    const lines = [item.scoreHome, item.scoreAway].filter(Boolean);
    return primary || lines.join(' · ') || 'live · no line in this feed';
  }
  if (item.state === 'done') return primary || 'result not in this feed';
  if (item.state === 'soon') return primary || 'no score yet';
  return primary || 'not on a score feed';
}

/** The little "also on" set, so a merged card admits it came from more than one feed. */
export function sourceLine(item = {}) {
  const sources = [...new Set([item.source, ...(item.also || [])].filter(Boolean))];
  return sources.map((source) => source.toUpperCase()).join(' · ');
}

/* ---------------------------------------------------------------- hub table shapers */

export function scorecardRows(innings = []) {
  return (innings || []).map((inn) => ({
    header: [text(inn.team), text(inn.desc)].filter(Boolean).join(' · ') || `Innings ${inn.number ?? ''}`.trim(),
    label: [text(inn.desc), text(inn.inningsType)].filter(Boolean).join(' · ') || `Innings ${inn.number ?? ''}`.trim(),
    extras: extrasLine(inn.extras),
    /* `fallOfWickets`/`partnerships` arrive from three different normalisers; the canonical keys are read
       first so a row the lib already resolved never loses its wicket number or its player's name. */
    fow: (Array.isArray(inn.fallOfWickets) ? inn.fallOfWickets : []).map((row) => ({
      runs: text(row.runs ?? row.Runs ?? row.Score),
      over: text(row.over ?? row.overs ?? row.Overs ?? row.overBall ?? row.OverBall),
      wicket: text(row.wicket ?? row.wicketNo ?? row.Wicket_No ?? row.order),
      who: text(row.who ?? row.player?.name ?? row.playerName ?? row.PlayerName ?? row.batsman ?? row.Batsman),
    })).filter((row) => row.runs || row.who),
    partnerships: (Array.isArray(inn.partnerships) ? inn.partnerships : []).map((row) => ({
      runs: text(row.runs ?? row.Runs),
      balls: text(row.balls ?? row.Balls),
      wicket: text(row.forWicket ?? row.forWicketNumber ?? row.ForWicket ?? row.Wicket),
      who: (row.batsmen || row.Batsmen || [])
        .map((b) => [text(b.name ?? b.Name_Full ?? ''), text(b.runs ?? b.Runs)].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(' & '),
    })).filter((row) => row.runs),
    powerplay: (Array.isArray(inn.powerplay) ? inn.powerplay : []).map((row) => ({
      label: text(row.label), overs: text(row.overs), runs: text(row.runs), wickets: text(row.wickets),
    })).filter((row) => row.label || row.overs),
    total: [inn.runs, inn.wickets !== undefined && inn.wickets !== null ? `${inn.wickets}` : '']
      .filter(Boolean)
      .join('/') + (text(inn.overs) ? ` (${text(inn.overs)} ov)` : ''),
    runRate: inn.runRate !== undefined && inn.runRate !== null && inn.runRate !== '' ? `CRR ${Number(inn.runRate).toFixed(2)}` : '',
    required: inn.requiredRunRate ? `RRR ${Number(inn.requiredRunRate).toFixed(2)}` : '',
    batters: (inn.batsmen || []).map((b) => ({
      name: text(b.name),
      line: [text(b.runs), text(b.balls)].filter(Boolean).join(' · '),
      boundary: [b.fours ? `${b.fours}×4` : '', b.sixes ? `${b.sixes}×6` : ''].filter(Boolean).join(' '),
      sr: text(b.sr),
      dismissal: text(b.dismissal),
      batting: b.out === false,
    })).filter((b) => b.name),
    bowlers: (inn.bowlers || []).map((b) => ({
      name: text(b.name),
      line: [text(b.overs), text(b.maidens), text(b.runs), text(b.wickets)].filter((v) => v !== '' && v !== undefined).join(' - '),
      econ: text(b.econ),
    })).filter((b) => b.name),
  }));
}

/** `15 (b 1, lb 2, w 13, nb 6)` from whichever spelling this feed used. '' when the feed has no extras. */
/** `7 (lb 2, w 3, p 1)` — the extras breakdown, spelled the way a scorecard spells it. */
export function extrasLine(extras = {}) {
  const box = Array.isArray(extras) ? extras[0] : extras;
  if (!box || typeof box !== 'object') return '';
  const pick = (...keys) => {
    for (const key of keys) {
      const value = box[key];
      if (value !== undefined && value !== null && value !== '') return text(value);
    }
    return '';
  };
  const total = pick('total', 'Total');
  const parts = [
    ['b', pick('byes', 'Byes')],
    ['lb', pick('legByes', 'LegByes', 'legbyes')],
    ['w', pick('wides', 'Wides')],
    ['nb', pick('noBalls', 'Noballs', 'NoBalls', 'noballs')],
    ['p', pick('penalties', 'Penalty', 'penalty')],
  ].filter(([, value]) => value && value !== '0').map(([label, value]) => `${label} ${value}`);
  if (!total && !parts.length) return '';
  return `${total || parts.reduce((sum, [, value]) => sum + Number(value || 0), 0)}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}

/**
 * Ball-by-ball, grouped into overs for the collapsible sections. A row is only kept if the feed actually said
 * something about a delivery, and an over with no balls in it is dropped — which is how the "no commentary ⇒ no
 * commentary section" rule gets enforced here instead of in three different components.
 */
export function commentaryView(rows = []) {
  const overs = new Map();
  const notes = [];
  for (const row of rows || []) {
    const line = text(row.commentary || row.Commentary || row.detail || row.Detail || row.text);
    const ball = text(row.ball ?? row.Ball ?? row.ballNumber ?? row.Ball_Number ?? '');
    const over = text(row.over ?? row.Over ?? row.overNo ?? row.Over_No ?? '');
    const isBall = row.isBall ?? row.Isball ?? Boolean(over && ball);
    if (!isBall || !over) {
      if (line) notes.push({ id: text(row.id ?? row.UID ?? notes.length), line });
      continue;
    }
    if (!overs.has(over)) overs.set(over, { over, balls: [], runs: 0, wickets: 0 });
    const group = overs.get(over);
    const runs = Number(row.runs ?? row.Runs ?? 0);
    /* The flag wins when the feed has one. Where it has none (the ICC page marks nothing), a boundary is never
       counted as a wicket from prose alone — "hits the winning blow … out of the race" reads like a dismissal and
       would have put a fake wicket in the over header. */
    const flagged = row.isWicket ?? row.IsWicket ?? row.wicket ?? row.Wicket;
    const prose = /\b(dismissed|scaught\b|stumped|lbw\b|run ?out\b|bowled\b|gone, |takes the wicket)\b/i.test(line || row.summary || '');
    const wicket = flagged === undefined || flagged === null ? (prose && runs !== 4 && runs !== 6) : Boolean(flagged);
    group.balls.push({
      id: `${over}.${ball || group.balls.length + 1}`,
      ball: ball || `${group.balls.length + 1}`,
      line: line || (row.summary ? text(row.summary) : '') || (row.defaultCommentary ? text(row.defaultCommentary) : '') || `${Number.isFinite(runs) ? runs : 0} run${runs === 1 ? '' : 's'}`,
      runs: Number.isFinite(runs) ? runs : 0,
      boundary: Boolean(row.isBoundary ?? row.Isboundary ?? row.boundary ?? row.Boundary) || runs === 4 || runs === 6,
      six: runs === 6,
      wicket,
      bowler: text(row.bowlerName ?? row.Bowler_Name ?? row.bowler ?? row.Bowler),
      batter: text(row.strikerName ?? row.Batsman_Name ?? row.batsman ?? row.Batsman),
      at: text(row.time ?? row.Timestamp ?? row.createdTimestamp ?? row.Created_Timestamp),
      speed: text(row.ballSpeed ?? row.Ball_Speed ?? row.speed ?? ''),
    });
    group.runs += Number.isFinite(runs) ? runs : 0;
    if (wicket) group.wickets += 1;
  }
  const list = [...overs.values()].filter((group) => group.balls.length);
  return { overs: list, notes, available: list.length > 0 || notes.length > 0 };
}

export function panelNote(panel) {
  if (!panel) return 'this panel was not requested';
  if (panel.state === 'ok') return panel.source ? `from ${panel.source}` : '';
  if (panel.state === 'empty') return panel.note || 'the feed answered, and had nothing for this';
  if (panel.state === 'unavailable') return panel.note || 'the score feed did not answer';
  return panel.note || '';
}

/**
 * The four tabs of a match hub, in the order the user asked for. Each one is present only when it has something
 * to print: Live score (the card, plus ball-by-ball if this source publishes it), Video (a stream we can
 * actually resolve, or the official highlights/replay link), Match info (venue, toss, XI, result, the source's
 * own page), Scorecard (the full card, innings by innings). There is no fifth tab: feed health is about every
 * match at once, so it sits in the aside.
 */
/* The four tabs of the hub, in the order they are printed, with the names the brief used. */
export const HUB_TABS = [
  { id: 'live', label: 'Live Score' },
  { id: 'video', label: 'Video Highlights' },
  { id: 'info', label: 'Match Info' },
  { id: 'scorecard', label: 'Scorecard' },
];

export function hubTabs(panels = {}, item = {}) {
  const links = item.links || {};
  const has = {
    /* One rule per tab, and it is always about content: a tab that would print an apology does not get printed.
       `video` is the exception the user asked for — an unresolvable stream still earns a tab, because the tab's
       job there is to say so and hand over a link to the source's own page. */
    live: true,
    video: panels.video?.state === 'ok' || Boolean(item.stream || item.videoId || links.highlight || links.watch || links.match || (item.variants || []).length),
    info: panels.info?.state === 'ok' || Boolean(item.venue || item.competition || links.match),
    scorecard: panels.scorecard?.state === 'ok',
  };
  return HUB_TABS.filter((tab) => has[tab.id]).map((tab) => tab.id);
}

export function hubTabLabel(id) {
  return HUB_TABS.find((tab) => tab.id === id)?.label || id;
}

/* ---------------------------------------------------------------- channels */

/**
 * A channel is only "ready" if the player can actually be handed something. `needs` names what is missing so
 * the user can fix it in `.env.local` instead of pressing a card that plays nothing.
 */
export function channelReadiness(channel = {}, now = Date.now()) {
  const url = text(channel.url || channel.stream);
  if (!url) return { state: 'unset', label: 'not set', note: 'no stream url on this entry' };
  const keyId = cleanHex(channel.keyId || channel.kid);
  const key = cleanHex(channel.key || channel.clearKey);
  const license = text(channel.licenseKey);
  const hasKey = Boolean((keyId && key) || (license.includes(':') && !/^https?:/i.test(license)));
  const needsHeaders = Boolean(text(channel.referer) || text(channel.cookie) || text(channel.userAgent));
  const expires = text(channel.keyExpiresAt);
  if (expires && new Date(expires).getTime() < now) {
    return { state: 'expired', label: 'key expired', note: 'the feed gave a key with a past expiry' };
  }
  if (hasKey) return { state: 'key', label: 'clear key', note: 'ClearKey pair present · played in JashPlayer' };
  if (keyId || license) {
    return { state: 'needs-key', label: 'needs a key', note: 'DRM stream · this player does ClearKey only, so it needs KEY_ID and KEY in .env.local' };
  }
  if (needsHeaders) return { state: 'proxy', label: 'via proxy', note: 'needs a Referer or Cookie · /api/live-proxy' };
  return { state: 'ready', label: 'ready', note: 'plays direct' };
}

const cleanHex = (value) => text(value).replace(/[^0-9a-f]/gi, '').toLowerCase();

export function channelLine(channel = {}) {
  const parts = [text(channel.source), channel.format ? channel.format.toUpperCase() : ''].filter(Boolean);
  if (channel.language) parts.push(text(channel.language));
  return parts.join(' · ');
}

/** Ready / needs-you counts for the aside header. Never a total of channels that cannot play. */
export function channelCounts(channels = [], now = Date.now()) {
  let ready = 0;
  let blocked = 0;
  for (const channel of channels) {
    const readiness = channelReadiness(channel, now);
    if (readiness.state === 'ready' || readiness.state === 'key' || readiness.state === 'proxy') ready += 1;
    else blocked += 1;
  }
  return { ready, blocked, total: channels.length };
}

/* ---------------------------------------------------------------- small shared bits */

export function initials(...values) {
  for (const value of values) {
    const clean = text(value);
    if (clean) return clean.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 5);
  }
  return '—';
}

export function dotLabel(item = {}, now = Date.now()) {
  if (item.state === 'live') {
    const overs = text(item.scoreHome).match(/\((\d+(?:\.\d+)?)\s*ov\)/i)?.[1] || text(item.statusLine).match(/(\d+(?:\.\d+)?)\s*ov/i)?.[1] || '';
    return overs ? `${overs} ov` : 'live';
  }
  if (item.state === 'soon') return istClock(item.startAt) || 'soon';
  if (item.state === 'done') return text(item.startAt) ? dayLabel(item.startAt, now) : '—';
  return 'tbc';
}
