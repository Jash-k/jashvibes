'use client';

/**
 * Gesture layer for the unified player.
 *
 * Rules that the old pages got wrong, encoded here once:
 *   • the layer ignores pointers that start on the controls (`[data-dvp="controls"]`)
 *     so tapping the play button never also toggles playback;
 *   • seek/scrub gestures need `status === 'ready'`, but "show the controls"
 *     always works (an unresponsive-looking black rectangle is worse);
 *   • single finger only — a second pointer cancels the gesture so pinch zoom
 *     still reaches the browser;
 *   • gestures never mutate React state per move beyond one bubble object; the
 *     engine is driven through refs (`setScrubbing`) so `scrubbing` cannot end
 *     up in a listener dependency array (bug B1).
 */

import { useCallback, useRef, useState } from 'react';
import { classifyGesture, tapZone } from '@/lib/player/commands';
import { clampToSeekWindow, readSeekWindow } from '@/lib/player/kind';

const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 380;
const HOLD_RATE = 2;

export function usePlayerGestures({
  engine,
  videoEl,
  status,
  enabled = true,
  coarse = false,
  locked = false,
  onToggleControls,
  onTogglePlay,
  onToggleFullscreen,
  onPulse,
  onHaptic,
  onWake,
  canSeek,
} = {}) {
  const [bubble, setBubble] = useState(null); // {label, value, x, y}
  const [hold2x, setHold2x] = useState(false);
  const [jog, setJog] = useState(null); // {seconds}

  const pointerRef = useRef({ id: null, startX: 0, startY: 0, startAt: 0, zone: 'middle', type: 'touch', active: false });
  const activePointersRef = useRef(0);
  const recentTapRef = useRef({ at: 0, zone: '' });
  const holdTimerRef = useRef(0);
  const holdActiveRef = useRef(false);
  const prevRateRef = useRef(1);
  const magnitudeRef = useRef(0);
  const bubbleTimerRef = useRef(0);

  const ready = status === 'ready' || status === 'buffering' || status === 'recovering' || status === 'ended';

  const flashBubble = useCallback((next) => {
    setBubble(next);
    window.clearTimeout(bubbleTimerRef.current);
    if (next) {
      bubbleTimerRef.current = window.setTimeout(() => setBubble(null), 700);
    }
  }, []);

  const endHold = useCallback(() => {
    window.clearTimeout(holdTimerRef.current);
    if (!holdActiveRef.current) return;
    holdActiveRef.current = false;
    const el = videoEl || engine.videoEl;
    if (el) el.playbackRate = prevRateRef.current || 1;
    setHold2x(false);
    setBubble(null);
    onHaptic?.(12);
  }, [engine.videoEl, onHaptic, videoEl]);

  const startHold = useCallback(() => {
    const el = videoEl || engine.videoEl;
    if (!el || el.paused) return;
    if (Math.abs((Number(el.playbackRate) || 1) - HOLD_RATE) < 0.01) return;
    holdActiveRef.current = true;
    prevRateRef.current = Number(el.playbackRate) || 1;
    el.playbackRate = HOLD_RATE;
    setHold2x(true);
    onHaptic?.([10, 20, 10]);
  }, [onHaptic, videoEl, engine.videoEl]);

  const beginGesture = useCallback(
    (event) => {
      onWake?.();
      if (!enabled || locked) return false;
      const target = event.target;
      if (target?.closest?.('[data-dvp="controls"]')) return false;

      activePointersRef.current += 1;
      if (activePointersRef.current > 1) {
        // pinch / second finger: bail out and let the browser do its thing
        pointerRef.current.active = false;
        endHold();
        return false;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      pointerRef.current = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rectLeft: rect.left,
        rectWidth: rect.width,
        rectTop: rect.top,
        rectHeight: rect.height,
        startAt: Date.now(),
        zone: tapZone(event.clientX, rect),
        type: event.pointerType || 'touch',
        active: true,
        lastX: event.clientX,
        lastY: event.clientY,
      };

      if (pointerRef.current.type === 'mouse') return true;

      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = window.setTimeout(startHold, LONG_PRESS_MS);
      return true;
    },
    [enabled, endHold, locked, onWake, startHold],
  );

  const moveGesture = useCallback(
    (event) => {
      const state = pointerRef.current;
      if (!state.active || state.id !== event.pointerId) return;
      state.lastX = event.clientX;
      state.lastY = event.clientY;

      if (state.type === 'mouse') {
        if (!event.buttons) return;
        if (!canSeek || !ready) return;
        const el = videoEl || engine.videoEl;
        const win = readSeekWindow(el);
        if (!win) return;
        const ratio = Math.min(1, Math.max(0, (event.clientX - state.rectLeft) / Math.max(1, state.rectWidth)));
        const target = clampToSeekWindow(el, win.start + ratio * (win.end - win.start));
        if (target === null) return;
        engine.setScrubbing(true, target);
        setJog({ seconds: target });
        return;
      }

      // A drag long enough to be a swipe cancels the long-press intent.
      const distance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
      if (distance > 14) window.clearTimeout(holdTimerRef.current);

      const gesture = classifyGesture(
        {
          startX: state.startX,
          startY: state.startY,
          endX: event.clientX,
          endY: event.clientY,
          durationMs: Date.now() - state.startAt,
          pointerType: state.type,
          zone: state.zone,
        },
        {},
      );

      if (gesture.type === 'brightness' || gesture.type === 'volume') {
        const el = videoEl || engine.videoEl;
        const step = (gesture.magnitude - magnitudeRef.current) / Math.max(160, state.rectHeight || 320);
        magnitudeRef.current = gesture.magnitude;
        if (gesture.type === 'brightness') {
          const next = Math.min(1, Math.max(0.15, (Number(el?.style?.filter?.match(/([\d.]+)\)?$/)?.[1]) || 1) + step));
          engine.setBrightness(next);
          flashBubble({ label: 'Brightness', value: `${Math.round(next * 100)}%`, x: event.clientX - state.rectLeft, y: event.clientY - state.rectTop });
        } else {
          const next = Math.min(1, Math.max(0, (Number(el?.volume) || 0) + step));
          engine.setVolume(next);
          flashBubble({ label: el?.muted ? 'Unmuted' : 'Volume', value: `${Math.round(next * 100)}%`, x: event.clientX - state.rectLeft, y: event.clientY - state.rectTop });
        }
        return;
      }

      if (gesture.type === 'scrub' && canSeek && ready) {
        const el = videoEl || engine.videoEl;
        const win = readSeekWindow(el);
        if (!win) return;
        const secondsPerDistance = Math.max(1, (win.end - win.start) / Math.max(240, state.rectWidth || 640));
        const target = clampToSeekWindow(el, (Number(el?.currentTime) || 0) + gesture.magnitude * Math.sign(event.clientX - state.startX) * secondsPerDistance);
        if (target === null) return;
        engine.setScrubbing(true, target);
        setJog({ seconds: target, delta: `${event.clientX > state.startX ? '+' : '−'}${Math.round(Math.abs(target - (Number(el?.currentTime) || 0)))}s` });
      }
    },
    [canSeek, engine, flashBubble, ready, videoEl],
  );

  const endGesture = useCallback(
    (event) => {
      const state = pointerRef.current;
      activePointersRef.current = Math.max(0, activePointersRef.current - 1);
      window.clearTimeout(holdTimerRef.current);

      if (holdActiveRef.current) {
        endHold();
        pointerRef.current = { ...state, active: false };
        return;
      }

      if (!state.active || (event && state.id !== undefined && event.pointerId !== state.id)) {
        pointerRef.current = { ...state, active: false };
        return;
      }
      pointerRef.current = { ...state, active: false };
      if (!enabled || locked) return;

      // Commit a jog gesture on release.
      if (jog !== null) {
        const target = jog.seconds;
        setJog(null);
        engine.setScrubbing(false);
        if (target != null) {
          engine.seekTo(target);
          onHaptic?.(12);
        }
        return;
      }

      if (bubble) setBubble(null);

      const gesture = classifyGesture(
        {
          startX: state.startX,
          startY: state.startY,
          endX: event?.clientX ?? state.lastX,
          endY: event?.clientY ?? state.lastY,
          durationMs: Date.now() - state.startAt,
          pointerType: state.type,
          zone: state.zone,
        },
        { recentTap: Date.now() - recentTapRef.current.at < DOUBLE_TAP_MS && recentTapRef.current.zone === state.zone },
      );

      if (gesture.type === 'click' && state.type === 'mouse') {
        onTogglePlay?.();
        return;
      }

      if (gesture.type !== 'tap') return;

      const now = Date.now();
      const isDouble = gesture.doubleTap;
      recentTapRef.current = { at: now, zone: state.zone };

      if (isDouble) {
        if (!ready) {
          onToggleControls?.();
          return;
        }
        if (gesture.command === 'togglePlay') {
          onTogglePlay?.();
          onPulse?.('play');
          return;
        }
        if (!canSeek) {
          onToggleControls?.();
          return;
        }
        const direction = gesture.command === 'seekForward' ? 1 : -1;
        engine.seekBy(direction * 10);
        onPulse?.({ kind: direction > 0 ? 'fwd' : 'back', amount: 10 });
        onHaptic?.(12);
        return;
      }

      // Touch: a single tap only ever reveals controls — never hides them under
      // the finger (the idle timer hides them).
      if (state.type === 'mouse') return;
      onToggleControls?.();
    },
    [bubble, canSeek, enabled, engine, endHold, jog, locked, onHaptic, onPulse, onToggleControls, onTogglePlay, ready],
  );

  const cancelGesture = useCallback((event) => {
    endHold();
    activePointersRef.current = Math.max(0, activePointersRef.current - 1);
    pointerRef.current.active = false;
    setJog(null);
    setBubble(null);
    engine.setScrubbing(false);
    void event;
  }, [engine, endHold]);

  const onDoubleClick = useCallback(
    (event) => {
      if (!coarse && !locked) {
        event?.preventDefault?.();
        onToggleFullscreen?.();
      }
    },
    [coarse, locked, onToggleFullscreen],
  );

  /** Wheel over the picture: volume, or speed with Shift. */
  const onWheel = useCallback(
    (event) => {
      if (!coarse && Math.abs(event.deltaY) > 0) {
        event.preventDefault();
        const step = event.deltaY < 0 ? 0.05 : -0.05;
        if (event.shiftKey) {
          engine.nudgeRate(event.deltaY < 0 ? 0.25 : -0.25);
        } else {
          const el = videoEl || engine.videoEl;
          engine.setVolume((Number(el?.volume) || 0) + step);
          if (el?.muted && step > 0) engine.toggleMute();
        }
      }
    },
    [coarse, engine, videoEl],
  );

  const layerProps = {
    onPointerDown: beginGesture,
    onPointerMove: moveGesture,
    onPointerUp: endGesture,
    onPointerCancel: cancelGesture,
    onDoubleClick,
    onWheel,
  };

  return { layerProps, bubble, hold2x, jog, ready };
}

export default usePlayerGestures;
