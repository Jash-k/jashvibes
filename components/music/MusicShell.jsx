'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import RailNav from '@/components/rail/RailNav';
import { useMusic } from './MusicProvider';
import { formatTime, QUALITY_LABELS, trackKey } from '@/lib/musicCore';
import { useLyricLook } from './lyricLook';
import { Art, Toast, TrackList } from './MusicBits';
import { MusicHome, MusicLibrary, MusicPlayer, MusicSettings } from './MusicScreens';
import MusicLyrics from './MusicLyrics';

/*
 * The music section screen.
 *
 * Shape: one shell, five views (Home, Library, Playing, Lyrics, Settings) plus search.
 * The provider underneath is untouched — same engine, same queue, same routes — so
 * every action here is the action the old screen called.
 *
 * Day/night is inherited from the app header, not duplicated here. The left rail is the
 * app's own RailNav, kept so the section still sits inside the product.
 */

const SCREENS = [
  { id: 'home', label: 'Home' },
  { id: 'library', label: 'Library' },
  { id: 'player', label: 'Playing' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'settings', label: 'Settings' },
];

const FACETS = [
  { id: 'albums', label: 'Albums', go: ['library', 'albums'], path: '<rect x="3" y="3.5" width="7" height="7" rx="1.6"/><rect x="14" y="3.5" width="7" height="7" rx="1.6"/><rect x="3" y="13.5" width="7" height="7" rx="1.6"/><rect x="14" y="13.5" width="7" height="7" rx="1.6"/>' },
  { id: 'artists', label: 'Artists', go: ['library', 'artists'], path: '<circle cx="12" cy="8.4" r="3.6"/><path d="M4.8 20c1-3.6 3.9-5.6 7.2-5.6S18.2 16.4 19.2 20"/>' },
  { id: 'playlists', label: 'Playlists', go: ['library', 'playlists'], path: '<path d="M4 6h11M4 11h11M4 16h7"/><circle cx="17.5" cy="16.5" r="2.6"/><path d="M20.1 16.5V9.4l1.4-.4"/>' },
  { id: 'trending', label: 'Trending', go: ['library', 'trending'], path: '<path d="M12 3.5c3.4 3.2 5.4 5.8 5.4 9a5.4 5.4 0 1 1-10.8 0c0-1.7.7-3 1.8-4.3.4 1 1.2 1.7 2 1.7.2-2.5.6-4.5 1.6-6.4Z"/>' },
  { id: 'new', label: 'New', go: ['library', 'new'], path: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 9.6h17M8 3.5v3M16 3.5v3"/>' },
  { id: 'favorites', label: 'Favourites', go: ['favorites'], path: '<path d="M12 20s-7.4-4.3-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.5C19.4 15.7 12 20 12 20Z"/>' },
  { id: 'recents', label: 'Recent', go: ['recents'], path: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3.4 2"/>' },
];

const TITLES = {
  home: ['Home', 'JaSH ViBeS'],
  library: ['Library', 'Albums · Artists · Playlists'],
  player: ['Now playing', ''],
  lyrics: ['Lyrics', ''],
  settings: ['Settings', 'Music'],
  search: ['Search', 'Songs · Albums · Artists'],
  favorites: ['Favourites', 'Saved on this device'],
  recents: ['Recently played', 'Your last 12 songs'],
};

export default function MusicShell() {
  const music = useMusic();
  const { look, update, reset, step, nudgeOffset } = useLyricLook();

  const [screen, setScreen] = useState('home');
  const [libTab, setLibTab] = useState('albums');
  const [query, setQuery] = useState('');
  const [queueOpen, setQueueOpen] = useState(false);
  const [message, setMessage] = useState('');

  const notify = useCallback((text) => setMessage(`${text}:${Date.now()}`), []);
  const toastText = message ? message.split(':')[0] : '';

  const searchRef = useRef(null);
  const setQueryInProvider = useRef(null);
  setQueryInProvider.current = music.setQuery;

  const go = useCallback((next, tab) => {
    if (next === 'queue') { setQueueOpen(true); return; }
    if (tab) setLibTab(tab);
    setScreen(next);
    setQueueOpen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  /* Search is debounced into the provider: one request per pause, not per keystroke,
     and the query is cleared when the field empties so stale results never linger. */
  useEffect(() => {
    const handle = setTimeout(() => { setQueryInProvider.current?.(query); }, 320);
    return () => clearTimeout(handle);
  }, [query]);

  const openCollection = useCallback((kind, item) => {
    if (!item) return;
    go('library');
    if (kind === 'playlist') music.openPlaylist?.(item);
    else if (kind === 'artist') music.openArtist?.(item);
    else music.openAlbum?.(item);
  }, [go, music]);

  const playTrack = useCallback((track, list) => {
    if (!track) return;
    const queue = Array.isArray(list) && list.length ? list : [track];
    music.playTrack?.(track, queue, true);
    notify(`Playing ${track.title || 'track'}`);
  }, [music, notify]);

  const onFacet = useCallback((facet) => {
    const [next, tab] = facet.go;
    go(next, tab);
    if (next === 'library') {
      if (tab === 'trending') music.loadTrending?.('Tamil');
      if (tab === 'new') music.loadFresh?.();
      if (tab === 'artists') music.loadFacet?.('artists');
      if (tab === 'playlists') music.loadFacet?.('playlists');
    }
  }, [go, music]);

  const [title, kicker] = TITLES[screen] || ['Music', ''];
  const playing = music.playingTrack;
  const favourite = music.favoriteSet?.has(music.activeKey);
  const showNowBar = Boolean(playing) && screen !== 'player' && screen !== 'lyrics';

  return (
    <main className="mu2" data-screen={screen}>
      <RailNav onOpenSearch={() => { go('search'); setTimeout(() => searchRef.current?.focus(), 60); }} />

      <div className="mu2-shell">
        <header className="mu2-topbar">
          <button type="button" className="mu2-icon-btn is-burger" aria-label="Open the library" onClick={() => go('library')}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <h1>{title}<small>{screen === 'player' || screen === 'lyrics' ? (playing?.title || '') : kicker}</small></h1>
          <label className="mu2-search">
            <span className="sr-only">Search music</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.4" /><path d="M16 16l4.2 4.2" /></svg>
            <input
              ref={searchRef}
              value={query}
              placeholder="Songs, albums, artists…"
              onFocus={() => go('search')}
              onChange={(event) => { setQuery(event.target.value); if (screen !== 'search') go('search'); }}
            />
          </label>
          <button type="button" className="mu2-icon-btn" aria-label="Settings" onClick={() => go('settings')}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" />
            </svg>
          </button>
        </header>

      <nav className="mu2-tabbar" aria-label="Music sections">
        {SCREENS.map((item) => (
          <button key={item.id} type="button" aria-current={screen === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

        <nav className="mu2-facets" aria-label="Quick library facets">
          {FACETS.map((facet) => (
            <button key={facet.id} type="button" className="mu2-facet" onClick={() => onFacet(facet)}
              aria-pressed={screen === 'library' && facet.go[1] === libTab}>
              <span className="mu2-facet-b">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: facet.path }} />
              </span>
              <span>{facet.label}</span>
            </button>
          ))}
        </nav>

        {screen === 'home' ? <MusicHome music={music} onOpen={openCollection} onPlay={playTrack} onGo={go} /> : null}
        {screen === 'library' ? <MusicLibrary music={music} onOpen={openCollection} onPlay={playTrack} tab={libTab} setTab={setLibTab} /> : null}
        {screen === 'player' ? <MusicPlayer music={music} onPlay={playTrack} notify={notify} onGo={go} /> : null}
        {screen === 'lyrics' ? (
          <MusicLyrics music={music} look={look} updateLook={update} stepLook={step} nudgeOffset={nudgeOffset} notify={notify} onGo={go} />
        ) : null}
        {screen === 'settings' ? <MusicSettings music={music} look={look} updateLook={update} resetLook={reset} notify={notify} /> : null}

        {screen === 'search' ? (
          <div className="mu2-screen">
            <h2 className="mu2-big">{query ? `Results for “${query}”` : 'Search the catalogue'}</h2>
            {music.searchStatus === 'loading' ? <p className="mu2-lede" role="status">Searching…</p> : null}
            {!query ? <p className="mu2-lede">Type a song, album or artist. Tamil script and English both work.</p> : null}
            {query && music.searchStatus === 'ready' ? (
              <>
                <TrackList tracks={music.searchResults?.songs || []} music={music} onPlay={playTrack} showQuality
                  emptyTitle="No songs matched" emptyBody="Try fewer words, or the composer’s name." />
                {(music.searchResults?.albums || []).length ? (
                  <>
                    <h3 className="mu2-h3">Albums</h3>
                    <div className="mu2-grid">
                      {(music.searchResults.albums || []).map((item, index) => (
                        <button key={item.id || index} type="button" className="mu2-card" onClick={() => openCollection('album', item)}>
                          <span className="mu2-card-art"><Art item={item} /></span>
                          <span className="mu2-card-t"><strong>{item.title || 'Untitled'}</strong><small>{item.artists || ''}</small></span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {screen === 'favorites' ? (
          <div className="mu2-screen">
            <h2 className="mu2-big">Favourites</h2>
            <p className="mu2-lede">Saved on this device, and the only personal list the section keeps.</p>
            <TrackList tracks={music.favoriteTracks || []} music={music} onPlay={playTrack} showQuality
              emptyTitle="No favourites yet"
              emptyBody="Tap the heart on any row and it lands here."
              emptyAction={<button type="button" className="mu2-btn" onClick={() => go('library')}>Browse the library</button>} />
          </div>
        ) : null}

        {screen === 'recents' ? (
          <div className="mu2-screen">
            <h2 className="mu2-big">Recently played</h2>
            <p className="mu2-lede">Held in memory for this device only — no history is written anywhere.</p>
            <TrackList tracks={music.recents || []} music={music} onPlay={playTrack} showQuality
              emptyTitle="Nothing played yet" emptyBody="Play a song and it appears here." />
          </div>
        ) : null}
      </div>

      {showNowBar && playing ? (
        <div className="mu2-nowbar">
          <button type="button" className="mu2-nowbar-main" onClick={() => go('player')} aria-label={`Open the player — ${playing.title || 'current track'}`}>
            <Art item={playing} className="mu2-art-sm" />
            <span className="mu2-nowbar-t">
              <strong>{playing.title || 'Untitled'}</strong>
              <small>{playing.artists || ''}</small>
              <span className="mu2-mono">{QUALITY_LABELS[music.quality] || music.quality || 'Auto'} · {formatTime(music.duration || 0)}</span>
            </span>
          </button>
          <button type="button" className="mu2-icon-btn" aria-pressed={Boolean(favourite)}
            aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={() => music.toggleFavorite?.(playing)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill={favourite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20s-7.4-4.3-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.5C19.4 15.7 12 20 12 20Z" />
            </svg>
          </button>
          <button type="button" className="mu2-icon-btn is-play" aria-label={music.isPlaying ? 'Pause' : 'Play'}
            onClick={() => music.togglePlay?.()}>
            {music.isPlaying
              ? <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5h3.4v15H7zM13.6 4.5H17v15h-3.4z" /></svg>
              : <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 4.5l13 7.5-13 7.5z" /></svg>}
          </button>
          <span className="mu2-nowbar-prog" aria-hidden="true">
            <i style={{ width: `${music.duration ? Math.min(100, (music.currentTime / music.duration) * 100) : 0}%` }} />
          </span>
        </div>
      ) : null}

      {queueOpen ? (
        <div className="mu2-scrim" onClick={(event) => { if (event.target.classList.contains('mu2-scrim')) setQueueOpen(false); }}>
          <section className="mu2-sheet" role="dialog" aria-modal="true" aria-label="Music queue">
            <header className="mu2-sheet-h">
              <div><h2>Up next</h2><p>{music.queueTracks?.length || 0} tracks queued</p></div>
              <button type="button" className="mu2-icon-btn" onClick={() => setQueueOpen(false)} aria-label="Close">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </header>
            <TrackList tracks={music.queueTracks || []} music={music} onPlay={playTrack} showArt={false} showQuality
              emptyTitle="The queue is empty" emptyBody="Play an album, or add tracks from any row." />
          </section>
        </div>
      ) : null}

      <Toast message={message ? toastText : ''} />
    </main>
  );
}
