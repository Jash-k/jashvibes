/**
 * Player command bus.
 *
 * Every action the player can take is declared ONCE here, with both its
 * desktop binding (keyboard) and its touch binding (gesture) listed. A test
 * asserts the parity table, so a feature can never again ship on one device
 * class only — the mistake that lost swipe-brightness/volume in v8.1.0.
 */

/**
 * `button` = a control-bar/menu button exists (touch reachable without a
 * gesture); `menu` = reachable from the settings sheet; `desktopOnly` = a real
 * PC-only affordance (hover, precise keys) that mobile does not need.
 * parityReport() treats any one of gesture|button|menu as touch-reachable.
 */
export const COMMANDS = {
  togglePlay: { label: 'Play / pause', keys: [' ', 'k'], gesture: 'tap-center', button: true, icon: 'play' },
  seekBack: { label: 'Back 10 s', keys: ['j', 'arrowleft'], gesture: 'double-tap-left', button: true, repeatable: true },
  seekForward: { label: 'Forward 10 s', keys: ['l', 'arrowright'], gesture: 'double-tap-right', button: true, repeatable: true },
  // No ±30 buttons: on touch the same reach comes from stacking double-taps
  // (3 taps = 30 s) or the scrub bar, so these are honestly keyboard-only.
  seekBack30: { label: 'Back 30 s', keys: ['shift+arrowleft'], gesture: null, desktopOnly: true },
  seekForward30: { label: 'Forward 30 s', keys: ['shift+arrowright'], gesture: null, desktopOnly: true },
  frameBack: { label: 'Previous frame', keys: [','], gesture: null, desktopOnly: true },
  frameForward: { label: 'Next frame', keys: ['.'], gesture: null, desktopOnly: true },
  jumpToPercent: { label: 'Jump to 0–90 %', keys: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], gesture: 'drag-scrubber', desktopOnly: true },
  nudgeVolumeUp: { label: 'Volume up', keys: ['arrowup'], gesture: 'swipe-right-up', button: true },
  nudgeVolumeDown: { label: 'Volume down', keys: ['arrowdown'], gesture: 'swipe-right-down' },
  mute: { label: 'Mute', keys: ['m'], gesture: null, button: true },
  brightnessUp: { label: 'Brightness up', keys: ['n'], gesture: 'swipe-left-up' },
  brightnessDown: { label: 'Brightness down', keys: ['b'], gesture: 'swipe-left-down' },
  speedUp: { label: 'Faster', keys: [']', '>'], gesture: 'long-press', menu: true },
  speedDown: { label: 'Slower', keys: ['[', '<'], gesture: null, menu: true },
  speedReset: { label: 'Normal speed', keys: ['\\'], gesture: null, menu: true },
  toggleFullscreen: { label: 'Fullscreen', keys: ['f'], gesture: null, button: true },
  togglePip: { label: 'Picture in picture', keys: ['p', 'o'], gesture: null, menu: true },
  cycleCaptions: { label: 'Subtitles on/off', keys: ['t', 'c', 's'], gesture: null, menu: true },
  openSubtitles: { label: 'Subtitle options', keys: ['shift+c'], gesture: null, menu: true },
  subtitleDelayUp: { label: 'Subtitle delay +250 ms', keys: ['shift+arrowup'], gesture: null, desktopOnly: true, menu: true },
  subtitleDelayDown: { label: 'Subtitle delay −250 ms', keys: ['shift+arrowdown'], gesture: null, desktopOnly: true, menu: true },
  cycleAudioTrack: { label: 'Audio track', keys: ['a'], gesture: null, menu: true },
  cycleQuality: { label: 'Quality', keys: ['q'], gesture: null, button: true, menu: true },
  qualityAuto: { label: 'Quality: auto', keys: ['shift+q'], gesture: null, menu: true },
  toggleAmbient: { label: 'Ambient dim', keys: ['y'], gesture: null, desktopOnly: true },
  toggleStats: { label: 'Stats overlay', keys: ['i'], gesture: null, desktopOnly: true, menu: true },
  toggleControls: { label: 'Show / hide controls', keys: ['h'], gesture: 'tap-anywhere' },
  lockControls: { label: 'Lock player', keys: ['shift+l'], gesture: null, desktopOnly: true },
  freezeFrame: { label: 'Freeze frame (hold the picture)', keys: ['shift+f'], gesture: null, menu: true },
  skipMarks: { label: 'Skip intro', keys: ['shift+x'], gesture: 'tap-skip', button: true },
  // No dedicated button: on touch the same thing is a stacked double-tap on
  // the left edge, which the scrub bar and −10 already cover.
  replaySegment: { label: 'Replay 10 s', keys: ['r'], gesture: null, desktopOnly: true },
  loopSegment: { label: 'A–B loop', keys: ['shift+r'], gesture: null, desktopOnly: true },
  restart: { label: 'Restart from 0', keys: ['home'], gesture: null, menu: true },
  closeMenus: { label: 'Close menu', keys: ['escape'], gesture: 'tap-outside' },
  prevItem: { label: 'Previous channel/episode', keys: ['pageup'], gesture: 'swipe-down-right' },
  nextItem: { label: 'Next channel/episode', keys: ['pagedown'], gesture: 'swipe-down-left' },
};

