'use client';

/**
 * The guide surface for /live: a hook that keeps Pocket-EPG windows in sync with the lineup, and the
 * four pieces that render them.
 *
 * Design rules this file follows, all of them learned the hard way:
 *  • one <video>, one page. Nothing here remounts the player, because a remount is how a seek used
 *    to restart a Telegram file at 0 — the guide is data layered next to the player, never a wrapper
 *    around it.
 *  • the ticker re-answers from the server's cached day index (name resolution is <1 ms); it never
 *    re-downloads the feed. Polling stops while the tab is hidden, so an idle phone costs nothing —
 *    which matters on a free tier that suspends services for background load.
 *  • a channel with no guide data is a *known state*, not an empty card: rows say "not linked" and
 *    offer the mapping panel, because a blank strip reads as "broken player".
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const TIME_FORMAT = { hour: '2-digit', minute: '2-digit' };

export function fmtHour(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '—';
  try {
    return new Date(value).toLocaleTimeString('en-IN', TIME_FORMAT);
  } catch {
    return '—';
  }
}

/** Progress 0..1 of the current programme, from the schedule alone — never from a poll. */
export function showProgress(show, at = Date.now()) {
  if (!show || !(show.to > show.from)) return 0;
  return Math.min(1, Math.max(0, (at - show.from) / (show.to - show.from)));
}

function lineupPayload(channels = []) {
  return JSON.stringify(
    channels
      .filter((channel) => channel?.id || channel?.name)
      .slice(0, 500)
      .map((channel) => [String(channel.id || channel.channelId || ''), String(channel.name || ''), String(channel.tvgId || '')]),
  );
}

/**
 * `channels` is the **whole lineup**, not the filtered view: the response is only a few KB and
 * filtering then costs a map lookup instead of a round trip.
 */
export function useLiveGuide({ channels = [], activeId = '', intervalMs = 60_000, enabled = true } = {}) {
  const [rows, setRows] = useState(() => new Map());
  const [status, setStatus] = useState(null);
  const [at, setAt] = useState(Date.now());
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const payload = lineupPayload(channels);

  const load = useCallback(
    async ({ day = activeId, force = false } = {}) => {
      const id = requestRef.current + 1;
      requestRef.current = id;
      if (!enabled || !payload || payload === '[]') {
        setLoading(false);
        return null;
      }
      if (force) setLoading(true);
      try {
        if (force) {
          await fetch('/api/live-epg/guide', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(await tokenHeaders()) },
            body: JSON.stringify({ action: 'refresh', channels: JSON.parse(payload) }),
          }).catch(() => null);
        }
        const query = new URLSearchParams({ c: payload });
        if (day) query.set('day', String(day));
        const response = await fetch(`/api/live-epg/guide?${query.toString()}`, { cache: 'no-store' });
        const data = await response.json().catch(() => null);
        if (requestRef.current !== id) return null; // a newer request already answered
        if (!data || data.ok === false) throw new Error(data?.error || `guide request failed (${response.status})`);
        setRows(new Map((data.channels || []).map((row) => [row.id, row])));
        setStatus(data.status || null);
        setError(data.status?.error ? `Guide feed: ${data.status.error}` : '');
        setAt(Number(data.at) || Date.now());
        setLoading(false);
        return data;
      } catch (cause) {
        if (requestRef.current === id) {
          // Keep the last known guide on screen; the streams are fine, only the listing is stale.
          setError(String(cause?.message || cause));
          setLoading(false);
        }
        return null;
      }
    },
    [activeId, enabled, payload],
  );

  useEffect(() => {
    // `payload` is a string, so this fires on a real lineup change and not on every parent re-render.
    // Stale responses are dropped by the request id inside `load`, which is also what an unmount needs.
    setLoading(true);
    load({ day: activeId });
  }, [load, payload]); // eslint-disable-line react-hooks/exhaustive-deps

  // The clock, not the network: progress and "next starts in N min" advance on their own, and the
  // server call only re-resolves names from an index that is already warm.
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const start = () => {
      if (timer) return;
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') load({ day: activeId });
      }, Math.max(15_000, Number(intervalMs) || 60_000));
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop());
    start();
    document.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, [activeId, enabled, intervalMs, load]);

  const refresh = useCallback(async () => {
    const data = await load({ day: activeId, force: true });
    return Boolean(data?.ok);
  }, [activeId, load]);

  return { rows, status, at, loading, error, refresh, get: (id) => rows.get(String(id || '')) || null };
}

