'use client';
import { useEffect, useRef } from 'react';
import { isHlsUrl } from '@/lib/musicCore';

// Audio transport only: lyrics, browsing and queue transitions do not own attachment.
export function useAudioPlayback({ elementRef, trackKey, url, autoplay, onReady, onError }) {
  const previous = useRef({ key: '', position: 0 });
  const handlers = useRef({ autoplay, onReady, onError });
  handlers.current = { autoplay, onReady, onError };
  useEffect(() => {
    const audio = elementRef.current;
    if (!audio || !url) return undefined;
    let cancelled = false, player = null;
    const resume = previous.current.key === trackKey ? previous.current.position : 0;
    const timer = setTimeout(() => { if (!cancelled) handlers.current.onError?.('Audio did not become playable within 20 seconds.'); }, 20000);
    const ready = () => {
      if (cancelled) return;
      clearTimeout(timer);
      if (resume > 0 && Number.isFinite(audio.duration)) { try { audio.currentTime = Math.min(resume, Math.max(0, audio.duration - 0.2)); } catch {} }
      handlers.current.onReady?.();
      if (handlers.current.autoplay) audio.play().catch(() => {});
    };
    const failed = () => { if (!cancelled) { clearTimeout(timer); handlers.current.onError?.('This audio URL could not be played.'); } };
    audio.addEventListener('canplay', ready, { once: true });
    audio.addEventListener('error', failed);
    (async () => {
      try {
        audio.pause(); audio.removeAttribute('src'); audio.load();
        if (!isHlsUrl(url) || audio.canPlayType('application/vnd.apple.mpegurl')) {
          audio.src = url; audio.preload = 'auto'; audio.load(); return;
        }
        const module = await import('shaka-player/dist/shaka-player.compiled.js');
        if (cancelled) return;
        const shaka = module.default || module; shaka.polyfill?.installAll?.();
        player = new shaka.Player(); await player.attach(audio);
        if (cancelled) { await player.destroy(); return; }
        player.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 2 } });
        player.addEventListener('error', failed);
        await player.load(url, undefined, 'application/x-mpegurl');
        if (!cancelled) ready();
      } catch (e) { if (!cancelled) { clearTimeout(timer); handlers.current.onError?.(e.message || 'Audio attachment failed.'); } }
    })();
    return () => {
      cancelled = true; clearTimeout(timer);
      previous.current = { key: trackKey, position: Number(audio.currentTime) || 0 };
      audio.removeEventListener('canplay', ready); audio.removeEventListener('error', failed);
      if (player) player.destroy().catch(() => {});
      audio.pause(); audio.removeAttribute('src'); audio.load();
    };
  }, [elementRef, trackKey, url]);
}
