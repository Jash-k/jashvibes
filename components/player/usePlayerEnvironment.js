'use client';

/**
 * Environment detection for the player chrome: pointer class, network class,
 * fullscreen/PiP/AirPlay capability. Every capability is *detected*, never
 * assumed, so unsupported devices hide the control instead of showing a button
 * that does nothing (docs/PLAYER.md §5).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtSize } from '@/lib/player/labels';

export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    const apply = () => setCoarse(Boolean(query.matches));
    apply();
    query.addEventListener?.('change', apply);
    return () => query.removeEventListener?.('change', apply);
  }, []);
  return coarse;
}

export function useLandscapePhone() {
  const [landscape, setLandscape] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(pointer: coarse) and (orientation: landscape) and (max-height: 500px)');
    const apply = () => setLandscape(Boolean(query.matches));
    apply();
    query.addEventListener?.('change', apply);
    return () => query.removeEventListener?.('change', apply);
  }, []);
  return landscape;
}


/**
 * `navigator.connection` — used for data-saver defaults and the "480p to avoid
 * buffering" chip. Also reports the file size warning for big remuxes.
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener?.('online', on);
    window.addEventListener?.('offline', off);
    return () => {
      window.removeEventListener?.('online', on);
      window.removeEventListener?.('offline', off);
    };
  }, []);
  return online;
}

export function useFullscreen({ onToggle } = {}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const supported = useMemo(() => {
    if (typeof document === 'undefined') return false;
    const probe = document.createElement('div');
    return typeof probe.requestFullscreen === 'function' || typeof probe.webkitRequestFullscreen === 'function';
  }, []);

  useEffect(() => {
    const apply = () => setIsFullscreen(Boolean(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement));
    const events = ['fullscreenchange', 'webkitfullscreenchange'];
    for (const name of events) document.addEventListener?.(name, apply);
    apply();
    return () => {
      for (const name of events) document.removeEventListener?.(name, apply);
    };
  }, []);

  const toggle = useCallback(
    (element) => {
      if (!element) return;
      const active = document.fullscreenElement || document.webkitFullscreenElement;
      if (active) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        exit?.call(document)?.catch?.(() => {});
        try {
          window.screen?.orientation?.unlock?.();
        } catch {}
        return;
      }
      const request = element.requestFullscreen || element.webkitRequestFullscreen;
      if (!request) return;
      Promise.resolve(request.call(element, { navigationUI: 'hide' }))
        .then(() => {
          // iOS/Safari webviews and Android both need the wrapper fullscreen +
          // an orientation lock; element-fullscreen on <video> is unreliable.
          if (/android|iphone|ipad|mobile/i.test(navigator.userAgent || '')) {
            try {
              window.screen?.orientation?.lock?.('landscape')?.catch?.(() => {});
            } catch {}
          }
        })
        .catch?.(() => {});
    },
    [],
  );

  useEffect(() => {
    onToggle?.(isFullscreen);
  }, [isFullscreen, onToggle]);

  return { isFullscreen, canFullscreen: supported, toggleFullscreen: toggle };
}

export function usePip(videoEl) {
  const [pipActive, setPipActive] = useState(false);
  const supported = useMemo(() => {
    if (typeof document === 'undefined') return false;
    return Boolean(document.pictureInPictureEnabled) || Boolean(videoEl?.webkitSupportsPresentationMode);
  }, [videoEl]);

  useEffect(() => {
    if (!videoEl) return undefined;
    const onEnter = () => setPipActive(true);
    const onLeave = () => setPipActive(false);
    videoEl.addEventListener?.('enterpictureinpicture', onEnter);
    videoEl.addEventListener?.('leavepictureinpicture', onLeave);
    setPipActive(Boolean(document.pictureInPictureElement));
    return () => {
      videoEl.removeEventListener?.('enterpictureinpicture', onEnter);
      videoEl.removeEventListener?.('leavepictureinpicture', onLeave);
    };
  }, [videoEl]);

  const toggle = useCallback(async () => {
    if (!videoEl) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        return;
      }
      if (document.pictureInPictureEnabled && !videoEl.paused) {
        await videoEl.requestPictureInPicture();
        return;
      }
      if (videoEl.webkitSupportsPresentationMode?.()) {
        videoEl.webkitPresentationMode = videoEl.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture';
      }
    } catch {}
  }, [videoEl]);

  return { pipActive, canPip: supported, togglePip: toggle };
}

export function useAirPlay(videoEl) {
  const available = useMemo(
    () => typeof videoEl?.webkitShowPlaybackTargetPicker === 'function' && Boolean(videoEl?.playbackTargetPickerShowing !== undefined),
    [videoEl],
  );
  const show = useCallback(() => {
    try {
      videoEl?.webkitShowPlaybackTargetPicker?.();
    } catch {}
  }, [videoEl]);
  return { canAirPlay: available, showAirPlay: show };
}

/** Screen wake lock so a phone does not sleep mid-episode. */
export function useWakeLock(active) {
  const lockRef = useMemo(() => ({ current: null }), []);
  useEffect(() => {
    let cancelled = false;
    const release = () => {
      try {
        lockRef.current?.release?.();
      } catch {}
      lockRef.current = null;
    };
    const acquire = async () => {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || !active) return;
      try {
        if (!lockRef.current && !cancelled) lockRef.current = await navigator.wakeLock.request('screen');
      } catch {}
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      release();
      document.removeEventListener?.('visibilitychange', onVisibility);
    };
  }, [active, lockRef]);
}

export function useVibrate(prefs) {
  return useCallback(
    (pattern) => {
      if (!prefs?.haptics) return;
      try {
        navigator.vibrate?.(pattern);
      } catch {}
    },
    [prefs?.haptics],
  );
}

/** "2.9 GB · HEVC" warnings for a source before the user commits to it. */
export function describeSize(bytes) {
  return fmtSize(bytes);
}
