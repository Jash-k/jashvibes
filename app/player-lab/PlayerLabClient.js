'use client';

/**
 * Player lab — a permanent, hidden harness for the unified player.
 *
 * Why this exists: Next only bundles what a route imports, so a build proves
 * nothing about files no page uses. This route imports JashPlayer, both
 * playback policies and the pure modules, which puts the whole stack on the
 * build graph — and gives you one place to see every state the chrome can be
 * in (buffering, recovery, DRM refusal, live edge, PiP, subtitle drop) without
 * hunting for a stream that happens to misbehave.
 *
 * Route: /player-lab  (noindex, not linked from the app)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JashPlayer from '@/components/player/JashPlayer';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { createDirectPolicy, createStreamPolicy } from '@/lib/player/policy/stream';
import { detectKind, needsEngine } from '@/lib/player/kind';
import { fmtTime } from '@/lib/player/labels';
import { keyMap, listCommands, parityReport } from '@/lib/player/commands';
import { LAB_FIXTURES, LAB_LINEUP } from './labFixtures';

/**
 * Query-string entry point (`/player-lab?src=…`), read off `location` instead of
 * `useSearchParams` so the route stays a static page: `?src=` a Stremio or
 * Telegram URL, `&kind=hls|dash|direct`, `&live=1`, `&label=…`,
 * `&drm=keyIdHex:keyHex`, `&timeout=45000`. Handy on a phone: paste the link in
 * the share sheet, open the lab, and compare it against the same file on the TV.
 */
function readLocationQuery() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const src = (params.get('src') || '').trim();
  if (!src) return null;
  return {
    src,
    label: (params.get('label') || 'From ?src').trim(),
    kind: (params.get('kind') || '').trim(),
    live: params.get('live') === '1' || params.get('live') === 'true',
    drm: (params.get('drm') || '').trim(),
    timeout: Number(params.get('timeout')) || undefined,
  };
}

function policyFor(fixture) {
  if (fixture.livePolicy) return createLiveTvPolicy(fixture.channel || {});
  if (fixture.drm) {
    return createStreamPolicy({ url: fixture.source.url, label: fixture.source.label, licenseKey: fixture.drm.licenseKey });
  }
  return createDirectPolicy(fixture.source.url, { live: Boolean(fixture.live) });
}

function KindBadge({ url }) {
  const kind = detectKind(url);
  const engine = needsEngine(url, kind) ? 'Shaka' : 'native';
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-zinc-300">
      {kind} · {engine}
    </span>
  );
}

