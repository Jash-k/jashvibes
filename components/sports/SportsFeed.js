'use client';

/**
 * Sports — the Single Feed (round 19, idea 6 of `docs/concepts/sports-redesign.html`).
 *
 * One vertical column of the same card, two type sizes, one accent, no tabs: live now, starting today, later,
 * finished. Pressing a card opens its hub in place — Watch, Scorecard, Match, About — and the hub is the whole
 * point of the page, so it is fetched per card and cached for the visit rather than hidden behind a route you
 * have to navigate to. The aside holds the things that are not matches: which channels can actually play, and
 * which replays this app can resolve.
 *
 * What this replaced, and did not carry over: the channel grid with one hardcoded Willow iframe, the
 * `Live Feeds / Match Hub` tab pair, `Featured Live Match →` (it linked at `/match/live`, a route with no page),
 * `/match-center/<base64 of the score>`, the FanCode dump being fetched by the browser, and `text-[8px]`.
 *
 * Rules this page keeps: nothing is printed that a feed did not say; a group with no matches in it is not
 * rendered; an empty panel names the feed that was empty; a slept backend says `waking`, never spins forever;
 * and the horizontal gutters live on `.jv-sp`, never on the element that carries `jv-rail-shift` (v8.11.1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import RailNav from '@/components/rail/RailNav';
import JashPlayer from '@/components/player/JashPlayer';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import {
  channelCounts,
  channelLine,
  channelReadiness,
  countdownLine,
  dotLabel,
  feedLine,
  groupFeed,
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
const CHANNELS_URL = '/api/sports/channels';
const REFRESH_FLOOR_MS = 20_000;

/** The player only ever gets a channel-shaped object, so the policy ladder is the same one /live uses. */
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

/* ------------------------------------------------------------------ the card */

function MatchHead({ item, open, onToggle, now }) {
  const chip = stateChip(item);
  return (
    <button
      type="button"
      className="jv-sp-head"
      onClick={onToggle}
      aria-expanded={open}
      title={`${item.home || item.homeCode} v ${item.away || item.awayCode} — ${open ? 'close' : 'open'} the hub`}
    >
      <span className={`jv-sp-state is-${item.state}`} aria-hidden="true">
        <i />
        <small>{dotLabel(item, now) || chip.label}</small>
      </span>
      <span className="jv-sp-which">
        <b>{[item.home, item.away].filter(Boolean).join(' v ') || item.competition || 'Fixture'}</b>
        <p>
          {statusLine(item)}
          {item.venue ? ` · ${item.venue}` : ''} · <span className="jv-sp-src">{sourceLine(item)}</span> · {timeLabel(item, now)}
        </p>
      </span>
      <span className="jv-sp-side">
        {item.has?.watch || item.stream ? <span className="jv-sp-tag is-play">stream</span> : null}
        {item.state === 'soon' ? <span className="jv-sp-tag is-soon">{countdownLine(item, now)}</span> : null}
        <span className={`jv-sp-tag is-${chip.tone}`}>{chip.label}</span>
        <span className="jv-sp-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </span>
    </button>
  );
}

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

