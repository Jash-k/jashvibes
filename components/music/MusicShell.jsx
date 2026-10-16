'use client';

import SectionLink from '@/components/SectionLink';
import RailNav from '@/components/rail/RailNav';
import MobileDock from '@/components/MobileDock';
import dynamic from 'next/dynamic';
import { readSessionCache, writeSessionCache } from '@/lib/clientCache';
import { useEffect, useRef, useState } from 'react';
import { formatTime, QUALITY_LABELS } from '@/lib/musicCore';
import { useMusic } from './MusicContext';
import useWakeLock from './useWakeLock';
import CanvasLibrary, { LIBRARY_TABS } from './CanvasLibrary';
const CanvasLyrics = dynamic(() => import('./CanvasLyrics'));
const PocketLock = dynamic(() => import('./PocketLock'));
import { Cover, IconButton, MusicIcon, Sheet, TrackRows } from './CanvasBits';
import './music-canvas.css';

const DEFAULT_LOOK = { canvas: 'cinema', size: 34, offset: 0, follow: true, motion: false };

export default function MusicShell() {
  const music = useMusic();
  const [tab, setTabState] = useState('albums');
  const [query, setQuery] = useState('');
  // Fresh entries open Library on every screen; selecting a song opens lyrics focus.
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [overlay, setOverlay] = useState('');
  const [pocketLocked, setPocketLocked] = useState(false);
  const [mode, setMode] = useState('lyrics');
  const [full, setFull] = useState(true);
  const [look, setLook] = useState(DEFAULT_LOOK);
  const [notice, setNotice] = useState('');
  const media = useRef(null);
  const provider = useRef(music); provider.current = music;
  const initialized = useRef(false);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add('music-canvas-open');
    const applyLocation = () => {
      setMobile(media.current.matches);
      const params = new URLSearchParams(window.location.search);
      const next = params.get('tab');
      const prefs = readSessionCache('jash:music:screen:v1');
      const wanted = next || prefs?.tab;
      if (LIBRARY_TABS.some((item) => item.id === wanted)) setTabState(wanted);
      // Explicit URL/history choices win; a bare /music always starts in Library.
      const open = params.get('library') !== '0';
      setLibraryOpen(open);
      setFull(params.get('focus') !== '0');
      setMode(params.get('view') === 'artwork' ? 'artwork' : 'lyrics');
    };
    media.current = window.matchMedia('(max-width: 1023px)');
    applyLocation();
    const prefs = readSessionCache('jash:music:screen:v1');
    if (prefs) setQuery(prefs.query || '');
    setRestored(true);
    const resize = () => { applyLocation(); };
    media.current.addEventListener('change', resize);
    window.addEventListener('popstate', applyLocation);
    try {
      const saved = JSON.parse(localStorage.getItem('jash_music_canvas') || '{}');
      const migrated = localStorage.getItem('jash_music_cinema_default_v1') === '1';
      const canvas = migrated && ['bloom', 'cinema', 'noir'].includes(saved.canvas) ? saved.canvas : 'cinema';
      localStorage.setItem('jash_music_canvas', JSON.stringify({ ...saved, canvas }));
      localStorage.setItem('jash_music_cinema_default_v1', '1');
      setLook({ canvas, size: Math.min(48, Math.max(22, Number(saved.size) || 34)), offset: Math.min(30, Math.max(-30, Number(saved.offset) || 0)), follow: saved.follow !== false, motion: saved.motion === true });
    } catch { /* storage unavailable */ }
    return () => { document.documentElement.classList.remove('music-canvas-open'); media.current.removeEventListener('change', resize); window.removeEventListener('popstate', applyLocation); };
  }, []);
  useEffect(() => { if (restored) writeSessionCache('jash:music:screen:v1', { tab, query }); }, [tab, query, restored]);
  const update = (patch) => setLook((old) => { const value = { ...old, ...patch }; try { localStorage.setItem('jash_music_canvas', JSON.stringify(value)); } catch { /* storage unavailable */ } return value; });
  const locationState = (nextTab, open, push = true, focus = full, view = mode) => {
    const url = new URL(window.location.href); url.searchParams.set('tab', nextTab);
    url.searchParams.set('library', open ? '1' : '0');
    url.searchParams.set('focus', focus ? '1' : '0');
    url.searchParams.set('view', view);
    window.history[push ? 'pushState' : 'replaceState'](window.history.state, '', url.pathname + url.search);
  };
  const setTab = (id) => { setTabState(id); locationState(id, libraryOpen); };
  const showLibrary = (value) => { setLibraryOpen(value); locationState(tab, value); };
  const showLyrics = (focus = true) => { setLibraryOpen(false); setFull(focus); setMode('lyrics'); locationState(tab, false, true, focus, 'lyrics'); };
  const showArtwork = () => { setLibraryOpen(false); setMode('artwork'); setFull(false); locationState(tab, false, true, false, 'artwork'); };
  /**
   * The Artwork/Lyrics choice. While focus is locked the choice still changes what stays
   * sharp, but it must not change the layout or add a history entry — that would give the
   * Back button something to pop other than the lock itself.
   */
  const chooseView = (view) => {
    if (pocketLocked) {
      setMode(view);
      locationState(tab, false, false, true, view);
      return;
    }
    if (view === 'artwork') showArtwork(); else showLyrics(true);
  };
  useEffect(() => {
    if (!initialized.current) { initialized.current = true; return; }
    const timer = setTimeout(() => provider.current.setQuery(query), 320);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 2400); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const keyboard = (event) => {
      if (pocketLocked) return;
      if (event.key === 'Escape' && !overlay) { if (libraryOpen) showLibrary(false); else if (full) showLyrics(false); }
      if (event.code === 'Space' && !overlay && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(event.target.tagName)) { event.preventDefault(); provider.current.togglePlay(); }
    };
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [overlay, libraryOpen, tab, pocketLocked, full, mode]);
  // ── focus mode (the lock button) ──────────────────────────────────────────
  /**
   * One button, three effects: blur every layer except the lyrics/sleeve, lock touches, and
   * ask the browser to keep the screen awake. The pre-focus layout is remembered so unlocking
   * puts the screen back exactly as it was.
   */
  const pocketReturn = useRef(null);
  const pocketRef = useRef(false); pocketRef.current = pocketLocked;
  const awake = useWakeLock(pocketLocked);

  function enterPocket() {
    if (!playing) return;
    pocketReturn.current = { full, mode, libraryOpen, tab };
    setOverlay('');
    setLibraryOpen(false);
    setFull(true);            // focus layout; the Artwork/Lyrics choice is kept as it is
    setPocketLocked(true);
    // One history entry, so Back leaves focus instead of leaving the Music section.
    try { window.history.pushState({ ...window.history.state, jvFocus: 1 }, '', window.location.href); } catch { /* history unavailable */ }
    // And keep the URL honest about the locked layout (replace, not push: the entry above is the
    // one Back should pop). Without this, a rotate re-reads the old params and re-opens the library
    // underneath the blur.
    locationState(tab, false, false, true, mode);
  }

  function exitPocket(fromHistory = false) {
    if (!pocketRef.current) return;
    const back = pocketReturn.current;
    pocketReturn.current = null;
    setPocketLocked(false);
    if (back) { setFull(back.full); setLibraryOpen(back.libraryOpen); setMode(back.mode); }
    // A gesture exit has to give back the history entry we pushed; a Back exit is already there.
    if (!fromHistory) {
      locationState(back?.tab || tab, back?.libraryOpen ?? false, false, back?.full ?? false, back?.mode || mode);
      try { window.history.back(); } catch { /* history unavailable */ }
    }
  }

  useEffect(() => {
    const onPop = () => { if (pocketRef.current) exitPocket(true); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const libraryRef = useRef(null), savedFocus = useRef(null);
  useEffect(() => {
    if (!libraryOpen || !mobile) return;
    savedFocus.current = document.activeElement;
    const background = document.querySelector('.mc-player');
    if (background) background.inert = true;
    libraryRef.current?.querySelector('button')?.focus();
    const trap = (event) => {
      if (event.key !== 'Tab' || overlay) return;
      const elements = [...document.querySelectorAll('.mc-library-dock button, .mc-library-dock input, .mc-library-dock select, .mc-library-dock [tabindex="0"], .mc-transport button, .mc-transport input, .mc-top-actions button, .mobile-dock a')].filter((node) => !node.disabled && node.getClientRects().length);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); if (background) background.inert = false; savedFocus.current?.focus?.(); };
  }, [libraryOpen, overlay, mobile]);
  const play = (track, tracks) => {
    if (!track) return;
    music.playTrack(track, tracks, true);
    setOverlay('');
    showLyrics(true);
    setNotice(`Playing ${track.title || 'track'}`);
  };
  const playing = music.playingTrack;
  const favorite = music.favoriteSet?.has(music.activeKey);
  const image = playing?.image || '';
  const quality = QUALITY_LABELS[music.quality] || music.quality || 'Source quality';

  return <main className={`mc-app mc-style-${look.canvas} ${libraryOpen ? 'is-library-open' : ''} ${full ? 'is-focus' : ''} ${pocketLocked ? 'is-pocket' : ''}`} style={{ '--mc-art': image ? `url(${JSON.stringify(image)})` : 'none' }}>
    <div className="mc-app-content">
      <RailNav />
      <MobileDock />
      <div className="mc-canvas">
        <header className="mc-topbar"><SectionLink href="/" className="mc-brand">JaSH ViBeS <small>MUSIC</small></SectionLink><span className="mc-top-subtitle">Your music. Your moment.</span><div className="mc-top-actions"><IconButton icon="library" label={libraryOpen ? 'Close Library' : 'Open Library'} active={libraryOpen} className="mc-library-toggle" onClick={() => showLibrary(!libraryOpen)}/><button type="button" className="mc-header-button" onClick={() => setOverlay('queue')}><MusicIcon name="queue"/><span>Queue</span></button><button type="button" className="mc-header-button" onClick={() => setOverlay('settings')}><MusicIcon name="settings"/><span>Settings</span></button></div></header>
        <div className="mc-workspace">
          <div ref={libraryRef} className="mc-library-dock" {...(libraryOpen ? { role: 'region', 'aria-label': 'Library browsing sheet' } : {})}><CanvasLibrary music={music} tab={tab} setTab={setTab} query={query} setQuery={setQuery} onPlay={play} onClose={() => showLibrary(false)}/></div>
          <div className={`mc-player ${mode === 'artwork' ? 'is-artwork-mode' : ''}`}>
            <section className="mc-now" aria-label="Now playing"><Cover item={playing} className={`mc-now-art mc-vinyl ${music.isPlaying ? 'is-spinning' : ''}`}/><div className="mc-now-text"><h1>{playing?.title || 'Find your next favourite'}</h1><p>{playing?.artists || 'Open the Library to choose a song'}</p>{playing ? <small>{quality}{music.playerStatus === 'loading' ? ' · Connecting…' : ''}</small> : <small>Tamil music · One uninterrupted queue</small>}</div></section>
            <CanvasLyrics music={music} look={look} update={update} full={full} onExpand={() => showLyrics(!full)} onSettings={() => setOverlay('settings')}/>
            <div className="mc-player-modes" role="group" aria-label="Player view">{/* Stays sharp and live while focus is locked: it is the one control that changes what the lock shows. */}<button type="button" aria-pressed={mode === 'artwork'} onClick={() => chooseView('artwork')}>Artwork</button><button type="button" aria-pressed={mode === 'lyrics'} onClick={() => chooseView('lyrics')}>Lyrics</button></div>
          </div>
        </div>
        <footer className="mc-transport" aria-label="Playback controls">
          {music.playerStatus === 'error' ? <div className="mc-play-error" role="alert"><span>{music.error || 'Playback unavailable'}</span><button type="button" onClick={music.retryTrack}>Retry</button><button type="button" onClick={() => music.playNext()}>Skip</button></div> : null}
          <div className="mc-seek"><span>{formatTime(music.currentTime)}</span><input type="range" aria-label="Playback position" aria-valuetext={`${formatTime(music.currentTime)} of ${formatTime(music.duration)}`} min="0" max={music.duration || 1} step="0.1" value={Math.min(music.currentTime || 0, music.duration || 1)} disabled={!music.duration} onChange={(event) => music.seekTo(Number(event.target.value))}/><span>{formatTime(music.duration)}</span></div>
          <div className="mc-transport-row"><button type="button" className="mc-mini-info" onClick={() => { if (libraryOpen) showLibrary(false); setMode('lyrics'); }} aria-label="Return to player"><Cover item={playing}/><span><strong>{playing?.title || 'Nothing playing'}</strong><small>{playing?.artists || 'Choose a song'}</small></span></button><div className="mc-transport-main"><IconButton icon="shuffle" label="Shuffle" active={music.shuffleEnabled} onClick={() => music.setShuffleEnabled(!music.shuffleEnabled)} disabled={!playing}/><IconButton icon="previous" label="Previous track" onClick={music.playPrevious} disabled={!playing}/><IconButton icon={music.isPlaying ? 'pause' : 'play'} label={music.isPlaying ? 'Pause' : 'Play'} className="mc-primary-play" onClick={music.togglePlay} disabled={!playing}/><IconButton icon="next" label="Next track" onClick={() => music.playNext()} disabled={!playing}/><IconButton icon="repeat" label={`Repeat: ${music.repeatMode}`} active={music.repeatMode !== 'off'} onClick={music.cycleRepeat} disabled={!playing}>{music.repeatMode === 'one' ? <sup>1</sup> : null}</IconButton><IconButton icon="heart" label={favorite ? 'Remove current track from favourites' : 'Save current track'} active={Boolean(favorite)} onClick={() => music.toggleFavorite(playing)} disabled={!playing}/><IconButton icon="lock" label="Focus: blur everything but the lyrics or sleeve, lock touches, keep the screen awake" className="mc-pocket-button" onClick={enterPocket} disabled={!playing}/></div><label className="mc-volume"><MusicIcon name="volume"/><span className="sr-only">Volume</span><input type="range" min="0" max="1" step="0.01" value={music.muted ? 0 : music.volume} onChange={(event) => music.changeVolume(Number(event.target.value))}/></label></div>
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
    {pocketLocked ? <PocketLock awake={awake} onUnlock={() => exitPocket()}/> : null}
    <div className={`mc-notice ${notice ? 'is-visible' : ''}`} role="status" aria-live="polite">{notice}</div>
  </main>;
}
