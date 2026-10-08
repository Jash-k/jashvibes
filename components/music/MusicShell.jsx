'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { formatTime, QUALITY_LABELS } from '@/lib/musicCore';
import { useMusic } from './MusicProvider';
import CanvasLibrary, { LIBRARY_TABS } from './CanvasLibrary';
import CanvasLyrics from './CanvasLyrics';
import { Cover, IconButton, MusicIcon, Sheet, TrackRows } from './CanvasBits';
import './music-canvas.css';

const DEFAULT_LOOK = { canvas: 'bloom', size: 34, offset: 0, follow: true, motion: false };

export default function MusicShell() {
  const music = useMusic();
  const [tab, setTabState] = useState('albums');
  const [query, setQuery] = useState('');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [overlay, setOverlay] = useState('');
  const [mode, setMode] = useState('lyrics');
  const [full, setFull] = useState(false);
  const [look, setLook] = useState(DEFAULT_LOOK);
  const [notice, setNotice] = useState('');
  const media = useRef(null);
  const provider = useRef(music); provider.current = music;
  const initialized = useRef(false);

  useEffect(() => {
    document.documentElement.classList.add('music-canvas-open');
    const applyLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const next = params.get('tab');
      if (LIBRARY_TABS.some((item) => item.id === next)) setTabState(next);
      setLibraryOpen(params.get('library') === '1');
    };
    applyLocation();
    provider.current.setQuery('');
    media.current = window.matchMedia('(max-width: 900px)');
    const resize = () => { if (!media.current.matches) setLibraryOpen(false); };
    media.current.addEventListener('change', resize);
    window.addEventListener('popstate', applyLocation);
    try {
      const saved = JSON.parse(localStorage.getItem('jash_music_canvas') || '{}');
      setLook({ canvas: ['bloom', 'cinema', 'noir'].includes(saved.canvas) ? saved.canvas : 'bloom', size: Math.min(48, Math.max(22, Number(saved.size) || 34)), offset: Math.min(30, Math.max(-30, Number(saved.offset) || 0)), follow: saved.follow !== false, motion: saved.motion === true });
    } catch { /* storage unavailable */ }
    return () => { document.documentElement.classList.remove('music-canvas-open'); media.current.removeEventListener('change', resize); window.removeEventListener('popstate', applyLocation); };
  }, []);
  const update = (patch) => setLook((old) => { const value = { ...old, ...patch }; try { localStorage.setItem('jash_music_canvas', JSON.stringify(value)); } catch { /* storage unavailable */ } return value; });
  const locationState = (nextTab, open, push = true) => {
    const url = new URL(window.location.href); url.searchParams.set('tab', nextTab);
    if (open) url.searchParams.set('library', '1'); else url.searchParams.delete('library');
    window.history[push ? 'pushState' : 'replaceState']({}, '', url.pathname + url.search);
  };
  const setTab = (id) => { setTabState(id); locationState(id, libraryOpen); };
  const showLibrary = (value) => { setLibraryOpen(value); locationState(tab, value); };
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    const timer = setTimeout(() => provider.current.setQuery(query), 320);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2400); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const keyboard = (event) => {
      if (event.key === 'Escape' && !overlay) { if (libraryOpen) showLibrary(false); else setFull(false); }
      if (event.code === 'Space' && !overlay && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)) { event.preventDefault(); provider.current.togglePlay(); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [overlay, libraryOpen, tab]);
  const libraryRef = useRef(null), savedFocus = useRef(null);
  useEffect(() => {
    if (!libraryOpen || !media.current?.matches) return;
    savedFocus.current = document.activeElement;
    const background = document.querySelector('.mc-player');
    if (background) background.inert = true;
    libraryRef.current?.querySelector('button')?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab' || overlay) return;
      const elements = [...document.querySelectorAll('.mc-library-dock button, .mc-library-dock input, .mc-library-dock select, .mc-library-dock [tabindex="0"], .mc-transport button, .mc-transport input')].filter((node) => !node.disabled && node.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (background) background.inert = false; savedFocus.current?.focus?.(); };
  }, [libraryOpen, overlay]);
  const play = (track, tracks) => { music.playTrack(track, tracks, true); setNotice(`Playing ${track.title || 'track'}`); };
  const playing = music.playingTrack;
  const favorite = music.favoriteSet?.has(music.activeKey);
  const image = playing?.image || '';
  const quality = QUALITY_LABELS[music.quality] || music.quality || 'Source quality';

  return <main className={`mc-app mc-style-${look.canvas} ${libraryOpen ? 'is-library-open' : ''} ${full ? 'is-focus' : ''}`} style={{ '--mc-art': image ? `url(${JSON.stringify(image)})` : 'none' }}>
    <div className="mc-app-content">
      <aside className="mc-rail" aria-label="App navigation"><Link href="/" className="mc-wordmark" aria-label="JaSH ViBeS Home">JV</Link><nav><Link href="/" title="Home"><MusicIcon name="home"/><span>Home</span></Link><Link href="/music" aria-current="page"><MusicIcon name="play"/><span>Music</span></Link><Link href="/live"><MusicIcon name="live"/><span>Live</span></Link><Link href="/vault"><MusicIcon name="library"/><span>Vault</span></Link></nav><Link href="/" className="mc-exit">← Exit</Link></aside>
      <div className="mc-canvas">
        <header className="mc-topbar"><Link href="/" className="mc-brand">JaSH ViBeS <small>MUSIC</small></Link><span className="mc-top-subtitle">Your music. Your moment.</span><div className="mc-top-actions"><IconButton icon="library" label="Open Library" className="mc-library-toggle" onClick={() => showLibrary(!libraryOpen)}/><button type="button" className="mc-header-button" onClick={() => setOverlay('queue')}><MusicIcon name="queue"/><span>Queue</span></button><button type="button" className="mc-header-button" onClick={() => setOverlay('settings')}><MusicIcon name="settings"/><span>Settings</span></button></div></header>
        <div className="mc-workspace">
          <div ref={libraryRef} className="mc-library-dock" {...(libraryOpen ? { role: 'region', 'aria-label': 'Library browsing sheet' } : {})}><CanvasLibrary music={music} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onPlay={play} onClose={() => showLibrary(false)}/></div>
          <div className={`mc-player ${mode === 'artwork' ? 'is-artwork-mode' : ''}`}>
            <section className="mc-now" aria-label="Now playing"><Cover item={playing} className="mc-now-art"/><div className="mc-now-text"><h1>{playing?.title || 'Find your next favourite'}</h1><p>{playing?.artists || 'Open the Library to choose a song'}</p>{playing ? <small>{quality}{music.playerStatus === 'loading' ? ' · Connecting…' : ''}</small> : <small>Tamil music · One uninterrupted queue</small>}</div></section>
            <CanvasLyrics music={music} look={look} update={update} full={full} onExpand={() => { setFull(!full); setMode('lyrics'); }} onSettings={() => setOverlay('settings')}/>
            <div className="mc-player-modes" role="group" aria-label="Player view"><button type="button" aria-pressed={mode === 'artwork'} onClick={() => { setMode('artwork'); setFull(false); }}>Artwork</button><button type="button" aria-pressed={mode === 'lyrics'} onClick={() => setMode('lyrics')}>Lyrics</button></div>
          </div>
        </div>
        <footer className="mc-transport" aria-label="Playback controls">
          {music.playerStatus === 'error' ? <div className="mc-play-error" role="alert"><span>{music.error || 'Playback unavailable'}</span><button type="button" onClick={music.retryTrack}>Retry</button><button type="button" onClick={() => music.playNext()}>Skip</button></div> : null}
          <div className="mc-seek"><span>{formatTime(music.currentTime)}</span><input type="range" aria-label="Playback position" aria-valuetext={`${formatTime(music.currentTime)} of ${formatTime(music.duration)}`} min="0" max={music.duration || 1} step="0.1" value={Math.min(music.currentTime || 0, music.duration || 1)} disabled={!music.duration} onChange={(event) => music.seekTo(Number(event.target.value))}/><span>{formatTime(music.duration)}</span></div>
          <div className="mc-transport-row"><button type="button" className="mc-mini-info" onClick={() => { if (libraryOpen) showLibrary(false); setMode('lyrics'); }} aria-label="Return to player"><Cover item={playing}/><span><strong>{playing?.title || 'Nothing playing'}</strong><small>{playing?.artists || 'Choose a song'}</small></span></button><div className="mc-transport-main"><IconButton icon="shuffle" label="Shuffle" active={music.shuffleEnabled} onClick={() => music.setShuffleEnabled(!music.shuffleEnabled)} disabled={!playing}/><IconButton icon="previous" label="Previous track" onClick={music.playPrevious} disabled={!playing}/><IconButton icon={music.isPlaying ? 'pause' : 'play'} label={music.isPlaying ? 'Pause' : 'Play'} className="mc-primary-play" onClick={music.togglePlay} disabled={!playing}/><IconButton icon="next" label="Next track" onClick={() => music.playNext()} disabled={!playing}/><IconButton icon="repeat" label={`Repeat: ${music.repeatMode}`} active={music.repeatMode !== 'off'} onClick={music.cycleRepeat} disabled={!playing}>{music.repeatMode === 'one' ? <sup>1</sup> : null}</IconButton><IconButton icon="heart" label={favorite ? 'Remove current track from favourites' : 'Save current track'} active={Boolean(favorite)} onClick={() => music.toggleFavorite(playing)} disabled={!playing}/></div><label className="mc-volume"><MusicIcon name="volume"/><span className="sr-only">Volume</span><input type="range" min="0" max="1" step="0.01" value={music.muted ? 0 : music.volume} onChange={(event) => music.changeVolume(Number(event.target.value))}/></label></div>
          {look.motion ? <div className={`mc-signal ${music.isPlaying ? 'is-playing' : ''}`} aria-hidden="true">{Array.from({ length: 72 }, (_, i) => <i key={i} style={{ '--bar-height': `${10 + ((i * 17) % 31)}px`, '--bar-delay': `${(i % 9) * -0.12}s`, '--bar-color': `hsl(${200 - i * 2.5} 78% 65%)` }}/>)}</div> : null}
        </footer>
      </div>
    </div>
    {overlay ? <Sheet title={overlay === 'queue' ? 'Up next' : 'Music settings'} onClose={() => setOverlay('')}>
      {overlay === 'queue' ? <><p className="mc-muted">{music.queueTracks.length} tracks · Browsing does not replace this queue.</p><TrackRows tracks={music.queueTracks} music={music} queue onPlay={play}/></> : <div className="mc-settings">
        <label>Audio quality<select value={music.quality} disabled={!music.qualityChips?.length} onChange={(event) => music.setQuality(event.target.value)}>{music.qualityChips?.length ? music.qualityChips.map((item) => <option key={item.key} value={item.key}>{item.label}</option>) : <option value="">No source selected</option>}</select></label><p>Only qualities supplied by the current source are offered. Changing quality retains the playback position.</p>
        <label>Lyrics appearance<select value={look.canvas} onChange={(event) => update({ canvas: event.target.value })}><option value="bloom">Bloom · Ambient colour</option><option value="cinema">Cinema · Album artwork</option><option value="noir">Noir · Monochrome</option></select></label>
        <label>Lyrics size <span>{look.size}px</span><input type="range" min="22" max="48" value={look.size} onChange={(event) => update({ size: Number(event.target.value) })}/></label>
        <label>Timing offset (seconds)<input type="number" step="0.25" min="-30" max="30" value={look.offset} onChange={(event) => update({ offset: Math.min(30, Math.max(-30, Number(event.target.value) || 0)) })}/></label>
        <label className="mc-check"><input type="checkbox" checked={look.follow} onChange={(event) => update({ follow: event.target.checked })}/>Follow synced lyrics</label>
        <label className="mc-check"><input type="checkbox" checked={look.motion} onChange={(event) => update({ motion: event.target.checked })}/>Decorative spectrum animation</label><p>The spectrum is decorative, not a measured audio analyser. Reduced-motion preferences disable it.</p>
        <button type="button" className="mc-button is-quiet" onClick={() => update(DEFAULT_LOOK)}>Reset appearance</button>
      </div>}
    </Sheet> : null}
    <div className={`mc-notice ${notice ? 'is-visible' : ''}`} role="status" aria-live="polite">{notice}</div>
  </main>;
}
