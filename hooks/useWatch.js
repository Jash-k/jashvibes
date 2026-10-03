'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { groupEpisodes } from '@/lib/vaultEpisodes';
import { providerOrder, normalizeCandidates, chooseCandidate, MAX_PROVIDER_ALTERNATIVES } from '@/lib/watch/policy';

export async function requestJson(url, signal, timeout = 30000) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { needsIdentity: data.needsIdentity });
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function useWatchContext(routeType, routeId, queryString) {
  const [state, setState] = useState({ status: 'loading', context: null, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    const p = new URLSearchParams(queryString);
    const origin = p.get('origin') || (routeType === 'retro' ? 'retro' : routeType === 'vault' ? 'vault' : routeType.startsWith('stremio') ? 'stremio' : 'home');
    const series = routeType.includes('series') || routeType === 'tv' || p.get('mediaType') === 'series';
    const knownId = /^(movie|series|tv)$/.test(routeType) && /^\d+$/.test(routeId) ? Number(routeId) : 0;
    const context = { origin, entryId: routeId, type: series ? 'series' : 'movie', title: p.get('title') || 'Selected title', year: p.get('year') || '', posterUrl: p.get('poster') || '', tmdbId: Number(p.get('tmdbId')) || knownId || null, imdbId: p.get('imdbId') || '', reference: origin === 'stremio' ? routeId : '', vault: null, retroStreams: [], episodes: [] };
    setState({ status: 'loading', context, error: '' });
    (async () => {
      try {
        if (origin === 'vault' || routeType === 'vault') {
          const data = await requestJson(`/api/vault?id=${encodeURIComponent(routeId)}`, controller.signal);
          if (!data.movie) throw new Error('Vault title not found.');
          context.vault = data.movie;
          Object.assign(context, { title: data.movie.title, year: data.movie.year, posterUrl: data.movie.poster, tmdbId: data.movie.tmdbId || context.tmdbId, imdbId: data.movie.imdbId || context.imdbId, type: data.movie.isSeries ? 'series' : 'movie' });
        } else if (origin === 'retro') {
          const data = await requestJson(`/api/vod/${encodeURIComponent(routeId)}`, controller.signal);
          Object.assign(context, data.item, { origin, entryId: routeId, retroStreams: data.item.streams || [] });
        } else if (origin === 'stremio') {
          try {
            const data = await requestJson(`/api/stremio/meta?type=${context.type}&id=${encodeURIComponent(routeId)}&source=catalog`, controller.signal);
            const m = data.item || {};
            Object.assign(context, { title: m.title || m.name || context.title, year: m.year || context.year, posterUrl: m.posterUrl || m.poster || context.posterUrl, synopsis: m.synopsis || '', videos: m.videos || [] });
            if (/^tt\d+$/i.test(routeId)) context.imdbId = routeId;
            if (/^tmdb:\d+$/i.test(routeId)) context.tmdbId = Number(routeId.split(':')[1]);
          } catch (e) { if (controller.signal.aborted) throw e; }
        }
        if (context.tmdbId) {
          try { const meta = await requestJson(`/api/tmdb/meta?type=${context.type}&tmdbId=${context.tmdbId}`, controller.signal, 12000); if (meta.ok) Object.assign(context, meta, { origin, entryId: routeId }); } catch (e) { if (controller.signal.aborted) throw e; }
        }
        if (!context.vault) {
          try {
            const q = new URLSearchParams({ type: context.type, title: context.title, year: String(context.year || ''), tmdbId: String(context.tmdbId || ''), imdbId: context.imdbId || '' });
            const m = await requestJson(`/api/vault/match?${q}`, controller.signal, 12000);
            if (m.hit?.id) context.vault = (await requestJson(`/api/vault?id=${encodeURIComponent(m.hit.id)}`, controller.signal)).movie;
          } catch (e) { if (controller.signal.aborted) throw e; }
        }
        const eps = groupEpisodes(context.vault?.embeds || []).map((e) => ({ season: e.season || 1, episode: e.episode, name: '' }));
        (context.videos || []).forEach((e) => eps.push({ season: Number(e.season) || 1, episode: Number(e.episode) || 1, name: e.title || '' }));
        if (context.type === 'series' && context.tmdbId) {
          try { const seriesMeta = await requestJson(`/api/tmdb/series/${context.tmdbId}`, controller.signal, 20000); (seriesMeta.seasons || []).forEach((s) => (s.episodes || []).forEach((e) => eps.push({ season: s.seasonNumber, episode: e.episodeNumber, name: e.name || '' }))); } catch (e) { if (controller.signal.aborted) throw e; }
        }
        context.episodes = [...new Map(eps.map((e) => [`${e.season}:${e.episode}`, e])).values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
        if (!controller.signal.aborted) setState({ status: 'ready', context: { ...context }, error: '' });
      } catch (e) { if (!controller.signal.aborted) setState({ status: 'error', context, error: e.message }); }
    })();
    return () => controller.abort();
  }, [routeId, routeType, queryString]);
  return state;
}

export function useWatchSources(context, season, episode) {
  const [selection, setSelection] = useState('auto');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ status: 'idle', provider: '', candidates: [], index: 0, error: '', attempts: [], needsIdentity: false, note: '' });
  const generation = useRef(0), resolver = useRef(null), quality = useRef(''), startAt = useRef(0), tried = useRef(new Set());
  const order = providerOrder(context?.origin);
  useEffect(() => {
    if (!context) return undefined;
    const controller = new AbortController(), token = ++generation.current;
    tried.current = new Set();
    const safe = (value) => { if (!controller.signal.aborted && generation.current === token) setState(value); };
    const attempts = [];
    async function resolve(from = 0, forced = '') {
      const providers = forced ? [forced] : order.slice(from);
      let nextNote = '';
      safe({ status: 'loading', provider: providers[0] || '', candidates: [], index: 0, error: '', attempts: [...attempts], needsIdentity: false, note: '' });
      let needsIdentity = false;
      for (const provider of providers) {
        if (controller.signal.aborted || generation.current !== token) return;
        let candidates = [];
        try {
          if (provider === 'vault') {
            const embeds = context.vault?.embeds || [];
            candidates = normalizeCandidates(context.type === 'series' ? embeds.filter((e) => (Number(e.season) || 1) === season && Number(e.episode) === episode) : embeds, provider);
          } else if (provider === 'retro') candidates = normalizeCandidates(context.retroStreams || [], provider);
          else {
            const p = new URLSearchParams({ provider, type: context.type, tmdbId: String(context.tmdbId || ''), imdbId: context.imdbId || '', title: context.title || '', year: String(context.year || ''), season: String(season), episode: String(episode) });
            if (context.reference) p.set('reference', context.reference);
            const data = await requestJson(`/api/watch/source?${p}`, controller.signal, 35000);
            candidates = data.candidates || [];
            // A provider may answer with usable candidates *and* a caveat (direct
            // MP4 says so when every host refused). Keep it: silently listing dead
            // links as if they were live is the bug being fixed.
            if (data.note) nextNote = data.note;
          }
          if (candidates.length) {
            const index = chooseCandidate(candidates, quality.current);
            tried.current.add(candidates[index].url);
            attempts.push({ provider, status: candidates[index].kind === 'embed' ? 'iframe opened · playback not verified' : 'stream discovered' });
            safe({ status: 'ready', provider, candidates, index, error: '', attempts: [...attempts], needsIdentity, note: nextNote });
            return;
          }
          attempts.push({ provider, status: 'no matching source' });
        } catch (e) {
          if (controller.signal.aborted || generation.current !== token) return;
          needsIdentity ||= Boolean(e.needsIdentity);
          attempts.push({ provider, status: e.needsIdentity ? 'identity needed' : e.name === 'AbortError' ? 'discovery timed out' : e.message });
        }
      }
      safe({ status: 'error', provider: forced || providers.at(-1) || '', candidates: [], index: 0, error: forced ? 'This provider has no available stream. Retry or explicitly try the next source.' : 'No available source. Retry, match the title ID, or choose a provider.', attempts: [...attempts], needsIdentity });
    }
    resolver.current = resolve;
    resolve(selection === 'auto' ? startAt.current : 0, selection === 'auto' ? '' : selection);
    startAt.current = 0;
    return () => { controller.abort(); ++generation.current; };
    // entry order is deterministic; quality selection must not restart discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, season, episode, selection, retry]);
  const chooseProvider = useCallback((value) => { startAt.current = 0; setSelection(value); setRetry((v) => v + 1); }, []);
  const next = () => {
    const nextIndex = order.indexOf(state.provider) + 1;
    if (nextIndex >= order.length) { setState((s) => ({ ...s, status: 'error', error: 'The source chain is exhausted. Retry or choose a provider.' })); return; }
    startAt.current = Math.max(0, nextIndex); setSelection('auto'); setRetry((v) => v + 1);
  };
  const fatal = () => {
    if (state.status !== 'ready' || state.candidates[state.index]?.kind === 'embed') return;
    const candidateIndex = state.candidates.findIndex((c) => !tried.current.has(c.url));
    if (candidateIndex >= 0 && tried.current.size < MAX_PROVIDER_ALTERNATIVES) {
      tried.current.add(state.candidates[candidateIndex].url); setState((s) => ({ ...s, index: candidateIndex, error: '' }));
    } else if (selection === 'auto') next();
    else setState((s) => ({ ...s, status: 'error', error: 'This provider’s alternatives failed. Retry or explicitly try the next source.' }));
  };
  const chooseQuality = (value) => { quality.current = value; const index = chooseCandidate(state.candidates, value); tried.current = new Set([state.candidates[index]?.url]); setState((s) => ({ ...s, index, error: '' })); };
  const chooseMirror = (index) => { tried.current = new Set([state.candidates[index]?.url]); setState((s) => ({ ...s, index, error: '' })); };
  return { ...state, selection, active: state.candidates[state.index] || null, chooseProvider, chooseQuality, chooseMirror, next, fatal, retry: () => { startAt.current = order.indexOf(state.provider); setRetry((v) => v + 1); }, retryKey: retry, order };
}