export default function PlayerLabClient() {
  const [activeId, setActiveId] = useState(LAB_FIXTURES[0].id);
  const [compact, setCompact] = useState(false);
  const [gestures, setGestures] = useState(true);
  const [audioOnly, setAudioOnly] = useState(false);
  const [customUrl, setCustomUrl] = useState('');
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState(null);
  const seqRef = useRef(0);

  useEffect(() => {
    setQuery(readLocationQuery());
  }, []);

  const fixture = useMemo(
    () => LAB_FIXTURES.find((item) => item.id === activeId) || LAB_FIXTURES[0],
    [activeId],
  );
  const url = query?.src || customUrl.trim() || fixture.source.url;
  const title = query?.label || fixture.name;
  const live = Boolean(query ? query.live : fixture.live);
  const policy = useMemo(() => {
    if (query) {
      return query.drm
        ? createStreamPolicy(
            { url: query.src, label: query.label, licenseKey: query.drm },
            { loadTimeoutMs: query.timeout },
          )
        : createDirectPolicy(query.src, {
            kind: query.kind || undefined,
            live: query.live,
            label: query.label,
            loadTimeoutMs: query.timeout,
          });
    }
    if (customUrl.trim()) return createDirectPolicy(customUrl.trim());
    return policyFor(fixture);
  }, [customUrl, fixture, query]);

  const log = useCallback((type, detail) => {
    seqRef.current += 1;
    const entry = { id: seqRef.current, type, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) };
    setEvents((current) => [entry, ...current].slice(0, 40));
  }, []);

  const handlers = useMemo(
    () => ({
      onStatus: (status, message) => log('status', message ? `${status} — ${message}` : status),
      onError: (info) => log('error', `${info?.code ?? '—'} ${info?.label || ''} [${info?.action || 'none'}]`),
      onFatal: (info) => log('fatal', `${info?.label || 'playback failed'} · auto-retry ladder stopped`),
      onEnded: () => log('ended', 'ended → lineup.nextEpisode would advance now'),
      onReport: (incident) => log('report', incident?.summary || 'incident queued for Live Service'),
    }),
    [log],
  );

  const parity = useMemo(() => parityReport(), []);
  const commands = useMemo(() => listCommands(), []);
  const map = useMemo(() => keyMap(), []);

  return (
    <main className="min-h-dvh bg-[#07060d] px-4 py-6 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-[1400px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-fuchsia-300/80">Internal tool</p>
            <h1 className="text-2xl font-black sm:text-3xl">Player lab</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-400">
              Every surface in the app mounts the same <code className="text-fuchsia-200">&lt;JashPlayer /&gt;</code>. These fixtures are
              the states that are hard to reproduce on purpose: live edge, DRM refusal, a container the browser refuses,
              a dead host.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            {[
              ['Chrome: compact', compact, () => setCompact((v) => !v)],
              ['Gestures', gestures, () => setGestures((v) => !v)],
              ['Audio only', audioOnly, () => setAudioOnly((v) => !v)],
            ].map(([label, on, toggle]) => (
              <button
                key={label}
                type="button"
                onClick={toggle}
                className={`rounded-full border px-3 py-1.5 transition ${
                  on ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-100' : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/30'
                }`}
              >
                {label}: {on ? 'on' : 'off'}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <section className="min-w-0 space-y-4">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
              <JashPlayer
                key={`${fixture.id}:${url}`}
                source={{
                  ...fixture.source,
                  url,
                  label: query ? query.label : fixture.source.label,
                  kind: query?.kind || fixture.source.kind,
                  crossOrigin: fixture.id === 'mp4' ? 'anonymous' : undefined,
                }}
                playbackPolicy={policy}
                live={live}
                compact={compact}
                gesturesEnabled={gestures}
                audioOnly={audioOnly}
                display={{ title, aspect: compact ? 'video' : 'fill', poster: '' }}
                lineup={{
                  sources: LAB_LINEUP.map((item) => ({ ...item, kind: detectKind(item.url) })),
                  activeIndex: 0,
                  onPickSource: (index) => log('source', `picked #${index} ${LAB_LINEUP[index]?.label || ''}`),
                  nextEpisode: { title: 'Next up · auto-advance test', image: '', onPlay: () => log('next', 'nextEpisode.onPlay') },
                }}
                on={handlers}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <KindBadge url={url} />
              {query ? (
                <span className="break-all rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-2 py-0.5 font-mono text-[10px] text-fuchsia-100">
                  ?src → {url}
                </span>
              ) : null}
              <span>{fixture.expect}</span>
            </div>

            <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3">
              <label className="flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-wider text-zinc-400">
                Paste any URL (Stremio mirror, Telegram file, .m3u8, .mpd…)
                <input
                  value={customUrl}
                  onChange={(event) => setCustomUrl(event.target.value)}
                  placeholder={fixture.source.url}
                  className="min-w-[16rem] flex-1 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-[12px] font-medium normal-case tracking-normal text-white outline-none focus:border-fuchsia-400/60"
                />
                {customUrl ? (
                  <button type="button" onClick={() => setCustomUrl('')} className="rounded-full border border-white/10 px-3 py-1.5 normal-case tracking-normal">
                    Clear
                  </button>
                ) : null}
              </label>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10">
              <p className="border-b border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                Engine events
              </p>
              <ul className="max-h-56 space-y-1 overflow-y-auto bg-black/40 p-3 font-mono text-[11px] leading-5">
                {events.length ? (
                  events.map((event) => (
                    <li key={event.id} className="flex gap-2">
                      <span
                        className={`shrink-0 font-black uppercase ${
                          event.type === 'error' || event.type === 'fatal' ? 'text-red-300' : event.type === 'status' ? 'text-zinc-500' : 'text-fuchsia-200'
                        }`}
                      >
                        {event.type}
                      </span>
                      <span className="break-all text-zinc-300">{event.detail}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-zinc-600">Nothing yet — press play, scrub, or drag an .srt file onto the video.</li>
                )}
              </ul>
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">Fixtures</p>
              <ul className="space-y-1.5">
                {LAB_FIXTURES.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(item.id);
                        setCustomUrl('');
                      }}
                      className={`w-full rounded-xl border px-3 py-2 text-left text-[12px] font-bold transition ${
                        item.id === fixture.id
                          ? 'border-fuchsia-400/60 bg-fuchsia-500/10 text-white'
                          : 'border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/30'
                      }`}
                    >
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-[12px]">
              <p className="mb-2 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">Input parity</p>
              <p className={parity.gaps.length ? 'text-red-300' : 'text-emerald-300'}>
                {parity.gaps.length
                  ? `${parity.gaps.length} gap(s): ${parity.gaps.map((gap) => `${gap.name} (${gap.why})`).join(', ')}`
                  : `All ${parity.total} commands reachable by touch, mouse or key.`}
              </p>
              <p className="mt-1 text-zinc-500">
                {parity.mobileOnly.length} gesture/button command(s) with no key binding · {parity.desktopOnly.length}{' '}
                marked desktop-only.
              </p>
              <p className="mt-2 text-zinc-500">
                Rebuilt by <code>tests/player-commands.test.js</code>, so a new binding cannot ship without a mobile path.
              </p>
            </div>

            <details className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-[12px]">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                Keyboard map
              </summary>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-zinc-300">
                {Object.entries(map).map(([keys, names]) => (
                  <li key={keys} className="flex justify-between gap-3">
                    <span className="text-fuchsia-200">{keys}</span>
                    <span className="text-right text-zinc-400">{names.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </details>

            <details className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-[12px]">
              <summary className="cursor-pointer text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                All commands ({commands.length})
              </summary>
              <ul className="mt-2 grid gap-1 text-[11px] text-zinc-400">
                {commands.map((command) => (
                  <li key={command.name} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold text-zinc-200">{command.label || command.name}</span>
                    <span className="text-zinc-500">{command.keys.length ? command.keys.join(', ') : 'no key binding'}</span>
                    {command.gesture ? <span className="text-emerald-300/80">gesture</span> : null}
                    {command.desktopOnly ? <span className="text-amber-300/80">desktop only</span> : null}
                  </li>
                ))}
              </ul>
            </details>

            <div className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 text-[11px] leading-5 text-zinc-400">
              <p className="mb-1 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">Not covered here</p>
              <p>
                Embed providers (VidLink/VidEasy/VidZee/VidRock/Global Mirchi) stay iframes by design — their player is
                remote and unstyleable. Music keeps its own audio engine. <code>fmtTime</code> is shared so the numbers
                below match the chrome: {fmtTime(0)} · {fmtTime(3725)} · {fmtTime(86400)}.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
