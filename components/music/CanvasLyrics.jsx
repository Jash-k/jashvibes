'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseSyncedLyrics, trackKey } from '@/lib/musicCore';
import { IconButton, Status } from './CanvasBits';

/*
 * The lyric stage.
 *
 * Pipeline contract it renders: LRCLIB is the only provider, its answer is
 * cached in the database, and lyrics the viewer saved for this song are served
 * before any provider is asked. So there are now three real states, and each one
 * has something to do next instead of an empty column:
 *
 *   found        lines, with the karaoke highlight when the source carried timing
 *   not found    the reason the lookup could not accept anything, plus
 *                "Try again" and "Paste lyrics"
 *   unavailable  a provider failure (retryable), never confused with "no lyrics"
 *
 * Saved lyrics live on this device (localStorage) so a viewer can fix a song
 * themselves; the owner panel saves them for everyone.
 */

const OWN_KEY = 'jash_own_lyrics_v1';

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
    <header><h2>Lyrics <small>{mine ? 'Your lyrics' : synced ? 'Synced' : lines.length ? 'Plain lyrics' : ''}</small></h2><div className="mc-lyric-tools"><button className="mc-text-button" type="button" aria-label="Lyrics text settings" onClick={onSettings}>Aa</button><label><span className="sr-only">Lyrics style</span><select value={look.canvas} onChange={(event) => update({ canvas: event.target.value })}><option value="bloom">Bloom</option><option value="cinema">Cinema</option><option value="noir">Noir</option></select></label><IconButton className="mc-lyrics-expand" icon="expand" label={full ? 'Exit lyrics focus' : 'Expand lyrics'} active={full} onClick={onExpand}/></div></header>
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
                  <button className="mc-text-button" type="button" onClick={() => { setPasting(true); setDraft(''); }}>Paste lyrics</button>
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
    <footer>
      {lines.length && settled && music.lyricsData?.message ? <span role="status">{music.lyricsData.message}</span> : null}
      {lines.length && !mine ? <button className="mc-text-button" type="button" onClick={() => music.rejectLyrics()} title="Reject this lyric result for this song on this device">Wrong lyrics?</button> : null}
      {mine ? <button className="mc-text-button" type="button" onClick={() => { setPasting(true); setDraft(saved?.syncedLyrics || saved?.plainLyrics || ''); }}>Edit my lyrics</button> : null}
      {mine ? <button className="mc-text-button" type="button" onClick={() => saveSaved(null)}>Remove my lyrics</button> : null}
      {!lines.length ? <button className="mc-text-button" type="button" disabled={pasting} onClick={() => { setPasting(true); setDraft(''); }}>Paste lyrics</button> : null}
      {synced && !following ? <button className="mc-button" type="button" onClick={() => setFollowing(true)}>Resume follow</button> : <span>{mine ? 'Saved on this device' : synced ? 'Tap a line to seek' : lines.length ? 'Timing is not available for these lyrics' : ''}</span>}
      <IconButton icon="refresh" label="Refresh lyrics" disabled={!key || music.lyricsStatus === 'loading' || mine} onClick={() => music.openLyrics(true)} />
    </footer>
  </section>;
}
