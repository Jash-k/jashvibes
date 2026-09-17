'use client';

/*
 * components/music/Curtains.jsx — the presentational half of the Light Curtains music section.
 *
 * Everything here is dumb on purpose: props in, markup out, no fetch, no localStorage. The blur budget the
 * design needs to survive a phone and a TV box is enforced structurally, not by discipline — only two surfaces
 * in this file carry `data-mu-blur`, and the day/night question never reaches these components at all because
 * the theme is a `--mu-*` token swap in globals.css.
 */

import { formatTime } from '@/lib/musicCore';

/** The three curtain shafts of light behind the whole section. `position` is 0-1 from playback time. */
export function CurtainField({ vars = {}, position = 0, dim = false, ...rest }) {
  return (
    <div className="jv-mu-field" aria-hidden="true" data-dim={dim ? 'true' : undefined} style={{ ...vars, '--mu-pos': position.toFixed(4) }} {...rest}>
      <span className="jv-mu-shaft jv-mu-shaft-a" />
      <span className="jv-mu-shaft jv-mu-shaft-b" />
      <span className="jv-mu-shaft jv-mu-shaft-c" />
      <span className="jv-mu-bead" />
    </div>
  );
}

/** One frosted glass surface. Blur is opt-in and capped by CSS to two of these on screen. */
export function MuPanel({ as: Tag = 'section', name, children, ...rest }) {
  return <Tag className={`jv-mu-panel jv-mu-panel-${name}`} data-mu-panel={name} {...rest}>{children}</Tag>;
}

/** Tabs Albums · Artists · Playlists with live counts, plus the non-facet views as quiet chips. */
export function MuTabs({ tabs = [], active = '', onSelect, chips = [], chipActive = '', onChip }) {
  return (
    <div className="jv-mu-tabs" role="tablist" aria-label="Music library">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`mu-tab-${tab.id}`}
          aria-selected={active === tab.id}
          className={`jv-mu-tab${active === tab.id ? ' is-on' : ''}`}
          onClick={() => onSelect(tab.id)}
        >
          <span className="jv-mu-tab-glyph" aria-hidden="true">{tab.glyph}</span>
          <span className="jv-mu-tab-label">{tab.label}</span>
          <span className="jv-mu-tab-count">{tab.count}</span>
        </button>
      ))}
      <span className="jv-mu-tabs-tail">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className={`jv-mu-chip${chipActive === chip.id ? ' is-on' : ''}`}
            aria-pressed={chipActive === chip.id}
            onClick={() => onChip(chip.id)}
          >
            <span aria-hidden="true">{chip.glyph}</span> {chip.label}
          </button>
        ))}
      </span>
    </div>
  );
}

export function MuHeading({ eyebrow = '', title, note = '', children = null }) {
  return (
    <header className="jv-mu-head">
      <div>
        {eyebrow ? <p className="jv-mu-eyebrow">{eyebrow}</p> : null}
        <h2 className="jv-mu-title">{title}</h2>
        {note ? <p className="jv-mu-note">{note}</p> : null}
      </div>
      {children ? <div className="jv-mu-head-actions">{children}</div> : null}
    </header>
  );
}

/** A tile for an album / artist / playlist. One button — no control lives inside another. */
export function MuTile({ item, kind = 'album', active = false, onOpen }) {
  const label = kind === 'artist' ? (item?.name || item?.title || 'Artist') : (item?.title || item?.name || 'Untitled');
  const sub = item?.subtitle || [item?.artists, item?.year, item?.songCount ? `${item.songCount} songs` : '', item?.dominantType]
    .filter(Boolean).join(' · ');
  return (
    <button type="button" className={`jv-mu-tile${active ? ' is-on' : ''}`} onClick={() => onOpen(item)}>
      <span className="jv-mu-tile-art">
        {item?.image ? <img src={item.image} alt="" loading="lazy" /> : <span className="jv-mu-tile-fallback" aria-hidden="true">{String(label).slice(0, 2)}</span>}
      </span>
      <span className="jv-mu-tile-body">
        <span className="jv-mu-tile-title">{label}</span>
        {sub ? <span className="jv-mu-tile-sub">{sub}</span> : null}
      </span>
    </button>
  );
}

