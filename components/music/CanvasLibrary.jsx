'use client';

import { useEffect, useRef, useState } from 'react';
import { TAMIL_MUSIC_DIRECTORS } from '@/lib/tamilMusicDirectors';
import { CollectionCards, Cover, IconButton, Status, TrackRows } from './CanvasBits';

export const LIBRARY_TABS = [
  { id: 'new', label: 'New' }, { id: 'tracks', label: 'Tracks' }, { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' }, { id: 'playlists', label: 'Playlists' },
];

export default function CanvasLibrary({ music, tab, setTab, query, setQuery, onPlay, onClose }) {
  const [sort, setSort] = useState('added');
  const [favorites, setFavorites] = useState(false);
  const refs = useRef([]);
  const loaders = useRef(music); loaders.current = music;
  const requested = useRef(new Set());
  const scroll = useRef(null);
  const detail = music.selectedCollection;
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
    if (requested.current.has(tab)) return;
    requested.current.add(tab);
    if (tab === 'new') loaders.current.loadFresh();
    else if (tab === 'tracks') loaders.current.loadTrending();
    else if (tab !== 'artists') loaders.current.loadFacet(tab);
  }, [tab]);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [detail?.id, query]);
  const refresh = () => tab === 'artists' ? undefined : tab === 'new' ? music.loadFresh() : tab === 'tracks' ? music.loadTrending() : music.loadFacet(tab);
  const changeTab = (id) => { music.backToAlbums(); setQuery(''); setFavorites(false); setTab(id); };
  const open = (kind, item) => {
    if (kind === 'artist') music.openArtist(item);
    else if (kind === 'playlist') music.openPlaylist(item);
    else music.openAlbum(item);
  };
  const searching = Boolean(query.trim());
  const state = tab === 'artists' ? { status: 'ready' } : searching ? { status: music.searchStatus } : tab === 'new' ? music.fresh : tab === 'tracks' ? music.trending : tab === 'artists' ? { status: 'ready' } : music.facets?.[tab];
  const results = music.searchResults || {};
  let cards = [], tracks = [];
  if (searching) {
    if (tab === 'artists') {
      const normalize = (value) => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
      const aliases = { arr: 'A. R. Rahman', arrahman: 'A. R. Rahman', harris: 'Harris Jayaraj', illayraja: 'Ilaiyaraaja', ilayaraja: 'Ilaiyaraaja', anirudh: 'Anirudh Ravichander' };
      const search = normalize(aliases[normalize(query)] || query);
      cards = TAMIL_MUSIC_DIRECTORS.filter((item) => normalize(item.name).includes(search));
    }
    else if (tab === 'playlists') cards = results.playlists || [];
    else if (tab === 'tracks') tracks = results.songs || [];
    else { cards = results.albums || []; if (tab === 'new') tracks = results.songs || []; }
  } else if (tab === 'new') { cards = music.fresh?.albums || []; tracks = music.fresh?.tracks || []; }
  else if (tab === 'tracks') tracks = music.trending?.status === 'ready' ? music.trending.items : music.allShelfSongs || [];
  else cards = tab === 'artists' ? TAMIL_MUSIC_DIRECTORS : music.facetLists?.[tab] || [];
  if (tab === 'playlists' && !searching) cards = [...new Map([...(music.home?.importedPlaylists || music.home?.playlists || []), ...cards].map((item) => [item.id || item.title, item])).values()];
  if (tab === 'tracks' && favorites) tracks = music.favoriteTracks || [];
  if (sort === 'az') {
    cards = [...cards].sort((a, b) => String(a.title || a.name || '').localeCompare(String(b.title || b.name || '')));
    tracks = [...tracks].sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }
  const kind = tab === 'artists' ? 'artist' : tab === 'playlists' ? 'playlist' : 'album';
  return <section className="mc-library" aria-label="Music library">
    <header className="mc-library-heading"><div><h2>Library</h2><p>Browse without interrupting playback</p></div>{onClose ? <IconButton icon="close" label="Return to player" onClick={onClose} /> : null}</header>
    <label className="mc-search"><span className="sr-only">Search music</span><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></svg><input value={query} onChange={(event) => { music.backToAlbums(); setQuery(event.target.value); }} placeholder="Search songs, albums, artists…" type="search" />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>×</button> : null}</label>
    <div className="mc-tabs" role="tablist" aria-label="Library categories">{LIBRARY_TABS.map((item, index) => <button type="button" role="tab" id={`mc-tab-${item.id}`} aria-controls="mc-library-results" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} ref={(node) => { refs.current[index] = node; }} key={item.id} onClick={() => changeTab(item.id)} onKeyDown={(event) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End']; if (!keys.includes(event.key)) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + (event.key === 'ArrowRight' ? 1 : 4)) % 5;
      changeTab(LIBRARY_TABS[next].id); refs.current[next]?.focus();
    }}>{item.label}</button>)}</div>
    <div className="mc-library-tools"><span>{tab === 'artists' ? 'Tamil music directors' : searching ? 'Search results' : 'Tamil · Available catalogue'}</span>{tab === 'tracks' ? <button className="mc-text-button" type="button" aria-pressed={favorites} onClick={() => setFavorites(!favorites)}>Favourites</button> : null}<label><span className="sr-only">Sort library</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="added">Provider order</option><option value="az">A–Z</option></select></label><IconButton icon="refresh" label="Refresh library" disabled={tab === 'artists'} onClick={refresh} /></div>
    <div className="mc-library-results" ref={scroll} id="mc-library-results" role="tabpanel" aria-labelledby={`mc-tab-${tab}`} tabIndex={0} aria-busy={detail ? music.collectionStatus === 'loading' : state?.status === 'loading'}>
      {detail ? <>
        <button type="button" className="mc-text-button" onClick={() => music.backToAlbums()}>← Back to {LIBRARY_TABS.find((item) => item.id === tab)?.label}</button>
        <div className="mc-collection-detail"><Cover item={detail}/><div><small>{detail.type}</small><h3>{detail.title || detail.name}</h3><p>{detail.artists || detail.subtitle}</p><small>{detail.tracks?.length || 0} available tracks</small></div></div>
        {detail.tracks?.length ? <div className="mc-actions"><button type="button" className="mc-button" onClick={() => onPlay(detail.tracks[0], detail.tracks)}>Play all</button><button type="button" className="mc-button is-quiet" onClick={() => detail.tracks.forEach((track) => music.addToQueue(track))}>Add to queue</button></div> : null}
        {music.collectionStatus === 'loading' ? <Status title="Loading collection…" /> : music.collectionStatus === 'error' ? <Status title="Collection unavailable" error retry={() => open(detail.type, detail)}>{detail.error}</Status> : <TrackRows tracks={detail.tracks || []} music={music} onPlay={onPlay} />}
        {detail.albums?.length ? <><h3 className="mc-section-title">Albums by this artist</h3><CollectionCards items={detail.albums} onOpen={open}/></> : null}
      </> : <>
        {state?.status === 'loading' ? <Status title="Loading library…" /> : null}
        {state?.status === 'error' ? <Status title={searching ? 'Search unavailable' : 'Library unavailable'} error retry={searching ? () => { const value = query; music.setQuery(''); setTimeout(() => music.setQuery(value), 0); } : refresh}>{state?.error || 'Try again when your music service is available.'}</Status> : null}
        {cards.length ? <CollectionCards items={cards} kind={kind} onOpen={open}/> : null}
        {tracks.length ? <><h3 className="mc-section-title">{tab === 'new' ? 'New tracks' : favorites ? 'Favourites' : searching ? 'Matching tracks' : 'Tracks · Trending selection'}</h3><TrackRows tracks={tracks} music={music} onPlay={onPlay}/></> : null}
        {!cards.length && !tracks.length && state?.status !== 'loading' && state?.status !== 'error' ? <Status title="Nothing here yet" retry={searching ? undefined : refresh}>{searching ? 'Try another search or a different category.' : 'Search for music or refresh this category.'}</Status> : null}
      </>}
    </div>
  </section>;
}