async function tokenHeaders() {
  // The service panel keeps its token in localStorage; the POST is panel-only, so read it lazily.
  const token = typeof window === 'undefined' ? '' : window.localStorage.getItem('jash_live_service_token') || '';
  return token ? { 'x-service-token': token } : {};
}

/* ---------------------------------------------------------------------- pieces */

export function SourceBadges({ channel, row }) {
  const format = String(channel?.format || 'HLS').toUpperCase();
  return (
    <span className="flex items-center gap-1.5">
      <span className="rounded-full border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[9px] font-black tracking-wide text-zinc-300">{format}</span>
      {channel?.keyId && channel?.key ? <span className="rounded-full border border-blue-500/20 bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-black text-blue-200">DRM</span> : null}
      {row && row.matched ? (
        <span
          className={`h-1.5 w-1.5 rounded-full ${row.via === 'name' || row.via === 'prefix' ? 'bg-emerald-400' : 'bg-purple-300'}`}
          title={row.via === 'tvgId' ? `Guide linked by tvg-id ${row.epgId}` : `Guide matched by name → ${row.epgName || row.epgId}`}
        />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" title="No guide data for this channel" />
      )}
    </span>
  );
}

/** One line for a list row: what is on, how far through it is, and what comes next. */
export function GuideNowLine({ row, at = Date.now(), className = '' }) {
  if (!row) {
    return <p className={`truncate text-[11px] font-semibold text-zinc-500 ${className}`}>Guide loading…</p>;
  }
  if (!row.matched) {
    return <p className={`truncate text-[11px] font-semibold text-zinc-500 ${className}`}>No guide match — map it in the service panel</p>;
  }
  const show = row.now || row.lastEnded;
  if (!show) {
    return <p className={`truncate text-[11px] font-semibold text-zinc-500 ${className}`}>Nothing scheduled now · next {fmtHour(row.next?.from)}</p>;
  }
  const progress = row.lastEnded && !row.now ? 1 : showProgress(row.now, at);
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="truncate text-[11.5px] font-bold text-zinc-200">
        {show.title}
        {row.now && row.nowMinutesLeft ? <span className="ml-1.5 font-black text-purple-300">{row.nowMinutesLeft}m left</span> : null}
      </p>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-400 transition-[width] duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="mt-1 truncate text-[10px] font-semibold text-zinc-500">
        {fmtHour(show.from)}–{fmtHour(show.to)}
        {row.next ? ` · next ${row.next.title} at ${fmtHour(row.next.from)}` : ''}
      </p>
    </div>
  );
}