/** A queue / track row. Play is the row button; favourite is a sibling, never a child. */
export function MuTrackRow({ track, index = 0, active = false, favorite = false, onPlay, onFavorite, onPrefetch, durationLabel = '' }) {
  const title = track?.title || 'Untitled';
  const artist = track?.subtitle || track?.artists || '';
  return (
    <li className={`jv-mu-row${active ? ' is-on' : ''}`}>
      <button
        type="button"
        className="jv-mu-row-main"
        onClick={() => onPlay(track)}
        onPointerEnter={() => onPrefetch?.(track)}
        onFocus={() => onPrefetch?.(track)}
      >
        <span className="jv-mu-row-index" aria-hidden="true">{active ? <span className="jv-mu-row-pulse" /> : index + 1}</span>
        <span className="jv-mu-row-art">{track?.image ? <img src={track.image} alt="" loading="lazy" /> : null}</span>
        <span className="jv-mu-row-body">
          <span className="jv-mu-row-title">{title}</span>
          {artist ? <span className="jv-mu-row-artist">{artist}</span> : null}
        </span>
        {durationLabel ? <span className="jv-mu-row-time">{durationLabel}</span> : null}
      </button>
      {onFavorite ? (
        <button type="button" className={`jv-mu-row-fav${favorite ? ' is-on' : ''}`} aria-pressed={favorite} onClick={() => onFavorite(track)}>
          {favorite ? '★' : '☆'}<span className="jv-mu-sr">{favorite ? ' remove from favorites' : ' add to favorites'}</span>
        </button>
      ) : null}
    </li>
  );
}

export function MuTrackList({ tracks = [], activeKey = '', favoriteSet, onPlay, onFavorite, onPrefetch }) {
  return (
    <ul className="jv-mu-rows">
      {tracks.map((track, index) => (
        <MuTrackRow
          key={`${track?.seokey || track?.id || track?.title || index}`}
          track={track}
          index={index}
          durationLabel={track?.durationLabel || ''}
          active={`${track?.seokey || track?.id || track?.title || ''}` === `${activeKey}`}
          favorite={Boolean(favoriteSet?.has?.(track?.seokey || track?.id || track?.title || ''))}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onPrefetch={onPrefetch}
        />
      ))}
    </ul>
  );
}

