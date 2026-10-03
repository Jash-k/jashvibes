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
  const selectClass = 'mt-1 min-h-11 w-full rounded-xl border border-white/15 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-amber-400';
  return (
    <main className="min-h-dvh bg-[#080a10] text-zinc-100 pb-28">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5"><Link href={context?.origin === 'retro' ? '/classics' : context?.origin === 'vault' ? '/vault' : context?.origin === 'stremio' ? '/stremio' : '/'} className="text-sm text-zinc-400 hover:text-white">← Back to catalogue</Link><span className="text-xs font-bold uppercase tracking-[.2em] text-amber-300">Unified Watch</span></header>
      <section className="mx-auto max-w-7xl px-4">
        <div className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-zinc-500">{series ? 'Series' : 'Movie'} · {loaded.context?.year || ''}</p><h1 className="mt-1 text-2xl font-bold sm:text-4xl">{loaded.context?.title || 'Opening title…'}</h1><p className="mt-2 text-sm text-zinc-400">{sources.selection === 'auto' ? `Auto: ${sources.order.map((id) => WATCH_PROVIDERS.find((p) => p.id === id)?.name).join(' → ')}` : 'Manual source — no silent provider switching'}</p></div><button type="button" disabled={!context} onClick={() => toggleFavoriteItem(entry)} className="rounded-xl border border-white/15 px-4 py-3 text-sm">{isFavoriteItem(key) ? '★ Saved' : '☆ My List'}</button></div>
        <div ref={shell} className="overflow-hidden rounded-2xl border border-white/10 bg-black fullscreen:h-dvh fullscreen:w-screen fullscreen:rounded-none flex flex-col">
          <div className="grid grid-cols-2 gap-3 bg-zinc-900/80 p-3 sm:grid-cols-4">
            <label className="text-xs text-zinc-400">Source<select aria-label="Source" className={selectClass} value={sources.selection} onChange={(e) => { setTrailer(null); sources.chooseProvider(e.target.value); }}><option value="auto">Auto</option>{WATCH_PROVIDERS.filter((p) => p.id !== 'retro' || context?.retroStreams?.length).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {series ? <label className="text-xs text-zinc-400">Episode<select aria-label="Episode" className={selectClass} value={`${season}:${episode}`} onChange={(e) => pickEpisode(e.target.value)}>{episodes.map((e) => <option key={`${e.season}:${e.episode}`} value={`${e.season}:${e.episode}`}>S{e.season} E{e.episode}{e.name ? ` · ${e.name}` : ''}</option>)}</select></label> : null}
            <label className="text-xs text-zinc-400">Resolution<select aria-label="Resolution" className={selectClass} value={qualities.length ? active?.quality || '' : manifestQuality?.auto ? 'auto' : String(manifestQuality?.height || 'auto')} disabled={!qualities.length && !manifestQuality?.heights?.length} onChange={(e) => { if (qualities.length) sources.chooseQuality(e.target.value); else if (e.target.value === 'auto') manifestQuality?.setAuto(); else manifestQuality?.select(Number(e.target.value)); }}>{!qualities.length ? <><option value="auto">{manifestQuality?.heights?.length ? 'Auto' : 'Source controlled / Auto'}</option>{(manifestQuality?.heights || []).map((h) => <option key={h} value={String(h)}>{h}p</option>)}</> : qualities.map((q) => <option key={q} value={q}>{q}</option>)}</select></label>
            <div className="flex items-end gap-2"><button type="button" onClick={() => { setTrailer(null); sources.retry(); }} className="min-h-11 rounded-xl border border-white/15 px-3 text-xs">Retry</button><button type="button" onClick={() => { setTrailer(null); sources.next(); }} className="min-h-11 flex-1 rounded-xl bg-amber-300 px-3 text-xs font-bold text-black">Try next source →</button></div>
          </div>
          <div className="relative aspect-video flex-1 min-h-0 bg-black">
            {loaded.status === 'loading' || sources.status === 'loading' ? <div className="absolute inset-0 grid place-content-center gap-3 p-6 text-center"><span className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-amber-300"/><p className="text-sm text-zinc-400">{loaded.status === 'loading' ? 'Matching title and episode…' : `Checking ${sources.provider}…`}</p></div> : null}
            {loaded.status === 'error' || sources.status === 'error' ? <div className="absolute inset-0 grid place-content-center p-6 text-center"><h2 className="text-xl font-bold">Source unavailable</h2><p role="alert" className="mt-3 max-w-xl text-sm text-zinc-400">{loaded.error || sources.error}</p><p className="mt-3 text-xs text-zinc-500">Use Retry / Try next source, or select a provider above.</p></div> : null}
            {sources.status === 'ready' && active && !embed ? <JashPlayer key={`${active.url}:${sources.retryKey}`} playbackPolicy={playbackPolicy} source={{ url: active.url, kind: active.kind || detectKind(active.url) }} display={{ title: context?.title, poster: context?.backdropUrl || context?.posterUrl, aspect: 'fill' }} library={{ watchKey: key, entry, resume: false, persist: false }} fullscreenTargetRef={shell} lineup={{ nextEpisode: nextEpisode ? { label: `S${nextEpisode.season} E${nextEpisode.episode}`, onPlay: () => pickEpisode(`${nextEpisode.season}:${nextEpisode.episode}`) } : null }} on={{ onFatal: sources.fatal, onQualityApi }} /> : null}
            {(trailer || sources.status === 'ready' && active && embed) ? <iframe key={`${trailer?.embedUrl || active.url}:${sources.retryKey}`} title={trailer?.name || context?.title || 'Embedded player'} src={trailer?.embedUrl || active.url} className="absolute inset-0 h-full w-full border-0" onLoad={() => setFrameLoaded(true)} allow="autoplay; encrypted-media; fullscreen; picture-in-picture" sandbox={popupBlocker ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : undefined} referrerPolicy="origin-when-cross-origin" allowFullScreen /> : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/80 px-4 py-3 text-xs text-zinc-400"><span>{sources.provider ? `${WATCH_PROVIDERS.find((p) => p.id === sources.provider)?.name || sources.provider} · ` : ''}{embed ? `${frameLoaded ? 'Frame opened' : 'Frame opening'} — video playback cannot be verified by the app` : 'Native player · bounded recovery'}</span><button type="button" onClick={() => shell.current?.requestFullscreen?.()} className="text-zinc-200">Fullscreen ↗</button></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-400"><label className="flex items-center gap-2"><input type="checkbox" checked={popupBlocker} onChange={(e) => setPopupBlocker(e.target.checked)} /> Sandbox iframe popups</label>{sources.candidates.length > 1 ? <label>Stream / mirror <select aria-label="Stream mirror" className="ml-2 rounded-lg bg-zinc-900 p-2" value={sources.index} onChange={(e) => sources.chooseMirror(Number(e.target.value))}>{sources.candidates.map((c, i) => <option key={c.url} value={i}>{c.label}</option>)}</select></label> : null}{nextEpisode ? <button type="button" onClick={() => pickEpisode(`${nextEpisode.season}:${nextEpisode.episode}`)}>Next episode →</button> : null}{context?.tmdbId ? <button type="button" onClick={playTrailer}>Trailer</button> : null}{trailer ? <button type="button" onClick={() => setTrailer(null)}>Return to title</button> : null}{trailerError ? <span>{trailerError}</span> : null}</div>
        {context && (!context.tmdbId || sources.needsIdentity) ? <form onSubmit={match} className="mt-5 rounded-2xl border border-white/10 bg-zinc-900/40 p-4"><h2 className="font-semibold">Match identity inside Watch</h2><p className="mt-1 text-xs text-zinc-400">Vault can play without an ID. Other providers may need TMDB/IMDb. No guessed title is silently substituted.</p><div className="mt-3 flex gap-2"><input aria-label="TMDB or IMDb ID" value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="TMDB URL / numeric ID / tt0133093" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-black p-3 text-sm"/><button type="submit" className="rounded-xl bg-zinc-200 px-4 text-sm font-semibold text-black">Match</button></div>{identityError ? <p role="alert" className="mt-2 text-xs text-red-300">{identityError}</p> : null}</form> : null}
        {context?.synopsis ? <p className="mt-6 max-w-4xl text-sm leading-7 text-zinc-400">{context.synopsis}</p> : null}
        <details className="mt-5 text-xs text-zinc-500"><summary>Source discovery status</summary><ul className="mt-2 space-y-1">{sources.attempts.map((a, i) => <li key={i}>{a.provider}: {a.status}</li>)}</ul><p className="mt-2">Iframe timestamps cannot be carried across providers without a supported provider API.</p></details>
      </section>
    </main>
  );
}
