'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSyncedLyrics, trackKey } from '@/lib/musicCore';
import { IconButton, MusicIcon, Status } from './CanvasBits';

/*
 * The lyric stage.
 *
 * Pipeline contract it renders: LRCLIB is the only provider, its answer is
 * cached in the database, and lyrics the viewer saved for this song are served
 * before any provider is asked. So there are now three real states, and each one
 * has something to do next instead of an empty column:
 *
 *   found        lines, with the karaoke highlight when the source carried timing
 *   not found    the reason the lookup could not accept anything, plus retry
 *   unavailable  a provider failure (retryable), never confused with "no lyrics"
 *
 * The stage prints words only where they are the content: the lyric lines and the
 * empty state. Its controls are symbols — the panel is for reading, not for reading
 * about. Saved lyrics live on this device (localStorage) so a viewer can fix a song
 * themselves; the owner panel saves them for everyone.
 *
 * The one control that needed more than a symbol is the record list behind
 * "Available": LRCLIB keeps several records for the same song (a live cut, another
 * album, a different vocal) and the strict matcher only ever shows one of them, so
 * the list is the way to a record it refused. A row is only a *choice*: nothing is
 * written until the tick is pressed.
 */

const OWN_KEY = 'jash_own_lyrics_v1';

const EMPTY_PICKER = { status: 'idle', candidates: [], autoId: '', savedId: '', current: 'auto', message: '' };

/**
 * The records the list has found for a song, kept per song so opening it again — or switching to
 * the library and back — never asks the provider twice. Cleared on a reload of the page; the saved
 * choice itself lives in the database, not here.
 */
const CANDIDATE_CACHE = new Map();