/** The now-playing panel: artwork with the halo, the meta block, the quality chips, and the rail. */
export function NowPlayingPanel({ track, image, isPlaying = false, position = 0, currentTime = 0, duration = 0, chips = [], onQuality, artistChips = [], onArtist, children = null }) {
  return (
    <div className="jv-mu-playing">
      <div className="jv-mu-playing-art" data-playing={isPlaying ? 'true' : undefined}>
        {image ? <img src={image} alt="" /> : <span className="jv-mu-playing-art-empty" aria-hidden="true">♪</span>}
      </div>
      <div className="jv-mu-playing-meta">
        <p className="jv-mu-playing-album">{track?.album || track?.primaryRelease || ''}</p>
        <h3 className="jv-mu-playing-title">{track?.title || 'Nothing playing'}</h3>
        <p className="jv-mu-playing-artist">
          {artistChips.length
            ? artistChips.map((artist) => (
              <button key={artist.id || artist.name} type="button" className="jv-mu-artist" onClick={() => onArtist?.(artist)}>{artist.name}</button>
            ))
            : (track?.subtitle || track?.artists || 'Pick a song to start the curtains')}
        </p>
        {chips.length ? (
          <div className="jv-mu-chips" role="group" aria-label="Stream quality">
            {chips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className={`jv-mu-qchip${chip.current ? ' is-on' : ''}`}
                aria-pressed={chip.current}
                onClick={() => onQuality?.(chip.key)}
              >
                {chip.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="jv-mu-rail" data-playing={isPlaying ? 'true' : undefined}>
          <span className="jv-mu-rail-fill" style={{ transform: `scaleX(${position.toFixed(4)})` }} />
          <span className="jv-mu-rail-bead" style={{ left: `${(position * 100).toFixed(2)}%` }} />
        </div>
        <p className="jv-mu-time">
          <span>{formatTime(currentTime)}</span>
          <span>{duration ? formatTime(duration) : '--:--'}</span>
        </p>
      </div>
      {children ? <div className="jv-mu-playing-side">{children}</div> : null}
    </div>
  );
}

/**
 * The lyrics panel. The column of light is the design's signature: it sits behind the *current* line, and it
 * is one element, so a 400-line file does not become 400 gradients.
 */
export function LyricsPanel({ rows = [], open = false, autoScroll = true, onToggleAutoScroll, onBlurToggle, blur = false, onClose, onJump, note = '', status = '', loading = false }) {
  return (
    <div className={`jv-mu-lyrics${open ? ' is-open' : ''}`} data-mu-blur="true" aria-hidden={open ? undefined : 'true'}>
      <header className="jv-mu-lyrics-head">
        <h3>Lyrics</h3>
        <div className="jv-mu-lyrics-tools">
          <button type="button" className={`jv-mu-mini-toggle${autoScroll ? ' is-on' : ''}`} aria-pressed={autoScroll} onClick={onToggleAutoScroll}>auto-scroll</button>
          <button type="button" className={`jv-mu-mini-toggle${blur ? ' is-on' : ''}`} aria-pressed={blur} onClick={onBlurToggle}>blur</button>
          {onClose ? <button type="button" className="jv-mu-mini-toggle" onClick={onClose}>close</button> : null}
        </div>
      </header>
      {status ? <p className="jv-mu-lyrics-status">{status}</p> : null}
      {loading ? <p className="jv-mu-lyrics-status">reading the source…</p> : null}
      {!rows.length && note ? <p className="jv-mu-lyrics-empty">{note}</p> : null}
      <ol className={`jv-mu-lines${blur ? ' is-blur' : ''}`}>
        {rows.map((row) => (
          <li key={`${row.index}-${row.time ?? 'x'}`} data-state={row.state} className="jv-mu-line">
            {row.state === 'current' ? <span className="jv-mu-line-light" aria-hidden="true" /> : null}
            {row.tappable ? (
              <button type="button" className="jv-mu-line-btn" onClick={() => onJump?.(row.time)}>
                <span className="jv-mu-line-time">{formatTime(row.time)}</span>
                <span className="jv-mu-line-text">{row.text}</span>
              </button>
            ) : (
              <span className="jv-mu-line-plain">
                {row.time != null ? <span className="jv-mu-line-time">{formatTime(row.time)}</span> : null}
                <span className="jv-mu-line-text">{row.text}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One row of transport, plus volume — every button a direct child, so nothing is nested in nothing. */
export function TransportStrip({ isPlaying = false, shuffle = false, repeat = 'off', volume = 1, muted = false, currentTime = 0, duration = 0, onToggle, onPrev, onNext, onShuffle, onRepeat, onVolume, onMute, onLyrics, lyricsOn = false, onLock, lockLabel = 'lock', listeningOn = false, onListening, pocket, children = null }) {
  return (
    <div className="jv-mu-transport">
      <button type="button" className={`jv-mu-btn${shuffle ? ' is-on' : ''}`} aria-pressed={shuffle} onClick={onShuffle} title="Shuffle">⇄<span className="jv-mu-sr"> shuffle</span></button>
      <button type="button" className="jv-mu-btn" onClick={onPrev} title="Previous">⏮<span className="jv-mu-sr"> previous</span></button>
      <button type="button" className="jv-mu-btn jv-mu-btn-play" aria-pressed={isPlaying} onClick={onToggle} title={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? '⏸' : '▶'}<span className="jv-mu-sr"> {isPlaying ? 'pause' : 'play'}</span></button>
      <button type="button" className="jv-mu-btn" onClick={onNext} title="Next">⏭<span className="jv-mu-sr"> next</span></button>
      <button type="button" className={`jv-mu-btn${repeat !== 'off' ? ' is-on' : ''}`} onClick={onRepeat} title={`Repeat: ${repeat}`}>{repeat === 'one' ? '🔂' : '🔁'}<span className="jv-mu-sr"> repeat {repeat}</span></button>
      <label className="jv-mu-vol">
        <button type="button" className="jv-mu-btn jv-mu-btn-vol" onClick={onMute} title={muted ? 'Unmute' : 'Mute'}>{muted || volume === 0 ? '🔇' : volume < 0.45 ? '🔉' : '🔊'}<span className="jv-mu-sr"> {muted ? 'unmute' : 'mute'}</span></button>
        <input type="range" min="0" max="1" step="0.01" value={muted ? 0 : volume} aria-label="Volume" onChange={(event) => onVolume(event.target.value)} />
      </label>
      <span className="jv-mu-transport-time">{formatTime(currentTime)}{duration ? ` / ${formatTime(duration)}` : ''}</span>
      <span className="jv-mu-transport-tail">
        <button type="button" className={`jv-mu-chip${lyricsOn ? ' is-on' : ''}`} aria-pressed={lyricsOn} onClick={onLyrics}>lyrics</button>
        <button type="button" className={`jv-mu-chip${listeningOn ? ' is-on' : ''}`} aria-pressed={listeningOn} onClick={onListening}>listening mode</button>
        {pocket ? <button type="button" className="jv-mu-chip" onClick={pocket}>{lockLabel}</button> : null}
        {onLock ? <button type="button" className="jv-mu-chip" onClick={onLock}>{lockLabel}</button> : null}
        {children}
      </span>
    </div>
  );
}

/** The capsule: fixed, draggable down to dismiss, hairline progress. It never becomes a second player. */
export function MiniCapsule({ visible = false, image = '', title = '', position = 0, isPlaying = false, onToggle, onNext, onDismiss, onDragStart, onDragMove, onDragEnd, offset = 0 }) {
  if (!visible) return null;
  return (
    <div className="jv-mu-mini" style={{ transform: offset ? `translateY(${offset}px)` : undefined, transition: offset ? 'none' : undefined }}
      onTouchStart={onDragStart} onTouchMove={onDragMove} onTouchEnd={onDragEnd}>
      <button type="button" className="jv-mu-mini-art" onClick={onToggle} title={isPlaying ? 'Pause' : 'Play'}>
        {image ? <img src={image} alt="" /> : <span aria-hidden="true">♪</span>}
      </button>
      <span className="jv-mu-mini-body">
        <span className="jv-mu-mini-title">{title || 'Paused'}</span>
        <span className="jv-mu-mini-rail"><span style={{ transform: `scaleX(${position.toFixed(4)})` }} /></span>
      </span>
      <button type="button" className="jv-mu-btn jv-mu-btn-mini" onClick={onToggle} aria-pressed={isPlaying}>{isPlaying ? '⏸' : '▶'}<span className="jv-mu-sr"> {isPlaying ? 'pause' : 'play'}</span></button>
      <button type="button" className="jv-mu-btn jv-mu-btn-mini" onClick={onNext}>⏭<span className="jv-mu-sr"> next</span></button>
      <button type="button" className="jv-mu-mini-x" onClick={onDismiss} title="Dismiss">✕<span className="jv-mu-sr"> dismiss mini player</span></button>
    </div>
  );
}

/**
 * The lock surface, reused for pocket mode and for the wake-lock notice. The ring is a conic-gradient driven by
 * `progress`, because a hold has to be readable without looking at it — that is the entire point of pocket mode.
 */
export function LockVeil({ view, onHoldStart, onHoldEnd, onExit }) {
  if (!view || view.kind === 'off') return null;
  const ring = `conic-gradient(var(--mu-accent) ${view.progress}%, rgba(255,255,255,0.14) ${view.progress}%)`;
  return (
    <div className="jv-mu-veil" role="dialog" aria-modal="true" aria-label={view.title}>
      <CurtainField dim />
      <div className="jv-mu-veil-inner">
        {view.kind === 'pocket' ? (
          <button
            type="button"
            className="jv-mu-hold"
            style={{ background: ring }}
            onPointerDown={onHoldStart}
            onPointerUp={onHoldEnd}
            onPointerLeave={onHoldEnd}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onHoldStart(); }}
            onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') onHoldEnd(); }}
          >
            <span className="jv-mu-hold-hole" />
          </button>
        ) : null}
        <p className="jv-mu-veil-title">{view.title}</p>
        <p className="jv-mu-veil-hint">{view.hint}</p>
        {view.status ? <p className="jv-mu-veil-status">{view.status}</p> : null}
        {view.nextTitle ? <p className="jv-mu-veil-next">up next · {view.nextTitle}</p> : null}
        <button type="button" className="jv-mu-chip jv-mu-veil-exit" onClick={onExit}>leave {view.kind === 'pocket' ? 'pocket mode' : 'listening mode'}</button>
      </div>
    </div>
  );
}

export function MuNote({ tone = 'info', children }) {
  if (!children) return null;
  return <p className={`jv-mu-note-line is-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>;
}
