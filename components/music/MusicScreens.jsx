'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatTime, isHlsUrl, QUALITY_LABELS, trackKey } from '@/lib/musicCore';
import { Art, CollectionCard, CollectionGrid, SectionHead, StateBox, TrackList } from './MusicBits';
import { LYRIC_CANVASES, LYRIC_FACES, LYRIC_SIZES } from './lyricLook';

/*
 * Home, Library, Now playing and Settings — the four screens that are not lyrics.
 *
 * Day/night is deliberately NOT repeated here: the app already ships one toggle in its
 * global header (components/AuthGate.js, `jash_theme_mode` + `html.day-mode`). A second
 * switch would fight it, so this whole section just follows whatever the app is set to.
 */

const GREETING = () => {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Late night';
};

/* ── Home ──────────────────────────────────────────────────────────────────── */

export function MusicHome({ music, onOpen, onPlay, onGo }) {
  const [trending, setTrending] = useState([]);
  const loadTrending = useRef(null);
  loadTrending.current = music.loadTrending;
  const loaded = useRef(false);

  // Trending is its own route and is not part of /home: fetch it once, after first
  // paint, so the home screen is never waiting on it.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    Promise.resolve(loadTrending.current?.('Tamil')).then((items) => {
      if (Array.isArray(items)) setTrending(items);
    }).catch(() => {});
  }, []);

  const home = music.home || {};
  const sections = Array.isArray(home.sections) ? home.sections : [];
  const albums = home.releases?.albums?.length ? home.releases.albums : [];
  const newTracks = home.releases?.tracks || [];
  const recents = (music.recents || []).filter(Boolean);
  const top = (music.favoriteTracks || []).filter(Boolean);
  const pending = music.status === 'loading' && !sections.length;

  const openItem = (item) => {
    // Section items can be albums, playlists or plain tracks — route by shape.
    if (item.type === 'playlist' || item.kind === 'playlist') return onOpen('playlist', item);
    if (Array.isArray(item.songs)) return onOpen('playlist', item);
    if (item.type === 'track' || item.trackId) return onPlay?.(item, [item]);
    return onOpen('album', item);
  };

  return (
    <div className="mu2-screen">
      <section className="mu2-sec">
        <p className="mu2-eyebrow">{GREETING()}</p>
        <h2 className="mu2-big">
          {pending ? 'Waking the library' : sections.length || albums.length ? 'Everything Tamil, one queue' : 'Your library is empty'}
        </h2>
        <p className="mu2-lede">
          {pending ? 'Fetching the catalogue — nothing here blocks the player.'
            /* Count what the payload actually carries. The old line said "0 playlists"
               here because it counted the imported-playlists field, which only ever
               holds what the owner imported — the playlist catalogue lives in its own
               facet, one tap away. */
            : `${albums.length} albums · ${(home.artists || []).length} artists · ${newTracks.length} new tracks`}
        </p>
      </section>

      {music.error ? <StateBox tone="error" title="The catalogue did not load" body={music.error} onRetry={() => music.loadHome?.()} /> : null}
      {!pending && !music.error && !sections.length && !albums.length ? (
        <StateBox tone="empty" title="No albums yet"
          body="The catalogue routes came back empty. Search and imported playlists still work."
          onRetry={() => music.loadHome?.()} retryLabel="Retry the catalogue" />
      ) : null}

      {recents.length ? (
        <section className="mu2-sec">
          <SectionHead title="Jump back in" meta="your recents" />
          <div className="mu2-rail">
            {recents.slice(0, 8).map((item, index) => (
              <CollectionCard key={trackKey(item) || index} item={item} kind="track" onOpen={() => onPlay?.(item, recents)} />
            ))}
          </div>
        </section>
      ) : null}

      {albums.length ? (
        <section className="mu2-sec">
          <SectionHead title="Recently added" meta={`${albums.length} albums`}
            action={<button type="button" className="mu2-more" onClick={() => onGo?.('library')}>Library →</button>} />
          <div className="mu2-grid">
            {albums.slice(0, 8).map((item, index) => (
              <CollectionCard key={item.id || index} item={item} kind="album" onOpen={() => onOpen('album', item)} />
            ))}
          </div>
        </section>
      ) : null}

      {top.length ? (
        <section className="mu2-sec">
          <SectionHead title="Your top tracks" meta={`${top.length} favourites`} />
          <TrackList tracks={top.slice(0, 6)} music={music} onPlay={onPlay} showArt={false} showQuality />
        </section>
      ) : null}

      {trending.length ? (
        <section className="mu2-sec">
          <SectionHead title="Trending now" meta="Tamil" action={
            <button type="button" className="mu2-more" onClick={() => onGo?.('library', 'trending')}>See all →</button>} />
          <div className="mu2-rail">
            {trending.slice(0, 10).map((item, index) => (
              <CollectionCard key={trackKey(item) || index} item={item} rank={index + 1} kind="track"
                onOpen={() => onPlay?.(item, trending)} />
            ))}
          </div>
        </section>
      ) : null}

      {sections.slice(0, 3).map((section) => (
        <section className="mu2-sec" key={section.id}>
          <SectionHead title={section.title} meta={`${(section.items || []).length} items`} />
          {section.type === 'tracks' ? (
            <TrackList tracks={(section.items || []).slice(0, 6)} music={music} onPlay={onPlay} showArt={false} />
          ) : (
            <div className="mu2-rail">
              {(section.items || []).slice(0, 10).map((item, index) => (
                <CollectionCard key={item.id || index} item={item} onOpen={() => openItem(item)} />
              ))}
            </div>
          )}
        </section>
      ))}

      {newTracks.length ? (
        <section className="mu2-sec">
          <SectionHead title="New releases" meta={`${newTracks.length} tracks`} />
          <TrackList tracks={newTracks.slice(0, 6)} music={music} onPlay={onPlay} showArt={false} showQuality />
        </section>
      ) : null}

      {(home.importedPlaylists || []).length ? (
        <section className="mu2-sec">
          <SectionHead title="Imported playlists" meta="from the owner panel" />
          <div className="mu2-grid">
            {home.importedPlaylists.map((item, index) => (
              <CollectionCard key={item.id || index} item={item} kind="playlist" onOpen={() => onOpen('playlist', item)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ── Library ───────────────────────────────────────────────────────────────── */

const LIB_TABS = [
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
];

const CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'favorites', label: 'Favourites' },
  { id: 'hq', label: '320k only' },
];

const SORTS = [
  { id: 'az', label: 'A–Z' },
  { id: 'added', label: 'Added' },
];

export function MusicLibrary({ music, onOpen, onPlay, tab, setTab }) {
  const [chip, setChip] = useState('all');
  const [sort, setSort] = useState('az');
  const [detailTab, setDetailTab] = useState('albums');
  const facet = music.facet || {};
  const list = music.facetLists || {};
  const detail = music.selectedCollection;

  // The album facet is the one the section opens on; load it the first time the
  // library is shown rather than on mount, so Home stays the fast path.
  const loadFacet = useRef(null);
  loadFacet.current = music.loadFacet;
  const asked = useRef(new Set());

  const active = tab === 'playlists' ? 'playlists' : tab === 'artists' ? 'artists' : tab === 'trending' ? 'trending' : tab === 'new' ? 'new' : 'albums';

  useEffect(() => {
    if (active === 'trending' || active === 'new') return;
    if (asked.current.has(active)) return;
    asked.current.add(active);
    loadFacet.current?.(active);
  }, [active]);

  /* `music` is a new object every render, so it can never be a dependency here.
     Hold the loaders in a ref and key the effect on the tab alone. */
  const loaders = useRef({ trending: null, fresh: null });
  loaders.current.trending = music.loadTrending;
  loaders.current.fresh = music.loadFresh;

  useEffect(() => {
    if (active === 'trending') loaders.current.trending?.('Tamil');
    if (active === 'new') loaders.current.fresh?.();
  }, [active]);

  const albums = useMemo(() => {
    let items = Array.isArray(list.albums) ? [...list.albums] : [];
    if (chip === 'favorites') {
      const favKeys = new Set((music.favoriteTracks || []).map((track) => track.album).filter(Boolean));
      items = items.filter((album) => favKeys.has(album.title) || favKeys.has(album.name));
    }
    if (chip === 'hq') items = items.filter((album) => Number(album.songCount || 0) > 0);
    if (sort === 'az') items.sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
    return items;
  }, [list.albums, chip, sort, music.favoriteTracks]);

  const songs = music.allShelfSongs || [];

  if (detail) {
    const tracks = detail.tracks || [];
    return (
      <div className="mu2-screen">
        <button type="button" className="mu2-btn" onClick={() => music.backToAlbums?.()}>← {detail.type === 'playlist' ? 'Playlists' : detail.type === 'artist' ? 'Artists' : 'Albums'}</button>
        <div className="mu2-detail">
          <Art item={detail} className="mu2-art-lg" />
          <div className="mu2-detail-t">
            <p className="mu2-eyebrow">{detail.type}</p>
            <h2 className="mu2-big">{detail.title || detail.name || 'Untitled'}</h2>
            <p className="mu2-detail-sub">{detail.artists || detail.subtitle || ''}</p>
            <p className="mu2-mono">
              {tracks.length} loaded{detail.songCount && Number(detail.songCount) !== tracks.length ? ` / ${detail.songCount} declared` : ''}
              {detail.language ? ` · ${detail.language}` : ''}
            </p>
            {tracks.length ? (
              <div className="mu2-btn-row">
                <button type="button" className="mu2-btn is-primary" onClick={() => onPlay?.(tracks[0], tracks)}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M7 4.5l13 7.5-13 7.5z" /></svg>Play all
                </button>
                <button type="button" className="mu2-btn" onClick={() => { tracks.forEach((track) => music.addToQueue?.(track)); }}>Add to queue</button>
              </div>
            ) : null}
          </div>
        </div>

        {music.collectionStatus === 'loading' ? <p className="mu2-lede" role="status">Loading this collection’s tracks…</p> : null}
        {music.collectionStatus === 'error' ? (
          <StateBox tone="error" title="That collection did not load" body={detail.error || music.error}
            onRetry={() => (detail.type === 'playlist' ? music.openPlaylist?.(detail) : detail.type === 'artist' ? music.openArtist?.(detail) : music.openAlbum?.(detail))} />
        ) : null}

        {tracks.length ? <TrackList tracks={tracks} music={music} onPlay={onPlay} showQuality /> : music.collectionStatus === 'ready' ? (
          <StateBox tone="empty" title="No tracks came back"
            body="The provider declared this collection but supplied no tracks. The row above still plays nothing — pick another album." />
        ) : null}

        {detail.albums?.length ? (
          <>
            <SectionHead title="Appears on" />
            <div className="mu2-rail">
              {detail.albums.map((item, index) => <CollectionCard key={item.id || index} item={item} onOpen={() => onOpen('album', item)} />)}
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mu2-screen">
      <div className="mu2-tabs" role="tablist">
        {LIB_TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={active === item.id}
            className="mu2-tab" onClick={() => setTab(item.id)}>{item.label}</button>
        ))}
      </div>

      {active === 'albums' ? (
        <>
          <div className="mu2-chips" role="group" aria-label="Filters">
            {CHIPS.map((item) => (
              <button key={item.id} type="button" className="mu2-chip" aria-pressed={chip === item.id} onClick={() => setChip(item.id)}>{item.label}</button>
            ))}
          </div>
          <SectionHead title="Albums" meta={`${albums.length} shown`} action={
            <span className="mu2-seg">
              {SORTS.map((item) => (
                <button key={item.id} type="button" aria-pressed={sort === item.id} onClick={() => setSort(item.id)}>{item.label}</button>
              ))}
            </span>
          } />
          {facet.status === 'loading' && !albums.length ? <p className="mu2-lede" role="status">Loading albums…</p> : null}
          {facet.status === 'error' ? <StateBox tone="error" title="Albums did not load" body={facet.error} onRetry={() => music.loadFacet?.('albums')} /> : null}
          {chip !== 'all' && !albums.length && facet.status !== 'loading' ? (
            <StateBox tone="empty" title="Nothing matches that filter"
              body={`The ${chip === 'hq' ? 'bitrate' : 'favourites'} filter is on and no album matches it.`}>
              <button type="button" className="mu2-btn" onClick={() => setChip('all')}>Clear filter</button>
            </StateBox>
          ) : (
            <CollectionGrid items={albums} kind="album" onOpen={(item) => onOpen('album', item)} />
          )}
        </>
      ) : null}

      {active === 'artists' ? (
        <>
          {facet.status === 'error' ? <StateBox tone="error" title="Artists did not load" body={facet.error} onRetry={() => music.loadFacet?.('artists')} /> : null}
          <CollectionGrid items={list.artists || []} kind="artist" onOpen={(item) => onOpen('artist', item)}
            emptyTitle="No artists yet" emptyBody="The artists facet came back empty." />
        </>
      ) : null}

      {active === 'playlists' ? (
        <>
          <SectionHead title="Playlists" meta={`${(list.playlists || []).length + (music.home?.importedPlaylists || []).length} total`} />
          <CollectionGrid
            items={[...(music.home?.importedPlaylists || []), ...(list.playlists || [])]}
            kind="playlist" onOpen={(item) => onOpen('playlist', item)}
            emptyTitle="No playlists yet"
            emptyBody="Imported playlists arrive from the owner panel; saved ones from the player."
          />
        </>
      ) : null}

      {active === 'trending' ? (
        <>
          <SectionHead title="Trending now" meta="Tamil" />
          <TrackList tracks={music.trending || []} music={music} onPlay={onPlay} showQuality
            emptyTitle="Nothing trending yet" emptyBody="The trending route came back empty." />
        </>
      ) : null}

      {active === 'new' ? (
        <>
          <SectionHead title="New releases" />
          <CollectionGrid items={music.fresh?.albums || []} kind="album" onOpen={(item) => onOpen('album', item)}
            emptyTitle="No new releases" emptyBody="The new-releases route came back empty." />
          <TrackList tracks={music.fresh?.tracks || []} music={music} onPlay={onPlay} showArt={false} showQuality
            emptyTitle="No new tracks" emptyBody="" />
        </>
      ) : null}

      {active === 'albums' && songs.length ? (
        <section className="mu2-sec">
          <SectionHead title="Everything loaded" meta={`${songs.length} tracks`} />
          <TrackList tracks={songs.slice(0, 40)} music={music} onPlay={onPlay} showArt={false} showQuality />
        </section>
      ) : null}
    </div>
  );
}

/* ── Now playing ───────────────────────────────────────────────────────────── */

/**
 * A decorative field of dots that breathes while the song plays. It is NOT an audio
 * analyser — there is no Web Audio graph behind it — so it is marked aria-hidden and
 * named honestly in the UI. It exists to give the screen a pulse while it plays.
 */
function SignalField({ playing }) {
  const ref = useRef(null);
  const raf = useRef(0);
  const state = useRef({ playing, t: performance.now() });
  state.current.playing = playing;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const draw = (now) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight || 70;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      const styles = getComputedStyle(document.documentElement);
      const accent = styles.getPropertyValue('--jv-accent, var(--brand)').trim() || '#a85454';
      const ok = styles.getPropertyValue('--ok').trim() || '#3ddc97';
      ctx.clearRect(0, 0, width, height);
      const columns = Math.max(20, Math.floor(width / 8));
      const rows = 5;
      const live = state.current.playing ? (now - state.current.t) / 1000 : state.current.t;
      for (let column = 0; column < columns; column += 1) {
        const phase = column * 1.7;
        const wave = (Math.sin(phase + live * 1.4) * 0.5 + 0.5) * (0.55 + 0.45 * Math.sin(phase * 0.37 + live * 0.8));
        const amp = 0.16 + wave * 0.7;
        for (let row = 0; row < rows; row += 1) {
          const fraction = (row + 1) / rows;
          if (fraction > amp + 0.14) continue;
          const y = height - 8 - row * ((height - 16) / (rows - 1));
          ctx.globalAlpha = Math.max(0.1, 1 - fraction * 0.38) * (state.current.playing ? 1 : 0.5);
          ctx.fillStyle = column / columns < 0.5 ? accent : ok;
          ctx.beginPath();
          ctx.arc(column * (width / columns) + 3.5, y, 1.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return <canvas className="mu2-viz" ref={ref} aria-hidden="true" />;
}

export function MusicPlayer({ music, onPlay, notify, onGo }) {
  const track = music.playingTrack;
  const queue = music.queueTracks || [];
  const chips = music.qualityChips || [];
  const duration = music.duration || 0;
  const [scrub, setScrub] = useState(null);
  const seeking = scrub != null;
  const shown = seeking ? scrub : Math.min(music.currentTime || 0, duration || 0);

  const qualityLabel = QUALITY_LABELS[music.quality] || music.quality || 'Auto';
  const streamUrl = track?.streamUrls?.[music.quality] || '';
  const transport = streamUrl && isHlsUrl(streamUrl) ? 'HLS' : 'progressive';

  if (!track) {
    return (
      <div className="mu2-screen">
        <StateBox tone="empty" title="Nothing playing yet"
          body="Choose a song from Home or the Library. The queue, the lyrics and the artwork all follow it.">
          <button type="button" className="mu2-btn" onClick={() => onGo?.('library')}>Browse albums</button>
        </StateBox>
      </div>
    );
  }

  const favourite = music.favoriteSet?.has(music.activeKey);

  const pct = duration ? Math.min(100, Math.max(0, (shown / duration) * 100)) : 0;

  return (
    <div className={`mu2-player ${music.isPlaying ? 'is-playing' : ''}`}>
      <div className="mu2-player-main">
        <div className="mu2-hero">
          <Art item={track} className="mu2-hero-art" />
          <span className="mu2-hero-tag">{qualityLabel}</span>
        </div>

        <h2 className="mu2-np-title">{track.title || 'Untitled'}</h2>
        <p className="mu2-np-sub">{track.artists || ''}{track.album ? ` · ${track.album}` : ''}</p>
        <p className="mu2-np-spec">
          <i aria-hidden="true" />
          <b>{qualityLabel}</b>
          <span>{transport}</span>
          {track.year ? <span>{track.year}</span> : null}
        </p>

        <div className="mu2-seek">
          <span className="mu2-mono">{formatTime(shown)}</span>
          <input
            type="range" min="0" max={duration || 1} step="0.1"
            value={Math.min(shown, duration || 1)}
            style={{ '--pct': `${pct}%` }}
            aria-label="Track position"
            disabled={!duration}
            onChange={(event) => setScrub(Number(event.target.value))}
            onPointerUp={() => { if (seeking) { music.seekTo?.(scrub); setScrub(null); } }}
            onKeyUp={() => { if (seeking) { music.seekTo?.(scrub); setScrub(null); } }}
          />
          <span className="mu2-mono">{formatTime(duration)}</span>
        </div>

        <div className="mu2-ctl-pill">
          <button type="button" className={`mu2-ctl ${music.shuffleEnabled ? 'is-on' : ''}`} aria-pressed={music.shuffleEnabled}
            aria-label="Shuffle" title="Shuffle" onClick={() => music.setShuffleEnabled?.(!music.shuffleEnabled)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h4l8 10h4M4 17h4l8-10h4" /><path d="M18 4.5 20.5 7 18 9.5M18 14.5 20.5 17 18 19.5" />
            </svg>
          </button>
          <button type="button" className={`mu2-ctl ${music.repeatMode && music.repeatMode !== 'off' ? 'is-on' : ''}`}
            aria-label={`Repeat ${music.repeatMode || 'off'}`} title="Repeat" onClick={() => music.cycleRepeat?.()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 9a4 4 0 0 1 4-4h9M20 15a4 4 0 0 1-4 4H7" /><path d="M15.5 2.6 17.6 5l-2.1 2.4M8.5 14.6 6.4 17l2.1 2.4" />
            </svg>
          </button>
          <button type="button" className="mu2-ctl" aria-label="Queue" title="Queue" onClick={() => onGo?.('queue')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h11M4 12h11M4 17h7" /><circle cx="18" cy="16" r="2.4" /><path d="M20.4 16v-6l-1.6.6" />
            </svg>
          </button>
          {music.listeningMode != null ? (
            <button type="button" className={`mu2-ctl ${music.listeningMode ? 'is-on' : ''}`} aria-pressed={Boolean(music.listeningMode)}
              aria-label="Keep the screen awake" title="Keep awake" onClick={() => music.toggleListeningMode?.()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.4l3 1.8" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="mu2-transport">
          <button type="button" className="mu2-tp" aria-label="Lyrics" onClick={() => onGo?.('lyrics')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M4 6h10M4 11h16M4 16h13M4 20h7" /></svg>
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
          <button type="button" className="mu2-tp" aria-label="Favourite" aria-pressed={Boolean(favourite)} onClick={() => music.toggleFavorite?.(track)}>
            <svg viewBox="0 0 24 24" fill={favourite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20s-7.4-4.3-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.5C19.4 15.7 12 20 12 20Z" />
            </svg>
          </button>
        </div>

        <div className="mu2-viz-wrap">
          <span className="mu2-mono">Signal field</span>
          <SignalField playing={Boolean(music.isPlaying)} />
        </div>

        {music.playerStatus === 'error' ? (
          <StateBox tone="error" title="This track did not play" body={music.error || 'Every stream URL for this song failed.'}>
            <div className="mu2-btn-row">
              <button type="button" className="mu2-btn" onClick={() => music.retryTrack?.()}>Retry track</button>
              <button type="button" className="mu2-btn is-outline" onClick={() => music.playNext?.()}>Skip</button>
            </div>
          </StateBox>
        ) : null}
      </div>

      <div className="mu2-player-side">
        <section className="mu2-panel" aria-label="Up next">
          <div className="mu2-panel-h">
            <h3>Up next</h3>
            <span className="mu2-badge">{queue.length}</span>
          </div>
          <TrackList tracks={queue} music={music} onPlay={onPlay} showArt={false} showQuality
            emptyTitle="The queue is empty" emptyBody="Play an album or add tracks to build it." />
          {queue.length ? (
            <button type="button" className="mu2-btn is-outline" onClick={() => notify?.('Use “Add to queue” while browsing to grow this list')}>
              How the queue fills
            </button>
          ) : null}
        </section>

        <section className="mu2-panel" aria-label="Stream quality">
          <div className="mu2-panel-h"><h3>Stream quality</h3></div>
          <div className="mu2-quality">
            {chips.map((chip) => (
              <button key={chip.key || chip.id} type="button" className="mu2-qbtn2"
                aria-pressed={(chip.key || chip.id) === music.quality}
                onClick={() => { music.setQuality?.(chip.key || chip.id); notify?.(`Quality ${chip.label || chip.key}`); }}>
                {chip.label || chip.key}
              </button>
            ))}
          </div>
          <p className="mu2-mono">Auto picks the best URL this song actually carries. Falls down the ladder when one is missing.</p>
        </section>
      </div>
    </div>
  );
}

/* ── Settings ──────────────────────────────────────────────────────────────── */

export function MusicSettings({ music, look, updateLook, resetLook, notify }) {
  const [catalogue, setCatalogue] = useState([]);
  const [sourceStatus, setSourceStatus] = useState('idle');

  useEffect(() => {
    let alive = true;
    setSourceStatus('loading');
    fetch('/api/music/lyrics?list=1&catalogue=1', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => { if (alive) { setCatalogue(Array.isArray(data?.catalogue) ? data.catalogue : []); setSourceStatus('ready'); } })
      .catch(() => { if (alive) setSourceStatus('error'); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="mu2-screen mu2-settings">
      <section className="mu2-panel">
        <h3>Lyrics defaults</h3>
        <p className="mu2-lede">What every new song opens with. The same controls sit inline on the lyrics screen.</p>

        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Canvas</strong><small>{CANVAS_LABEL(look.canvas)}</small></span>
          <div className="mu2-canvases is-row">
            {LYRIC_CANVASES.map((canvas) => (
              <button key={canvas.id} type="button" className={`mu2-cv mu2-bg-${canvas.id}`} data-canvas={canvas.id}
                aria-pressed={look.canvas === canvas.id} aria-label={canvas.label} title={canvas.label}
                onClick={() => updateLook({ canvas: canvas.id })} />
            ))}
          </div>
        </div>

        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Type size</strong></span>
          <span className="mu2-seg">
            {LYRIC_SIZES.map((size) => (
              <button key={size.id} type="button" aria-pressed={look.size === size.id} onClick={() => updateLook({ size: size.id })}>{size.label}</button>
            ))}
          </span>
        </div>

        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Typeface</strong></span>
          <span className="mu2-seg is-face">
            {LYRIC_FACES.map((face) => (
              <button key={face.id} type="button" data-face={face.id} aria-pressed={look.face === face.id}
                onClick={() => updateLook({ face: face.id })}>{face.label}</button>
            ))}
          </span>
        </div>

        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Follow the song</strong><small>Auto-scroll until you take over.</small></span>
          <button type="button" className="mu2-sw" aria-pressed={look.follow} aria-label="Follow the song"
            onClick={() => updateLook({ follow: !look.follow })} />
        </div>

        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Reset the look</strong><small>Back to Aura, size M, Sans.</small></span>
          <button type="button" className="mu2-btn is-outline" onClick={() => { resetLook(); notify?.('Lyric look reset'); }}>Reset</button>
        </div>
      </section>

      <section className="mu2-panel">
        <h3>Lyrics sources</h3>
        <p className="mu2-lede">Every row was probed, not assumed. The line under each name is what it actually returned.</p>
        {sourceStatus === 'loading' ? <p className="mu2-mono" role="status">Reading the catalogue…</p> : null}
        {catalogue.map((group) => (
          <div key={group.id} className={`mu2-src-group ${group.tone || ''}`}>
            <h4>{group.label} <b>{group.badge}</b></h4>
            <p>{group.note}</p>
            {group.items.map((item) => (
              <div key={item.id} className={`mu2-src ${item.pickable ? '' : 'is-off'}`}>
                <span className="mu2-src-ic" aria-hidden="true">{item.mark || '•'}</span>
                <span className="mu2-src-t">
                  <strong>{item.name}</strong>
                  <span className={`mu2-ev ${item.pickable ? 'is-live' : 'is-no'}`}>{item.evidence}</span>
                  <small>{item.note}</small>
                </span>
                <span className="mu2-tag">{item.pickable ? 'available' : 'off'}</span>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="mu2-panel">
        <h3>Playback</h3>
        <p className="mu2-lede">Existing behaviour, restyled.</p>
        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Keep the screen awake</strong><small>Wake lock while a song plays.</small></span>
          <button type="button" className="mu2-sw" aria-pressed={Boolean(music.listeningMode)} aria-label="Keep the screen awake"
            onClick={() => music.toggleListeningMode?.()} />
        </div>
        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Appearance</strong><small>Day or night comes from the app header, so the whole app moves together.</small></span>
          <span className="mu2-mono">inherited</span>
        </div>
        <div className="mu2-set-row">
          <span className="mu2-set-t"><strong>Watch history</strong><small>Removed app-wide: no history rows, here or anywhere.</small></span>
          <span className="mu2-mono">off</span>
        </div>
      </section>
    </div>
  );
}

function CANVAS_LABEL(id) {
  return (LYRIC_CANVASES.find((canvas) => canvas.id === id) || LYRIC_CANVASES[1]).label;
}
