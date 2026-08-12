'use client';

import { useEffect } from 'react';

function isMobileViewport() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(max-width: 900px)')?.matches || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function fullscreenElement() {
  if (typeof document === 'undefined') return null;
  return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
}

async function requestFullscreen(element) {
  if (!element) return;
  element.classList?.add?.('jash-landscape-fullscreen');
  if (element.requestFullscreen) await element.requestFullscreen();
  else if (element.webkitRequestFullscreen) element.webkitRequestFullscreen();
  else if (element.msRequestFullscreen) element.msRequestFullscreen();
}

async function lockLandscape() {
  if (!isMobileViewport()) return false;
  try {
    if (screen?.orientation?.lock) {
      await screen.orientation.lock('landscape');
      return true;
    }
  } catch {}
  return false;
}

function unlockLandscape() {
  try { screen?.orientation?.unlock?.(); } catch {}
}

function markFullscreenElement() {
  const element = fullscreenElement();
  document.querySelectorAll?.('.jash-landscape-fullscreen').forEach((node) => {
    if (node !== element) node.classList.remove('jash-landscape-fullscreen');
  });
  if (element) {
    element.classList?.add?.('jash-landscape-fullscreen');
    lockLandscape();
  } else {
    unlockLandscape();
  }
}

export default function FullscreenOrientationLock() {
  useEffect(() => {
    window.jashLockLandscape = lockLandscape;
    window.jashRequestFullscreen = async (element) => {
      await requestFullscreen(element);
      await lockLandscape();
      markFullscreenElement();
    };

    document.addEventListener('fullscreenchange', markFullscreenElement);
    document.addEventListener('webkitfullscreenchange', markFullscreenElement);
    document.addEventListener('MSFullscreenChange', markFullscreenElement);

    return () => {
      document.removeEventListener('fullscreenchange', markFullscreenElement);
      document.removeEventListener('webkitfullscreenchange', markFullscreenElement);
      document.removeEventListener('MSFullscreenChange', markFullscreenElement);
      try { delete window.jashLockLandscape; } catch {}
      try { delete window.jashRequestFullscreen; } catch {}
      unlockLandscape();
    };
  }, []);

  return null;
}