function VideoPanel({ item, hub, channels, playing, onPickChannel, onResolveVideo, resolving }) {
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
          liveLabel={playing.liveLabel || 'LIVE'}
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
                  extra: { cookie: variant.cookie, referer: variant.referer, userAgent: variant.userAgent },
                  expiresAt: variant.expiresAt,
                  via: /\.m3u8/i.test(variant.url) ? 'HLS' : 'direct',
                  note: variant.cookie ? 'the token this feed published travels through the live proxy' : 'plays direct',
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
      {channels.length ? (
        <div className="jv-sp-watch-alt">
          <p className="jv-sp-note">or play a channel this device already has</p>
          <div className="jv-sp-watch-list">
            {channels.filter((channel) => channelReadiness(channel).state !== 'unset' && channelReadiness(channel).state !== 'needs-key').slice(0, 4).map((channel) => {
              const readiness = channelReadiness(channel);
              return (
                <button
                  key={channel.id}
                  type="button"
                  className="jv-sp-play"
                  disabled={readiness.state === 'expired'}
                  onClick={() => onPickChannel({
                    url: channel.url,
                    label: channel.name,
                    source: channel.source || 'channel',
                    extra: { keyId: channel.keyId, key: channel.key, licenseKey: channel.licenseKey, cookie: channel.cookie, referer: channel.referer, userAgent: channel.userAgent },
                    via: readiness.label,
                    note: readiness.note,
                  })}
                >
                  <b>{channel.name}</b>
                  <span>{channelLine(channel)} · {readiness.label}</span>
                </button>
              );
            })}
          </div>
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
              <li key={`${index}-${row.runs}`}><b>{row.runs}{row.balls ? ` (${row.balls}b)` : ''}</b><span>{[row.who, row.wicket && `${row.wicket} wkt`].filter(Boolean).join(' · ') || '—'}</span></li>
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

function Hub({ item, panel, loading, error, onReload, channels, onPickChannel, playing, initialTab, onPickTab, now, onResolveVideo, resolving }) {
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
      {!loading && tab === 'video' ? <VideoPanel item={item} hub={panel} channels={channels} playing={playing} onPickChannel={onPickChannel} onResolveVideo={onResolveVideo} resolving={resolving} /> : null}
      {!loading && tab === 'info' ? <InfoPanel item={item} hub={panel} /> : null}
      {!loading && tab === 'scorecard' ? <Scorecard panel={panels.scorecard || {}} activeIndex={innings} onInnings={setInnings} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ aside + sheet */

function ChannelsBox({ channels, counts, onPlay }) {
  if (!channels.length) {
    return <p className="jv-sp-note">no sports channels answered · /api/sports/channels returned an empty list</p>;
  }
  return (
    <ul className="jv-sp-chans">
      {channels.map((channel) => {
        const readiness = channelReadiness(channel);
        const playable = readiness.state === 'ready' || readiness.state === 'key' || readiness.state === 'proxy';
        return (
          <li key={channel.id}>
            <button type="button" disabled={!playable} onClick={() => playable && onPlay(channel)}>
              <b>{channel.name}</b>
              <span>{channelLine(channel)}</span>
            </button>
            <em className={`is-${readiness.state}`} title={readiness.note}>{readiness.label}</em>
          </li>
        );
      })}
      <li className="jv-sp-count">{counts.ready} can play here · {counts.blocked} cannot</li>
    </ul>
  );
}

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

function SourcesSheet({ open, onClose, channels, sources, onReload }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const blocked = channels.filter((channel) => channelReadiness(channel).state === 'unset');
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
            {(sources || []).map((source) => (
              <li key={source.id} className={source.ok ? 'ok' : 'no'}>
                <b>{source.id}</b>
                <span>{source.ok ? `${source.count} ${source.count === 1 ? 'match' : 'matches'}` : source.note}</span>
              </li>
            ))}
            {!sources?.length ? <li className="no"><b>feeds</b><span>not read yet · press reload</span></li> : null}
          </ul>
        </section>
        <section>
          <h3>Channels</h3>
          <p className="jv-sp-note">
            Every entry below is a stream URL this device was given. Anything that needs a key or a Referer is
            played through the same policy <code>/live</code> uses; nothing here opens a third-party player.
          </p>
          <ul className="jv-sp-chans">
            {channels.map((channel) => {
              const readiness = channelReadiness(channel);
              return (
                <li key={channel.id}>
                  <span style={{ minWidth: 0 }}><b>{channel.name}</b><span>{channelLine(channel)}</span></span>
                  <em className={`is-${readiness.state}`} title={readiness.note}>{readiness.label}</em>
                </li>
              );
            })}
            {!channels.length ? <li><span><b>nothing configured</b><span>add SPORTS_FANCODE_URL or SPORTS_WILLOW_URL in .env.local, or let the live-TV catalog carry a sports channel</span></span></li> : null}
          </ul>
          {blocked.length ? <p className="jv-sp-note">{blocked.length} entries carry no URL, so they are listed and never offered.</p> : null}
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
  const channels = useAsyncJson();
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

  const load = useCallback((force = false) => {
    lastFetch.current = Date.now();
    return Promise.all([feed.load(FEED_URL, { force }), channels.load(CHANNELS_URL)]);
  }, [feed.load, channels.load]);

  useEffect(() => { load(false); /* once per visit: the page is a board, not a ticker */ }, [load]);

  // Labels ("in 25 h 0 m") are clock-dependent, so the minute tick repaints them. No network on this timer.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
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

  const items = useMemo(() => (feed.data?.items || []), [feed.data]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
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

  /* `open` is passed as the pin so a match reached by URL is on the board even when its group is capped. */
  const groups = useMemo(() => groupFeed(list, { now, pin: open }), [list, now, open]);
  const channelList = useMemo(() => channels.data?.channels || [], [channels.data]);

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
      setPlaying({ key: video?.key || 'channel', url, label, source: video?.source || 'ICC', via: video?.via || 'resolved', liveLabel: 'VOD' });
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

  const counts = feed.data?.counts || { live: 0, soon: 0, done: 0, tbc: 0 };
  const chanCounts = useMemo(() => channelCounts(channelList, now), [channelList, now]);
  const firstGroup = groups[0];

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
              <h1 className="jv-sp-h1">All of it, one feed</h1>
            </div>
            <div className="jv-sp-mast-side">
              <span className={`jv-sp-livepill${counts.live ? ' on' : ''}`}>
                {counts.live ? <i aria-hidden="true" /> : null}{feedLine(counts)}
              </span>
              <button type="button" className="jv-sp-reload" onClick={() => load(true)} disabled={feed.status === 'loading'}>
                {feed.status === 'loading' ? 'reading…' : 'reload'}
              </button>
            </div>
          </header>

          {feed.status === 'error' && !items.length ? (
            <p className="jv-sp-banner">The feeds did not answer: {feed.error}. The board stays empty rather than showing yesterday as today. <button type="button" onClick={() => load(true)}>try again</button></p>
          ) : null}
          {feed.data?.unavailable ? <p className="jv-sp-banner is-soft">{feed.data.note || 'no feed answered'} · <button type="button" onClick={() => load(true)}>reload</button></p> : null}
          {!feed.data && feed.status === 'loading' ? (
            <div className="jv-sp-skels" aria-hidden="true">{[0, 1, 2, 3].map((row) => <span className="jv-sp-skel" key={row} />)}</div>
          ) : null}
          {feed.data && !groups.length ? <p className="jv-sp-banner is-soft">nothing on any feed right now · {feed.data.sources?.filter((source) => !source.ok).length || 0} of {feed.data.sources?.length || 0} feeds unavailable</p> : null}

          <div className="jv-sp-cols">
            <div className="jv-sp-feed">
              {groups.map((group) => (
                <section key={group.id} className="jv-sp-group">
                  <p className="jv-sp-rule">
                    {group.label}
                    <em>{group.count}{group.truncated ? ` · showing ${group.items.length}` : ''}</em>
                    <hr />
                  </p>
                  <div className="jv-sp-cards">
                    {group.items.map((item) => {
                      const key = `${item.source}:${item.id}`;
                      const isOpen = open === key;
                      return (
                        <article key={key} className={`jv-sp-card is-${item.state}${isOpen ? ' is-open' : ''}`}>
                          <MatchHead item={item} open={isOpen} onToggle={() => toggle(item)} now={now} />
                          {isOpen ? (
                            <Hub
                              item={item}
                              panel={hubs[key]}
                              loading={Boolean(hubs[key]?.loading)}
                              error={hubs[key]?.error || ''}
                              channels={channelList}
                              playing={playing?.key === key ? playing : null}
                              initialTab={tab === 'live' ? undefined : tab}
                              onPickTab={(next) => {
                                setTab(next);
                                if (typeof window !== 'undefined') {
                                  window.history.replaceState(null, '', `/sports/hub/${item.source}/${item.id}${next && next !== 'live' ? `?tab=${next}` : ''}`);
                                }
                              }}
                              onPickChannel={(state) => setPlaying({ key, ...state })}
                              onReload={() => fetchHub(item, true)}
                              onResolveVideo={(video) => resolveVideo({ ...video, key })}
                              resolving={resolving}
                            />
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
              {!groups.length && feed.status !== 'loading' && !firstGroup ? null : null}
            </div>

            <aside className="jv-sp-aside">
              <section className="jv-sp-box">
                <h4>Channels <em>{chanCounts.ready} ready · {chanCounts.blocked} not</em></h4>
                {channels.status === 'loading' && !channelList.length ? <p className="jv-sp-note">asking the live-TV catalog…</p> : null}
                {channels.error ? <p className="jv-sp-note is-warn">channels failed: {channels.error}</p> : null}
                <ChannelsBox channels={channelList} counts={chanCounts} onPlay={(channel) => {
                  setOpen('');
                  setPlaying({ key: 'channel', url: channel.url, label: channel.name, source: channel.source || 'channel', extra: { keyId: channel.keyId, key: channel.key, licenseKey: channel.licenseKey, cookie: channel.cookie, referer: channel.referer, userAgent: channel.userAgent }, via: channelReadiness(channel).label });
                }} />
                {playing?.key === 'channel' ? (
                  <div className="jv-sp-player-wrap">
                    <JashPlayer
                      key={playing.url}
                      className="jv-sp-player"
                      source={{ url: playing.url, kind: 'auto', label: playing.label }}
                      playbackPolicy={createLiveTvPolicy(streamChannel({ url: playing.url, label: playing.label, source: playing.source, extra: playing.extra }))}
                      live
                      liveLabel="LIVE"
                      display={{ title: playing.label, subtitle: `${playing.source} · ${playing.via || 'direct'}`, aspect: 'fill' }}
                    />
                    <button type="button" className="jv-sp-stop" onClick={() => setPlaying(null)}>stop</button>
                  </div>
                ) : null}
              </section>

              <ReplaysBox items={list} resolving={resolving} onPlay={(wanted) => {
                if (wanted.url) { setPlaying({ key: 'channel', ...wanted }); return; }
                resolveVideo({ id: wanted.videoId, title: wanted.label, source: 'ICC', key: 'channel' });
              }} />

              <section className="jv-sp-box">
                <h4>About this board <em>no cron, no Mongo</em></h4>
                <p className="jv-sp-note">
                  One request per open match, one per reload, and one when this tab becomes visible again if a match
                  was live and the last read is older than {REFRESH_FLOOR_MS / 1000} s. Nothing else asks the
                  upstreams anything.
                </p>
                <ul className="jv-sp-sources">
                  {(feed.data?.sources || []).map((source) => (
                    <li key={source.id} className={source.ok ? 'ok' : 'no'}>
                      <b>{source.id}</b>
                      <span>{source.ok ? source.note || 'answered' : source.note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          </div>
        </div>
      </main>
      <SourcesSheet open={sheet} onClose={() => setSheet(false)} channels={channelList} sources={feed.data?.sources} onReload={() => load(true)} />
    </>
  );
}
