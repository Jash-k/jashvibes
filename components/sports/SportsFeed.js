'use client';

/**
 * Sports — Live Streams (round 25). Minimal on purpose.
 *
 * The page IS the working streams, nothing else. Every card was published by a playlist
 * minutes old and its manifest answered on this very read; a stream that does not answer
 * is hidden before it is ever shown. Playback tries the feed direct, then retries through
 * this server (which can set the headers a browser may not), then the match's other feeds,
 * and only then says the truth out loud.
 *
 * What is deliberately gone: scores, fixtures, results, score feeds, channels, keys — none
 * of it was a stream. `/sports` is a set of live inputs, not a scoreboard.
 *
 * The one piece of round 22 that stayed: one press from card to picture — card ▶ opens the
 * stage in place, and the stage owns the whole recovery ladder.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import RailNav from '@/components/rail/RailNav';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { rankPlayableSources } from '@/lib/sportsLive';
import { feedLine } from '@/lib/sportsFeedView';

const FEED_URL = '/api/sports/feed';
const REFRESH_FLOOR_MS = 20_000;

/** The player only ever gets a channel-shaped object, so the policy ladder is the same one /live uses. */
function formatAge(ms = 0) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function streamChannel({ url, label, source = 'sports', extra = {}, streamProxy = '' }) {
  return {
    id: `sports-${label}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 48),
    name: label,
    url,
    category: 'Sports',
    source,
    format: /\.m3u8/i.test(url) ? 'hls' : 'video',
    streamProxy,
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

const SOURCE_LABEL = { fancode: 'FanCode', sonyliv: 'SonyLiv', icc: 'ICC' };

const SPORT_GLYPH = { cricket: '🏏', football: '⚽', golf: '⛳', kabaddi: '🤼', tennis: '🎾', hockey: '🏑', basketball: '🏀' };

export default function SportsFeed({ initialOpen = null } = {}) {
  const feed = useAsyncJson();
  const [sheet, setSheet] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [stageStatus, setStageStatus] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Per-visit toggle on purpose: a live wall is live on arrival, and storage reads are banned in this file.
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollBackoff = useRef({ fails: 0, nextAt: 0 });
  const lastFetch = useRef(0);

  const load = useCallback((force = false) => {
    lastFetch.current = Date.now();
    return feed.load(FEED_URL, { force });
  }, [feed.load]);

  useEffect(() => { load(false); }, [load]);

  // Clock labels ("upd 25s ago") repaint here. No network in this tick.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Coming back to the tab refreshes a live wall. Nothing polls while it is hidden.
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

  // Visible-only polling with exponential backoff (30 s · 2^n, capped at 5 min).
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
    };
    const timer = setInterval(tick, 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh, feed.data?.counts?.live, feed.status, load]);

  const items = useMemo(() => (feed.data?.items || []), [feed.data]);

  /* ---- the wall: every playlist entry whose manifest answered on the last read, one card per event,
         all of one event's language feeds chained behind its play button. ---- */
  const cards = useMemo(() => {
    const liveItems = items.filter((item) => item.state === 'live' && !item.staleFeed);
    const ranked = rankPlayableSources({ items: liveItems, channels: [], now });
    const byEvent = new Map();
    for (const entry of ranked) {
      if (entry.kind !== 'variant' && entry.kind !== 'stream') continue;
      const eventKey = entry.match ? `${entry.match.source}:${entry.match.id}` : entry.key;
      const card = byEvent.get(eventKey) || {
        key: eventKey,
        source: entry.match?.source || entry.badge || 'live',
        title: entry.match?.label || entry.label,
        competition: entry.match?.competition || '',
        statusLine: entry.match?.statusLine || '',
        poster: entry.match?.poster || '',
        sport: entry.match?.sport || '',
        attempts: [],
      };
      card.attempts.push({
        url: entry.url,
        label: entry.langLabel ? `${card.title} · ${entry.langLabel}` : entry.label,
        extra: entry.extra || {},
        via: entry.kind === 'variant' ? 'HLS · match feed' : 'stream',
        expiresAt: entry.expiresAt || '',
        variantId: entry.variantId || '',
      });
      byEvent.set(eventKey, card);
    }
    return [...byEvent.values()];
  }, [items, now]);

  /* ---- watch: build the chain (clicked feed first, the event's other feeds after). ---- */
  const watch = useCallback((entry, chain = null) => {
    if (!entry?.url) return;
    const attempts = chain?.length ? chain : [{
      url: entry.url,
      label: entry.label,
      extra: entry.extra || {},
      via: entry.via || (entry.kind === 'variant' ? 'HLS · match feed' : 'stream'),
      expiresAt: entry.expiresAt || '',
      variantId: entry.variantId || '',
    }];
    setPlaying({
      key: entry.eventKey || entry.key || 'live',
      url: attempts[0].url,
      label: attempts[0].label || entry.label,
      source: entry.source || 'live',
      extra: attempts[0].extra || {},
      via: attempts[0].via || 'stream',
      expiresAt: attempts[0].expiresAt || '',
      variantId: attempts[0].variantId || '',
      poster: entry.poster || '',
      chain: attempts,
      chainIndex: 0,
      failed: false,
      note: '',
    });
  }, []);

  /* One attempt (direct → proxy, inside the player) died for good: move down the chain. */
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
        note: `that feed would not open · switching to ${(next.label || 'the next feed').split(' · ').pop()}…`,
      };
    });
  }, []);

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

  /* A deep link (/sports/hub/{source}/{id}) to a live stream opens that stream — the URL is a
     remote control, not a page. Anything else falls back to the wall. */
  const autoOpened = useRef('');
  useEffect(() => {
    if (!initialOpen || !cards.length || playing) return;
    const key = `${initialOpen.source}:${initialOpen.id}`;
    if (autoOpened.current === key) return;
    const card = cards.find((entry) => entry.key === key);
    if (card?.attempts[0]) {
      autoOpened.current = key;
      watch({ ...card.attempts[0], eventKey: card.key, source: card.source, poster: card.poster }, card.attempts);
    }
  }, [cards, initialOpen, playing, watch]);

  const stop = useCallback(() => { setPlaying(null); setStageStatus(''); }, []);

  const updatedLabel = useMemo(() => {
    const at = Date.parse(feed.data?.generatedAt || '') || 0;
    if (!at) return feed.status === 'loading' ? 'reading…' : 'not read yet';
    return `upd ${formatAge(now - at)} ago`;
  }, [feed.data?.generatedAt, feed.status, now]);

  const counts = feed.data?.counts || { live: 0, soon: 0, done: 0, tbc: 0 };
  const streamProxy = String(feed.data?.streamProxy || '');
  const healthySources = (feed.data?.sources || []).filter((source) => source.ok);

  return (
    <>
      <RailNav />
      <main className="jv-sp-page jv-rail-shift">
        <div className="jv-sp">
          <header className="jv-sp-mast">
            <button type="button" className="jv-sp-burger" onClick={() => setSheet(true)} aria-label="What this page is reading" title="What this page is reading">
              <span className="jv-sp-burger-bars" aria-hidden="true" />
            </button>
            <div className="jv-sp-who">
              <p className="jv-sp-kicker">Live sports · {new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })} · IST</p>
              <h1 className="jv-sp-h1">Live now</h1>
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

          {playing?.failed ? (
            <section className="jv-sg-stage" aria-label="Stream did not open">
              <div className="jv-sg-fail">
                <p className="jv-sp-kicker">This stream did not open</p>
                <h2 className="jv-sg-stage-fail-who">{playing.label}</h2>
                <p className="jv-sg-stage-fail-line">
                  Every way in was tried{playing.chain?.length > 1 ? ` — ${playing.chain.length} feeds, direct and through this server` : ' — direct and through this server'} — and the edge refused each one.
                  {!streamProxy ? ' These CDNs block browsers and datacenter regions; adding the free stream proxy (docs/STREAM-WORKER.md — one deploy, one env var) unlocks them.' : ''}
                </p>
                <div className="jv-sg-fail-actions">
                  <button type="button" className="jv-sg-ghost" onClick={stop}>Back to the wall</button>
                  <button type="button" className="jv-sg-watch" onClick={() => {
                    setPlaying((current) => ({ ...current, url: current.chain?.[0]?.url || current.url, chainIndex: 0, failed: false, note: '' }));
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
                  playbackPolicy={createLiveTvPolicy(streamChannel({ url: playing.url, label: playing.label, source: playing.source, extra: playing.extra, streamProxy }))}
                  live
                  display={{ title: playing.label, subtitle: `${SOURCE_LABEL[playing.source] || playing.source} · ${playing.via || 'direct'}`, aspect: 'fill', poster: playing.poster || undefined }}
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
                        : `${playing.via || 'direct'}`)}
                </span>
                {playing.chain?.length > 1 ? (
                  <span className="jv-sg-stage-feeds" role="group" aria-label="Feeds on this event">
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
                {cards.filter((card) => card.key !== playing.key).length ? (
                  <span className="jv-sg-stage-feeds" role="group" aria-label="Other live streams">
                    {cards.filter((card) => card.key !== playing.key).map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        className="jv-sg-feedchip"
                        onClick={() => watch({ ...card.attempts[0], eventKey: card.key, source: card.source, poster: card.poster }, card.attempts)}
                        title={`Switch to ${card.title}`}
                      >
                        {card.title}
                      </button>
                    ))}
                  </span>
                ) : null}
                <button type="button" className="jv-sg-stop" onClick={stop}>stop</button>
              </div>
            </section>
          ) : null}

          {!playing?.url && !playing?.failed ? (
            feed.status === 'loading' && !cards.length ? (
              <div className="jv-sp-skels" aria-hidden="true">{[0, 1, 2].map((row) => <span className="jv-sp-skel" key={row} />)}</div>
            ) : cards.length ? (
              <div className="jv-sg-grid jv-sc-grid">
                {cards.map((card) => (
                  <article key={card.key} className="jv-sc-card">
                    <div className="jv-sc-art" style={card.poster ? { backgroundImage: `url(${JSON.stringify(card.poster).slice(1, -1)})` } : undefined}>
                      {!card.poster ? <span className="jv-sc-glyph" aria-hidden="true">{SPORT_GLYPH[card.sport] || '📺'}</span> : null}
                      <span className="jv-sc-live"><i aria-hidden="true" />LIVE</span>
                      <span className="jv-sc-src">{SOURCE_LABEL[card.source] || String(card.source).toUpperCase()}</span>
                    </div>
                    <div className="jv-sc-body">
                      <h2 className="jv-sc-who">{card.title}</h2>
                      {card.competition ? <p className="jv-sc-comp">{card.competition}</p> : null}
                      <div className="jv-sc-actions">
                        <button
                          type="button"
                          className="jv-sc-play"
                          onClick={() => watch({ ...card.attempts[0], eventKey: card.key, source: card.source, poster: card.poster }, card.attempts)}
                          aria-label={`Play ${card.title}`}
                        >
                          ▶ Play
                        </button>
                        {card.attempts.length > 1 ? (
                          <span className="jv-sc-langs" role="group" aria-label={`${card.attempts.length} feeds`}>
                            {card.attempts.map((attempt, index) => (
                              <button
                                key={attempt.url}
                                type="button"
                                className="jv-sg-feedchip"
                                onClick={() => watch({ ...attempt, eventKey: card.key, source: card.source, poster: card.poster }, card.attempts)}
                                title={`Play ${(attempt.label || 'feed').split(' · ').pop()}`}
                              >
                                {(attempt.label || 'feed').split(' · ').pop()}
                              </button>
                            ))}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="jv-sc-empty">
                <p className="jv-sp-kicker">Nothing is on air right now</p>
                <p className="jv-sg-stage-fail-line">
                  {feed.error
                    ? `The playlists did not answer: ${feed.error}.`
                    : (feed.data?.unavailable ? (feed.data.note || 'no playlist answered') : 'Live streams appear here the moment a playlist publishes them and their stream answers.')}
                  {' '}
                  <button type="button" onClick={() => load(true)}>check again</button>
                </p>
                {healthySources.length ? (
                  <p className="jv-sg-src-line"><b>playlists read</b> {healthySources.map((source) => source.id.replace('-m3u', '')).join(' · ')}</p>
                ) : null}
              </div>
            )
          ) : null}

        </div>
      </main>
      <SourcesSheet open={sheet} onClose={() => setSheet(false)} sources={feed.data?.sources} onReload={() => load(true)} />
    </>
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
  const asleep = (sources || []).filter((source) => !source.ok);
  return (
    <div className="jv-sp-sheet" role="dialog" aria-modal="true" aria-label="What this page is reading">
      <div className="jv-sp-sheet-card">
        <header>
          <p className="jv-sp-kicker">Live sports · what this page is reading</p>
          <button type="button" className="jv-sp-x" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <section>
          <h3>Playlists</h3>
          <ul className="jv-sp-sources">
            {healthy.map((source) => (
              <li key={source.id} className={source.stale ? 'stale' : 'ok'}>
                <b>{source.id.replace('-m3u', '')}</b>
                <span title={source.at || undefined}>
                  {`${source.count} on air`}
                  {source.note ? ` · ${source.note}` : ''}
                </span>
              </li>
            ))}
            {!healthy.length ? <li className="ok"><b>playlists</b><span>not read yet · press reload</span></li> : null}
          </ul>
          {asleep.length ? (
            <p className="jv-sp-note">{asleep.map((source) => source.id.replace('-m3u', '')).join(', ')} asleep — the live playlists carry the page, and an asleep one wakes on the next read.</p>
          ) : null}
        </section>
        <footer>
          <button type="button" onClick={() => { onReload(); onClose(); }}>reload now</button>
          <Link href="/live" onClick={onClose}>live TV guide →</Link>
        </footer>
      </div>
    </div>
  );
}
