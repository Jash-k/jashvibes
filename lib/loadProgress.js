/**
 * loadProgress — the clock and the arithmetic behind the loading ring.
 *
 * The rule the user asked for: *the circle finishing and the page being ready must be the
 * same moment*. A timer alone cannot promise that, and raw progress alone freezes at 60%
 * when one request hangs. So this module mixes the two:
 *
 *   floor    an exponential curve that always creeps forward, so the ring never looks dead.
 *            It half-slows while a request is still in flight.
 *   ceiling  the floor is capped at READY_CAP (92%). The ring *cannot* complete on its own —
 *            the last 8% belongs to the content actually arriving.
 *   close    once the section reports settled, the arc sweeps the last 8% over CLOSE_MS,
 *            and completing is exactly what lifts the blur and shows the page.
 *   escape   VEIL_MAX_MS. If a request never settles the ring still closes and the section
 *            keeps its own skeleton — a loader must never become a hostage situation.
 *
 * The 200 ms rule survives: nothing is shown before VEIL_DELAY_MS, so a warm or prefetched
 * switch still shows no ring at all.
 *
 * Scope: every route, no exceptions. Watch, the embed browser and Admin were briefly excluded
 * (they own their whole screen) and were then asked for as well, so the exclusion was removed
 * rather than left behind as a dead switch.
 *
 * What counts as "settled", in order:
 *   - the new page committed AND its first burst of /api requests is done (the normal case);
 *   - the new page committed AND asked for nothing within QUIET_MS (cache hit, static page);
 *   - VEIL_MAX_MS passed, whatever the requests are doing.
 *
 * Plain JS, no DOM, no React — `scripts/test-loading-system.cjs` exercises it directly.
 *
 * Two kinds of subscription, because the two consumers want different rates:
 *   subscribeLoad   coarse events: a load began, the veil became visible, the arc closed,
 *                   the load ended. The shell listens here, so a route switch never
 *                   re-renders the app sixty times a second.
 *   subscribeFrame  the arc position, every animation frame. Only the ring listens.
 */

export const VEIL_DELAY_MS = 200;    // nothing at all is shown before this
export const READY_CAP = 0.92;       // the arc never closes itself
export const CLOSE_MS = 250;         // ...it closes here, once content has landed
const REVEAL_MS = 260;        // blur lift + veil fade
export const VEIL_MAX_MS = 4000;     // a stuck request cannot hold the ring forever
const FLOOR_MS = 1100;        // calm pace while nothing is in flight
const FLOOR_SLOW_MS = 1900;   // half pace while a request is in flight
export const QUIET_MS = 160;         // committed, nothing in flight for this long = ready

/** Requests that are part of loading a section — not media streams, not the auth handshake. */
const TRACKED = /^\/api\//;
const UNTRACKED = [
  /^\/api\/health/,                  // uptime probe, fired by the keep-alive
  /^\/api\/auth/,                    // the unlock handshake, not section content
  /^\/api\/live-proxy/,              // byte streams: they last as long as playback does
  /^\/api\/live-pocket\/proxy/,
  /^\/api\/cron\//,
];

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The arc position, 0…1.
 * @param {{ elapsedMs?: number, settled?: boolean, settledAtMs?: number, pending?: number }} input
 */
export function arcProgress({ elapsedMs = 0, settled = false, settledAtMs = 0, pending = 0 } = {}) {
  const floorMs = pending > 0 ? FLOOR_SLOW_MS : FLOOR_MS;
  const floor = (1 - Math.exp(-Math.max(0, elapsedMs) / floorMs)) * READY_CAP;
  if (!settled) return Math.min(READY_CAP, floor);
  const since = Math.max(0, elapsedMs - settledAtMs);
  return Math.min(1, READY_CAP + (1 - READY_CAP) * (since / CLOSE_MS));
}

/** The 200 ms rule, in one place. */
export function veilVisible({ active = false, elapsedMs = 0 } = {}) {
  return Boolean(active) && elapsedMs >= VEIL_DELAY_MS;
}

let session = null;
let loadId = 0;
let frameRequest = 0;
let finishTimer = 0;
let frameListeners = new Set();
const listeners = new Set();

const emit = () => { for (const fn of listeners) fn(); };