/** The card under (or beside) the player: the programme the viewer is actually watching. */
export function ProgrammeCard({ row, channel, compact = false, onOpenPanel, at = Date.now(), status, className = '', loading = false }) {
  const show = row?.now || row?.lastEnded;
  const progress = show ? (row.now ? showProgress(row.now, at) : 1) : 0;
  const minutesLeft = row?.now?.minutesLeft ?? row?.nowMinutesLeft ?? 0;
  return (
    <div className={`rounded-2xl border border-white/10 bg-zinc-950/85 shadow-[0_16px_40px_-24px_rgba(0,0,0,.9)] ${compact ? 'p-2.5' : 'p-3 sm:p-4'} ${className}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-purple-300/80">
            {row?.matched ? (row.now ? 'On air now' : 'Last shown') : 'Guide'}
          </p>
          {show ? (
            <p className={`truncate font-black text-white ${compact ? 'text-[13px]' : 'text-sm sm:text-base'}`}>{show.title}</p>
          ) : (
            <p className={`truncate font-black text-zinc-400 ${compact ? 'text-[13px]' : 'text-sm'}`}>
              {!row && loading ? 'Loading the guide…' : row && !row.matched ? 'No guide data linked' : 'Nothing scheduled on this channel today'}
            </p>
          )}
          {show ? (
            <p className="mt-0.5 truncate text-[11px] font-semibold text-zinc-400">
              {fmtHour(show.from)} – {fmtHour(show.to)}
              {show.category ? <span className="ml-1.5 rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-zinc-300">{show.category}</span> : null}
              {row?.now && minutesLeft ? <span className="ml-1.5 text-purple-300">{minutesLeft} min left</span> : null}
            </p>
          ) : null}
        </div>
        {row && !row.matched && onOpenPanel ? (
          <button
            type="button"
            onClick={onOpenPanel}
            className="shrink-0 rounded-full border border-purple-300/30 bg-purple-500/10 px-2 py-1 text-[10px] font-black text-purple-100 transition hover:border-purple-300/70"
            title="Open the Live TV service panel and map this channel to a guide id"
          >
            Map
          </button>
        ) : null}
      </div>

      {show ? <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 via-purple-400 to-fuchsia-300 transition-[width] duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} /></div> : null}
      {!compact && show?.desc ? <p className="mt-2 line-clamp-2 text-[11.5px] font-medium leading-5 text-zinc-400">{show.desc}</p> : null}
      {!compact && row?.next ? (
        <p className="mt-2 truncate text-[11px] font-bold text-zinc-300">
          <span className="text-zinc-500">Up next · </span>
          {fmtHour(row.next.from)} {row.next.title}
          {row.minutesToNext ? <span className="ml-1.5 font-black text-purple-300">in {row.minutesToNext} min</span> : null}
        </p>
      ) : null}
      {status?.error ? <p className="mt-2 truncate text-[10px] font-bold text-orange-300/80">guide feed: {status.error} (showing the last listing)</p> : null}
    </div>
  );
}

/**
 * Today for the focused channel. Past blocks stay visible and dim — on live TV "what just ended" is
 * the question people actually ask, and it explains an odd title still showing in the card.
 */
export function DayStrip({ row, at = Date.now(), loading = false }) {
  const scroller = useRef(null);
  const day = Array.isArray(row?.day) ? row.day : [];
  useEffect(() => {
    const node = scroller.current?.querySelector?.('[data-now="1"]');
    if (node) node.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [row?.id, day.length]);

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-2.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
          Today{row?.name ? ` · ${row.name}` : ''}
        </p>
        <p className="text-[10px] font-bold text-zinc-500">
          {loading ? 'loading…' : day.length ? `${day.length} shows` : row && !row.matched ? 'not linked' : 'no data'}
        </p>
      </div>
      {day.length ? (
        <div ref={scroller} className="mt-2 flex snap-x gap-1.5 overflow-x-auto pb-1">
          {day.map((show) => (
            <div
              key={`${show.from}-${show.title}`}
              data-now={show.state === 'now' ? '1' : undefined}
              className={`min-w-[8.5rem] max-w-[11rem] shrink-0 snap-start rounded-xl border px-2 py-1.5 ${
                show.state === 'now' ? 'border-fuchsia-400/50 bg-fuchsia-500/10' : show.state === 'ended' ? 'border-white/[0.06] bg-white/[0.02] opacity-55' : 'border-white/10 bg-white/[0.04]'
              }`}
            >
              <p className="text-[10px] font-black tabular-nums text-zinc-300">
                {fmtHour(show.from)}–{fmtHour(show.to)}
                {show.state === 'now' ? <span className="ml-1 text-fuchsia-300">now</span> : null}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-4 text-white">{show.title}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[11px] font-semibold text-zinc-500">
          {row && !row.matched
            ? 'This source has no entry in the guide feed. Map it once in the service panel and the listings appear here.'
            : 'The guide feed has nothing scheduled for this channel today.'}
        </p>
      )}
    </div>
  );
}

/** Small strip for the panel and the page header: is the guide warm, and how much of the lineup links? */
/** `linked`/`unlinked` come from the caller's rows, because a lineup that has not been resolved yet
 *  is not the same as a channel the feed does not carry — the panel must not blame the user for a
 *  cold cache. */
export function GuideStatus({ status, linked = 0, unlinked = 0, onRefresh, refreshing }) {
  const age = status?.ageMs != null ? Math.round(status.ageMs / 60_000) : null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold text-zinc-400">
      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5">
        Guide: {linked} linked{unlinked ? ` · ${unlinked} to map` : ''}
      </span>
      <span title={status?.url || ''}>
        {age == null ? 'loading' : age < 1 ? 'index fresh' : `index ${age} min old`}
        {status?.feedChannels ? ` · ${status.feedChannels} channels` : ''}
      </span>
      {status?.error ? <span className="text-orange-300">{status.error}</span> : null}
      {onRefresh ? (
        <button type="button" onClick={onRefresh} disabled={refreshing} className="rounded-full border border-purple-300/30 bg-purple-500/10 px-2 py-0.5 text-purple-100 transition hover:border-purple-300/70 disabled:opacity-50">
          {refreshing ? 'Refreshing…' : 'Refresh feed'}
        </button>
      ) : null}
    </div>
  );
}
