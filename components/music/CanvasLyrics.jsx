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
 *
 * One call answers a song, and it answers both halves of this screen: the record the
 * stage shows and every record the search returned for the list. So opening the list
 * is usually reading an answer that already exists — and when the provider is busy,
 * what was remembered for the song is shown with a retry symbol beside it rather
 * than an empty panel.
 */

const OWN_KEY = 'jash_own_lyrics_v1';

const EMPTY_PICKER = { status: 'idle', candidates: [], autoId: '', savedId: '', current: 'auto', busy: false, message: '' };

/**
 * The answer the route gave for a song, kept per song so opening the list again — or switching to
 * the library and back — costs nothing. The route remembers the same answer on the server, so this
 * only saves the round trip; the page can start from the server's copy instead of an empty panel.
 * A failure is never kept here, so the next look is a real look.
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

/**
 * What an option says: the mark for the record in use, the mark for a record that carries timing,
 * the record's own title, and how long it runs. Nothing else — the list is titles, not sentences.
 */
function candidateLabel(candidate = {}, wanted = {}, current = '') {
  const parts = [];
  if (candidate.id === current) parts.push('\u25cf');
  if (candidate.synced) parts.push('\u266a');
  parts.push(recordLine(candidate, wanted));
  if (candidate.duration) parts.push('\u00b7 ' + mmss(candidate.duration));
  return parts.join(' ');
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

  // A different song: the list closes, nothing is selected, a past refusal is forgotten.
  useEffect(() => { setOpen(false); setPicked(''); setFailed(false); }, [key]);

  /**
   * Looking again is one of two things, and they are not the same request. The retry symbol means
   * the provider refused, so ask it again, cache and all. A change that was just saved means the
   * search did not change at all — only what this song is using did — so that one asks again
   * locally and is answered from what the route already remembers, at no cost to the provider.
   */
  const [tick, setTick] = useState(0);
  const fromProvider = useRef(false), fromLocal = useRef(false);
  const askAgain = ({ provider = false, local = false }) => { fromProvider.current = provider; fromLocal.current = local; setTick((value) => value + 1); };

  useEffect(() => {
    if (!key) { setPicker(EMPTY_PICKER); return undefined; }
    const fresh = fromProvider.current; fromProvider.current = false;
    const again = fromLocal.current; fromLocal.current = false;
    const known = CANDIDATE_CACHE.get(key);
    if (!again && known) { setPicker(known); return undefined; }
    setPicker({ ...EMPTY_PICKER, status: 'loading', busy: Boolean(known?.busy) });
    const controller = new AbortController();
    // Deferred: the song's own lyrics are asked for first — and the route remembers that one
    // answer, so this is a second *reader* of it, never a second call to the provider.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ candidates: '1', title: wanted.title || '', artist: wanted.artist || '',
        album: wanted.album || '', duration: wanted.duration ? String(wanted.duration) : '', id: wanted.id || '' });
      if (fresh) params.set('reload', '1');
      fetch('/api/music/lyrics?' + params, { signal: controller.signal, cache: 'no-store' })
        .then((response) => response.json())
        .then((data) => {
          if (controller.signal.aborted) return;
          const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
          const busy = Boolean(data?.busy);
          // Busy with records from before is a list with a retry symbol beside it. Busy with
          // nothing remembered is a state the person can retry — one kept nowhere, so the next
          // look is a real look.
          const ready = Boolean(data?.ok) && (candidates.length > 0 || !busy);
          const next = { status: ready ? 'ready' : 'error', candidates, autoId: data?.autoId || '',
            savedId: data?.savedId || '', current: data?.current || 'auto', busy, message: data?.message || '' };
          if (ready || candidates.length) CANDIDATE_CACHE.set(key, next);
          setPicker(next);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          // What the route said earlier about this song is still true; only this look failed.
          setPicker(known || { ...EMPTY_PICKER, status: 'error', message: 'Could not reach the lyrics provider.' });
        });
    }, 1400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, wanted.title, wanted.artist, wanted.album, wanted.duration, wanted.id, tick]);

  // A failure has no sentence to print, so the tick carries it: red for a moment, and the words
  // go to assistive tech only.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), 4000);
    return () => clearTimeout(timer);
  }, [failed]);

  /** The record this song is using right now: the saved choice, or the automatic match. */
  const currentId = picker.current === 'saved' ? (picker.savedId || '') : picker.autoId;

  /**
   * The one place a choice is written: picking a record hands this screen's one write to the same
   * store the admin panel uses. Rows, the dropdown and the tick all end up here, so they cannot
   * drift apart — and the lookup that follows reads what the route already remembers. There is no
   * way back to the automatic match from here on purpose: that lives in the admin Lyrics tab.
   */
  async function ask(value) {
    if (!key || !value || picking) return;
    setPicked(value);
    setPicking(true);
    try {
      const response = await fetch('/api/music/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'choose', candidateId: value, ...wanted }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'That change was not saved.');
      // A copy pasted on this device would otherwise keep hiding the record just chosen.
      if (saved) saveSaved(null);
      CANDIDATE_CACHE.delete(key);
      setPicked('');
      setOpen(false);
      await music.reloadLyrics?.();
      // The search itself did not change, so this is answered from what the route remembers.
      askAgain({ local: true });
    } catch {
      setFailed(true);
    } finally {
      setPicked('');
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
      {key && picker.status !== 'loading' && (picker.busy || picker.status === 'error' || !picker.candidates.length)
        ? <IconButton className={`mc-lyric-retry ${picker.busy ? 'is-busy' : ''}`} icon="refresh" label="Look for these records again" onClick={() => askAgain({ provider: true, local: true })}/> : null}
      <button className="mc-text-button" type="button" aria-label="Lyrics text settings" onClick={onSettings}>Aa</button>
      <label><span className="sr-only">Lyrics style</span><select value={look.canvas} onChange={(event) => update({ canvas: event.target.value })}><option value="bloom">Bloom</option><option value="cinema">Cinema</option><option value="noir">Noir</option></select></label>
      <IconButton className="mc-lyrics-expand" icon="expand" label={full ? 'Exit lyrics focus' : 'Expand lyrics'} active={full} onClick={onExpand}/>
    </div></header>
    {/* The list opens inside the panel, so it is the same list on a phone and on a desktop and it
        can never be clipped or float over a different section. */}
    {open ? (
      <div className="mc-lyric-pop" role="dialog" aria-label="Available lyrics">
        {picker.status === 'loading' ? <span className="mc-lyric-pop-state" role="status"><MusicIcon name="refresh" size={16}/><span className="sr-only">Looking for other records</span></span> : null}
        {picker.status === 'error' ? <span className="mc-lyric-pop-state is-error" role="status"><MusicIcon name={picker.busy ? 'refresh' : 'close'} size={16}/><span className="sr-only">{picker.message || 'Could not list the records.'}</span></span> : null}
        {picker.status === 'ready' && !picker.candidates.length ? <span className="mc-lyric-pop-state" role="status"><MusicIcon name="queue" size={16}/><span className="sr-only">No other records for this song</span></span> : null}
        {picker.status === 'ready' && picker.candidates.length ? <>
          <ul className="mc-lyric-pop-list">
            {picker.candidates.map((candidate) => <li key={candidate.id}>
              <button type="button" className={`mc-lyric-option ${picked === candidate.id ? 'is-picked' : ''} ${currentId === candidate.id ? 'is-current' : ''} ${candidate.same === false ? 'is-other' : ''}`}
                aria-pressed={picked === candidate.id} onClick={() => setPicked(candidate.id)}>
                <MusicIcon name={candidate.synced ? 'wave' : 'text'} size={16}/>
                <span className="mc-lyric-option-title">{recordLine(candidate, wanted)}</span>
                {candidate.same === false ? <span className="sr-only">Not this song</span> : null}
                <span className="mc-lyric-option-time">{mmss(candidate.duration)}</span>
              </button>
            </li>)}
          </ul>
          {/* The same list again, as the dropdown a select gives: the whole set in one look. */}
          <label className="mc-lyric-records">
            <span className="sr-only">The lyric records for this song</span>
            <select className={`mc-lyric-select ${failed ? 'is-error' : ''}`} disabled={picking}
              value={picked || currentId}
              onChange={(event) => { const value = event.target.value; if (value) setPicked(value); }}>
              {!picker.candidates.some((candidate) => candidate.id === (picked || currentId)) ? <option value="">·</option> : null}
              {picker.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate, wanted, currentId)}</option>)}
            </select>
          </label>
          <div className="mc-lyric-pop-actions">
            {/* The one button that writes anything: a record is only a choice until the tick. */}
            <IconButton className={`mc-lyric-save ${failed ? 'is-error' : ''}`} icon={failed ? 'close' : 'check'}
              label={failed ? 'Could not save that choice' : 'Use these lyrics for this song'}
              disabled={!picked || picking || picked === currentId} onClick={() => ask(picked)}/>
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
      {/* Asking again asks the provider for the song's lyrics *and* for its records: one gesture,
          one lookup — never two competing ones. */}
      <IconButton className="mc-lyric-refresh" icon="refresh" label="Look for the lyrics again" disabled={!key || music.lyricsStatus === 'loading' || mine} onClick={() => { askAgain({ provider: true, local: true }); music.openLyrics(true); }}/>
    </footer>
  </section>;
}
