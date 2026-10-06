'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSyncedLyrics, plainFromSyncedLyrics, trackKey, muLyricRows } from '@/lib/musicCore';
import { LYRIC_CANVASES, LYRIC_FACES, LYRIC_SIZES } from './lyricLook';
import { Art, StateBox } from './MusicBits';

/*
 * Lyrics, and the two things that make this screen different from a lyric sheet:
 *
 *  1. "Choose your source" — several online providers are tried, each one is PREVIEWED
 *     with the lines it actually returned, and nothing is applied until you pick it.
 *     Applying a source changes the stage for real: a synced source keeps the
 *     karaoke highlight, a plain source drops it, and "instrumental" swaps the stage
 *     for the signal field.
 *
 *  2. Canvas / size / face, all persisted, all reachable from one inline strip so you
 *     never have to leave the lyrics to change how they look.
 *
 * The provider's own cascade is untouched: "Auto" is exactly what the section did
 * before. Pinning a source is the only new behaviour, and it is opt-in per track.
 */

const KIND_LABEL = { synced: 'LRC', plain: 'PLAIN', none: 'INST', auto: 'AUTO' };

/* ── the source list + the pinned lookup ───────────────────────────────────── */

function useLyricsSource(track, autoLines, autoKind) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState([]);
  const [status, setStatus] = useState('idle');   // idle | loading | ready | error
  const [error, setError] = useState('');
  const [pinned, setPinned] = useState(null);      // { id, kind, lines, message }
  const [applying, setApplying] = useState('');
  const abort = useRef(null);

  const id = track?.id || track?.seokey || '';
  const title = track?.title || '';
  const artist = track?.artists || track?.subtitle || '';
  const duration = Number(track?.duration || 0);
  const key = trackKey(track);

  // changing the song drops the pin: the choice was about that song's lyrics
  useEffect(() => { setPinned(null); setApplying(''); }, [key]);

  const params = useCallback(() => {
    const search = new URLSearchParams();
    if (id) search.set('id', String(id));
    if (title) search.set('title', title);
    if (artist) search.set('artist', artist);
    if (duration) search.set('duration', String(Math.round(duration)));
    return search;
  }, [id, title, artist, duration]);

  const load = useCallback(async () => {
    if (!title && !id) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStatus('loading');
    setError('');
    try {
      const search = params();
      search.set('list', '1');
      const response = await fetch(`/api/music/lyrics?${search.toString()}`, { signal: controller.signal, cache: 'no-store' });
      const data = await response.json();
      if (controller.signal.aborted) return;
      setSources(Array.isArray(data?.sources) ? data.sources : []);
      setStatus('ready');
    } catch (err) {
      if (controller.signal.aborted || err?.name === 'AbortError') return;
      setError(err?.message || 'Could not reach the lyrics service.');
      setStatus('error');
    }
  }, [params, title, id]);

  const apply = useCallback(async (sourceId) => {
    if (sourceId === 'auto') { setPinned(null); setApplying(''); return; }
    if (sourceId === 'inst') {
      setPinned({ id: 'inst', kind: 'none', lines: [], message: '' });
      setApplying('');
      return;
    }
    setApplying(sourceId);
    try {
      const search = params();
      search.set('source', sourceId);
      const response = await fetch(`/api/music/lyrics?${search.toString()}`, { cache: 'no-store' });
      const data = await response.json();
      const text = data?.syncedLyrics || data?.plainLyrics || data?.lyrics || '';
      const lines = data?.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : [];
      // plainFromSyncedLyrics returns a STRING, not an array — split it into rows
      const plain = lines.length
        ? []
        : plainFromSyncedLyrics(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ time: null, text: line }));
      setPinned({
        id: sourceId,
        kind: data?.applied || (data?.syncedLyrics ? 'synced' : text ? 'plain' : 'none'),
        lines: lines.length ? lines : plain,
        message: text ? '' : (data?.message || 'That source had nothing for this track.'),
      });
    } catch (err) {
      setPinned({ id: sourceId, kind: 'none', lines: [], message: err?.message || 'That source could not be reached.' });
    } finally {
      setApplying('');
    }
  }, [params]);

  const lines = pinned ? pinned.lines : autoLines;
  const kind = pinned ? pinned.kind : autoKind;
  const activeSourceId = pinned ? pinned.id : 'auto';

  return {
    open, setOpen, sources, status, error, load,
    pinned, apply, applying, lines, kind, activeSourceId,
    message: pinned?.message || '',
  };
}

