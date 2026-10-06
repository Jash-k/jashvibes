'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTime, trackKey } from '@/lib/musicCore';
import { revealStyle, useReveal } from '@/lib/useReveal';

/*
 * The primitives the whole music section is built from: artwork, the track row, the
 * collection card, section heads and the one shared empty/error box.
 *
 * Two rules this file exists to enforce:
 *  1. Artwork never leaves a hole. Every catalogue item may or may not carry
 *     `image`; when it does not, we derive a stable gradient from its own id so a
 *     missing cover still reads as that album and not as a grey rectangle.
 *  2. An empty state always says what happened and offers the next action. Never a
 *     blank panel, never a raw error string.
 */

/** Stable hash → hue. Same album, same colour, every render, no storage. */
export function artHue(seed = '') {
  let hash = 2166136261;
  const text = String(seed || 'x');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 360;
}

export function Art({ item, className = '', round = false, label = '' }) {
  const seed = item?.id || item?.name || item?.title || label || '';
  const image = item?.image || item?.album_image || item?.artist_image || '';
  const hue = artHue(seed);
  return (
    <span
      className={`mu2-art ${className} ${round ? 'is-round' : ''}`}
      style={{ '--mu-art-a': `hsl(${hue} 52% 34%)`, '--mu-art-b': `hsl(${(hue + 38) % 360} 48% 14%)` }}
    >
      {image
        ? <img src={image} alt="" loading="lazy" decoding="async" />
        : <span className="mu2-art-fb" aria-hidden="true">{String(item?.title || item?.name || '♪').trim().charAt(0).toUpperCase() || '♪'}</span>}
    </span>
  );
}

export function SectionHead({ title, meta, action }) {
  return (
    <div className="mu2-sec-h">
      <h2>{title}{meta ? <em>{meta}</em> : null}</h2>
      {action || null}
    </div>
  );
}

export function StateBox({ tone = '', title, body, children, onRetry, retryLabel = 'Try again' }) {
  return (
    <div className={`mu2-state ${tone ? `is-${tone}` : ''}`} role={tone === 'error' ? 'alert' : 'status'}>
      <p className="mu2-state-t">{title}</p>
      {body ? <p className="mu2-state-b">{body}</p> : null}
      {onRetry ? <button type="button" className="mu2-btn" onClick={onRetry}>{retryLabel}</button> : null}
      {children}
    </div>
  );
}

/**
 * Is this actually a song? The provider's `allShelfSongs` filters its sections by
 * `item.type`, which only exists when the upstream payload tagged the item — so an
 * untagged album can arrive inside a list of "songs" and render as a row with no
 * duration. Every list in this section runs through here instead of trusting the
 * shelf it came from.
 */
export function isSong(item) {
  if (!item) return false;
  if (item.type === 'album' || item.type === 'playlist' || item.type === 'artist') return false;
  if (Array.isArray(item.songs) || Array.isArray(item.tracks)) return false;
  return Boolean(item.trackId || item.songUrl || item.duration || item.durationLabel || item.streamUrls);
}

/**
 * One track row. `onPlay` receives the track and the list it came from, so playing
 * from a row always queues the album/playlist you are looking at — which is what the
 * old "Play all" did, minus the second click.
 */
