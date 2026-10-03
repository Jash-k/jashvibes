'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createStreamPolicy } from '@/lib/player/policy/stream';
import { detectKind } from '@/lib/player/kind';
import { useWatchContext, useWatchSources, requestJson } from '@/hooks/useWatch';
import { WATCH_PROVIDERS, parseIdentity } from '@/lib/watch/policy';
import { makeWatchKey, isFavoriteItem, toggleFavoriteItem, useLibraryVersion } from '@/lib/watchStore';
import { claimMediaFocus } from '@/lib/player/mediaFocus';

/**
 * The one on-demand playback surface.
 *
 * LAYOUT (design system v2): the source controls used to sit ABOVE the frame in
 * a 4-column grid of 12px labels — the first thing you saw on every visit was
 * plumbing, and on a phone it pushed the video below the fold. The order is now
 * picture first, plumbing second:
 *
 *   title → frame → control bar (44px fields) → mirrors / extras → synopsis
 *
 * Nothing about resolution changed: `useWatchContext` and `useWatchSources` are
 * untouched, every handler is the same call it was, and the bar hides itself in
 * fullscreen (`fullscreen:hidden`) because the player brings its own chrome and
 * the frame is the point there.
 */

/** "← Back" returns to the catalogue the title came from. */
function backHref(origin) {
  if (origin === 'retro') return '/classics';
  if (origin === 'vault') return '/vault';
  if (origin === 'stremio') return '/stremio';
  return '/';
}

/** One labelled control. A real <label> so tapping the word focuses the field. */
function Field({ label, children }) {
  return <label className="jv-field">{label}{children}</label>;
}