/**
 * The provider loads lyrics as a side effect of its song-detail request — and that
 * request also fetches stream URLs, so on a deployment with no working audio mirror
 * the detail call fails and the lyrics never arrive, even though they come from a
 * completely different provider. The track object already carries everything the
 * lyric route needs (id, title, artist, duration), so the lyrics screen asks for
 * itself when the provider has nothing. Provider data still wins when it exists.
 */
function useAutoLyrics(track, enabled) {
  const [state, setState] = useState({ lines: [], kind: 'none', status: 'idle', message: '' });
  const key = trackKey(track);
  const abort = useRef(null);

  useEffect(() => {
    if (!enabled || !track || (!track.title && !track.id)) {
      setState({ lines: [], kind: 'none', status: 'idle', message: '' });
      return undefined;
    }
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setState({ lines: [], kind: 'none', status: 'loading', message: '' });
    const search = new URLSearchParams();
    if (track.id || track.trackId) search.set('id', String(track.id || track.trackId));
    if (track.title) search.set('title', track.title);
    if (track.artists) search.set('artist', track.artists);
    if (track.duration) search.set('duration', String(Math.round(Number(track.duration) || 0)));
    fetch(`/api/music/lyrics?${search.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        const synced = data?.syncedLyrics ? parseSyncedLyrics(data.syncedLyrics) : [];
        const text = data?.plainLyrics || data?.lyrics || '';
        const plain = synced.length ? [] : plainFromSyncedLyrics(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ time: null, text: line }));
        const lines = synced.length ? synced : plain;
        setState({
          lines,
          kind: synced.length ? 'synced' : lines.length ? 'plain' : 'none',
          status: 'ready',
          message: lines.length ? '' : (data?.message || 'No lyrics found for this track.'),
        });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ lines: [], kind: 'none', status: 'error', message: error.message || 'Lyrics lookup failed.' });
      });
    return () => controller.abort();
  }, [key, enabled, track?.id, track?.title, track?.artists, track?.duration]);

  return state;
}

/* ── the stage ─────────────────────────────────────────────────────────────── */

function LyricStage({
  stageRef, rows, activeRef, look, track, kind, timing, scrollRef,
  onSeek, onUserScroll, autoscroll, empty, focus,
}) {
  const canvas = look.canvas;
  return (
    <section
      className={`mu2-stage mu2-canvas-${canvas}${focus ? ' is-lyric-focus' : ''}`}
      aria-label="Lyrics"
      ref={stageRef}
    >
      {canvas === 'fluid' ? <span className="mu2-wash" aria-hidden="true">{track?.image ? <img src={track.image} alt="" /> : null}</span> : null}
      <div className="mu2-stage-in">
        <div className="mu2-lz-scroll" ref={scrollRef} onWheel={onUserScroll} onTouchMove={onUserScroll}>
          {kind === 'none' ? (
            <div className="mu2-lz-none" role="status">
              <span className="mu2-lz-dots" aria-hidden="true">
                {Array.from({ length: 14 }, (_, index) => <i key={index} />)}
              </span>
              <p>
                <strong>No lyrics for this song</strong>
                <span>The stage stays quiet — nothing is invented to fill it.</span>
              </p>
            </div>
          ) : empty ? null : (
            <ol className="mu2-lz">
              {rows.map((row, index) => (
                <li
                  key={`${row.text}-${index}`}
                  ref={row.state === 'current' ? activeRef : undefined}
                  data-state={row.state}
                  aria-current={row.state === 'current' ? 'true' : undefined}
                  className="mu2-lz-line"
                >
                  {row.time != null && kind !== 'plain' ? (
                    <button type="button" onClick={() => onSeek(row.time)} title={`Seek to ${row.time.toFixed(0)}s`}>{row.text}</button>
                  ) : <span>{row.text}</span>}
                  {timing.has(index) ? <span className="mu2-lz-prog" aria-hidden="true" style={{ '--mu2-pct': timing.get(index) }} /> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export default function MusicLyrics({
  music, look, updateLook, stepLook, nudgeOffset, notify, onGo,
}) {
  const scrollRef = useRef(null);
  const stageRef = useRef(null);
  const [autoscroll, setAutoscroll] = useState(true);

  const providerSynced = music.syncedLyricLines?.length ? music.syncedLyricLines : [];
  const providerPlain = music.plainLyricLines?.length ? music.plainLyricLines : [];
  const hasProviderLyrics = Boolean(providerSynced.length || providerPlain.length);
  const solo = useAutoLyrics(music.playingTrack, !hasProviderLyrics);

  const autoAll = hasProviderLyrics ? (providerSynced.length ? providerSynced : providerPlain) : solo.lines;
  const autoKind = hasProviderLyrics
    ? (providerSynced.length ? 'synced' : 'plain')
    : (solo.status === 'ready' ? solo.kind : 'none');

  const source = useLyricsSource(music.playingTrack, autoAll, autoKind);
  const lines = source.lines || [];
  const kind = source.kind || 'none';

  // Load the source list once the sheet is opened, never on mount: this is a network
  // call to two providers and the lyrics screen must open instantly without it.
  useEffect(() => { if (source.open && source.status === 'idle') source.load(); }, [source.open, source.status, source.load]);

  const activeIndex = useMemo(() => {
    if (kind !== 'synced' || !lines.length) return -1;
    const now = music.currentTime + look.offset;
    let found = -1;
    lines.forEach((line, index) => { if (Number.isFinite(line.time) && now >= line.time) found = index; });
    // Before the first timestamp nothing has been sung yet, but the stage must not
    // look dead: the opening line is the upcoming one, so it takes the highlight.
    return found < 0 ? 0 : found;
  }, [kind, lines, music.currentTime, look.offset]);

  const rows = useMemo(
    () => muLyricRows(lines, kind === 'synced' ? activeIndex : -1, { radius: 2 }),
    [lines, kind, activeIndex],
  );

  // How far through the current line the song is. Line timing is what the sources
  // give; there is no per-word data, so the bar advances across the whole line.
  const timing = useMemo(() => {
    const map = new Map();
    if (kind !== 'synced' || !lines.length) return map;
    rows.forEach((row, index) => {
      if (row.state !== 'current' || row.time == null) return;
      const next = lines[index + 1];
      if (!next || !Number.isFinite(next.time) || next.time <= row.time) return;
      map.set(index, Math.max(0, Math.min(1, (music.currentTime + look.offset - row.time) / (next.time - row.time))));
    });
    return map;
  }, [rows, lines, kind, music.currentTime, look.offset]);

  // Follow the song, but only until the reader takes over. Touching the lyric column
  // switches it off; the button brings it back.
  useEffect(() => {
    if (!autoscroll || kind !== 'synced') return;
    const node = music.activeLyricRef?.current || scrollRef.current?.querySelector('[data-state="current"]');
    const holder = scrollRef.current;
    if (!node || !holder) return;
    const top = node.offsetTop - holder.clientHeight / 2 + node.clientHeight / 2;
    holder.scrollTo({ top, behavior: 'smooth' });
  }, [activeIndex, autoscroll, kind, music.activeLyricRef, rows]);

  const userScroll = useCallback(() => { setAutoscroll(false); }, []);
  const seek = useCallback((time) => { music.seekTo?.(time); setAutoscroll(true); }, [music]);

  /* The provider hands back a fresh object every render, so `music` must never be an
     effect dependency — that is an infinite loop. Hold the callback in a ref and key
     the effect on the value alone. */
  const pushAutoscroll = useRef(null);
  pushAutoscroll.current = music.setLyricAutoScroll;
  useEffect(() => { pushAutoscroll.current?.(autoscroll); }, [autoscroll]);

  const hasTranslation = Boolean(music.lyricsData?.translatedLines?.length);
  const track = music.playingTrack;

  return (
    <div className="mu2-lyrics-wrap" data-size={look.size} data-face={look.face} data-translate={look.translate ? '1' : '0'}>
      <div className="mu2-lyrics-col">
        <div className="mu2-lz-bar">
          <button type="button" className="mu2-tp" aria-label="Plain lyric view" title="Plain lyric view"
            onClick={() => { updateLook({ canvas: 'void', face: look.face }); notify?.('Plain view'); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h11M4 11h16M4 16h9M4 20h13" /></svg>
          </button>
          <button type="button" className="mu2-tp" aria-label="Previous track" onClick={() => music.playPrevious?.()}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h2.4v14H7zM19 5v14l-9-7z" /></svg>
          </button>
          <button type="button" className="mu2-tp mu2-tp-lg" aria-label={music.isPlaying ? 'Pause' : 'Play'} onClick={() => music.togglePlay?.()}>
            {music.isPlaying
              ? <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z" /></svg>
              : <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5l13 7.5-13 7.5z" /></svg>}
          </button>
          <button type="button" className="mu2-tp" aria-label="Next track" onClick={() => music.playNext?.()}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.6 5H17v14h-2.4zM5 5l9 7-9 7z" /></svg>
          </button>
          <button type="button" className="mu2-tp" aria-label="Favourite" aria-pressed={music.favoriteSet?.has(music.activeKey)}
            onClick={() => music.toggleFavorite?.(track)}>
            <svg viewBox="0 0 24 24" fill={music.favoriteSet?.has(music.activeKey) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20s-7.4-4.3-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.5C19.4 15.7 12 20 12 20Z" />
            </svg>
          </button>
        </div>

        {!track ? (
          <StateBox tone="empty" title="Your music. Every line."
            body="Pick an album, artists or playlist, then choose a song — the lyrics land here with the timing already worked out.">
            <button type="button" className="mu2-btn is-outline" onClick={() => onGo?.('library')}>Browse albums</button>
          </StateBox>
        ) : (
          <>
            <LyricStage
              stageRef={stageRef}
              rows={rows}
              activeRef={music.activeLyricRef}
              look={look}
              track={track}
              kind={kind}
              timing={timing}
              scrollRef={scrollRef}
              onSeek={seek}
              onUserScroll={userScroll}
              autoscroll={autoscroll}
              focus={music.lyricBlur}
              empty={false}
            />

            {(music.lyricsStatus === 'loading' || solo.status === 'loading') && source.activeSourceId === 'auto' && !hasProviderLyrics
              ? <p className="mu2-lz-note" role="status">Finding lyrics for this song…</p> : null}
            {source.message ? <p className="mu2-lz-note" role="status">{source.message}</p> : null}
            {!source.message && solo.status === 'error' && !hasProviderLyrics
              ? <p className="mu2-lz-note" role="status">{solo.message}</p> : null}
            {kind === 'none' && !source.message && solo.status !== 'loading'
              ? <p className="mu2-lz-note" role="status">No lyrics here. The signal field plays instead.</p> : null}
            {(music.lyricsStatus === 'error' || music.lyricsStatus === 'not-found') && source.activeSourceId === 'auto'
              ? <StateBox tone="error" title="No lyrics from Auto"
                  body={music.lyricsData?.message || 'Neither wired source returned lyrics for this track.'}
                  onRetry={() => music.openLyrics?.(true)} retryLabel="Retry lyrics" /> : null}

            {/* ── the inline mode strip: change the look without leaving the lyrics ── */}
            <div className="mu2-quick" role="group" aria-label="Lyric look">
              <span className="mu2-quick-l">Look</span>
              <span className="mu2-quick-dots">
                {LYRIC_CANVASES.map((canvas) => (
                  <button
                    key={canvas.id}
                    type="button"
                    className={`mu2-qdot mu2-bg-${canvas.id}`}
                    data-canvas={canvas.id}
                    aria-pressed={look.canvas === canvas.id}
                    aria-label={`${canvas.label} canvas`}
                    title={`${canvas.label} — ${canvas.hint}`}
                    onClick={() => updateLook({ canvas: canvas.id })}
                  />
                ))}
              </span>
              <span className="mu2-quick-sep" aria-hidden="true" />
              <button type="button" className="mu2-qbtn" aria-label="Smaller lyrics" onClick={() => stepLook('size', -1)}>A−</button>
              <span className="mu2-qbtn is-val" aria-hidden="true">{look.size.toUpperCase()}</span>
              <button type="button" className="mu2-qbtn" aria-label="Larger lyrics" onClick={() => stepLook('size', 1)}>A＋</button>
              <span className="mu2-quick-sep" aria-hidden="true" />
              <button type="button" className="mu2-qbtn is-face" aria-label="Cycle typeface" title="Typeface" onClick={() => {
                const index = LYRIC_FACES.findIndex((face) => face.id === look.face);
                updateLook({ face: LYRIC_FACES[(index + 1) % LYRIC_FACES.length].id });
              }}>{look.face}</button>
            </div>

            <div className="mu2-lz-actions">
              <button type="button" className="mu2-pill-lg" onClick={() => source.setOpen(true)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3.6 13.7 9l5.4 1.7-5.4 1.7L12 17.8l-1.7-5.4L4.9 10.7 10.3 9z" />
                  <path d="M18.4 15.6l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7z" />
                </svg>
                Choose source <small>{source.activeSourceId.toUpperCase()}</small>
              </button>
              <button
                type="button"
                className="mu2-sq is-round"
                aria-pressed={look.translate}
                disabled={!hasTranslation}
                title={hasTranslation ? 'Show the translation line' : 'No translation from this source yet'}
                onClick={() => updateLook({ translate: !look.translate })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.5 6h8M7.5 4v2c0 4-1.6 7-4 8.6M5.6 9.4c.9 2.3 2.6 3.9 4.6 4.8" />
                  <path d="M12.4 20l3.7-9.6L19.9 20M13.9 16.6h4.6" />
                </svg>
              </button>
              <button type="button" className="mu2-sq is-round" aria-pressed={Boolean(music.lyricBlur)}
                title="Dim everything but the line being sung"
                onClick={() => music.setLyricBlur?.(!music.lyricBlur)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 3.6v16.8" /><path d="M6.8 7.4A8.6 8.6 0 0 0 6.8 16.6M17.2 7.4a8.6 8.6 0 0 1 0 9.2" /><path d="M3.6 10.4a12 12 0 0 0 0 3.2M20.4 10.4a12 12 0 0 1 0 3.2" />
                </svg>
              </button>
              <button type="button" className="mu2-sq is-round" aria-pressed={autoscroll} title="Follow the song"
                onClick={() => setAutoscroll((value) => !value)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 4v13" /><path d="M7 12.5 12 17.5l5-5" />
                </svg>
              </button>
              <span className="mu2-sq" aria-label="Line type" title={kind === 'synced' ? 'Line-level timing — the sources we use do not give per-word timing' : 'No timing data on this source'}>
                <span className="mu2-mono">{KIND_LABEL[kind] || '—'}</span>
              </span>
            </div>

            <p className="mu2-mono mu2-lz-meta">
              {track.title} · {track.artists || ''} — source <b>{source.activeSourceId}</b>
              {kind === 'synced' ? ` · line-level timing${look.offset ? ` · offset ${look.offset.toFixed(2)}s` : ''}` : kind === 'plain' ? ' · plain text, no timing' : ' · no lyrics'}
            </p>
          </>
        )}
      </div>

      {/* ── the full look panel (desktop); the strip above covers the phone ── */}
      <aside className="mu2-look" aria-label="Lyrics look">
        <div className="mu2-look-g">
          <h4>Canvas</h4>
          <div className="mu2-canvases">
            {LYRIC_CANVASES.map((canvas) => (
              <button key={canvas.id} type="button" className={`mu2-cv mu2-bg-${canvas.id}`} data-canvas={canvas.id}
                aria-pressed={look.canvas === canvas.id} title={canvas.hint}
                onClick={() => updateLook({ canvas: canvas.id })}>
                <span>{canvas.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mu2-look-g">
          <h4>Type size</h4>
          <div className="mu2-seg">
            {LYRIC_SIZES.map((size) => (
              <button key={size.id} type="button" aria-pressed={look.size === size.id} onClick={() => updateLook({ size: size.id })}>{size.label}</button>
            ))}
          </div>
        </div>
        <div className="mu2-look-g">
          <h4>Typeface</h4>
          <div className="mu2-seg is-face">
            {LYRIC_FACES.map((face) => (
              <button key={face.id} type="button" data-face={face.id} aria-pressed={look.face === face.id}
                onClick={() => updateLook({ face: face.id })}>{face.label}</button>
            ))}
          </div>
        </div>
        <div className="mu2-look-g">
          <h4>Offset</h4>
          <div className="mu2-look-row">
            <button type="button" className="mu2-chip" onClick={() => nudgeOffset(-0.25)}>− 0.25s</button>
            <span className="mu2-mono">{look.offset.toFixed(2)}s</span>
            <button type="button" className="mu2-chip" onClick={() => nudgeOffset(0.25)}>＋ 0.25s</button>
          </div>
        </div>
        <p className="mu2-mono">Saved on this device — canvas, size, face, offset and follow.</p>
      </aside>

      {source.open ? (
        <SourceSheet
          sources={source.sources}
          status={source.status}
          error={source.error}
          activeSourceId={source.activeSourceId}
          applying={source.applying}
          onApply={(id) => { source.apply(id); source.setOpen(false); notify?.(id === 'auto' ? 'Using Auto' : `Applied ${id}`); }}
          onClose={() => source.setOpen(false)}
          onRetry={source.load}
        />
      ) : null}
    </div>
  );
}

/* ── "Choose your source" ──────────────────────────────────────────────────── */

const TAGS = { synced: ['Synced', 'is-sync'], plain: ['Plain', 'is-plain'], none: ['No lyrics', ''], auto: ['Auto', ''] };

function SourceSheet({ sources, status, error, activeSourceId, applying, onApply, onClose, onRetry }) {
  const [blocked, setBlocked] = useState([]);
  useEffect(() => {
    let alive = true;
    fetch('/api/music/lyrics?list=1&catalogue=1', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => { if (alive && Array.isArray(data?.catalogue)) setBlocked(data.catalogue); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const wired = Array.isArray(sources) ? sources : [];
  // `mark instrumental` is a local action, not a provider: it lives in the catalogue
  // (`group: 'local'`, folded into the wired group) and is rendered from there so the
  // source list has exactly one source of truth.
  const local = blocked.flatMap((group) => group.items).filter((item) => item.local && item.pickable);
  const notWired = blocked
    .filter((group) => group.id !== 'wired' && !group.local)
    .flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label, groupTone: group.tone, badge: group.badge })));

  return (
    <div className="mu2-scrim" onClick={(event) => { if (event.target.classList.contains('mu2-scrim')) onClose(); }}>
      <section className="mu2-sheet" role="dialog" aria-modal="true" aria-label="Choose your source">
        <header className="mu2-sheet-h">
          <div>
            <h2>Choose your source</h2>
            <p>Preview before you apply — the stage changes the moment you pick.</p>
          </div>
          <button type="button" className="mu2-icon-btn" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <p className="mu2-mono">Each preview below is what the provider actually returned for this song.</p>

        {status === 'loading' ? <p className="mu2-lz-note" role="status">Asking every wired source…</p> : null}
        {status === 'error' ? <StateBox tone="error" title="Could not reach the lyrics service" body={error} onRetry={onRetry} retryLabel="Try again" /> : null}

        {wired.map((item) => (
          <button key={item.id} type="button" className={`mu2-src ${activeSourceId === item.id ? 'is-on' : ''}`}
            aria-pressed={activeSourceId === item.id} onClick={() => onApply(item.id)}>
            <span className="mu2-src-ic" aria-hidden="true">{item.mark || '•'}</span>
            <span className="mu2-src-t">
              <strong>{item.name}{activeSourceId === item.id ? ' · using' : ''}{applying === item.id ? ' · applying…' : ''}</strong>
              <span className="mu2-tags">
                <span className={`mu2-tag ${TAGS[item.kind]?.[1] || ''}`}>{TAGS[item.kind]?.[0] || item.kind}</span>
                {item.lines ? <span className="mu2-tag">{item.lines} lines</span> : null}
                {item.match != null ? <span className="mu2-tag">{item.match}% match</span> : null}
              </span>
              {item.preview?.length ? (
                <span className="mu2-src-pv">
                  {item.preview.map((line, index) => <span key={index}>{line}</span>)}
                </span>
              ) : <span className="mu2-src-pv is-empty">{item.reason || 'Nothing returned for this song.'}</span>}
              <span className={`mu2-ev ${item.ok ? 'is-live' : 'is-no'}`}>{item.ok ? `returned ${item.lines} lines in ${item.ms} ms` : (item.reason || 'no result')}</span>
            </span>
          </button>
        ))}

        {local.map((item) => (
          <button key={item.id} type="button" className={`mu2-src ${activeSourceId === item.id ? 'is-on' : ''}`}
            aria-pressed={activeSourceId === item.id} onClick={() => onApply(item.id)}>
            <span className="mu2-src-ic" aria-hidden="true">{item.mark}</span>
            <span className="mu2-src-t">
              <strong>{item.name}{activeSourceId === item.id ? ' · using' : ''}</strong>
              <span className="mu2-tags"><span className="mu2-tag">Local</span></span>
              <span className="mu2-src-pv is-empty">{item.note}</span>
              <span className="mu2-ev is-no">{item.evidence}</span>
            </span>
          </button>
        ))}

        {notWired.length ? (
          <div className="mu2-src-group">
            <h4>Not wired in this app <b>probed by hand</b></h4>
            <p>Shown so they are not re-proposed later. One of them answers with deliberately scrambled text.</p>
            {notWired.map((item) => (
              <div key={item.id} className="mu2-src is-off">
                <span className="mu2-src-ic" aria-hidden="true">{item.mark || '•'}</span>
                <span className="mu2-src-t">
                  <strong>{item.name}</strong>
                  <span className="mu2-ev is-no">{item.evidence}</span>
                  <small>{item.note}</small>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