/** Keys that must never be swallowed by the player (typing in a field etc). */
export const IGNORED_TARGETS = new Set(['input', 'textarea', 'select', 'button', 'a', '[contenteditable="true"]']);

/**
 * Resolve a KeyboardEvent to a command name (or null).
 * Modifier-prefixed bindings ("shift+arrowup") win over bare ones.
 */
export function commandForKey(event, { enabled = true } = {}) {
  if (!enabled || !event) return null;
  const target = event.target;
  const tag = String(target?.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select'].includes(tag) || target?.isContentEditable) return null;

  const key = normalizeKeyName(event.key);
  if (!key) return null;

  const combo = `${event.shiftKey ? 'shift+' : ''}${event.ctrlKey || event.metaKey ? 'mod+' : ''}${key}`;
  const bare = key;

  for (const [name, command] of Object.entries(COMMANDS)) {
    const bindings = command.keys || [];
    if (bindings.includes(combo)) return name;
    if (!event.shiftKey && !event.ctrlKey && !event.metaKey && bindings.includes(bare)) return name;
  }
  return null;
}

function normalizeKeyName(raw) {
  const key = String(raw || '');
  if (!key) return '';
  if (key === 'Spacebar' || key === ' ') return ' ';
  const lower = key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'pageup', 'pagedown', 'escape'].includes(lower)) return lower;
  if (key.length === 1) return lower;
  return lower;
}

/**
 * Digit seeks (0–9 → 0 %–90 %) need the actual key, not just the command name.
 * Returns 0–90, or null when the event is not a digit.
 */
export function digitSeekPercent(event) {
  const key = normalizeKeyName(event?.key);
  if (!/^[0-9]$/.test(key)) return null;
  return Number(key) * 10;
}

/**
 * Gesture classification for the touch layer.
 * Pure so it can be unit-tested without a browser.
 */
export function classifyGesture({ startX, startY, endX, endY, durationMs, pointerType = 'touch', zone = 'middle' }, state = {}) {
  const dx = Number(endX) - Number(startX);
  const dy = Number(endY) - Number(startY);
  const distance = Math.hypot(dx, dy);
  const isTap = distance < 14 && durationMs < 240;

  if (pointerType === 'mouse') {
    return { type: isTap ? 'click' : 'drag', command: null };
  }

  if (isTap) {
    return { type: 'tap', command: zone === 'left' ? 'seekBack' : zone === 'right' ? 'seekForward' : 'togglePlay', doubleTap: Boolean(state.recentTap) };
  }

  if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 28) {
    if (zone === 'left') return { type: 'brightness', command: dy < 0 ? 'brightnessUp' : 'brightnessDown', magnitude: Math.abs(dy) };
    if (zone === 'right') return { type: 'volume', command: dy < 0 ? 'nudgeVolumeUp' : 'nudgeVolumeDown', magnitude: Math.abs(dy) };
    return { type: 'ignore', command: null };
  }

  if (Math.abs(dx) > 40) {
    return { type: 'scrub', command: dx > 0 ? 'seekForward' : 'seekBack', magnitude: Math.abs(dx) };
  }

  return { type: 'ignore', command: null };
}

export function tapZone(clientX, rect, edges = { left: 0.3, right: 0.7 }) {
  const ratio = (Number(clientX) - Number(rect.left)) / Math.max(1, Number(rect.width));
  if (ratio < edges.left) return 'left';
  if (ratio > edges.right) return 'right';
  return 'middle';
}

/**
 * Parity report — used by `tests/player-commands.test.js` and by /player-lab.
 *
 * A command is touch-reachable when it has a gesture, a chrome button, or a
 * menu entry. Anything keyboard-only must be marked `desktopOnly` explicitly,
 * so "we forgot swipe on mobile" can never be an accident again (v8.1.0 lost
 * swipe brightness/volume exactly this way).
 */
export function parityReport() {
  const gaps = [];
  const mobileOnly = [];
  const desktopOnly = [];
  for (const [name, command] of Object.entries(COMMANDS)) {
    const hasKeys = Boolean(command.keys?.length);
    const hasGesture = Boolean(command.gesture);
    const chromeReachable = Boolean(command.button || command.menu);
    if (!hasKeys && !hasGesture && !chromeReachable) {
      gaps.push({ name, why: 'no input path at all' });
      continue;
    }
    if (!hasGesture && !chromeReachable && !command.desktopOnly) {
      gaps.push({ name, why: 'keyboard-only but not marked desktopOnly' });
      continue;
    }
    if (!hasKeys && (hasGesture || chromeReachable)) mobileOnly.push(name);
    if (hasKeys && command.desktopOnly) desktopOnly.push(name);
  }
  return { total: Object.keys(COMMANDS).length, gaps, mobileOnly, desktopOnly };
}

/** Every key → command binding, for the chrome's key handler and the help sheet. */
export function keyMap() {
  const map = {};
  for (const [name, command] of Object.entries(COMMANDS)) {
    for (const key of command.keys || []) {
      if (!map[key]) map[key] = [];
      map[key].push(name);
    }
  }
  return map;
}

export function listCommands() {
  return Object.entries(COMMANDS).map(([name, command]) => ({
    name,
    label: command.label,
    keys: command.keys || [],
    gesture: command.gesture || null,
    desktopOnly: Boolean(command.desktopOnly),
  }));
}
