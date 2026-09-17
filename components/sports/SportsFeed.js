'use client';

/**
 * Sports — the On Air Grid (round 22, idea 3 of `docs/concepts/sports-live-redesign.html`).
 *
 * The page names THE thing to watch. A resolver (`lib/sportsLive.js`) ranks every playable
 * live source — the FanCode dump's fresh signed match feeds, then a match's own published
 * stream, then the standing FanCode/Willow channels, then the live-TV catalog's sports
 * channels — and the winner is the hero: one card, one pre-focused WATCH LIVE button, one
 * press to the stage. Everything else is a quiet grid below: also-live matches (each with
 * its own ▶), channels with their honest readiness label, today's fixtures with countdowns,
 * results, replays.
 *
 * Kept from the Single Feed (v8.12.0) because it is the part that was right: the hub and
 * its four content-decided tabs (Live Score · Video · Info · Scorecard), the merged feed
 * and its truth rules, the readiness labels, the deep-linkable `/sports/hub/{source}/{id}`,
 * and the visible-only polling with backoff. The center stage grew up: watching is now the
 * default state of the page, not a tab inside a card.
 *
 * Rules this page keeps: nothing is printed that a feed did not say; an empty panel names
 * the feed that was empty; a stale dump quarantines its "LIVE" rows; a channel without a
 * key is listed and never offered; and the horizontal gutters live on `.jv-sp`, never on
 * the element that carries `jv-rail-shift` (v8.11.1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import RailNav from '@/components/rail/RailNav';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { heroNote, otherLiveEntries, pickHeroSource, rankPlayableSources } from '@/lib/sportsLive';
import {
  countdownLine,
  feedLine,
  hubTabLabel,
  hubTabs,
  panelNote,
  scorecardRows,
  sourceLine,
  stateChip,
  statusLine,
  timeLabel,
} from '@/lib/sportsFeedView';

const FEED_URL = '/api/sports/feed';
const HUB_URL = '/api/sports/hub';
const REFRESH_FLOOR_MS = 20_000;

/** The player only ever gets a channel-shaped object, so the policy ladder is the same one /live uses. */
function formatAge(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function streamChannel({ url, label, source = 'sports', extra = {} }) {
  return {
    id: `sports-${label}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48),
    name: label,
    url,
    category: 'Sports',
    source,
    format: /\.m3u8/i.test(url) ? 'hls' : 'video',
    ...extra,
  };
}

function useAsyncJson() {
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const load = useCallback(async (url, { force = false } = {}) => {
    abortRef.current?.abort?.();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    abortRef.current = controller;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}${force ? '&force=1' : ''}`, {
        cache: 'no-store',
        signal: controller?.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error(data?.error || data?.note || `HTTP ${response.status}`);
      if (mountedRef.current) setState({ status: 'ready', data, error: '' });
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      if (mountedRef.current) setState((current) => ({ status: 'error', data: current.data, error: error.message || 'Failed' }));
      return null;
    }
  }, []);
  return { ...state, load };
}

/* ------------------------------------------------------------------ the hub's panels (kept) */

/** The score itself: the two lines, the feed's own sentence, and the clock or the countdown. */
function LiveScore({ item, hub, now }) {
  const info = hub?.panels?.info?.fields || {};
  const teams = [
    { name: item.home || info.home, line: item.scoreHome || info.homeLine, code: item.homeCode },
    { name: item.away || info.away, line: item.scoreAway || info.awayLine, code: item.awayCode },
  ].filter((team) => team.name || team.line);
  const crease = Array.isArray(info.atTheCrease) ? info.atTheCrease : [];
  const commentary = hub?.panels?.commentary;
  return (
    <div className="jv-sp-live">
      <ul className="jv-sp-score">
        {teams.map((team, index) => (
          <li key={`${team.code || 'team'}-${index}`} className={item.battingSide && item.battingSide === team.code ? 'is-batting' : ''}>
            <b>{[team.code, team.name].filter(Boolean).join(' · ') || '—'}</b>
            <span>{team.line || <em>not batting yet · no line from {sourceLine(item)}</em>}</span>
            {item.battingSide && item.battingSide === team.code ? <em className="jv-sp-bat">at the crease</em> : null}
          </li>
        ))}
        {!teams.length ? <li><b>this match</b><span><em>the feed carried no team names for it</em></span></li> : null}
      </ul>
      <p className="jv-sp-status">{statusLine(item) || 'no status sentence on this feed'}</p>
      <p className="jv-sp-clock">
        <span>{item.state === 'live' ? countdownLine(item, now) : timeLabel(item, now)}</span>
        {item.state === 'soon' ? <em>{countdownLine(item, now)}</em> : null}
        {item.dumpAt ? <em>feed snapshot · {item.dumpAt}</em> : null}
      </p>
      {crease.length ? (
        <p className="jv-sp-line">
          at the crease: {crease.map((batter) => `${batter.name}${batter.runs ? ` ${batter.runs}${batter.balls ? ` (${batter.balls})` : ''}` : ''}${batter.striker ? ' *' : ''}`).join(', ')}
          {info.currentRunRate ? ` · CRR ${info.currentRunRate}` : ''}
          {info.requiredRunRate ? ` · RRR ${info.requiredRunRate}` : ''}
        </p>
      ) : null}
      {commentary?.state === 'ok' ? <OverList panel={commentary} /> : null}
      {commentary?.state === 'unavailable' ? <p className="jv-sp-note is-warn">ball-by-ball: {panelNote(commentary)}</p> : null}
    </div>
  );
}

/**
 * Ball-by-ball, one collapsible section per over, newest first. The over header carries what that over scored, so
 * a closed section is still readable; feed notes that were not about a delivery are listed under the overs
 * instead of being numbered as if they were balls.
 */
