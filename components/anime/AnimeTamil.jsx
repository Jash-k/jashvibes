'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import JashPlayer from '@/components/player/JashPlayer';
import { createDirectPolicy } from '@/lib/player/policy/stream';
import {
  episodeLabel,
  summaryLine,
  episodeTag,
  filterByKind,
  kindCounts,
  pageHint,
  playerLineup,
  seasonGroups,
  sourceRows,
  unavailableNote,
  watchKeyFor,
} from '@/lib/animeTamilView';

/**
 * Tamil anime — one feed, one sheet, and a player that only appears when there is a stream.
 *
 * The content is `piratexplay.cc/language/tamil`, read by `lib/animeTamilFeed.js` and never iframed: the
 * grid, the episode list and the server list are our own DOM, and a card is playable only when a host
 * publishes a fetchable `.m3u8` (Vidmoly does; TurboVid usually does). Where nothing resolves, the row
 * says so and hands over a link to the source — the rule this app already keeps on the sports hub: a
 * control that changes nothing on screen is the one thing a control may never be.
 *
 * Request shape, because this runs on a 512 MB free instance that sleeps: one read per page tap, one per
 * open title, one per played episode, and nothing on a timer. Filters and search are client-side over
 * what has loaded; the only server round-trip that costs the source more than one page is "the whole list".
 */

const KINDS = [
  { id: 'all', label: 'Everything' },
  { id: 'series', label: 'Series' },
  { id: 'movie', label: 'Movies' },
];
const STORE_KEY = 'jash_anime_tamil';

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStored(patch) {
  try {
    const next = { ...readStored(), ...patch };
    window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return patch;
  }
}

async function getJson(url, signal) {
  const response = await fetch(url, { cache: 'no-store', signal });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `the source did not answer (${response.status})`);
  return data;
}

/**
 * The history row this episode earns. `season`/`episode` matter: the store resets progress when they
 * change, so two episodes of one series are two half-watched rows and not one overwritten by the other.
 */
function libraryRowFor(parent, row) {
  const isMovie = parent?.kind === 'movie';
  return {
    type: isMovie ? 'movie' : 'tv',
    title: parent?.title || row?.title || 'Anime',
    subtitle: isMovie ? '' : episodeTag(row) || row?.id || '',
    posterUrl: row?.still || parent?.poster || '',
    backdropUrl: parent?.poster || '',
    year: parent?.year || '',
    season: Number(row?.season) || 0,
    episode: Number(row?.episode) || 0,
    provider: 'anime-tamil',
    href: typeof window === 'undefined'
      ? `/anime/tamil?t=${parent?.path || ''}&ep=${row?.path || ''}`
      : `${window.location.pathname}?t=${encodeURIComponent(parent?.path || '')}&ep=${encodeURIComponent(row?.path || '')}`,
  };
}

function Card({ item, onOpen }) {
  return (
    <button type="button" className="jv-an-card" onClick={() => onOpen(item)} title={item.title}>
      <span className="jv-an-art">
        {item.poster ? (
          <img src={item.poster} alt="" loading="lazy" decoding="async" width={230} height={345} />
        ) : (
          <span className="jv-an-art-none">{item.title.slice(0, 2).toUpperCase()}</span>
        )}
        <span className="jv-an-art-act">{item.action || (item.kind === 'movie' ? 'Watch' : 'Episodes')}</span>
      </span>
      <span className="jv-an-card-body">
        <span className="jv-an-card-title">{item.title}</span>
        <span className="jv-an-card-meta">
          {item.year ? <span>{item.year}</span> : null}
          {item.rating ? <span className="jv-an-score">TMDB {item.rating}</span> : null}
          {item.kind === 'series' && item.season > 1 ? <span>Se {item.season}</span> : null}
        </span>
      </span>
    </button>
  );
}

