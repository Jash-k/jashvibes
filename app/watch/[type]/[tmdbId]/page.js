'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import JashPlayer from '@/components/player/JashPlayerLazy';
import { createStreamPolicy } from '@/lib/player/policy/stream';
import { detectKind } from '@/lib/player/kind';
import { useWatchContext, useWatchSources, requestJson } from '@/hooks/useWatch';
import { WATCH_PROVIDERS, parseIdentity, providerOrder, tieredCandidates, hostOf } from '@/lib/watch/policy';
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
 * fullscreen because the frame is the point there — the player brings its own
 * chrome, and a second copy of the controls only ever fought it.
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
  /*
   * One playback surface.
   *
   * This page used to answer "which source?" and "which quality?" with three
   * <select>s — Source, Resolution, and a Mirror picker further down — while the
   * player's own bar carried a fourth. Four controls, one decision. They are now
   * a single panel that shows the current answer on its face, and the player's
   * gear opens the same two questions for the stream that is already playing.
   */
  /*
   * The deck closes on every choice.
   *
   * A panel that stays open after you have answered it is asking the question
   * twice: the viewer picks a source, and then has to dismiss the sheet before
   * they can see whether it worked. Every selection closes it — the source, the
   * quality, the mirror. Escape and outside-click still work for backing out
   * without choosing anything.
   */
  const [playbackOpen, setPlaybackOpen] = useState(false);
  const playbackRef = useRef(null);
  useEffect(() => {
    if (!playbackOpen) return undefined;
    const onDown = (event) => {
      if (!playbackRef.current?.contains?.(event.target)) setPlaybackOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setPlaybackOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [playbackOpen]);
  const [manifestQuality, setManifestQuality] = useState(null);
  const onQualityApi = useCallback((api) => setManifestQuality(api), []);
  const active = sources.active;
  useEffect(() => setManifestQuality(null), [active?.url]);

  /*
   * Warm the Direct MP4 resolver while the viewer is still watching something else.
   *
   * `app/api/moviesda/resolve` has always been described as "the watch page fires
   * this in the background the moment the source match lands" — but nothing ever
   * called it, so the first click on Direct MP4 paid the whole hop-chain walk:
   * measured at 12.2s for a 12s budget, returning 1 candidate where a complete
   * walk returns 7. The fix is to call the two endpoints the way their own docs
   * say, once per title, after the page is up.
   *
   * Only for movies (the Direct MP4 catalogue is movies-only), only once per
   * title, and never awaited — if it fails, the click simply does the walk itself.
   *
   * The lookup is the cheap index read, deliberately without the live-search
   * fallback: warming is speculation, and speculation must not cost moviesda a
   * crawl for every title it has never heard of. A title the index does not know
   * is resolved on click, exactly as before.
   */
  const warmedRef = useRef('');
  useEffect(() => {
    if (!context || context.type !== 'movie') return;
    if (!providerOrder(context.origin).includes('mp4')) return;
    const warmKey = `${context.tmdbId || ''}|${context.title || ''}|${context.year || ''}`;
    if (!warmKey.replace(/\|/g, '') || warmedRef.current === warmKey) return;
    warmedRef.current = warmKey;
    /*
     * Deliberately not abortable.
     *
     * A fire-and-forget warm-up must outlive the render that started it: aborting
     * on cleanup would discard a walk the server is running anyway (it fills the
     * cache whether or not a client is still listening), so the only thing an
     * AbortController buys here is a warm-up that sometimes never lands.
     */
    (async () => {
      try {
        const matchParams = new URLSearchParams({
          type: 'movie',
          tmdbId: String(context.tmdbId || ''),
          title: context.title || '',
          year: String(context.year || ''),
        });
        const matchResponse = await fetch(`/api/moviesda/match?${matchParams}`);
        const match = (await matchResponse.json())?.match;
        if (!match?.pageUrl) return;
        await fetch(`/api/moviesda/resolve?pageUrl=${encodeURIComponent(match.pageUrl)}`);
      } catch { /* the click path resolves on its own */ }
    })();
  }, [context?.tmdbId, context?.title, context?.year, context?.type, context?.origin]);
  const embed = Boolean(trailer || active?.kind === 'embed');
  const series = context?.type === 'series';
  const episodes = context?.episodes?.length ? context.episodes : [{ season, episode, name: '' }];
  const episodeIndex = episodes.findIndex((e) => e.season === season && e.episode === episode);
  const nextEpisode = series ? episodes[episodeIndex + 1] : null;
  const key = context?.tmdbId ? makeWatchKey({ type: context.type, tmdbId: context.tmdbId }) : `${context?.origin || routeType}:${routeId}`;
  const qualities = [...new Set(sources.candidates.map((c) => c.quality).filter(Boolean))];
  /*
   * The direct-link list, tiered: 1080p/720p when they answer, otherwise 480p/HD/360p,
   * one row per link, dead ones dropped. Embeds (vault/stremio/mirchi) have no probe
   * and no resolution, so they keep the old shape — quality pills for their renditions,
   * and their own list below. See lib/watch/policy.js for the rule.
   */
  const isDirectLinks = sources.provider === 'mp4';
  const directRows = isDirectLinks ? tieredCandidates(sources.candidates) : [];
  /*
   * Direct MP4's own state, for the colour on its Source row. Health is read from the
   * probe verdicts the resolver already returned — no second request, no guessing:
   *   ready      at least one link answered        → --ok
   *   exhausted  links were found, all refused     → --danger
   *   checking   the walk is still running         → --gold
   *   unknown    nothing discovered yet            → no colour at all
   */
  const directState = (() => {
    if (!isDirectLinks) return '';
    if (sources.status === 'loading') return 'checking';
    const alive = sources.candidates.filter((c) => c.health !== 'dead').length;
    if (alive > 0) return 'ready';
    if (sources.candidates.length > 0) return 'exhausted';
    if (sources.status === 'error' || sources.error) return 'exhausted';
    return '';
  })();

  /*
   * The quality question, resolved once for the panel.
   *
   * Two shapes exist in this app and the old <select> handled both branches
   * inline: a source that labels its own candidates (mirrors of a release, each
   * with a quality string), or a manifest that exposes rendition heights. The
   * panel shows whichever exists, and never offers a choice that would be a
   * no-op — if there is nothing to switch, the section is simply not there.
   */
  const playbackQualities = qualities.length
    ? qualities
    : (manifestQuality?.heights || []).map((height) => String(height));
  const selectedQuality = qualities.length
    ? (active?.quality || '')
    : (manifestQuality?.auto ? 'auto' : String(manifestQuality?.height || 'auto'));
  const qualityLabelFor = (value) => {
    if (value === 'auto') return manifestQuality?.heights?.length ? 'Auto' : 'Source controlled · Auto';
    if (value === selectedQuality && !qualities.length && manifestQuality?.height) return `${manifestQuality.height}p`;
    return /^\d+$/.test(value) ? `${value}p` : value;
  };
  const playbackQualityLabel = playbackQualities.length
    ? qualityLabelFor(selectedQuality)
    : 'One rendition';
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

  /*
   * Fullscreen state, observed rather than assumed.
   *
   * The bar below the picture carried `fullscreen:hidden`, which is the
   * `:fullscreen` pseudo-class — and the element that actually goes fullscreen
   * is the frame, not the bar, so the rule never matched and the Playback panel
   * rode along inside fullscreen. One listener, one boolean, no guessing.
   */
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const apply = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    const events = ['fullscreenchange', 'webkitfullscreenchange'];
    apply();
    events.forEach((name) => document.addEventListener(name, apply));
    return () => events.forEach((name) => document.removeEventListener(name, apply));
  }, []);

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
            {!isFullscreen ? (
              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 px-3.5 py-3">
                {providerName ? <span className="jv-chip jv-chip-info">{providerName}</span> : <span />}
                {embed ? <span className="jv-chip jv-chip-warn">Embed</span> : null}
              </div>
            ) : null}

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
                {sources.note ? <p className="mt-2 text-center text-[12px] leading-5 text-txt-3/80">{sources.note}</p> : null}
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

          {/* control bar — below the picture. Not rendered while the frame owns the
              screen: fullscreen is the film, and a hidden button is still focusable. */}
          {!isFullscreen ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-line-1 bg-ink-1 p-3.5">
            <div ref={playbackRef} className="relative min-w-[15rem] flex-1 sm:flex-none">
              <p className="jv-eyebrow mb-1.5">Playback</p>
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={playbackOpen}
                aria-label={`Playback: ${sources.selection === 'auto' ? 'Auto source' : WATCH_PROVIDERS.find((p) => p.id === sources.selection)?.name || sources.selection}, ${playbackQualityLabel}`}
                onClick={() => setPlaybackOpen((open) => !open)}
                className="jv-playback-trigger"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2 font-black text-txt-1">
                    {/* The same dot as the deck's Source row: Direct MP4's health is
                        worth seeing without opening the panel to look for it. */}
                    {directState ? <span className={`jvp-state jvp-state-${directState}`} aria-hidden="true" /> : null}
                    <span className="truncate">
                      {sources.selection === 'auto'
                        ? 'Auto'
                        : WATCH_PROVIDERS.find((p) => p.id === sources.selection)?.name || sources.selection}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] font-semibold text-txt-4">{playbackQualityLabel}</span>
                </span>
                <span aria-hidden="true" className={`jv-playback-caret ${playbackOpen ? 'is-open' : ''}`}>▾</span>
              </button>

              {playbackOpen ? (
                <div role="dialog" aria-label="Playback" className="jvp-sheet jv-playback-panel">
                  <p className="jvp-panel-title">Source</p>
                  <button
                    type="button"
                    aria-pressed={sources.selection === 'auto'}
                    className="jvp-panel-row"
                    onClick={() => { setTrailer(null); sources.chooseProvider('auto'); setPlaybackOpen(false); }}
                  >
                    <span>Auto — best available, follows the order below</span>
                  </button>
                  {WATCH_PROVIDERS.filter((p) => p.id !== 'retro' || context?.retroStreams?.length).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={sources.selection === p.id}
                      className="jvp-panel-row"
                      onClick={() => { setTrailer(null); sources.chooseProvider(p.id); setPlaybackOpen(false); }}
                    >
                      {/* Colour is the whole signal: a dot beside the name, no word. The
                          two live in one flex line so the dot stays next to the provider
                          it describes — as a separate child of the row it would be pushed
                          to the far edge by the row's space-between, away from its own
                          subject. Direct MP4 is the only provider whose links are
                          probed, so it is the only row that can carry a state. */}
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{p.name}</span>
                        {p.id === 'mp4' && directState ? <span className={`jvp-state jvp-state-${directState}`} aria-hidden="true" /> : null}
                      </span>
                    </button>
                  ))}

                  {isDirectLinks ? (
                    <>
                      <p className="jvp-panel-title mt-3">Quality</p>
                      {directRows.length ? directRows.map((candidate) => {
                        const index = sources.candidates.indexOf(candidate);
                        const state = candidate.health === 'ok' ? 'ready' : candidate.health === 'dead' ? 'exhausted' : 'unknown';
                        return (
                          <button
                            key={candidate.url}
                            type="button"
                            aria-pressed={Number(sources.index) === index}
                            className="jvp-panel-row"
                            onClick={() => { setTrailer(null); sources.chooseMirror(index); setPlaybackOpen(false); }}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className={`jvp-state jvp-state-${state}`} aria-hidden="true" />
                              <span className="jvp-row-q">{candidate.quality || candidate.label || 'HD'}</span>
                              <span className="jvp-row-host truncate">{hostOf(candidate.url)}</span>
                            </span>
                          </button>
                        );
                      }) : (
                        <p className="jvp-panel-note px-1 pb-1">
                          No playable link right now — Retry, or try another source.
                        </p>
                      )}
                    </>
                  ) : playbackQualities.length ? (
                    <>
                      <p className="jvp-panel-title mt-3">Quality</p>
                      <div className="flex flex-wrap gap-1.5 px-1 pb-1">
                        {playbackQualities.map((q) => (
                          <button
                            key={q}
                            type="button"
                            className="jvp-pill"
                            aria-pressed={String(q) === String(selectedQuality)}
                            onClick={() => { setTrailer(null); if (qualities.length) sources.chooseQuality(q); else if (q === 'auto') manifestQuality?.setAuto(); else manifestQuality?.select(Number(q)); setPlaybackOpen(false); }}
                          >
                            {q === 'auto' ? 'Auto' : q}
                          </button>
                        ))}
                      </div>
                    </>
                  ) : null}

                  {!isDirectLinks && sources.candidates.length > 1 ? (
                    <>
                      <p className="jvp-panel-title mt-3">Sources</p>
                      {sources.candidates.map((c, i) => (
                        <button
                          key={c.url}
                          type="button"
                          aria-pressed={Number(sources.index) === i}
                          className="jvp-panel-row"
                          onClick={() => { sources.chooseMirror(i); setPlaybackOpen(false); }}
                        >
                          <span className="truncate">{c.label}</span>
                        </button>
                      ))}
                    </>
                  ) : null}

                  <div className="mt-3 flex gap-2 border-t border-white/10 px-1 pt-3">
                    <button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="jv-btn jv-btn-ghost jv-btn-sm">Retry</button>
                    <button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="jv-btn jv-btn-marquee jv-btn-sm flex-1">Next source →</button>
                  </div>
                </div>
              ) : null}
            </div>

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

            <div className="flex items-end gap-2">
              <button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="jv-btn jv-btn-ghost">Retry</button>
              <button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="jv-btn jv-btn-marquee">Next source →</button>
            </div>
          </div>
          ) : null}

        </div>
        </div>

        {/* extras ------------------------------------------------------- */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-txt-3">
          <label className="inline-flex min-h-11 items-center gap-2 font-semibold">
            <input type="checkbox" checked={popupBlocker} onChange={(e) => setPopupBlocker(e.target.checked)} />
            Sandbox iframe popups
          </label>

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
