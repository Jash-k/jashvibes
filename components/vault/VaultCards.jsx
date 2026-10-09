'use client';
import { memo, useState } from 'react';
import Icon from '@/components/Icons';
import { POSTER_SIZES_ATTR, tmdbImageSrcSet } from '@/lib/tmdbPoster';
import { revealStyle } from '@/lib/useReveal';
function qualityChipClass(quality) {
  if (quality === '1080p') return 'jv-vault-chip jv-vault-chip-hd';
  if (quality === '720p') return 'jv-vault-chip jv-vault-chip-hq';
  return 'jv-vault-chip';
}

export const VaultTile = memo(function VaultTile({ movie, onPlay, index = 0 }) {
  const [failedUrl, setFailedUrl] = useState('');
  const showPoster = Boolean(movie.poster) && failedUrl !== movie.poster;
  return (
    <button
      type="button"
      data-reveal
      style={revealStyle(index, 6)}
      className="jv-vault-card group"
      onClick={() => onPlay(movie)}
      title={movie.isSeries
        ? `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''} — ${movie.episodeCount} episode${movie.episodeCount === 1 ? '' : 's'}`
        : `Play ${movie.title}${movie.year ? ` (${movie.year})` : ''}`}
    >
      {showPoster ? (
        <img
          src={movie.poster}
          srcSet={tmdbImageSrcSet(movie.poster) || undefined}
          sizes={tmdbImageSrcSet(movie.poster) ? POSTER_SIZES_ATTR : undefined}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setFailedUrl(movie.poster)}
          className="jv-vault-poster"
        />
      ) : (
        <span className="jv-vault-poster jv-vault-poster-none" aria-hidden="true">
          {String(movie.title || '??').slice(0, 2).toUpperCase()}
        </span>
      )}

      {movie.quality ? <span className={qualityChipClass(movie.quality)}>{movie.quality}</span> : null}

      {movie.isSeries ? (
        <span className="jv-vault-chip jv-vault-chip-series">
          {movie.episodeCount ? `${movie.episodeCount} EP` : 'SERIES'}
        </span>
      ) : null}

      <span className="jv-vault-play" aria-hidden="true">
        <Icon name="play" className="h-7 w-7" />
      </span>

      <span className="jv-vault-caption">
        <span className="jv-vault-name">{movie.title}</span>
        <span className="jv-vault-meta">
          {movie.year || '—'}
          {movie.isSeries ? <span className="jv-vault-ep-count">{movie.episodeCount} ep</span> : null}
          {movie.rating ? <span className="jv-vault-star">★ {movie.rating.toFixed(1)}</span> : null}
          <span className="jv-vault-src-chip">{movie.embedCount} src</span>
        </span>
      </span>
    </button>
  );
});

export function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" aria-hidden="true">
      {Array.from({ length: 18 }).map((_, index) => (
        <div key={index} className="jv-vault-card aspect-[2/3] animate-pulse bg-white/[0.03]" />
      ))}
    </div>
  );
}
