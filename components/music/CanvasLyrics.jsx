'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { parseSyncedLyrics, trackKey } from '@/lib/musicCore';
import { IconButton, Status } from './CanvasBits';

export default function CanvasLyrics({ music, look, update, full, onExpand, onSettings }) {
  const scroll = useRef(null), current = useRef(null), latest = useRef(music);
  latest.current = music;
  const [following, setFollowing] = useState(true);
  const key = trackKey(music.playingTrack);
  const lines = useMemo(() => {
    if (music.lyricsData?.loadedFor !== key) return [];
    const synced = parseSyncedLyrics(music.lyricsData?.syncedLyrics || '');
    return synced.length ? synced : String(music.lyrics || '').split(/\r?\n/).filter(Boolean).map((text) => ({ text, time: null }));
  }, [key, music.lyricsData, music.lyrics]);
  const synced = lines.length > 0 && lines[0].time != null;
  let index = -1;
  if (synced) for (let i = 0; i < lines.length; i++) { if (lines[i].time <= music.currentTime + look.offset) index = i; else break; }
  useEffect(() => { setFollowing(true); if (key) latest.current.openLyrics(); }, [key]);
  useEffect(() => {
    if (!following || !look.follow || !synced || !current.current || !scroll.current) return;
    const container = scroll.current, line = current.current;
    // Scroll only this bounded panel, never the body or fixed canvas.
    const target = line.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - container.clientHeight / 2 + line.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [index, following, look.follow, synced, full]);
  return <section className={`mc-lyrics ${full ? 'is-full' : ''}`} aria-label="Lyrics">
    <header><h2>Lyrics <small>{synced ? 'Synced' : lines.length ? 'Plain lyrics' : ''}</small></h2><div className="mc-lyric-tools"><button className="mc-text-button" type="button" aria-label="Lyrics text settings" onClick={onSettings}>Aa</button><label><span className="sr-only">Lyrics style</span><select value={look.canvas} onChange={(event) => update({ canvas: event.target.value })}><option value="bloom">Bloom</option><option value="cinema">Cinema</option><option value="noir">Noir</option></select></label><IconButton icon="expand" label={full ? 'Exit lyrics focus' : 'Expand lyrics'} active={full} onClick={onExpand}/></div></header>
    <div className="mc-lyric-scroll" ref={scroll} tabIndex={0} aria-label="Lyrics text" onWheel={() => setFollowing(false)} onTouchStart={() => setFollowing(false)} onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(event.key)) setFollowing(false); }}>
      {!music.playingTrack ? <Status title="Your music, in focus">Choose a track from the Library to start listening.</Status> : music.lyricsStatus === 'loading' ? <Status title="Finding lyrics…"/> : music.lyricsStatus === 'error' ? <Status title="Lyrics unavailable" error retry={() => music.openLyrics(true)}>{music.lyricsData?.message}</Status> : !lines.length ? <Status title="No lyrics found" retry={() => music.openLyrics(true)}>You can keep listening or try fetching lyrics again.</Status> : <ol className="mc-lyric-lines" style={{ '--mc-lyric-size': `${look.size}px` }}>{lines.map((line, i) => <li key={`${key}:${i}`} ref={i === index ? current : null} className={!synced ? 'is-plain' : i === index ? 'is-current' : i < index ? 'is-past' : 'is-future'}>{synced ? <button type="button" onClick={() => { music.seekTo(Math.max(0, line.time - look.offset)); setFollowing(true); }} aria-label={`Seek to ${line.text}`}>{line.text}</button> : <span>{line.text}</span>}</li>)}</ol>}
    </div>
    <footer>{lines.length ? <button className="mc-text-button" type="button" onClick={() => music.rejectLyrics()} title="Reject this lyric result for this song on this device">Wrong lyrics?</button> : null}{synced && !following ? <button className="mc-button" type="button" onClick={() => setFollowing(true)}>Resume follow</button> : <span>{synced ? 'Tap a line to seek' : lines.length ? 'Timing is not available for these lyrics' : 'Lyrics depend on provider availability'}</span>}<IconButton icon="refresh" label="Refresh lyrics" disabled={!key || music.lyricsStatus === 'loading'} onClick={() => music.openLyrics(true)} /></footer>
  </section>;
}
