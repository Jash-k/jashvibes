'use client';

import { useEffect, useRef } from 'react';
import { formatTime, trackKey } from '@/lib/musicCore';

export function MusicIcon({ name, size = 22 }) {
  const paths = {
    play: 'M8 5l11 7-11 7z', pause: 'M8 5v14M16 5v14', next: 'M5 5l11 7-11 7zM19 5v14', previous: 'M19 5L8 12l11 7zM5 5v14',
    queue: 'M4 6h16M4 12h12M4 18h8', close: 'M6 6l12 12M18 6L6 18', back: 'M15 5l-7 7 7 7',
    shuffle: 'M4 6h3l10 12h3M17 15l3 3-3 3M4 18h3l4-5M13 9l4-3h3M17 3l3 3-3 3',
    repeat: 'M5 7h14l-3-3M19 7v5M19 17H5l3 3M5 17v-5', heart: 'M12 20S3 15 3 9a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 6-9 11-9 11z',
    search: 'M20 20l-5-5M17 10a7 7 0 11-14 0 7 7 0 0114 0', add: 'M12 5v14M5 12h14',
    settings: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6', library: 'M4 4h6v16H4zM14 4l5-1 3 16-5 1z',
    expand: 'M8 3H3v5M16 3h5v5M21 16v5h-5M3 16v5h5', volume: 'M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 010 8',
    home: 'M3 11l9-8 9 8M5 10v11h5v-7h4v7h5V10', live: 'M4 6h16v14H4zM8 2l4 4 4-4', refresh: 'M20 7v5h-5M20 12a8 8 0 10-2 6',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.play} /></svg>;
}

export function IconButton({ icon, label, active, className = '', children, ...props }) {
  return <button type="button" className={`mc-icon ${active ? 'is-active' : ''} ${className}`} aria-label={label} title={label} {...(active !== undefined ? { 'aria-pressed': active } : {})} {...props}><MusicIcon name={icon} />{children}</button>;
}

export function Cover({ item, className = '' }) {
  const image = item?.image || item?.album_image || item?.artist_image;
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.hidden = false; }, [image]);
  return <span className={`mc-cover ${className}`}>
    <span className="mc-cover-fallback" aria-hidden="true">{String(item?.title || item?.name || '♪').slice(0, 1)}</span>
    {image ? <img ref={ref} src={image} alt="" loading="lazy" decoding="async" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
  </span>;
}

export function Status({ title, children, retry, error = false }) {
  return <div className="mc-state" role={error ? 'alert' : 'status'}><strong>{title}</strong>{children ? <p>{children}</p> : null}{retry ? <button className="mc-button" type="button" onClick={retry}>Try again</button> : null}</div>;
}

export function TrackRows({ tracks = [], music, onPlay, queue = false }) {
  if (!tracks.length) return <Status title={queue ? 'Your queue is empty' : 'No tracks available'}>Choose another collection or try searching.</Status>;
  return <ol className="mc-tracks">{tracks.map((track, index) => {
    const key = trackKey(track) || `track-${index}`;
    const active = key === music.activeKey;
    const favorite = music.favoriteSet?.has(key);
    return <li key={`${key}:${index}`} className={active ? 'is-current' : ''}>
      <button type="button" className="mc-track-main" onClick={() => onPlay(track, tracks)} aria-label={`Play ${track.title || 'track'}`}>
        <span className="mc-track-index">{active && music.isPlaying ? '♫' : index + 1}</span><Cover item={track} />
        <span className="mc-track-text"><strong>{track.title || 'Untitled'}</strong><small>{track.artists || track.subtitle || 'Unknown artist'}</small></span>
      </button>
      <span className="mc-track-time">{track.duration ? formatTime(track.duration) : '—'}</span>
      <IconButton icon="heart" label={`${favorite ? 'Remove' : 'Add'} ${track.title || 'track'} ${favorite ? 'from' : 'to'} favourites`} active={Boolean(favorite)} onClick={() => music.toggleFavorite(track)} />
      {!queue ? <IconButton icon="add" label={`Add ${track.title || 'track'} to queue`} onClick={() => music.addToQueue(track)} /> : null}
    </li>;
  })}</ol>;
}

export function CollectionCards({ items = [], kind = 'album', onOpen }) {
  if (!items.length) return <Status title={`No ${kind === 'artist' ? 'artists' : kind === 'playlist' ? 'playlists' : 'albums'} available`}>Try searching or refresh this library tab.</Status>;
  return <div className="mc-cards">{items.map((item, index) => <button type="button" className={`mc-card ${kind === 'artist' ? 'is-artist' : ''}`} key={`${item.id || item.title || index}:${index}`} onClick={() => onOpen(kind, item)} aria-label={`Open ${item.title || item.name || kind}`}>
    <Cover item={item} /><strong>{item.title || item.name || 'Untitled'}</strong><small>{item.artists || item.subtitle || item.role || item.year || kind}</small>
  </button>)}</div>;
}

// Focus trapping, Escape, background inertness, and focus restoration for overlay sheets.
export function Sheet({ title, onClose, children }) {
  const ref = useRef(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const background = document.querySelector('.mc-app-content');
    const wasInert = background?.inert;
    if (background) background.inert = true;
    const panel = ref.current;
    panel?.focus();
    const focusables = () => [...panel.querySelectorAll('button, input, select, a[href], [tabindex="0"]')].filter((el) => !el.disabled && el.getClientRects().length);
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const list = focusables();
      const first = list[0], last = list[list.length - 1];
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); if (background) background.inert = wasInert; previous?.focus?.(); };
  }, []);
  return <div className="mc-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="mc-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header><h2>{title}</h2><IconButton icon="close" label={`Close ${title}`} onClick={onClose} /></header><div className="mc-sheet-body">{children}</div>
    </section>
  </div>;
}