export function TrackList({
  tracks = [], music, onPlay, showIndex = true, showArt = true, showQuality = false,
  emptyTitle = 'Nothing here yet', emptyBody = '', emptyAction = null,
}) {
  const list = Array.isArray(tracks) ? tracks.filter(isSong) : [];
  const revealRef = useReveal(list.length);

  if (!list.length) {
    return <StateBox tone="empty" title={emptyTitle} body={emptyBody}>{emptyAction}</StateBox>;
  }

  return (
    <ol className="mu2-tracks" ref={revealRef}>
      {list.map((track, index) => {
        const key = trackKey(track) || `i${index}`;
        const active = key === music?.activeKey;
        const favorite = music?.favoriteSet?.has(key);
        return (
          <li
            key={key}
            className={`mu2-tr ${active ? 'is-active' : ''} ${active && music?.isPlaying ? 'is-playing' : ''}`}
            data-reveal
            style={revealStyle(index, 8)}
          >
            <button type="button" className="mu2-tr-main" onClick={() => onPlay?.(track, list)} title={`Play ${track.title || 'track'}`}>
              {showIndex ? (
                <span className="mu2-tr-idx" aria-hidden="true">
                  {active && music?.isPlaying
                    ? <span className="mu2-bars"><i /><i /><i /></span>
                    : index + 1}
                </span>
              ) : null}
              {showArt ? <Art item={track} className="mu2-art-sm" /> : null}
              <span className="mu2-tr-t">
                <strong>{track.title || 'Untitled'}</strong>
                <small>{track.artists || track.subtitle || ''}</small>
              </span>
            </button>
            {showQuality && track.quality ? <span className="mu2-tr-q">{String(track.quality).replace('kbps', 'k')}</span> : null}
            <span className="mu2-tr-d">{formatTime(track.duration || 0)}</span>
            <button
              type="button"
              className={`mu2-tr-a ${favorite ? 'is-on' : ''}`}
              aria-pressed={Boolean(favorite)}
              aria-label={`${favorite ? 'Remove' : 'Add'} ${track.title || 'track'} ${favorite ? 'from' : 'to'} favourites`}
              onClick={() => music?.toggleFavorite?.(track)}
            >
              <svg viewBox="0 0 24 24" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20s-7.4-4.3-7.4-9.4A4.1 4.1 0 0 1 12 8.1a4.1 4.1 0 0 1 7.4 2.5C19.4 15.7 12 20 12 20Z" />
              </svg>
            </button>
            <button
              type="button"
              className="mu2-tr-a is-add"
              aria-label={`Add ${track.title || 'track'} to the queue`}
              title="Add to queue"
              onClick={() => music?.addToQueue?.(track)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function CollectionCard({ item, kind = 'album', count, onOpen, footer, rank }) {
  return (
    <button type="button" className="mu2-card" onClick={() => onOpen?.(item)}>
      <span className="mu2-card-art">
        <Art item={item} />
        {rank ? <span className="mu2-rank" aria-hidden="true">{String(rank).padStart(2, '0')}</span> : null}
        <span className="mu2-card-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5l13 7.5-13 7.5z" /></svg>
        </span>
      </span>
      <span className="mu2-card-t">
        <strong>{item.title || item.name || 'Untitled'}</strong>
        <small>{item.artists || item.subtitle || item.role || String(item.year || item.releaseDate || '').slice(0, 4)
          || (count != null ? `${count} ${kind === 'artist' ? 'albums' : 'tracks'}` : item.language || kind)}</small>
      </span>
      {footer ? <span className="mu2-card-f">{footer}</span> : null}
    </button>
  );
}

export function CollectionGrid({ items = [], kind = 'album', onOpen, countOf, emptyTitle, emptyBody, emptyAction }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const revealRef = useReveal(`${kind}:${list.length}`);
  if (!list.length) {
    return <StateBox tone="empty" title={emptyTitle || 'Nothing on this shelf'} body={emptyBody || 'This list came back empty.'}>{emptyAction}</StateBox>;
  }
  return (
    <div className="mu2-grid" ref={revealRef}>
      {list.map((item, index) => (
        <span key={item.id || item.title || item.name || index} data-reveal style={revealStyle(index, 7)}>
          <CollectionCard item={item} kind={kind} count={countOf?.(item)} onOpen={onOpen} />
        </span>
      ))}
    </div>
  );
}

/** A small transient message. One at a time, bottom-centred, never blocking. */
export function Toast({ message }) {
  const [shown, setShown] = useState('');
  const timer = useRef(null);
  useEffect(() => {
    if (!message) return undefined;
    setShown(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(''), 2600);
    return () => clearTimeout(timer.current);
  }, [message]);
  return (
    <div className={`mu2-toast ${shown ? 'is-on' : ''}`} role="status" aria-live="polite">
      <i aria-hidden="true" />
      <span>{shown}</span>
    </div>
  );
}