export function subscribeLoad(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function subscribeFrame(fn) {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

const IDLE = Object.freeze({
  active: false, visible: false, progress: 0, phase: 'idle', label: '', href: '', done: false,
});

/** Pure read of where the current load is. Latches `settledAt` once so the close is smooth. */
export function readLoad() {
  if (!session) return IDLE;
  const elapsedMs = clock() - session.startedAt;
  const sinceCommit = session.committed ? clock() - session.committedAt : 0;
  // QUIET_MS after the commit is the grace the first burst of requests gets to register:
  // without it, "nothing is pending" is briefly true in the gap between the new page
  // mounting and its effects firing, and the ring would close a beat too early.
  const quiet = session.committed && sinceCommit >= QUIET_MS && session.pending === 0;
  const settled = Boolean(session.settledAt) || quiet || elapsedMs >= VEIL_MAX_MS;
  if (settled && !session.settledAt) session.settledAt = clock();
  const settledAtMs = session.settledAt ? session.settledAt - session.startedAt : 0;
  const progress = arcProgress({ elapsedMs, settled, settledAtMs, pending: session.pending });
  return {
    active: true,
    visible: veilVisible({ active: true, elapsedMs }),
    progress,
    phase: progress >= 1 ? 'done' : settled ? 'closing' : 'loading',
    done: progress >= 1,
    label: session.label,
    href: session.href,
  };
}

function tickFrame() {
  if (!session) { stopClock(); return; }
  frameRequest = requestAnimationFrame(tickFrame);
  const load = readLoad();
  for (const fn of frameListeners) fn(load);
  if (load.visible && !session.visibleSent) { session.visibleSent = true; emit(); }
  if (load.done && !session.doneSent) {
    session.doneSent = true;
    emit();
    stopClock();
    clearTimeout(finishTimer);
    finishTimer = setTimeout(finishLoad, REVEAL_MS);
  }
}

function startClock() {
  if (frameRequest || typeof requestAnimationFrame !== 'function') return;
  frameRequest = requestAnimationFrame(tickFrame);
}

function stopClock() {
  if (frameRequest) cancelAnimationFrame(frameRequest);
  frameRequest = 0;
}

/**
 * A section is being opened. Called by the pressed link the instant Next reports pending —
 * which is *before* the new page exists, so the section still on screen is the one that
 * gets blurred, exactly as asked.
 */
export function beginPendingLoad({ href = '', label = 'section' } = {}) {
  clearTimeout(finishTimer);
  loadId += 1;
  session = {
    id: loadId,
    href,
    label,
    startedAt: clock(),
    committed: false,
    committedAt: 0,
    settledAt: 0,
    pending: 0,
    visibleSent: false,
    doneSent: false,
  };
  emit();
  startClock();
  return session;
}

/** The new page is mounted. Its data has not necessarily arrived yet. */
export function noteCommitted(href = '') {
  if (!session) return;
  session.committed = true;
  session.committedAt = clock();
  if (href && !session.href) session.href = href;
  emit();
}

/** A section that opened with nothing left to wait for. */

/**
 * Back button, a cancelled navigation, a route that never committed.
 *
 * Tagged with the id of the load the caller began: tapping two sections in quick succession
 * starts a second load, and the first link's "pending" going false must not cancel it.
 */
export function abortLoad(id) {
  if (!session || session.committed) return;
  if (id !== undefined && session.id !== id) return;
  finishLoad();
}

export function finishLoad() {
  if (!session) return;
  clearTimeout(finishTimer);
  stopClock();
  session = null;
  emit();
}

export function noteFetch(delta) {
  if (!session) return;
  if (delta > 0) session.pending += 1;
  else session.pending = Math.max(0, session.pending - 1);
}

/**
 * Only same-origin `/api/…` requests count. The origin check is not decoration: a provider
 * call to someone else's `/api/…` would otherwise be scored as section data (found by the
 * test in `scripts/test-loading-system.cjs` while writing this).
 */
export function shouldTrack(url = '') {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
    const origin = typeof location !== 'undefined' ? location.origin : 'http://localhost';
    const parsed = new URL(url, base);
    if (parsed.origin !== origin) return false;
    if (!TRACKED.test(parsed.pathname)) return false;
    return !UNTRACKED.some((rule) => rule.test(parsed.pathname));
  } catch { return false; }
}

/** Test seam: wipe state without touching the fetch tracker. */
export function __resetLoadProgress() {
  clearTimeout(finishTimer);
  stopClock();
  session = null;
  listeners.clear();
  frameListeners.clear();
}

/** Counts in-flight section requests. Installed once by the shell. */
let trackerInstalled = false;
export function installFetchTracker() {
  if (trackerInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  trackerInstalled = true;
  const original = window.fetch;
  window.fetch = function trackedFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!shouldTrack(url)) return original.call(this, input, init);
    noteFetch(1);
    return original.call(this, input, init).finally(() => noteFetch(-1));
  };
}