const mmss = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return total ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}` : '';
};

/** What a row says: the record's own title, and its artist when it is not the song's. */
function recordLine(candidate = {}, wanted = {}) {
  const title = candidate.title || wanted.title || '';
  const artist = candidate.artist && candidate.artist !== wanted.artist ? candidate.artist : '';
  return artist ? `${title} — ${artist}` : title;
}

function readOwn() {
  try { return JSON.parse(window.localStorage.getItem(OWN_KEY) || '{}') || {}; } catch { return {}; }
}

/** Per-song lyrics the viewer pasted. Re-read whenever the song changes. */
function useSavedLyrics(key) {
  const [saved, setSaved] = useState(null);
  useEffect(() => { setSaved(key ? readOwn()[key] || null : null); }, [key]);
  const write = useCallback((value) => {
    if (!key) return;
    try {
      const all = readOwn();
      if (value) all[key] = value; else delete all[key];
      const entries = Object.entries(all).slice(-120);
      window.localStorage.setItem(OWN_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* storage full or blocked: the stage simply keeps the provider text */ }
    setSaved(value);
  }, [key]);
  return [saved, write];
}

function linesFrom(text = '') {
  const synced = parseSyncedLyrics(String(text));
  if (synced.length) return synced;
  return String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, time: null }));
}

export default function CanvasLyrics({ music, look, update, full, onExpand, onSettings }) {
  const scroll = useRef(null), current = useRef(null);
  const [following, setFollowing] = useState(true);
  const [pasting, setPasting] = useState(false);
  const [draft, setDraft] = useState('');
  const key = trackKey(music.playingTrack);

  const [saved, saveSaved] = useSavedLyrics(key);

  // Provider lyrics, only once the engine's answer belongs to this song.
  const providerLines = useMemo(() => {
    if (music.lyricsData?.loadedFor !== key) return [];
    const synced = parseSyncedLyrics(music.lyricsData?.syncedLyrics || '');
    return synced.length ? synced : String(music.lyrics || '').split(/\r?\n/).filter(Boolean).map((text) => ({ text, time: null }));
  }, [key, music.lyricsData, music.lyrics]);

  const ownLines = useMemo(() => (saved ? linesFrom(saved.syncedLyrics || saved.plainLyrics || '') : []), [saved]);
  const lines = ownLines.length ? ownLines : providerLines;
  const synced = lines.length > 0 && lines[0].time != null;
  const mine = ownLines.length > 0;

  // ── the record list: every record LRCLIB offers for this song ───────────────
  const [picker, setPicker] = useState(EMPTY_PICKER);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState('');
  const [picking, setPicking] = useState(false);
  const [failed, setFailed] = useState(false);
  const wanted = music.lyricSong || {};

  useEffect(() => {
    setOpen(false);
    setPicked('');
    setFailed(false);
    if (!key) { setPicker(EMPTY_PICKER); return; }
    const cached = CANDIDATE_CACHE.get(key);
    if (cached) { setPicker(cached); return; }
    setPicker({ ...EMPTY_PICKER, status: 'loading' });
    const controller = new AbortController();
    // Deferred: the lyrics themselves come first, and this never competes with that request.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ candidates: '1', title: wanted.title || '', artist: wanted.artist || '',
        album: wanted.album || '', duration: wanted.duration ? String(wanted.duration) : '', id: wanted.id || '' });
      fetch('/api/music/lyrics?' + params, { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          const next = { status: data?.ok ? 'ready' : 'error', candidates: data?.candidates || [], autoId: data?.autoId || '',
            savedId: data?.savedId || '', current: data?.current || 'auto', message: data?.message || '' };
          if (data?.ok) CANDIDATE_CACHE.set(key, next);
          setPicker(next);
        })
        .catch(() => { if (!controller.signal.aborted) setPicker({ ...EMPTY_PICKER, status: 'error', message: 'Could not reach the lyrics provider.' }); });
    }, 1400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, wanted.title, wanted.artist, wanted.album, wanted.duration, wanted.id]);

  // A failure has no sentence to print, so the tick carries it: red for a moment, and the words
  // go to assistive tech only.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), 4000);
    return () => clearTimeout(timer);
  }, [failed]);

  /** The record this song is using right now: the saved choice, or the automatic match. */
  const currentId = picker.current === 'saved' ? (picker.savedId || '') : picker.autoId;

  async function commit() {
    if (!picked || picking || picked === currentId) return;
    setPicking(true);
    try {
      const response = await fetch('/api/music/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'choose', candidateId: picked, ...wanted }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Could not save that choice.');
      // A copy pasted on this device would otherwise keep hiding the record just chosen.
      if (saved) saveSaved(null);
      const next = { status: 'ready', candidates: picker.candidates, autoId: picker.autoId, savedId: picked, current: 'saved', message: '' };
      CANDIDATE_CACHE.set(key, next);
      setPicker(next);
      setPicked('');
      setOpen(false);
      await music.reloadLyrics?.();
    } catch {
      setFailed(true);
    } finally {
      setPicking(false);
    }
  }

  const settled = music.lyricsData?.loadedFor === key;
  const reason = settled ? (music.lyricsData?.reason || '') : '';
  const status = music.lyricsStatus;
  const loading = !lines.length && (!settled || ['idle', 'loading'].includes(status));

  let index = -1;
  if (synced) for (let i = 0; i < lines.length; i += 1) { if (lines[i].time <= music.currentTime + look.offset) index = i; else break; }

  useEffect(() => { setFollowing(true); setPasting(false); }, [key]);
  useEffect(() => {
    if (!following || !look.follow || !synced || !current.current || !scroll.current) return;
    const container = scroll.current, line = current.current;
    // Scroll only this bounded panel, never the body or fixed canvas.
    const target = line.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - container.clientHeight / 2 + line.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [index, following, look.follow, synced, full]);

  function save() {
    const text = draft.trim();
    if (!text) return;
    saveSaved({ plainLyrics: text.includes('[') && /\[\d+\s*:\s*\d+/.test(text) ? '' : text, syncedLyrics: /\[\d+\s*:\s*\d+/.test(text) ? text : '', savedAt: new Date().toISOString() });
    setDraft('');
    setPasting(false);
  }

  function openPaste() {
    setDraft(saved ? (saved.syncedLyrics || saved.plainLyrics || '') : '');
    setPasting(true);
  }

  const reasonText = {
    'missing-metadata': 'This song arrived without a title or artist, so there was nothing safe to search for.',
    'not-in-catalogue': 'LRCLIB does not carry this song. Nothing else is substituted for it.',
    'identity-rejected': 'A record for this song exists but did not match the title, artist and duration closely enough to trust.',
    'provider-error': 'The lyrics provider could not be reached just now.',
  }[reason] || '';

  return <section className={`mc-lyrics ${full ? 'is-full' : ''}`} aria-label="Lyrics">
    {/* Desktop keeps the expand glyph as its focus control. Mobile deliberately has no
        visible exit here: the Library button leaves focus, and the lock button's focus mode
        is the one with a gesture to leave. */}
    <header><h2>Lyrics</h2><div className="mc-lyric-tools">
      <button className="mc-lyric-available" type="button" aria-label="Available lyrics" aria-expanded={open}
        disabled={!key} onClick={() => setOpen((value) => !value)}>
        <MusicIcon name="queue" size={18}/><span>Available</span>
      </button>
      <button className="mc-text-button" type="button" aria-label="Lyrics text settings" onClick={onSettings}>Aa</button>
      <label><span className="sr-only">Lyrics style</span><select value={look.canvas} onChange={(event) => update({ canvas: event.target.value })}><option value="bloom">Bloom</option><option value="cinema">Cinema</option><option value="noir">Noir</option></select></label>
      <IconButton className="mc-lyrics-expand" icon="expand" label={full ? 'Exit lyrics focus' : 'Expand lyrics'} active={full} onClick={onExpand}/>
    </div></header>
    {/* The list opens inside the panel, so it is the same list on a phone and on a desktop and it
        can never be clipped or float over a different section. */}
    {open ? (
      <div className="mc-lyric-pop" role="dialog" aria-label="Available lyrics">
        {picker.status === 'loading' ? <span className="mc-lyric-pop-state" role="status"><MusicIcon name="refresh" size={16}/><span className="sr-only">Looking for other records</span></span> : null}
        {picker.status === 'error' ? <span className="mc-lyric-pop-state is-error" role="status"><MusicIcon name="close" size={16}/><span className="sr-only">{picker.message || 'Could not list the records.'}</span></span> : null}
        {picker.status === 'ready' && !picker.candidates.length ? <span className="mc-lyric-pop-state" role="status"><MusicIcon name="queue" size={16}/><span className="sr-only">No other records for this song</span></span> : null}
        {picker.status === 'ready' && picker.candidates.length ? <>
          <ul className="mc-lyric-pop-list">
            {picker.candidates.map((candidate) => <li key={candidate.id}>
              <button type="button" className={`mc-lyric-option ${picked === candidate.id ? 'is-picked' : ''} ${currentId === candidate.id ? 'is-current' : ''}`}
                aria-pressed={picked === candidate.id} onClick={() => setPicked(candidate.id)}>
                <MusicIcon name={candidate.synced ? 'wave' : 'text'} size={16}/>
                <span className="mc-lyric-option-title">{recordLine(candidate, wanted)}</span>
                <span className="mc-lyric-option-time">{mmss(candidate.duration)}</span>
              </button>
            </li>)}
          </ul>
          <div className="mc-lyric-pop-actions">
            <IconButton className={`mc-lyric-save ${failed ? 'is-error' : ''}`} icon={failed ? 'close' : 'check'}
              label={failed ? 'Could not save that choice' : 'Use these lyrics for this song'}
              disabled={!picked || picking || picked === currentId} onClick={commit}/>
          </div>
        </> : null}
      </div>
    ) : null}
    <div className="mc-lyric-scroll" ref={scroll} tabIndex={0} aria-label="Lyrics text" onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) setFollowing(false); }}>
      {!music.playingTrack ? <Status title="Your music, in focus">Choose a track from the Library to start listening.</Status>
        : loading ? <Status title="Finding lyrics…">{settled ? music.lyricsData?.message : ''}</Status>
          : !lines.length && status === 'error' ? <Status title="Lyrics temporarily unavailable" error retry={() => music.openLyrics(true)}>{music.lyricsData?.message}</Status>
            : !lines.length ? (
              <div className="mc-lyric-miss">
                <Status title="No lyrics for this song" retry={() => music.openLyrics(true)}>
                  {reasonText || music.lyricsData?.message || 'You can keep listening, try again, or paste the lyrics yourself.'}
                </Status>
                <div className="mc-lyric-miss-actions">
                  <IconButton icon="add" label="Paste these lyrics yourself" disabled={pasting} onClick={openPaste}/>
                </div>
              </div>
            ) : (
              <ol className="mc-lyric-lines" style={{ '--mc-lyric-size': `${look.size}px` }}>{lines.map((line, i) => <li key={`${key}:${i}`} ref={i === index ? current : null} className={!synced ? 'is-plain' : i === index ? 'is-current' : i < index ? 'is-past' : 'is-future'}>{synced ? <button type="button" onClick={() => { music.seekTo(Math.max(0, line.time - look.offset)); setFollowing(true); }} aria-label={`Seek to ${line.text}`}>{line.text}</button> : <span>{line.text}</span>}</li>)}</ol>
            )}
      {pasting ? (
        <div className="mc-lyric-paste">
          <label htmlFor="mc-lyric-draft">Paste the lyrics for {music.playingTrack?.title || 'this song'}</label>
          <p>One line per row. Add <code>[mm:ss.xx]</code> timestamps to keep the karaoke highlight; without them the stage stays a static read. Saved on this device.</p>
          <textarea id="mc-lyric-draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={7} spellCheck={false} placeholder={'[00:12.40] first line\n[00:18.10] next line'} />
          <div className="mc-lyric-miss-actions">
            <button className="mc-button" type="button" disabled={!draft.trim()} onClick={save}>Save my lyrics</button>
            <button className="mc-text-button" type="button" onClick={() => { setPasting(false); setDraft(''); }}>Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
    {/* Symbols only, and nothing else: a line of status words under a lyric is one more thing
        between the reader and the song. Secrets that must be announced go to screen readers. */}
    <footer>
      <IconButton icon="add" label={mine ? 'Change my lyrics' : 'Paste my own lyrics'} disabled={!key || pasting} onClick={openPaste}/>
      {synced && !following ? <IconButton icon="follow" label="Follow the playing line again" onClick={() => setFollowing(true)}/> : null}
      <IconButton icon="refresh" label="Look for the lyrics again" disabled={!key || music.lyricsStatus === 'loading' || mine || picker.current === 'saved'} onClick={() => music.openLyrics(true)}/>
    </footer>
  </section>;
}