export default function AnimeTamil() {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [maxPage, setMaxPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [all, setAll] = useState(false);
  const [status, setStatus] = useState('loading');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [generatedAt, setGeneratedAt] = useState(0);
  const [complete, setComplete] = useState(true);
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(null);
  const [title, setTitle] = useState(null);
  const [titleState, setTitleState] = useState('idle');
  const [episodePath, setEpisodePath] = useState('');
  const [episode, setEpisode] = useState(null);
  const [playState, setPlayState] = useState('idle');
  const [playing, setPlaying] = useState(null);
  const [playingIndex, setPlayingIndex] = useState(0);
  const requestRef = useRef(0);
  // Which addresses this episode has already failed on — the ladder below walks it once each.
  const triedRef = useRef([]);
  const playStateRef = useRef('idle');
  playStateRef.current = playState;

  useEffect(() => {
    const stored = readStored();
    if (stored?.kind && KINDS.some((row) => row.id === stored.kind)) setKind(stored.kind);
  }, []);

  const load = useCallback(async ({ nextPage = 1, append = false, full = false, force = false, search = '', signal }) => {
    const params = new URLSearchParams();
    if (full) params.set('all', '1');
    else params.set('page', String(nextPage));
    if (search) params.set('q', search);
    if (force) params.set('force', '1');
    const data = await getJson(`/api/anime/tamil?${params.toString()}`, signal);
    return { data, append };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const id = requestRef.current + 1;
    requestRef.current = id;
    setStatus('loading');
    setError('');
    load({ nextPage: 1, search: query, signal: controller.signal })
      .then(({ data }) => {
        if (requestRef.current !== id) return;
        setItems(data.items || []);
        setPage(data.page || 1);
        setMaxPage(data.maxPage || 1);
        setHasNext(Boolean(data.hasNext));
        setAll(Boolean(data.all));
        setGeneratedAt(data.generatedAt || 0);
        setStatus(data.items?.length ? 'ready' : 'error');
        if (!data.items?.length) setError(data.error || 'the listing came back empty');
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || requestRef.current !== id) return;
        setError(err?.message || 'the listing could not be read');
        setStatus('error');
      });
    return () => controller.abort();
  }, [load, query]);

  const counts = useMemo(() => kindCounts(items), [items]);
  const shown = useMemo(() => filterByKind(items, kind), [items, kind]);
  const line = useMemo(
    () => summaryLine({ items, shown: shown.length, page, maxPage, all, complete, generatedAt, query }),
    [items, shown.length, page, maxPage, all, complete, generatedAt, query],
  );

  const pickKind = (next) => {
    setKind(next);
    writeStored({ kind: next });
  };

  const loadMore = async () => {
    if (busy) return;
    setBusy('more');
    setError('');
    try {
      const { data } = await load({ nextPage: page + 1, search: query });
      const seen = new Set(items.map((item) => item.path));
      setItems([...items, ...(data.items || []).filter((item) => !seen.has(item.path))]);
      setPage(data.page || page + 1);
      setMaxPage(data.maxPage || maxPage);
      setHasNext(Boolean(data.hasNext));
      setGeneratedAt(data.generatedAt || 0);
    } catch (err) {
      setError(err?.message || 'that page could not be read');
    } finally {
      setBusy('');
    }
  };

  const loadWholeList = async () => {
    if (busy) return;
    setBusy('all');
    setError('');
    try {
      const { data } = await load({ full: true, search: query });
      setItems(data.items || []);
      setAll(true);
      setMaxPage(data.maxPage || maxPage);
      setHasNext(Boolean(data.hasNext));
      setComplete(data.complete !== false);
      setGeneratedAt(data.generatedAt || 0);
    } catch (err) {
      setError(err?.message || 'the full walk did not finish');
    } finally {
      setBusy('');
    }
  };

  const reload = async () => {
    if (busy) return;
    setBusy('reload');
    try {
      const { data } = await load({ nextPage: 1, force: true, search: query });
      setItems(data.items || []);
      setPage(data.page || 1);
      setMaxPage(data.maxPage || maxPage);
      setHasNext(Boolean(data.hasNext));
      setAll(false);
      setComplete(true);
      setGeneratedAt(data.generatedAt || 0);
      setStatus('ready');
    } catch (err) {
      setError(err?.message || 'the source did not answer');
    } finally {
      setBusy('');
    }
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setQuery(draft.trim().slice(0, 60));
  };

  /** `?t=` is the title and `?ep=` the row being watched, so a resume link reopens the sheet on the episode. */
  const rememberInUrl = useCallback((titlePath, episodePath) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (titlePath) url.searchParams.set('t', titlePath);
    else url.searchParams.delete('t');
    if (episodePath) url.searchParams.set('ep', episodePath);
    else url.searchParams.delete('ep');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const closeSheet = useCallback(() => {
    setOpen(null);
    setTitle(null);
    setEpisode(null);
    setEpisodePath('');
    setPlaying(null);
    setPlayState('idle');
    setTitleState('idle');
    rememberInUrl('', '');
  }, [rememberInUrl]);

  const openTitle = useCallback(async (item, resumePath = '') => {
    setOpen(item);
    setTitle(null);
    setEpisode(null);
    setEpisodePath('');
    setPlaying(null);
    setPlayState('idle');
    setTitleState('loading');
    rememberInUrl(item.path, '');
    try {
      const data = await getJson(`/api/anime/tamil/title?u=${encodeURIComponent(item.path)}`);
      const loaded = data.title || null;
      setTitle(loaded);
      setTitleState(loaded?.episodes?.length ? 'ready' : 'empty');
      // A resume link said which row to open; once the list is here, hand it to the player.
      const want = resumePath.replace(/\/+$/, '');
      const wanted = want && (loaded?.episodes || []).find((row) => row.path.replace(/\/+$/, '') === want);
      if (wanted) playEpisodeRef.current?.(wanted, item);
    } catch (err) {
      setError(err?.message || 'this title could not be read');
      setTitleState('error');
    }
  }, [rememberInUrl]);

  // A deep link (`?t=/series/…`) opens the sheet on its own, so a bookmark is a real URL.
  const bootRef = useRef(false);
  useEffect(() => {
    if (bootRef.current || !items.length) return;
    const params = typeof window === 'undefined' ? new URLSearchParams() : new URL(window.location.href).searchParams;
    const wanted = params.get('t');
    if (!wanted) return;
    bootRef.current = true;
    const hit = items.find((item) => item.path === wanted);
    if (hit) openTitle(hit, params.get('ep') || '');
  }, [items, openTitle]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') closeSheet(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, closeSheet]);

  // `openTitle` reaches the play path before this callback is rebuilt; the ref keeps one render in step.
  const playEpisodeRef = useRef(null);

  const playEpisode = useCallback(async (row, owner = null) => {
    if (!row?.path) return;
    const parent = owner || open;
    setEpisodePath(row.path);
    rememberInUrl(parent?.path, row.path);
    setPlayState('loading');
    setEpisode(null);
    setPlaying(null);
    try {
      const again = playStateRef.current === 'error' || playStateRef.current === 'failed' ? '&force=1' : '';
      const data = await getJson(`/api/anime/tamil/play?u=${encodeURIComponent(row.path)}${again}`);
      const entry = data.episode || null;
      setEpisode(entry);
      const lineup = playerLineup(entry?.playable || []);
      if (!lineup.length) {
        setPlayState('empty');
        return;
      }
      setPlayingIndex(0);
      triedRef.current = [lineup[0].url];
      setPlaying({
        key: `${row.path}::${lineup[0].url}`,
        watchKey: watchKeyFor(row.path),
        entry: libraryRowFor(parent, row),
        title: `${parent?.title || entry?.title || 'Episode'}`,
        subtitle: `${lineup[0].label} · resolved by this app, played in JashPlayer`,
        poster: entry?.playable?.[0]?.poster || parent?.poster || '',
        ...lineup[0],
      });
      setPlayState('ready');
    } catch (err) {
      setError(err?.message || 'the servers on this episode could not be read');
      setPlayState('error');
    }
  }, [open, rememberInUrl]);

  playEpisodeRef.current = playEpisode;

  const lineup = useMemo(() => playerLineup(episode?.playable || []), [episode]);

  /**
   * A resolved address is still somebody else's CDN: it can be gone by the time a tap lands. The row
   * that failed is reported and the next one the source offered is tried, once each, so the sheet never
   * shows a dead player. When the ladder runs out, the server table below is the answer.
   */
  const stepToNextSource = useCallback((message) => {
    setError(message || 'this address did not play');
    const remaining = lineup.filter((entry) => entry.url && !triedRef.current.includes(entry.url));
    if (!remaining.length) {
      setPlayState('failed');
      return;
    }
    const next = remaining[0];
    triedRef.current = [...triedRef.current, next.url];
    setPlayingIndex(Math.max(0, lineup.findIndex((entry) => entry.url === next.url)));
    setPlaying((current) => ({
      ...current,
      key: `${episodePath}::${next.url}`,
      url: next.url,
      label: next.label,
      subtitle: `${next.label} · after a failed address, this app moved to the next one`,
    }));
    setPlayState('ready');
  }, [episodePath, lineup]);
  const rows = useMemo(() => sourceRows(episode || {}), [episode]);
  const groups = useMemo(() => seasonGroups(title?.episodes || []), [title]);

  return (
    <>
      {/* The rail is per page in this app, and `.jv-rail-shift` on <main> only clears room for it:
          clearing space for a nav that is not rendered is how you get an empty gutter and no way home. */}
      <RailNav />
      <main className="jv-an-page jv-rail-shift">
      <div className="jv-an">
        <header className="jv-an-mast">
          <div className="jv-an-who">
            <p className="jv-an-kicker">PirateXPlay · /language/tamil · scraped, never framed</p>
            <h1 className="jv-an-title">Tamil anime</h1>
            <p className="jv-an-line">
              {status === 'loading' ? 'reading the list…' : line || pageHint({ page, maxPage, hasNext, all })}
              {query ? ` · search “${query}”` : ''}
            </p>
          </div>
          <div className="jv-an-actions">
            <button type="button" className="jv-an-btn" onClick={reload} disabled={Boolean(busy)}>
              {busy === 'reload' ? 'reading…' : 'Reload'}
            </button>
            {!all && hasNext ? (
              <button type="button" className="jv-an-btn is-quiet" onClick={loadWholeList} disabled={Boolean(busy)}>
                {busy === 'all' ? `walking ${maxPage} pages…` : `Read all ${maxPage} pages`}
              </button>
            ) : null}
          </div>
        </header>

        <section className="jv-an-tools">
          <div className="jv-an-chips" role="group" aria-label="Filter what has loaded">
            {KINDS.map((row) => (
              <button
                key={row.id}
                type="button"
                className={`jv-an-chip${kind === row.id ? ' is-on' : ''}`}
                aria-pressed={kind === row.id}
                onClick={() => pickKind(row.id)}
              >
                {row.label}
                <span className="jv-an-chip-n">
                  {row.id === 'all' ? items.length : (counts[row.id] || 0)}
                </span>
              </button>
            ))}
          </div>
          <form className="jv-an-search" onSubmit={submitSearch} role="search">
            <input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Search this list on the source"
              aria-label="Search the source for a title"
            />
            <button type="submit" className="jv-an-btn is-quiet" disabled={Boolean(busy)}>Search</button>
            {query ? (
              <button
                type="button"
                className="jv-an-btn is-quiet"
                onClick={() => { setDraft(''); setQuery(''); }}
              >
                Clear
              </button>
            ) : null}
          </form>
        </section>

        {status === 'loading' ? <p className="jv-an-note">Loading the Tamil list from the source…</p> : null}

        {error ? (
          <p className="jv-an-note is-warn">
            {error}
            {' '}
            <button type="button" className="jv-an-linkbtn" onClick={reload}>try again</button>
          </p>
        ) : null}

        {status === 'ready' && !shown.length ? (
          <p className="jv-an-note">
            Nothing of this kind is loaded yet
            {kind !== 'all' ? ` — ${counts.series} series and ${counts.movie} films are on the pages read so far` : ''}.
            {hasNext ? ' Load the next page, or read all of them.' : ''}
          </p>
        ) : null}

        {shown.length ? (
          <>
            <div className="jv-an-grid">
              {shown.map((item) => <Card key={item.id} item={item} onOpen={openTitle} />)}
            </div>
            <div className="jv-an-more">
              {!all && hasNext ? (
                <button type="button" className="jv-an-btn" onClick={loadMore} disabled={Boolean(busy)}>
                  {busy === 'more' ? 'reading…' : `Next page (${page + 1} of ≥${maxPage})`}
                </button>
              ) : (
                <p className="jv-an-note">
                  {all ? `The source’s whole Tamil list is loaded — ${items.length} titles.` : 'That is every page the source advertised. Reload re-reads it.'}
                </p>
              )}
            </div>
          </>
        ) : null}

        <section className="jv-an-about">
          <h2 className="jv-an-h">How this page gets its videos</h2>
          <p className="jv-an-note">
            Four reads, all in one request each: the list (<code>/language/tamil/page/N</code>), a title’s
            episodes (<code>/series/…</code>), an episode’s server row (<code>/episode/…</code>) and, for a
            server that publishes a manifest, that server’s page. Playable addresses are HLS playlists whose
            CDN answers <code>access-control-allow-origin: *</code>, so the browser fetches the video itself —
            this app’s server carries no media bytes and stores nothing. Hosts that build their address in
            obfuscated script are listed with the reason, next to a link to the source.
          </p>
        </section>
      </div>

      {open ? (
        <div className="jv-an-sheet" role="dialog" aria-modal="true" aria-label={`${open.title} — episodes`}>
          <button type="button" className="jv-an-sheet-scrim" aria-label="Close" onClick={closeSheet} />
          <div className="jv-an-sheet-body">
            <header className="jv-an-sheet-mast">
              <div className="jv-an-sheet-who">
                <p className="jv-an-kicker">{open.kind === 'movie' ? 'Film' : 'Series'} · {title?.source || open.source || 'piratexplay.cc'}</p>
                <h2 className="jv-an-sheet-title">{title?.title || open.title}</h2>
                <p className="jv-an-sheet-meta">
                  {[title?.year || open.year, title?.status, title?.duration, title?.tmdbId ? `TMDB ${title.tmdbId}` : '']
                    .filter(Boolean).join(' · ')}
                  {title?.episodes?.length ? ` · ${title.episodes.length} episode${title.episodes.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <div className="jv-an-sheet-side">
                {open.poster ? <img src={open.poster} alt="" loading="lazy" /> : null}
                <a className="jv-an-btn is-quiet" href={open.href} target="_blank" rel="noopener noreferrer">
                  open on PirateXPlay <span aria-hidden="true">↗</span>
                </a>
              </div>
            </header>

            {title?.synopsis ? <p className="jv-an-sheet-syn">{title.synopsis}</p> : null}

            {titleState === 'loading' ? <p className="jv-an-note">Reading the episode list…</p> : null}
            {titleState === 'error' ? <p className="jv-an-note is-warn">The episode list could not be read — the source link above still works.</p> : null}
            {titleState === 'empty' ? <p className="jv-an-note is-warn">This title carries no episode list on the source, so there is nothing here to play.</p> : null}

            {playState === 'failed' ? (
              <p className="jv-an-note is-warn">
                Every address this episode offered was tried and none played ({error}). The rows below say
                what each host reported; {open?.href ? (
                  <a className="jv-an-linkbtn" href={open.href} target="_blank" rel="noopener noreferrer">the source itself can play it ↗</a>
                ) : null}
              </p>
            ) : null}

            {playing ? (
              <>
              <div className="jv-an-player">
                <JashPlayer
                  key={playing.key}
                  className="jv-an-player-el"
                  source={{ url: playing.url, kind: 'hls', label: playing.label, crossOrigin: 'anonymous' }}
                  playbackPolicy={createDirectPolicy(playing.url, { streamType: 'hls' })}
                  display={{ title: playing.title, subtitle: playing.subtitle, poster: playing.poster || undefined, aspect: 'fill' }}
                  library={{ watchKey: playing.watchKey, entry: playing.entry }}
                  lineup={{
                    sources: lineup,
                    activeIndex: playingIndex,
                    onPickSource: (index) => {
                      const next = lineup[index];
                      if (!next) return;
                      triedRef.current = [...new Set([...triedRef.current, next.url])];
                      setPlayingIndex(index);
                      setPlaying({ ...playing, key: `${episodePath}::${next.url}`, url: next.url, label: next.label, subtitle: `${next.label} · resolved by this app, played in JashPlayer` });
                    },
                  }}
                  on={{ onError: (info) => stepToNextSource(info?.message) }}
                />
              </div>
              {playing.warn ? <p className="jv-an-note is-warn">{playing.warn}</p> : null}
              </>
            ) : null}

            {groups.map((group) => (
              <section className="jv-an-season" key={`${group.season}-${group.label}`}>
                {group.season ? <h3 className="jv-an-h">{group.label}</h3> : null}
                <ul className="jv-an-eps">
                  {group.episodes.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`jv-an-ep${episodePath === row.path ? ' is-on' : ''}`}
                        onClick={() => playEpisode(row)}
                        title={row.href}
                      >
                        {row.still ? <img src={row.still} alt="" loading="lazy" /> : <span className="jv-an-art-none">{row.id}</span>}
                        <span className="jv-an-ep-body">
                          <span className="jv-an-ep-tag">{episodeTag(row) || row.id}</span>
                          <span className="jv-an-ep-title">{episodeLabel(row)}</span>
                        </span>
                        <span className="jv-an-ep-go">{playState === 'loading' && episodePath === row.path ? 'reading…' : 'play'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {title?.seasons?.length > 1 ? (
              <p className="jv-an-note">
                The source keeps each season on its own page.{' '}
                {title.seasons.map((row, index) => (
                  <span key={row.href}>{index ? ' · ' : ''}
                    <a className="jv-an-linkbtn" href={row.href} target="_blank" rel="noopener noreferrer">{row.label}</a>
                  </span>
                ))}
              </p>
            ) : null}

            {episode || playState !== 'idle' ? (
              <section className="jv-an-sources">
                <h3 className="jv-an-h">
                  Servers on this episode
                  {episode?.playable?.length ? <em>{episode.playable.length} playable</em> : <em>none playable</em>}
                </h3>
                {playState === 'loading' ? <p className="jv-an-note">Asking each server for a fetchable address…</p> : null}
                {!lineup.length && playState !== 'loading' ? (
                  <p className="jv-an-note is-warn">
                    {playState === 'error'
                      ? error || 'The episode page could not be read.'
                      : unavailableNote(episode || {})}
                  </p>
                ) : null}
                <ul className="jv-an-srcs">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`jv-an-src${row.canPlay ? ' is-ok' : ' is-no'}${playing?.url === row.url ? ' is-on' : ''}`}
                        disabled={!row.canPlay}
                        onClick={() => {
                          const stream = { url: row.url, label: row.label };
                          const index = lineup.findIndex((entry) => entry.url === stream.url);
                          if (index >= 0) setPlayingIndex(index);
                          triedRef.current = [...new Set([...triedRef.current, stream.url])];
                          setPlaying({
                            key: `${episodePath}::${stream.url}`,
                            watchKey: watchKeyFor(episodePath),
                            title: open?.title || episode?.title || 'Episode',
                            subtitle: `${stream.label} · resolved by this app, played in JashPlayer`,
                            poster: row.poster || open?.poster || '',
                            ...stream,
                          });
                          setPlayState('ready');
                        }}
                      >
                        <span className="jv-an-src-name">{row.label}</span>
                        <span className="jv-an-src-state">{row.canPlay ? 'playable · HLS' : row.note || 'no fetchable address'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="jv-an-note">
                  Nothing on this page is framed: a row is offered only when the manifest itself can be read and
                  played. {episode?.open ? (
                    <a className="jv-an-linkbtn" href={episode.open} target="_blank" rel="noopener noreferrer">watch it on the source ↗</a>
                  ) : null}
                </p>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}
      </main>
    </>
  );
}