function OverList({ panel }) {
  const overs = [...(panel.overs || [])].sort((a, b) => (Number(b.over.split('.')[0]) || 0) - (Number(a.over.split('.')[0]) || 0));
  return (
    <section className="jv-sp-overs">
      <p className="jv-sp-rule is-sub">
        Ball by ball
        <em>{overs.length} {overs.length === 1 ? 'over' : 'overs'} · {panel.source}</em>
        <hr />
      </p>
      <div className="jv-sp-overlist">
        {overs.slice(0, 12).map((over) => (
          <details className="jv-sp-over" key={over.over} open={over === overs[0]}>
            <summary>
              <b>Over {over.over}</b>
              <span>{over.runs} run{over.runs === 1 ? '' : 's'}{over.wickets ? ` · ${over.wickets} wicket${over.wickets === 1 ? '' : 's'}` : ''} · {over.balls.length} {over.balls.length === 1 ? 'ball' : 'balls'}</span>
            </summary>
            <ul>
              {over.balls.map((ball) => (
                <li key={ball.id} className={ball.wicket ? 'is-wicket' : ball.boundary ? 'is-boundary' : ''}>
                  <span className="jv-sp-ball">{ball.ball}</span>
                  <span className="jv-sp-text">{ball.line}</span>
                  {ball.speed ? <span className="jv-sp-kph">{ball.speed} kph</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      {overs.length > 12 ? <p className="jv-sp-note">the last 12 overs of this innings are listed here; the feed pages the rest.</p> : null}
      {panel.notes?.length ? (
        /* The feed's own non-delivery lines (drinks, powerplay milestones, a pre-match paragraph) are worth
           having but they are not the score: folded, so the over list stays the thing you came to read. */
        <details className="jv-sp-notes-box">
          <summary>{panel.notes.length} other line{panel.notes.length === 1 ? '' : 's'} from the feed</summary>
          <ul className="jv-sp-notes">
            {panel.notes.slice(0, 8).map((note) => <li key={note.id}>{note.line}</li>)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Everything the hub can legitimately show for watching this match: the streams the feed attached (each audio
 * feed the dump published is its own entry), or the honest answer — no stream, and the link to the page that
 * does have one. There is no player element here that has nothing to play.
 */
/* The source's own name, because a link has to say whose page it opens. */
const SOURCE_NAME = { fancode: 'FanCode', icc: 'ICC', bcci: 'BCCI', ipl: 'IPL' };
const sourceName = (item = {}) => SOURCE_NAME[item.source] || String(item.source || 'the source').toUpperCase();

function VideoPanel({ item, hub, playing, onPickChannel, onResolveVideo, resolving }) {
  const panel = hub?.panels?.video || {};
  const playable = panel.playable || [];
  const videos = panel.items || [];
  const clips = videos.filter((video) => video.kind === 'wicket' && /^https?:/i.test(video.url || ''));
  const library = videos.filter((video) => video.kind === 'video');
  const links = panel.links || item.links || {};
  const linkLabel = { match: 'match page', scorecard: 'scorecard', commentary: 'commentary', highlight: 'highlights', watch: 'live/replay video' };
  const linkKeys = Object.keys(links).filter((key) => /^https?:\/\//i.test(links[key] || ''));
  const pending = playing && !playing.url ? playing : null;
  if (playing?.url) {
    const channel = streamChannel({ url: playing.url, label: playing.label, source: playing.source, extra: playing.extra });
    return (
      <div className="jv-sp-player-wrap">
        <JashPlayer
          key={channel.url}
          className="jv-sp-player"
          source={{ url: channel.url, kind: 'auto', label: channel.name }}
          playbackPolicy={createLiveTvPolicy(channel)}
          live
          display={{ title: channel.name, subtitle: `${channel.source} · ${channel.format.toUpperCase()} · ${playing.via || 'direct'}`, aspect: 'fill', poster: item.poster || undefined }}
        />
        <p className="jv-sp-note">
          {playing.note || 'mounted in JashPlayer · the ClearKey, proxy and error-recovery ladder this app already uses for live TV'}
        </p>
      </div>
    );
  }
  return (
    <div className="jv-sp-watch">
      {/* A labelled video being resolved — or one that failed — is said out loud, with the source's own page next
          to it. A control that changes nothing on screen is the one thing a control may never be. */}
      {pending ? (
        <div className="jv-sp-unavailable is-warn">
          <p><b>{pending.via === 'resolving…' ? 'Asking the source for a playable address…' : 'That video did not resolve'}</b></p>
          <span>{pending.label} · {pending.source}{pending.via !== 'resolving…' ? ` · ${pending.via}` : ''}</span>
          {pending.via !== 'resolving…' && linkKeys.length ? (
            <a className="jv-sp-link" href={links.match || links.highlight || links.watch} target="_blank" rel="noopener noreferrer">open it on {sourceName(item)} <span aria-hidden="true">↗</span></a>
          ) : null}
        </div>
      ) : null}
      {!pending && (playable.length ? (
        <>
          <p className="jv-sp-note">{panel.note}</p>
          <div className="jv-sp-watch-list">
            {playable.map((variant) => (
              <button
                key={variant.id || variant.url}
                type="button"
                className="jv-sp-play"
                onClick={() => onPickChannel({
                  url: variant.url,
                  label: `${item.homeCode || ''} v ${item.awayCode || ''}`.trim() || item.competition || 'Match stream',
                  source: `${sourceLine(item)} · ${variant.label}`,
                  extra: {
                    cookie: variant.cookie,
                    referer: variant.referer || variant.origin,
                    userAgent: variant.userAgent,
                    keyId: variant.keyId,
                    key: variant.key,
                    licenseKey: variant.licenseKey,
                  },
                  expiresAt: variant.expiresAt,
                  variantId: variant.id || '',
                  matchSource: item.source,
                  matchId: String(item.id),
                  via: /\.m3u8/i.test(variant.url) ? 'HLS' : (/\.mpd/i.test(variant.url) ? 'DASH' : 'direct'),
                  note: variant.cookie ? 'the token this feed published travels through the live proxy' : (variant.keyId ? 'plays with the key this feed published' : 'plays direct · if the edge refuses, it retries through this server'),
                })}
              >
                <b>{variant.label}</b>
                <span>{/\.m3u8/i.test(variant.url) ? 'HLS' : 'stream'}{variant.expiresAt ? ` · link good until ${new Date(variant.expiresAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="jv-sp-unavailable">
          <p><b>Stream unavailable</b>{links.match ? ` — check ${sourceName(item)}` : ' · this feed publishes no stream'}</p>
          <span>{panel.note || 'this feed carries no stream for this match'}</span>
        </div>
      ))}
      {library.length ? (
        <div className="jv-sp-videos">
          <p className="jv-sp-mini">Videos on this feed <span>{panel.note && !playable.length ? panel.note : ''}</span></p>
          <ul>
            {library.slice(0, 6).map((video) => (
              <li key={video.id}>
                {video.image ? <img src={video.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
                <span className="jv-sp-video-who">{video.title}{video.matched ? <em>title names both sides</em> : null}</span>
                <button type="button" onClick={() => onResolveVideo(video)} disabled={resolving === video.id}>
                  {resolving === video.id ? 'resolving…' : 'play'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {clips.length ? (
        <div className="jv-sp-links is-clips">
          {clips.slice(0, 4).map((clip, index) => (
            <a key={`${clip.url}-${index}`} className="jv-sp-link" href={clip.url} target="_blank" rel="noopener noreferrer" title={clip.title}>
              {clip.title || 'dismissal clip'} <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ) : null}
      {linkKeys.length ? (
        <div className="jv-sp-links">
          {linkKeys.map((key) => (
            <a key={key} className="jv-sp-link" href={links[key]} target="_blank" rel="noopener noreferrer">
              {key === 'match' ? `Open this match on ${sourceName(item)}` : `on ${sourceName(item)} · ${linkLabel[key] || key}`} <span aria-hidden="true">↗</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Venue, toss, the feed's own summary lines, and the page the source publishes this match on. */
function InfoPanel({ item, hub }) {
  const info = hub?.panels?.info || {};
  const fields = info.fields || {};
  const links = info.links || item.links || {};
  const rows = [
    ['Competition', fields.competition || item.competition],
    ['Match', fields.match || item.matchOrder],
    ['Format', fields.format || item.inningsKind],
    ['Venue', fields.venue || item.venue],
    ['Date', fields.date ? `${fields.date}${fields.statusText ? ` · ${fields.statusText}` : ''}` : timeLabel(item)],
    ['Toss', fields.toss],
    ['Result', fields.result || item.result],
    [`${item.homeCode || 'Home'} line`, fields.homeLine || item.scoreHome],
    [`${item.awayCode || 'Away'} line`, fields.awayLine || item.scoreAway],
    ['Player of the match', fields.playerOfMatch],
    ['Feed coverage', fields.coverage],
  ].filter(([, value]) => value);
  const linkKeys = Object.keys(links).filter((key) => /^https?:\/\//i.test(links[key] || ''));
  return (
    <div className="jv-sp-info">
      {rows.length ? (
        <dl className="jv-sp-fields">
          {rows.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      ) : <p className="jv-sp-note">the summary feed answered with nothing for this match</p>}
      {fields.notes?.length ? (
        <ul className="jv-sp-notes">
          {fields.notes.slice(0, 6).map((note, index) => <li key={`${index}-${note.slice(0, 12)}`}>{note}</li>)}
        </ul>
      ) : null}
      <div className="jv-sp-links">
        {linkKeys.length
          ? linkKeys.map((key) => (
            <a key={key} className="jv-sp-link" href={links[key]} target="_blank" rel="noopener noreferrer">
              view on {sourceName(item)} <span aria-hidden="true">↗</span>
            </a>
          ))
          : <p className="jv-sp-note">this feed publishes scores only · no official match page in its payload</p>}
      </div>
      <p className="jv-sp-note">
        {item.source}/{item.id} · read {hub?.generatedAt ? new Date(hub.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'when you opened it'}
        {item.dumpAt ? ` · FanCode dump dated ${item.dumpAt}` : ''}
      </p>
    </div>
  );
}

/** The full card. Innings toggle first, then batting, bowling, extras, fall of wickets, partnerships. */
function Scorecard({ panel, activeIndex, onInnings }) {
  const rows = useMemo(() => scorecardRows(panel.innings || []), [panel.innings]);
  if (!rows.length) return <p className="jv-sp-note">{panelNote(panel) || 'no innings in this feed'}</p>;
  const active = rows[activeIndex] || rows[rows.length - 1];
  return (
    <div className="jv-sp-card-tables">
      {rows.length > 1 ? (
        <div className="jv-sp-innings" role="group" aria-label="Innings">
          {rows.map((row, index) => (
            <button key={`${row.header}-${index}`} type="button" className={index === rows.indexOf(active) ? 'on' : ''} onClick={() => onInnings(index)}>
              {row.label || row.header || `Innings ${index + 1}`}
            </button>
          ))}
        </div>
      ) : null}
      {active.total || active.runRate ? (
        <p className="jv-sp-line">
          {[active.total, active.runRate, active.required].filter(Boolean).join(' · ') || 'no line in this feed'}
          {active.extras ? ` · extras ${active.extras}` : ''}
        </p>
      ) : null}
      {active.batters.length ? (
        <table className="jv-sp-table">
          <thead><tr><th>Batter</th><th className="num">R</th><th className="num">B</th><th className="num">4s/6s</th><th>Dismissal</th></tr></thead>
          <tbody>
            {active.batters.map((bat, index) => (
              <tr key={`${bat.name}-${index}`} className={bat.batting ? 'here' : ''}>
                <td>{bat.name}</td>
                <td className="num">{bat.line.split(' · ')[0] || '—'}</td>
                <td className="num">{bat.line.split(' · ')[1] || '—'}</td>
                <td className="num">{bat.boundary || '—'}</td>
                <td className="dim">{bat.dismissal || (bat.batting ? 'batting' : '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="jv-sp-note">this feed published the innings total but no batter rows</p>}
      {active.bowlers.length ? (
        <table className="jv-sp-table">
          <thead><tr><th>Bowler</th><th className="num">O</th><th className="num">M</th><th className="num">R</th><th className="num">W</th><th>Econ</th></tr></thead>
          <tbody>
            {active.bowlers.map((bowl, index) => (
              <tr key={`${bowl.name}-${index}`}>
                <td>{bowl.name}</td>
                {bowl.line.split(' - ').length >= 4
                  ? bowl.line.split(' - ').slice(0, 4).map((cell, i) => <td className="num" key={i}>{cell || '—'}</td>)
                  : <td className="dim" colSpan={4}>{bowl.line || '—'}</td>}
                <td className="dim">{bowl.econ || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {active.fow.length ? (
        <div className="jv-sp-fow">
          <p className="jv-sp-mini">Fall of wickets</p>
          <ul>
            {active.fow.map((row, index) => (
              <li key={`${row.wicket || index}-${row.who || index}`}>
                <b>{row.wicket ? `${row.wicket}-` : ''}{row.runs || '—'}</b>
                <span>{[row.who, row.over && `(${row.over})`].filter(Boolean).join(' ') || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {active.partnerships.length ? (
        <div className="jv-sp-fow">
          <p className="jv-sp-mini">Partnerships</p>
          <ul>
            {active.partnerships.map((row, index) => (
              <li key={`${index}-${row.runs}`}><b>{row.runs}{row.balls ? ` (${row.balls}b)` : ''}</b><span>{[row.who, row.wicket && `${row.wicket} wkt`].filter(Boolean).join(' · ')}</span></li>
            ))}
          </ul>
        </div>
      ) : null}
      {active.powerplay.length ? (
        <p className="jv-sp-mini">
          {active.powerplay.map((row) => `${row.label || 'PP'} ${row.overs}${row.runs ? ` · ${row.runs}/${row.wickets || 0}` : ''}`).join('  ·  ')}
        </p>
      ) : null}
      <p className="jv-sp-note">{panelNote(panel)}</p>
    </div>
  );
}

function Hub({ item, panel, loading, error, onReload, onPickChannel, playing, initialTab, onPickTab, now, onResolveVideo, resolving }) {
  const tabs = useMemo(() => hubTabs(panel?.panels || {}, item), [panel?.panels, item]);
  const [tab, setTab] = useState(() => (tabs.includes(initialTab) ? initialTab : tabs[0] || 'live'));
  const wanted = useRef(initialTab && initialTab !== tab ? initialTab : '');
  const [innings, setInnings] = useState(0);
  /* A `?tab=scorecard` link arrives before the hub has answered, and at that moment the Scorecard tab does not
     exist yet — so the request is held until the tab it names appears, instead of silently landing on Live Score. */
  useEffect(() => {
    if (wanted.current && tabs.includes(wanted.current)) { setTab(wanted.current); wanted.current = ''; return; }
    if (!tabs.includes(tab)) setTab(tabs[0] || 'live');
  }, [tab, tabs]);
  const pick = (next) => { setTab(next); onPickTab?.(next); };
  const panels = panel?.panels || {};
  return (
    <div className="jv-sp-hub">
      <div className="jv-sp-hubbar">
        <nav className="jv-sp-tabs" aria-label="Match panels">
          {tabs.map((key) => (
            <button key={key} type="button" className={key === tab ? 'on' : ''} onClick={() => pick(key)} aria-current={key === tab ? 'true' : undefined}>
              {hubTabLabel(key)}
            </button>
          ))}
        </nav>
        <span className="jv-sp-hubtools">
          <button type="button" onClick={onReload} disabled={loading}>{loading ? 'reading…' : 'refresh score'}</button>
          <a href={item.href} className="jv-sp-hubtools-link" title="This URL re-reads the feed when you open it">open in page</a>
        </span>
      </div>
      {error ? <p className="jv-sp-note is-warn">{error} · the hub did not build, press refresh score</p> : null}
      {loading && !panel ? <p className="jv-sp-note">asking the score feed… one request, no polling</p> : null}
      {!loading && tab === 'live' ? <LiveScore item={item} hub={panel} now={now} /> : null}
      {!loading && tab === 'video' ? <VideoPanel item={item} hub={panel} playing={playing} onPickChannel={onPickChannel} onResolveVideo={onResolveVideo} resolving={resolving} /> : null}
      {!loading && tab === 'info' ? <InfoPanel item={item} hub={panel} /> : null}
      {!loading && tab === 'scorecard' ? <Scorecard panel={panels.scorecard || {}} activeIndex={innings} onInnings={setInnings} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ grid bits */

function ReplaysBox({ items, onPlay, resolving }) {
  const replays = items.filter((item) => item.state === 'done' && (item.stream || item.videoId));
  if (!replays.length) return null;
  return (
    <ul className="jv-sp-replays">
      {replays.slice(0, 6).map((item) => (
        <li key={`${item.source}-${item.id}`}>
          <span className="jv-sp-replay-who">{[item.homeCode, item.awayCode].filter(Boolean).join(' v ') || item.competition}</span>
          <button
            type="button"
            onClick={() => onPlay({
              url: item.stream,
              videoId: item.videoId,
              label: `${item.homeCode || ''} v ${item.awayCode || ''}`.trim() || 'Replay',
              source: sourceLine(item),
            })}
            disabled={!item.stream && !item.videoId}
          >
            {item.stream ? 'play' : (resolving === item.videoId ? 'resolving…' : 'resolve')}
          </button>
        </li>
      ))}
    </ul>
  );
}

function SourcesSheet({ open, onClose, sources, onReload }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const healthy = (sources || []).filter((source) => source.ok);
  const sleeping = (sources || []).filter((source) => !source.ok && source.id !== 'fancode-legacy');
  return (
    <div className="jv-sp-sheet" role="dialog" aria-modal="true" aria-label="Sports feeds and channels">
      <div className="jv-sp-sheet-card">
        <header>
          <p className="jv-sp-kicker">Sports · what this page is reading</p>
          <button type="button" className="jv-sp-x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section>
          <h3>Feeds</h3>
          <ul className="jv-sp-sources">
            {healthy.map((source) => (
              <li key={source.id} className={source.stale ? 'stale' : 'ok'}>
                <b>{source.id}</b>
                <span title={source.at || undefined}>
                  {`${source.count} ${source.count === 1 ? 'match' : 'matches'}`}
                  {source.stale ? ` · stale${source.ageMs ? ` · ${formatAge(source.ageMs)} old` : ''}` : ''}
                  {source.note ? ` · ${source.note}` : ''}
                </span>
              </li>
            ))}
            {!healthy.length ? <li className="ok"><b>feeds</b><span>not read yet · press reload</span></li> : null}
          </ul>
          {sleeping.length ? (
            <p className="jv-sp-note">{sleeping.length} score feed{sleeping.length === 1 ? ' is' : 's are'} asleep — the live playlists carry the board, and the asleep feed{sleeping.length === 1 ? '' : 's'} wake{sleeping.length === 1 ? 's' : ''} on the next read.</p>
          ) : null}
        </section>
        <footer>
          <button type="button" onClick={() => { onReload(); onClose(); }}>reload feeds now</button>
          <Link href="/live" onClick={onClose}>live TV guide →</Link>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function SportsFeed({ initialOpen = null } = {}) {
  const feed = useAsyncJson();
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState(initialOpen ? `${initialOpen.source}:${initialOpen.id}` : '');
  const [hubs, setHubs] = useState({});
  const [playing, setPlaying] = useState(null);
  const [tab, setTab] = useState(initialOpen?.tab || 'live');
  const [now, setNow] = useState(() => Date.now());
  const [resolving, setResolving] = useState('');
  const hubRequests = useRef(new Map());
  const lastFetch = useRef(0);
  const seededHub = useRef('');
  // Per-visit toggle on purpose: the board is always live on arrival, and storage reads are banned
  // in this file (see tests) so deep links never depend on them.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollBackoff = useRef({ fails: 0, nextAt: 0 });
  const lastHubPoll = useRef({ key: '', at: 0 });
  const fetchHubRef = useRef(null);
  const hubsRef = useRef({});
  const swapTimersRef = useRef([]);

  const load = useCallback((force = false) => {
    lastFetch.current = Date.now();
    return feed.load(FEED_URL, { force });
  }, [feed.load]);

  useEffect(() => { load(false); /* once per visit: the page is a board, not a ticker */ }, [load]);

  // Labels ("in 25 h 0 m", "upd 25s ago") are clock-dependent, so this tick repaints them. No network here.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Coming back to the tab refreshes a live board. Nothing polls while it is hidden.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (!feed.data?.counts?.live) return;
      if (Date.now() - lastFetch.current < REFRESH_FLOOR_MS) return;
      load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [feed.data?.counts?.live, load]);

  /* Smart polling: the board re-reads while (and only while) it is visible with live matches, and an
     open live hub re-reads its scorecard. The server coalesces + TTL-caches reads, so a tick is one
     cheap JSON hit — nothing like the old always-on poller that got the free tier suspended. Failures
     back off exponentially to 5 minutes, and the masthead toggle pauses everything. */
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (!feed.data?.counts?.live) return;
      if (feed.status === 'loading') return;
      const nowMs = Date.now();
      if (nowMs - lastFetch.current >= 30_000 && nowMs >= pollBackoff.current.nextAt) {
        load(false).then((data) => {
          if (data) pollBackoff.current = { fails: 0, nextAt: Date.now() + 30_000 };
          else {
            const fails = pollBackoff.current.fails + 1;
            pollBackoff.current = { fails, nextAt: Date.now() + Math.min(300_000, 30_000 * 2 ** fails) };
          }
        }).catch(() => {
          const fails = pollBackoff.current.fails + 1;
          pollBackoff.current = { fails, nextAt: Date.now() + Math.min(300_000, 30_000 * 2 ** fails) };
        });
      }
      if (open && fetchHubRef.current) {
        const separator = open.indexOf(':');
        const source = open.slice(0, separator);
        const id = open.slice(separator + 1);
        const item = (itemsRef.current || []).find((entry) => entry.source === source && String(entry.id) === String(id));
        const hub = hubsRef.current[open];
        if (item?.state === 'live' && !hub?.loading) {
          const last = lastHubPoll.current;
          if (last.key !== open || nowMs - last.at >= 20_000) {
            lastHubPoll.current = { key: open, at: nowMs };
            fetchHubRef.current(item, true);
          }
        }
      }
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh, feed.data?.counts?.live, feed.status, load, open]);

  const items = useMemo(() => (feed.data?.items || []), [feed.data]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  hubsRef.current = hubs;
  const list = useMemo(() => {
    if (!initialOpen) return items;
    const wanted = items.find((item) => item.source === initialOpen.source && String(item.id) === String(initialOpen.id));
    if (wanted) return items;
    // A deep link to a match no live feed is carrying still has to open, so the card is materialised from the URL.
    return [{
      id: initialOpen.id,
      source: initialOpen.source,
      href: `/sports/hub/${initialOpen.source}/${initialOpen.id}`,
      state: 'tbc',
      home: '',
      away: '',
      homeCode: initialOpen.source.toUpperCase(),
      awayCode: '',
      competition: 'from the hub link',
      has: { scorecard: true, commentary: false, watch: false },
    }, ...items];
  }, [items, initialOpen]);

  /* ---- the On Air resolver: one ranked list of everything that can play right now.
     Channels are /live's business — the sports board is matches only. ---- */
  const liveItems = useMemo(() => items.filter((item) => item.state === 'live' && !item.staleFeed), [items]);
  const ranked = useMemo(() => rankPlayableSources({ items: liveItems, channels: [], now }), [liveItems, now]);
  const hero = useMemo(() => pickHeroSource(ranked), [ranked]);
  const heroIsMatch = Boolean(hero?.match);
  const heroFeeds = useMemo(
    () => (heroIsMatch ? ranked.filter((entry) => entry.kind === 'variant' && entry.match.source === hero.match.source && String(entry.match.id) === String(hero.match.id)) : []),
    [ranked, hero, heroIsMatch],
  );
  const heroChain = useMemo(
    () => heroFeeds.map((entry) => ({
      url: entry.url,
      label: entry.langLabel ? `${entry.match.label} · ${entry.langLabel}` : entry.label,
      extra: entry.extra || {},
      via: 'HLS · match feed',
      expiresAt: entry.expiresAt || '',
      variantId: entry.variantId || '',
    })),
    [heroFeeds],
  );
  /* Every live match's chain (all its language feeds), so a grid card gets the same fallback depth. */
  const chainByMatch = useMemo(() => {
    const map = new Map();
    for (const entry of ranked) {
      if (entry.kind !== 'variant' || !entry.match) continue;
      const matchKey = `${entry.match.source}:${entry.match.id}`;
      const attempts = map.get(matchKey) || [];
      attempts.push({
        url: entry.url,
        label: entry.langLabel ? `${entry.match.label} · ${entry.langLabel}` : entry.label,
        extra: entry.extra || {},
        via: 'HLS · match feed',
        expiresAt: entry.expiresAt || '',
        variantId: entry.variantId || '',
      });
      map.set(matchKey, attempts);
    }
    return map;
  }, [ranked]);
  /* Also-live cards: one per live match that is not the hero's own. Each carries its best playable entry. */
  const alsoLive = useMemo(() => {
    const others = otherLiveEntries(ranked, hero);
    return liveItems
      .filter((item) => !heroIsMatch || !(item.source === hero.match.source && String(item.id) === String(hero.match.id)))
      .map((item) => ({ item, entry: others.find((entry) => entry.match && entry.match.source === item.source && String(entry.match.id) === String(item.id)) || null }));
  }, [ranked, hero, heroIsMatch, liveItems]);
  const upcoming = useMemo(() => items.filter((item) => item.state === 'soon').slice(0, 8), [items]);
  const finished = useMemo(() => items.filter((item) => item.state === 'done').slice(0, 6), [items]);
  /* The waiting-room hero: when nothing can play, the next fixture is still the headline — with its
     countdown and its hub, and never a fake play button. */
  const nextUp = useMemo(
    () => [...upcoming].sort((a, b) => (Number(a.startAt) || Infinity) - (Number(b.startAt) || Infinity))[0] || upcoming[0] || null,
    [upcoming],
  );

  const fetchHub = useCallback(async (item, force = false) => {
    const key = `${item.source}:${item.id}`;
    if (!force && hubs[key]) return;
    /* Two parameters, and that is the whole request. Everything else the hub needs is read off the same cached
       feed this board came from, so a match URL can never carry a stale copy of a score. */
    const query = new URLSearchParams({ source: item.source, id: String(item.id) });
    const pending = hubRequests.current.get(key);
    if (pending && !force) return;
    const run = (async () => {
      setHubs((current) => ({ ...current, [key]: { ...(current[key] || {}), loading: true, error: '' } }));
      try {
        const response = await fetch(`${HUB_URL}?${query}${force ? '&force=1' : ''}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
        setHubs((current) => ({ ...current, [key]: { ...data, loading: false, error: '' } }));
      } catch (error) {
        setHubs((current) => ({ ...current, [key]: { ...(current[key] || {}), loading: false, error: error.message || 'the hub did not build' } }));
      } finally {
        hubRequests.current.delete(key);
      }
    })();
    hubRequests.current.set(key, run);
    await run;
  }, [hubs]);

  /*
   * One resolver for every video a feed hands us a *label* for (an ICC highlight, a dismissal clip, a replay).
   * `/api/icc/play` turns a uuid into a signed manifest on the score backend — the same call the live-TV
   * entitlement flow uses — and only once that has answered does the player mount. A video that cannot be
   * resolved stays a sentence, never a dead button.
   */
  const resolveVideo = useCallback(async (video) => {
    const wanted = video?.id || video?.videoId;
    if (!wanted) return;
    const label = video?.title || video?.label || 'video';
    setResolving(wanted);
    setPlaying({ key: video?.key || 'channel', label, source: video?.source || 'ICC', via: 'resolving…' });
    try {
      const response = await fetch(`/api/icc/play?videoId=${encodeURIComponent(wanted)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      const url = data?.manifestUrl || data?.url || '';
      if (!url) throw new Error(data?.error || 'no manifest came back');
      setPlaying({ key: video?.key || 'channel', url, label, source: video?.source || 'ICC', via: video?.via || 'resolved' });
    } catch (error) {
      setPlaying({ key: video?.key || 'channel', label, source: video?.source || 'ICC', via: `could not resolve · ${error.message}` });
    } finally {
      setResolving('');
    }
  }, []);

  /*
   * A match URL opens its own hub, so the hub has to be asked here too — the tap path is not the only way a
   * hub ends up on screen. Before this, `/sports/hub/icc/262350` printed the card's own two score lines and
   * no panels, because only `toggle()` ever fetched them.
   */
  useEffect(() => {
    if (!initialOpen) return;
    const key = `${initialOpen.source}:${initialOpen.id}`;
    if (seededHub.current === key) return;
    seededHub.current = key;
    const wanted = (itemsRef.current || []).find((item) => item.source === initialOpen.source && String(item.id) === String(initialOpen.id));
    fetchHub(wanted || { source: initialOpen.source, id: initialOpen.id });
  }, [initialOpen, feed.data, fetchHub]);

  const toggle = useCallback((item) => {
    const key = `${item.source}:${item.id}`;
    const next = open === key ? '' : key;
    setOpen(next);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', next ? `/sports/hub/${item.source}/${item.id}` : '/sports');
    }
    if (next) fetchHub(item);
    if (next && !item.stream && !item.videoId) setPlaying(null);
  }, [open, fetchHub]);
  fetchHubRef.current = fetchHub;

  /* The hero's hub button: the resolver entry only carries the match coordinates, so the toggle
     gets the real feed item when the board has one (it owns `stream`, which decides whether
     opening the hub may stop playback). */
  const toggleMatch = useCallback((match) => {
    const item = (itemsRef.current || []).find((entry) => entry.source === match.source && String(entry.id) === String(match.id));
    toggle(item || match);
  }, [toggle]);

  /* ---- watch: the one path to the stage. Every way in builds a CHAIN of attempts — the clicked
     feed first, then the match's other language feeds. JashPlayer already retries direct → this
     server's proxy on its own; if a whole attempt dies anyway, the stage moves down the chain
     instead of showing a black frame. ---- */
  const watch = useCallback((entry, chain = null) => {
    if (!entry?.url) return;
    const attempts = chain?.length ? chain : [{
      url: entry.url,
      label: entry.label,
      extra: entry.extra || {},
      via: entry.kind === 'variant' ? 'HLS · match feed' : 'stream',
      expiresAt: entry.expiresAt || '',
      variantId: entry.variantId || '',
    }];
    setPlaying({
      key: entry.match ? `${entry.match.source}:${entry.match.id}` : 'channel',
      url: attempts[0].url,
      label: attempts[0].label || entry.label,
      source: entry.badge || 'sports',
      extra: attempts[0].extra || {},
      via: attempts[0].via || 'stream',
      expiresAt: attempts[0].expiresAt || '',
      variantId: attempts[0].variantId || '',
      matchSource: entry.match?.source || '',
      matchId: entry.match ? String(entry.match.id) : '',
      poster: entry.match?.poster || '',
      chain: attempts,
      chainIndex: 0,
      failed: false,
      note: '',
    });
  }, []);

  /* One attempt (direct → proxy, handled inside the player) died for good: move down the chain.
     The last attempt that fails is said out loud — never a silent black frame. */
  const onStageFatal = useCallback(() => {
    setPlaying((current) => {
      if (!current?.chain?.length) return { ...current, failed: true };
      const nextIndex = (current.chainIndex || 0) + 1;
      if (nextIndex >= current.chain.length) return { ...current, failed: true, note: '' };
      const next = current.chain[nextIndex];
      return {
        ...current,
        url: next.url,
        label: next.label || current.label,
        extra: next.extra || {},
        via: next.via || current.via,
        expiresAt: next.expiresAt || '',
        variantId: next.variantId || '',
        chainIndex: nextIndex,
        note: `that feed would not open · switching to ${next.label || 'the next feed'}…`,
      };
    });
  }, []);

  const [stageStatus, setStageStatus] = useState('');
  const onStageStatus = useCallback((status) => setStageStatus(String(status || '')), []);
  const switchAttempt = useCallback((index) => {
    setPlaying((current) => {
      const next = current?.chain?.[index];
      if (!next || index === current.chainIndex) return current;
      return {
        ...current,
        url: next.url,
        label: next.label || current.label,
        extra: next.extra || {},
        via: next.via || current.via,
        expiresAt: next.expiresAt || '',
        variantId: next.variantId || '',
        chainIndex: index,
        failed: false,
        note: '',
      };
    });
  }, []);

  /*
   * Token hot-swap: a FanCode match feed's signed URL dies at `cookie_valid`. Two scheduled
   * refreshes (5 minutes and 45 seconds before expiry) re-read the feed once and swap the URL
   * in place — the player remounts on the live edge, which is where a live viewer already is.
   * Two reads per session, nothing periodic: the free tier never notices.
   */
  useEffect(() => {
    swapTimersRef.current.forEach((timer) => clearTimeout(timer));
    swapTimersRef.current = [];
    if (!playing?.url || !playing.expiresAt || !playing.variantId) return undefined;
    const expiresAt = Date.parse(playing.expiresAt);
    if (!Number.isFinite(expiresAt)) return undefined;
    const swap = async () => {
      const data = await load(true);
      const item = (data?.items || []).find((entry) => entry.state === 'live' && entry.source === playing.matchSource && String(entry.id) === String(playing.matchId));
      if (!item) return;
      const variants = Array.isArray(item.variants) ? item.variants : [];
      const fresh = variants.find((variant) => variant.id === playing.variantId && variant.url && !variant.unavailable)
        || variants.find((variant) => variant.url && !variant.unavailable);
      if (fresh?.url && fresh.url !== playing.url) {
        setPlaying((current) => (current?.variantId === playing.variantId
          ? { ...current, url: fresh.url, expiresAt: fresh.expiresAt || '', via: 'token refreshed · back on the live edge' }
          : current));
      }
    };
    swapTimersRef.current = [
      setTimeout(() => { swap().catch(() => {}); }, Math.max(5_000, expiresAt - Date.now() - 5 * 60_000)),
      setTimeout(() => { swap().catch(() => {}); }, Math.max(8_000, expiresAt - Date.now() - 45_000)),
    ];
    return () => {
      swapTimersRef.current.forEach((timer) => clearTimeout(timer));
      swapTimersRef.current = [];
    };
  }, [playing?.url, playing?.expiresAt, playing?.variantId, playing?.matchSource, playing?.matchId, load]);

  const staleLive = useMemo(() => {
    const count = feed.data?.counts?.unverified || 0;
    if (!count) return '';
    const dump = (feed.data?.sources || []).find((source) => source.id === 'fancode');
    return `${count} alleged-live match${count === 1 ? '' : 'es'} moved to Unverified below — the feed calling ${count === 1 ? 'it' : 'them'} live is too old to trust${dump?.ageMs ? ` · newest stale dump ${formatAge(dump.ageMs)} old` : ''}`;
  }, [feed.data?.counts?.unverified, feed.data?.sources]);

  const updatedLabel = useMemo(() => {
    const at = Date.parse(feed.data?.generatedAt || '') || Number(feed.data?.cachedAt) || 0;
    if (!at) return feed.status === 'loading' ? 'reading…' : 'not read yet';
    return `upd ${formatAge(now - at)} ago`;
  }, [feed.data?.generatedAt, feed.data?.cachedAt, feed.status, now]);

  const counts = feed.data?.counts || { live: 0, soon: 0, done: 0, tbc: 0 };
  /* The open card's key at render scope, so the hub zone can mount its hub. Named `key` on purpose:
     the hub test pins the literal `playing={playing?.key === key ? playing : null}`. */
  const key = open || '';
  const openItem = key ? list.find((entry) => `${entry.source}:${entry.id}` === key) || null : null;

  const gridCard = (item, { entry = null, showHub = true } = {}) => {
    const chip = stateChip(item);
    const itemKey = `${item.source}:${item.id}`;
    const isOpen = open === itemKey;
    return (
      <article key={itemKey} className={`jv-sg-card is-${item.state}${isOpen ? ' is-open' : ''}`}>
        <div className="jv-sg-card-top">
          <span className={`jv-sg-tag is-${chip.tone}`}>{item.state === 'live' ? '● LIVE' : chip.label}</span>
          <span className="jv-sg-src">{sourceLine(item)}</span>
        </div>
        <h3 className="jv-sg-card-who">{[item.homeCode || item.home, item.awayCode || item.away].filter(Boolean).join(' v ') || item.competition || 'Fixture'}</h3>
        <p className="jv-sg-card-line">
          {item.state === 'soon' ? countdownLine(item, now) : statusLine(item) || timeLabel(item, now)}
        </p>
        <div className="jv-sg-card-actions">
          <button
            type="button"
            className="jv-sg-play"
            disabled={!entry}
            onClick={() => {
              const entryWithMatch = { ...entry, match: entry?.match || { source: item.source, id: item.id, poster: item.poster || '' } };
              watch(entryWithMatch, chainByMatch.get(`${item.source}:${item.id}`) || null);
            }}
            title={entry ? `Watch ${entry.label}` : 'no playable stream on this feed'}
          >
            ▶ Watch
          </button>
          {showHub ? (
            <button type="button" className="jv-sg-hubbtn" onClick={() => toggle(item)}>
              {isOpen ? 'close hub' : 'hub'}
            </button>
          ) : null}
        </div>
      </article>
    );
  };

  return (
    <>
      <RailNav />
      <main className="jv-sp-page jv-rail-shift">
        <div className="jv-sp">
          <header className="jv-sp-mast">
            <button type="button" className="jv-sp-burger" onClick={() => setSheet(true)} aria-label="Feeds and channels" title="What this page is reading">
              <span className="jv-sp-burger-bars" aria-hidden="true" />
            </button>
            <div className="jv-sp-who">
              <p className="jv-sp-kicker">Sports · {new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · IST</p>
              <h1 className="jv-sp-h1">On Air</h1>
            </div>
            <div className="jv-sp-mast-side">
              <span className="jv-sp-updated">{updatedLabel}{autoRefresh && counts.live ? ' · auto' : ''}</span>
              <span className={`jv-sp-livepill${counts.live ? ' on' : ''}`}>
                {counts.live ? <i aria-hidden="true" /> : null}{feedLine(counts)}
              </span>
              <button type="button" className="jv-sp-reload" onClick={() => load(true)} disabled={feed.status === 'loading'}>
                {feed.status === 'loading' ? 'reading…' : 'reload'}
              </button>
              <button
                type="button"
                className={`jv-sp-auto${autoRefresh ? ' on' : ''}`}
                onClick={() => setAutoRefresh((value) => !value)}
                title={autoRefresh ? 'Pause live auto-refresh' : 'Resume live auto-refresh'}
              >
                {autoRefresh ? 'auto ✓' : 'auto off'}
              </button>
            </div>
          </header>

          {feed.status === 'error' && !items.length ? (
            <p className="jv-sp-banner">The feeds did not answer: {feed.error}. The board stays empty rather than showing yesterday as today. <button type="button" onClick={() => load(true)}>try again</button></p>
          ) : null}
          {feed.data?.unavailable ? <p className="jv-sp-banner is-soft">{feed.data.note || 'no feed answered'} · <button type="button" onClick={() => load(true)}>reload</button></p> : null}
          {staleLive ? <p className="jv-sp-banner">{staleLive}. <button type="button" onClick={() => load(true)}>reload</button></p> : null}
          {!feed.data && feed.status === 'loading' ? (
            <div className="jv-sp-skels" aria-hidden="true">{[0, 1, 2, 3].map((row) => <span className="jv-sp-skel" key={row} />)}</div>
          ) : null}

          {/* ---------- the stage: watching replaces the hero, one press, no navigation ---------- */}
          {playing?.failed ? (
            <section className="jv-sg-stage" aria-label="Stream did not open">
              <div className="jv-sg-fail">
                <p className="jv-sg-kicker">This stream did not open</p>
                <h2 className="jv-sg-hero-who">{playing.label}</h2>
                <p className="jv-sg-hero-line">
                  Every way in was tried{playing.chain?.length > 1 ? ` — ${playing.chain.length} feeds, direct and through this server` : ' — direct and through this server'} — and the edge refused each one. The match may have ended, or the feed is geo-fenced to where this server cannot follow.
                </p>
                <div className="jv-sg-hero-actions">
                  <button type="button" className="jv-sg-ghost" onClick={() => { setPlaying(null); setStageStatus(''); }}>Back to the board</button>
                  <button type="button" className="jv-sg-watch" onClick={() => {
                    const retry = { ...playing, url: playing.chain?.[0]?.url || playing.url, chainIndex: 0, failed: false, note: '' };
                    setPlaying(retry);
                  }}>Try again</button>
                </div>
              </div>
            </section>
          ) : playing?.url ? (
            <section className="jv-sg-stage" aria-label="Now watching">
              <div className="jv-sg-stage-video">
                <JashPlayer
                  key={playing.url}
                  className="jv-sg-player"
                  source={{ url: playing.url, kind: 'auto', label: playing.label }}
                  playbackPolicy={createLiveTvPolicy(streamChannel({ url: playing.url, label: playing.label, source: playing.source, extra: playing.extra }))}
                  live
                  display={{ title: playing.label, subtitle: `${playing.source} · ${playing.via || 'direct'}`, aspect: 'fill', poster: playing.poster || undefined }}
                  on={{ onFatal: onStageFatal, onStatus: onStageStatus }}
                />
              </div>
              <div className="jv-sg-stage-bar">
                <span className="jv-sg-tag is-live"><i aria-hidden="true" /> LIVE</span>
                <b className="jv-sg-stage-who">{playing.label}</b>
                <span className="jv-sg-stage-note">
                  {playing.note
                    ? playing.note
                    : (stageStatus === 'buffering' || stageStatus === 'loading' ? 'connecting…'
                      : stageStatus === 'error' ? 'reconnecting…'
                        : `${playing.via || 'direct'}${playing.expiresAt ? ` · token until ${new Date(playing.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}`)}
                </span>
                {playing.chain?.length > 1 ? (
                  <span className="jv-sg-stage-feeds" role="group" aria-label="Feeds on this match">
                    {playing.chain.map((attempt, index) => (
                      <button
                        key={attempt.url}
                        type="button"
                        className={`jv-sg-feedchip${index === playing.chainIndex ? ' on' : ''}`}
                        onClick={() => switchAttempt(index)}
                      >
                        {(attempt.label || 'feed').split(' · ').pop()}
                      </button>
                    ))}
                  </span>
                ) : null}
                <button type="button" className="jv-sg-stop" onClick={() => { setPlaying(null); setStageStatus(''); }}>stop</button>
              </div>
            </section>
          ) : hero ? (
            /* ---------- the hero: the resolver's pick, one pre-focused button ---------- */
            <section className="jv-sg-herozone">
              <article className={`jv-sg-hero${heroIsMatch ? ' is-match' : ' is-channel'}`}>
                <div className="jv-sg-hero-art" aria-hidden="true">
                  <span className="jv-sg-hero-live"><i />ON AIR</span>
                </div>
                <div className="jv-sg-hero-body">
                  <p className="jv-sg-kicker">
                    {heroIsMatch
                      ? [hero.match.matchOrder, hero.match.competition].filter(Boolean).join(' · ') || 'Live match'
                      : 'Live channel'}
                  </p>
                  <h2 className="jv-sg-hero-who">{heroIsMatch ? hero.match.label : hero.label}</h2>
                  {heroIsMatch ? (
                    <p className="jv-sg-hero-line">
                      {statusLine(hero.match) || [hero.match.scoreHome, hero.match.scoreAway].filter(Boolean).join(' v ')}
                      {hero.match.venue ? ` · ${hero.match.venue}` : ''}
                    </p>
                  ) : (
                    <p className="jv-sg-hero-line">{heroNote(hero)}</p>
                  )}
                  <p className="jv-sg-hero-note">{heroNote(hero)}</p>
                  <div className="jv-sg-hero-actions">
                    <button
                      type="button"
                      className="jv-sg-watch"
                      autoFocus={heroIsMatch}
                      onClick={() => watch(hero, heroIsMatch ? heroChain : null)}
                      aria-label={`Watch live: ${hero.label}`}
                    >
                      ▶ WATCH LIVE
                    </button>
                    {heroIsMatch ? (
                      <button type="button" className="jv-sg-ghost" onClick={() => toggleMatch(hero.match)}>
                        Match hub
                      </button>
                    ) : null}
                  </div>
                  {heroFeeds.length > 1 ? (
                    <p className="jv-sg-feeds">
                      {heroFeeds.length} feeds on this match:
                      {heroFeeds.map((entry) => (
                        <button key={entry.key} type="button" className={`jv-sg-feedchip${entry.key === hero.key ? ' on' : ''}`} onClick={() => watch(entry)}>
                          {entry.langLabel || 'feed'}
                        </button>
                      ))}
                    </p>
                  ) : null}
                </div>
              </article>
            </section>
          ) : nextUp ? (
            /* ---------- nothing can play: the next fixture is the headline, with a countdown ---------- */
            <section className="jv-sg-herozone">
              <article className="jv-sg-hero is-waiting">
                <div className="jv-sg-hero-body">
                  <p className="jv-sg-kicker">Nothing is on air yet · next fixture</p>
                  <h2 className="jv-sg-hero-who">{[nextUp.homeCode || nextUp.home, nextUp.awayCode || nextUp.away].filter(Boolean).join(' v ') || nextUp.competition}</h2>
                  <p className="jv-sg-hero-line">{countdownLine(nextUp, now)} · {timeLabel(nextUp, now)}</p>
                  <div className="jv-sg-hero-actions">
                    <button type="button" className="jv-sg-ghost" onClick={() => toggle(nextUp)}>Match hub</button>
                  </div>
                </div>
              </article>
            </section>
          ) : null}

          {/* ---------- the hub, opened in place under the hero (deep links land here too) ---------- */}
          {openItem ? (
            <section className="jv-sg-hubzone">
              <Hub
                key={key}
                item={openItem}
                panel={hubs[key]}
                loading={Boolean(hubs[key]?.loading)}
                error={hubs[key]?.error || ''}
                playing={playing?.key === key ? playing : null}
                initialTab={tab === 'live' ? undefined : tab}
                onPickTab={(next) => {
                  setTab(next);
                  if (typeof window !== 'undefined') {
                    window.history.replaceState(null, '', `/sports/hub/${openItem.source}/${openItem.id}${next && next !== 'live' ? `?tab=${next}` : ''}`);
                  }
                }}
                onPickChannel={(state) => setPlaying({ key, ...state })}
                onReload={() => fetchHub(openItem, true)}
                onResolveVideo={(video) => resolveVideo({ ...video, key })}
                resolving={resolving}
              />
            </section>
          ) : null}

          {/* ---------- the grid: also live · channels · today · results · replays ---------- */}
          {alsoLive.length ? (
            <section className="jv-sg-section" aria-labelledby="jv-sg-also">
              <p className="jv-sp-rule" id="jv-sg-also">Also live <em>{alsoLive.length}</em><hr /></p>
              <div className="jv-sg-grid">
                {alsoLive.map(({ item, entry }) => gridCard(item, { entry }))}
              </div>
            </section>
          ) : null}

          {upcoming.length ? (
            <section className="jv-sg-section" aria-labelledby="jv-sg-today">
              <p className="jv-sp-rule" id="jv-sg-today">Today <em>{items.filter((item) => item.state === 'soon').length}</em><hr /></p>
              <div className="jv-sg-grid">
                {upcoming.map((item) => gridCard(item, { entry: null, showHub: true }))}
              </div>
            </section>
          ) : null}

          {finished.length ? (
            <section className="jv-sg-section" aria-labelledby="jv-sg-done">
              <p className="jv-sp-rule" id="jv-sg-done">Finished <em>{items.filter((item) => item.state === 'done').length}</em><hr /></p>
              <div className="jv-sg-grid">
                {finished.map((item) => gridCard(item, { entry: null }))}
              </div>
            </section>
          ) : null}

          <section className="jv-sg-section">
            <ReplaysBox items={list} resolving={resolving} onPlay={(wanted) => {
              if (wanted.url) { setPlaying({ key: 'channel', ...wanted }); return; }
              resolveVideo({ id: wanted.videoId, title: wanted.label, source: 'ICC', key: 'channel' });
            }} />
          </section>

          <footer className="jv-sg-about">
            <p className="jv-sp-note">
              One request per open match, one per reload, and one when this tab becomes visible again if a match
              was live and the last read is older than {REFRESH_FLOOR_MS / 1000} s. A playing stream that fails
              direct retries through this server before moving to the match&rsquo;s next feed. Nothing else asks the
              upstreams anything.
            </p>
            {(() => {
              const healthy = (feed.data?.sources || []).filter((source) => source.ok);
              const sleeping = (feed.data?.sources || []).filter((source) => !source.ok && source.id !== 'fancode-legacy');
              if (!healthy.length && !sleeping.length) return null;
              return (
                <p className="jv-sg-src-line">
                  {healthy.length ? (
                    <>
                      <b>on air via</b> {healthy.map((source) => source.id.replace('-m3u', '')).join(' · ')}
                    </>
                  ) : null}
                  {sleeping.length ? <em>{healthy.length ? ' · ' : ''}{sleeping.length} score feed{sleeping.length === 1 ? '' : 's'} asleep, back on the next read</em> : null}
                </p>
              );
            })()}
          </footer>
        </div>
      </main>
      <SourcesSheet open={sheet} onClose={() => setSheet(false)} sources={feed.data?.sources} onReload={() => load(true)} />
    </>
  );
}

