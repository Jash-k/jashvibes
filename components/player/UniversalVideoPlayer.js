'use client';

/**
 * UniversalVideoPlayer — the ONE player for every direct-media surface.
 * Owns the <video> element + format attachment:
 *   • DASH (.mpd)            → Shaka
 *   • HLS  (.m3u8)           → Shaka (or native on Safari)
 *   • plain files (mp4/mkv)  → direct video.src
 * …then renders DirectWatchPlayer for the full custom UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import DirectWatchPlayer from './DirectWatchPlayer';

export function isHlsUrl(url = '') {
  const u = String(url || '').toLowerCase();
  return u.includes('.m3u8') || u.includes('m3u8');
}

export function isDashUrl(url = '') {
  return String(url || '').toLowerCase().includes('.mpd');
}

function nativeHlsSupported() {
  try {
    const v = document.createElement('video');
    return Boolean(v.canPlayType('application/vnd.apple.mpegurl'));
  } catch {
    return false;
  }
}

export default function UniversalVideoPlayer({
  url,
  title,
  poster,
  watchKey,
  sources,
  activeSource,
  onPickSource,
  onAutoFallback,
  nextEpisode,
  onError,
}) {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const [videoEl, setVideoEl] = useState(null);
  const callbackRef = useCallback((el) => {
    videoRef.current = el;
    setVideoEl(el);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return undefined;
    let cancelled = false;

    async function destroyPlayer() {
      if (playerRef.current) {
        try { await playerRef.current.destroy(); } catch {}
        playerRef.current = null;
      }
    }

    async function load() {
      try {
        await destroyPlayer();
        if (cancelled) return;
        video.pause();
        video.removeAttribute('src');
        video.load();

        const hls = isHlsUrl(url);
        const needsShaka = isDashUrl(url) || (hls && !nativeHlsSupported());

        if (needsShaka) {
          const shakaModule = await import('shaka-player/dist/shaka-player.compiled.js');
          const shaka = shakaModule.default || window.shaka || shakaModule;
          shaka.polyfill?.installAll?.();
          const player = new shaka.Player();
          playerRef.current = player;
          await player.attach(video);
          player.configure({
            streaming: { bufferingGoal: 20, rebufferingGoal: 2 },
            abr: { enabled: true, defaultBandwidthEstimate: 1_500_000 },
          });
          await player.load(url, undefined, hls ? 'application/x-mpegurl' : undefined);
        } else {
          video.src = url;
          video.load();
        }
        if (!cancelled) video.play().catch(() => {});
      } catch (playbackError) {
        if (!cancelled) onError?.(playbackError?.message || 'Playback failed');
      }
    }

    load();
    return () => { cancelled = true; destroyPlayer(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  if (!url) return null;

  return (
    <DirectWatchPlayer
      videoEl={videoEl}
      watchKey={watchKey}
      title={title}
      sources={sources}
      activeSource={activeSource}
      onPickSource={onPickSource}
      onAutoFallback={onAutoFallback}
      nextEpisode={nextEpisode}
      onError={onError}
    >
      <video
        ref={callbackRef}
        className="h-full w-full max-h-[100dvh] max-w-[100dvw] bg-black object-fill"
        playsInline
        autoPlay
        preload="metadata"
        poster={poster || undefined}
      />
    </DirectWatchPlayer>
  );
}