export default function UnifiedWatchPage() {
  const params = useParams(), query = useSearchParams(), router = useRouter();
  const routeType = String(params.type || 'movie'), routeId = String(params.tmdbId || '');
  const loaded = useWatchContext(routeType, routeId, query.toString());
  const context = loaded.status === 'ready' ? loaded.context : null;
  const [season, setSeason] = useState(Math.max(1, Number(query.get('season') || query.get('s')) || 1));
  const [episode, setEpisode] = useState(Math.max(1, Number(query.get('episode') || query.get('e')) || 1));
  const sources = useWatchSources(context, season, episode);
  const [identity, setIdentity] = useState(''), [identityError, setIdentityError] = useState('');
  const [frameLoaded, setFrameLoaded] = useState(false), [popupBlocker, setPopupBlocker] = useState(true);
  const [trailer, setTrailer] = useState(null), [trailerError, setTrailerError] = useState('');
  const shell = useRef(null); useLibraryVersion();
  const [manifestQuality, setManifestQuality] = useState(null);
  const onQualityApi = useCallback((api) => setManifestQuality(api), []);
  const active = sources.active;
  useEffect(() => setManifestQuality(null), [active?.url]);
  const embed = Boolean(trailer || active?.kind === 'embed');
  const series = context?.type === 'series';
  const episodes = context?.episodes?.length ? context.episodes : [{ season, episode, name: '' }];
  const episodeIndex = episodes.findIndex((e) => e.season === season && e.episode === episode);
  const nextEpisode = series ? episodes[episodeIndex + 1] : null;
  const key = context?.tmdbId ? makeWatchKey({ type: context.type, tmdbId: context.tmdbId }) : `${context?.origin || routeType}:${routeId}`;
  const qualities = [...new Set(sources.candidates.map((c) => c.quality).filter(Boolean))];
  const playbackPolicy = useMemo(() => active && !embed ? createStreamPolicy(active, { expandDashKids: false }) : null, [active, embed]);
  const entry = useMemo(() => context ? {
    key, type: context.type, tmdbId: context.tmdbId || null, title: context.title,
    posterUrl: context.posterUrl || '', year: context.year || '', season: series ? season : 0, episode: series ? episode : 0,
    provider: sources.provider, href: `${typeof window !== 'undefined' ? window.location.pathname : ''}?${new URLSearchParams({ ...Object.fromEntries(query), season: String(season), episode: String(episode) })}`,
    progressReliable: !embed, tracking: embed ? 'last-opened' : 'native',
  } : null, [context, embed, episode, key, query, season, series, sources.provider]);
  useEffect(() => {
    if (embed && sources.status === 'ready') { claimMediaFocus('watch'); setFrameLoaded(false); }
  }, [embed, active?.url, sources.status]);
  useEffect(() => {
    if (context?.episodes?.length && !context.episodes.some((e) => e.season === season && e.episode === episode)) {
      setSeason(context.episodes[0].season); setEpisode(context.episodes[0].episode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.entryId, context?.episodes]);
  function pickEpisode(value) {
    const [s, e] = value.split(':').map(Number); setSeason(s); setEpisode(e); setTrailer(null);
    // URL persistence uses replaceState: it must not trigger title rediscovery or reset a manual provider.
    const p = new URLSearchParams(window.location.search); p.set('season', String(s)); p.set('episode', String(e));
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p}`);
  }
  function match(event) {
    event.preventDefault(); const parsed = parseIdentity(identity);
    if (!parsed.tmdbId && !parsed.imdbId) { setIdentityError('Enter a numeric TMDB ID, IMDb tt ID, or a TMDB/IMDb title URL.'); return; }
    const p = new URLSearchParams(query); if (parsed.tmdbId) p.set('tmdbId', String(parsed.tmdbId)); if (parsed.imdbId) p.set('imdbId', parsed.imdbId); if (parsed.type) p.set('mediaType', parsed.type);
    router.replace(`${window.location.pathname}?${p}`); setIdentityError('');
  }
  async function playTrailer() {
    if (!context?.tmdbId) return;
    try { const d = await requestJson(`/api/tmdb/videos?type=${context.type}&tmdbId=${context.tmdbId}`, null, 12000); if (!d.trailer?.embedUrl) throw new Error('Trailer not found'); setTrailer(d.trailer); claimMediaFocus('watch'); } catch (e) { setTrailerError(e.message); }
  }

  const busy = loaded.status === 'loading' || sources.status === 'loading';
  const failed = loaded.status === 'error' || sources.status === 'error';
  const providerName = sources.provider ? (WATCH_PROVIDERS.find((p) => p.id === sources.provider)?.name || sources.provider) : '';
  const watched = isFavoriteItem(key);

  const art = context?.backdropUrl || context?.posterUrl || '';

  return (
    <main className="min-h-dvh bg-ink-0 pb-28 text-txt-1">
      <header className="border-b border-line-1 bg-ink-1">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link href={backHref(context?.origin)} className="jv-btn jv-btn-ghost jv-btn-sm">
            <span aria-hidden="true">←</span> Back to catalogue
          </Link>
          <span className="jv-eyebrow">Unified watch</span>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 pt-5 sm:px-6 sm:pt-7">
        {/* title block -------------------------------------------------- */}
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="jv-eyebrow">{series ? 'Series' : 'Movie'}{context?.year ? ` · ${context.year}` : ''}</p>
            <h1 className="mt-1.5 text-2xl font-black leading-tight tracking-tight text-txt-1 sm:text-4xl">
              {context?.title || loaded.context?.title || 'Opening title…'}
            </h1>
            <p className="mt-2 text-[13px] font-semibold text-txt-4">
              {sources.selection === 'auto'
                ? `Auto: ${sources.order.map((id) => WATCH_PROVIDERS.find((p) => p.id === id)?.name).join(' → ')}`
                : 'Manual source — no silent provider switching'}
            </p>
          </div>
          <button
            type="button"
            disabled={!context}
            onClick={() => toggleFavoriteItem(entry)}
            className={`jv-btn ${watched ? 'jv-btn-marquee' : 'jv-btn-ghost'}`}
            aria-pressed={watched}
          >
            {watched ? '★ Saved' : '☆ My List'}
          </button>
        </div>

        {/* the frame ---------------------------------------------------- */}
        <div className="jv-cinema">
          {/* The halo is the title's own artwork, blurred, sitting behind the frame: light
              spilling off the screen. Decorative only — `aria-hidden`, no layout impact. */}
          {art ? (
            <div aria-hidden="true" className="jv-cinema-halo" style={{ '--jv-halo-art': `url(${art})` }} />
          ) : null}
          <div ref={shell} className="jv-cinema-frame jv-surface flex flex-col overflow-hidden rounded-tile fullscreen:h-dvh fullscreen:w-screen fullscreen:rounded-none">
          <div className="relative aspect-video min-h-0 flex-1 bg-black">
            <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3.5 py-3">
              {providerName ? <span className="jv-chip jv-chip-info">{providerName}</span> : <span />}
              {embed ? <span className="jv-chip jv-chip-warn">Embed</span> : null}
            </div>

            {busy ? (
              <div role="status" className="absolute inset-0 grid place-content-center gap-3 p-6 text-center">
                <span className="jv-skel mx-auto h-10 w-10 !rounded-full" aria-hidden="true" />
                <p className="text-sm font-semibold text-txt-2">
                  {loaded.status === 'loading' ? 'Matching title and episode…' : `Checking ${sources.provider}…`}
                </p>
              </div>
            ) : null}

            {failed ? (
              <div className="absolute inset-0 grid place-content-center gap-3 p-6 text-center">
                <h2 className="text-lg font-black text-txt-1 sm:text-xl">No playable source right now</h2>
                <p role="alert" className="mx-auto max-w-xl text-[13px] leading-6 text-txt-3">{loaded.error || sources.error}</p>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="jv-btn jv-btn-ghost">Retry</button>
                  <button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="jv-btn jv-btn-marquee">Try next source →</button>
                </div>
              </div>
            ) : null}

            {sources.status === 'ready' && active && !embed ? (
              <JashPlayer
                key={`${active.url}:${sources.retryKey}`}
                playbackPolicy={playbackPolicy}
                source={{ url: active.url, kind: active.kind || detectKind(active.url) }}
                display={{ title: context?.title, poster: context?.backdropUrl || context?.posterUrl, aspect: 'fill' }}
                library={{ watchKey: key, entry, resume: false, persist: false }}
                fullscreenTargetRef={shell}
                lineup={{ nextEpisode: nextEpisode ? { label: `S${nextEpisode.season} E${nextEpisode.episode}`, onPlay: () => pickEpisode(`${nextEpisode.season}:${nextEpisode.episode}`) } : null }}
                on={{ onFatal: sources.fatal, onQualityApi }}
              />
            ) : null}

            {(trailer || (sources.status === 'ready' && active && embed)) ? (
              <iframe
                key={`${trailer?.embedUrl || active.url}:${sources.retryKey}`}
                title={trailer?.name || context?.title || 'Embedded player'}
                src={trailer?.embedUrl || active.url}
                className="absolute inset-0 h-full w-full border-0"
                onLoad={() => setFrameLoaded(true)}
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                sandbox={popupBlocker ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined}
                referrerPolicy="origin-when-cross-origin"
                allowFullScreen
              />
            ) : null}

            {/* Nothing resolved and nothing failed: a real empty state instead of a black rectangle. */}
            {sources.status === 'ready' && !active && !trailer && !failed ? (
              <div className="absolute inset-0 grid place-content-center p-6 text-center">
                <h2 className="text-lg font-black text-txt-1">No streams were returned for this title</h2>
                <p className="mx-auto mt-2 max-w-xl text-[13px] leading-6 text-txt-3">
                  The providers answered but none offered a playable link. Try another source, or paste a TMDB/IMDb id below so
                  the matchers have something exact to resolve.
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="jv-btn jv-btn-marquee">Try next source →</button>
                  <button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="jv-btn jv-btn-ghost">Search again</button>
                </div>
              </div>
            ) : null}
          </div>

          {/* control bar — below the picture, hidden in fullscreen ------- */}
          <div className="grid gap-3 border-t border-line-1 bg-ink-1 p-3.5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] fullscreen:hidden">
            <Field label="Source">
              <select
                aria-label="Source"
                className="jv-select"
                value={sources.selection}
                onChange={(e) => { setTrailer(null); sources.chooseProvider(e.target.value); }}
              >
                <option value="auto">Auto</option>
                {WATCH_PROVIDERS.filter((p) => p.id !== 'retro' || context?.retroStreams?.length).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>

            {series ? (
              <Field label="Episode">
                <select aria-label="Episode" className="jv-select" value={`${season}:${episode}`} onChange={(e) => pickEpisode(e.target.value)}>
                  {episodes.map((e) => (
                    <option key={`${e.season}:${e.episode}`} value={`${e.season}:${e.episode}`}>
                      S{e.season} E{e.episode}{e.name ? ` · ${e.name}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            <Field label="Resolution">
              <select
                aria-label="Resolution"
                className="jv-select"
                value={qualities.length ? active?.quality || '' : manifestQuality?.auto ? 'auto' : String(manifestQuality?.height || 'auto')}
                disabled={!qualities.length && !manifestQuality?.heights?.length}
                onChange={(e) => {
                  if (qualities.length) sources.chooseQuality(e.target.value);
                  else if (e.target.value === 'auto') manifestQuality?.setAuto();
                  else manifestQuality?.select(Number(e.target.value));
                }}
              >
                {!qualities.length ? (
                  <>
                    <option value="auto">{manifestQuality?.heights?.length ? 'Auto' : 'Source controlled / Auto'}</option>
                    {(manifestQuality?.heights || []).map((h) => <option key={h} value={String(h)}>{h}p</option>)}
                  </>
                ) : qualities.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </Field>

            <div className="flex items-end gap-2">
              <button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="jv-btn jv-btn-ghost">Retry</button>
              <button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="jv-btn jv-btn-marquee flex-1">Next source →</button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-1 bg-ink-2 px-3.5 py-2.5 text-[11px] font-semibold text-txt-4">
            <span>
              {providerName ? `${providerName} · ` : ''}
              {embed
                ? `${frameLoaded ? 'Frame opened' : 'Frame opening'} — video playback cannot be verified by the app`
                : 'Native player · bounded recovery'}
            </span>
            <button type="button" onClick={() => shell.current?.requestFullscreen?.()} className="font-black text-txt-2 underline-offset-4 hover:underline">
              Fullscreen ↗
            </button>
          </div>
        </div>
        </div>

        {/* extras ------------------------------------------------------- */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-txt-3">
          <label className="inline-flex min-h-11 items-center gap-2 font-semibold">
            <input type="checkbox" checked={popupBlocker} onChange={(e) => setPopupBlocker(e.target.checked)} />
            Sandbox iframe popups
          </label>

          {sources.candidates.length > 1 ? (
            <label className="jv-field inline-flex items-center gap-2">
              Mirror
              <select
                aria-label="Stream mirror"
                className="jv-select !mt-0 !w-auto min-h-11"
                value={sources.index}
                onChange={(e) => sources.chooseMirror(Number(e.target.value))}
              >
                {sources.candidates.map((c, i) => <option key={c.url} value={i}>{c.label}</option>)}
              </select>
            </label>
          ) : null}

          {nextEpisode ? (
            <button type="button" className="jv-btn jv-btn-ghost jv-btn-sm" onClick={() => pickEpisode(`${nextEpisode.season}:${nextEpisode.episode}`)}>
              Next episode →
            </button>
          ) : null}
          {context?.tmdbId ? (
            <button type="button" className="jv-btn jv-btn-ghost jv-btn-sm" onClick={playTrailer}>Trailer</button>
          ) : null}
          {trailer ? (
            <button type="button" className="jv-btn jv-btn-ghost jv-btn-sm" onClick={() => setTrailer(null)}>Return to title</button>
          ) : null}
          {trailerError ? <span role="alert" className="font-semibold text-danger">{trailerError}</span> : null}
        </div>

        {/* identity match ---------------------------------------------- */}
        {context && (!context.tmdbId || sources.needsIdentity) ? (
          <form onSubmit={match} className="jv-surface mt-5 p-4">
            <h2 className="text-[15px] font-black text-txt-1">Match this title</h2>
            <p className="mt-1 text-[12.5px] leading-6 text-txt-4">
              Vault can play without an ID; other providers may need TMDB or IMDb. No guessed title is silently substituted.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                aria-label="TMDB or IMDb ID"
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                placeholder="TMDB URL / numeric ID / tt0133093"
                className="jv-input !mt-0 min-w-0 flex-1"
              />
              <button type="submit" className="jv-btn jv-btn-brand">Match</button>
            </div>
            {identityError ? <p role="alert" className="jv-alert mt-2">{identityError}</p> : null}
          </form>
        ) : null}

        {context?.synopsis ? (
          <p className="mt-6 max-w-3xl text-[13.5px] leading-7 text-txt-3">{context.synopsis}</p>
        ) : null}

        <details className="mt-5 text-[11.5px] text-txt-4">
          <summary className="cursor-pointer font-bold">Source discovery status</summary>
          <ul className="mt-2 space-y-1">
            {sources.attempts.map((a, i) => <li key={i}>{a.provider}: {a.status}</li>)}
          </ul>
          <p className="mt-2">Iframe timestamps cannot be carried across providers without a supported provider API.</p>
        </details>
      </section>
    </main>
  );
}
