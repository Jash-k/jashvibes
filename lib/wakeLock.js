/**
 * wakeLock — keep the screen awake while focus mode is on.
 *
 * Focus mode exists so the phone can sit in front of you and read lyrics (or show the
 * sleeve) without the screen dimming mid-verse. The browser API for that is Screen Wake
 * Lock, and it has three quirks that shape this module:
 *
 *   1. it must be requested from a user gesture — the focus button click is one, so we
 *      request straight from the handler rather than from an effect;
 *   2. the sentinel is released by the browser the moment the page is hidden (tab switch,
 *      lock screen, another app). Releasing is not an error: on the way back we request
 *      again, and if the user already left focus we must NOT re-take it;
 *   3. it does not exist everywhere — iOS before 16.4, some in-app browsers. Unsupported
 *      is a normal state, not a failure: the caller is told, so the UI can say something
 *      true instead of promising an awake screen it cannot deliver.
 *
 * No timers, no polling, no silent-video hack: if the API is missing we say so.
 *
 * Written as a factory over an injected environment so `scripts/test-music-pocket.cjs`
 * can drive every branch without a browser.
 */

const STATE = { IDLE: 'idle', ACTIVE: 'active', UNSUPPORTED: 'unsupported', DENIED: 'denied' };

function defaultEnv() {
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const doc = typeof document !== 'undefined' ? document : null;
  return {
    wakeLock: nav?.wakeLock || null,
    now: () => Date.now(),
    document: doc,
  };
}

/**
 * @param {{ wakeLock?: { request: (type: string) => Promise<any> } | null, now?: () => number, document?: Document | null }} env
 */
export function createWakeLock(env = defaultEnv()) {
  let sentinel = null;
  let inflight = null;     // a request that has been made but not yet answered
  let wanted = false;      // the user is in focus mode
  let status = env.wakeLock ? STATE.IDLE : STATE.UNSUPPORTED;
  const listeners = [];
  const notify = () => { for (const fn of listeners) fn(status); };

  function bind(screenSentinel) {
    // The browser fires 'release' when the page is hidden or the lock is revoked; forget the
    // sentinel so a later reacquire() can take a fresh one instead of trusting a dead handle.
    screenSentinel?.addEventListener?.('release', () => {
      if (sentinel === screenSentinel) { sentinel = null; if (wanted) status = STATE.IDLE; notify(); }
    });
  }

  async function acquire() {
    wanted = true;
    if (!env.wakeLock) { status = STATE.UNSUPPORTED; notify(); return status; }
    // One request at a time: a visibility change while the first request is still unanswered
    // used to fire a second one (caught by scripts/test-music-pocket.cjs), and the extra
    // sentinel was then unreachable — leaking a lock nobody could release.
    if (sentinel || inflight) { await inflight?.catch?.(() => {}); return status; }
    inflight = (async () => {
      try {
        const next = await env.wakeLock.request('screen');
        // Focus may have ended while the request was in flight — then hand it straight back.
        if (!wanted) { next?.release?.(); return; }
        sentinel = next;
        bind(next);
        status = STATE.ACTIVE;
      } catch {
        // NotAllowedError (battery saver, permissions policy, not a gesture) or any other refusal.
        status = STATE.DENIED;
      } finally {
        inflight = null;
        notify();
      }
    })();
    await inflight;
    return status;
  }

  function release() {
    wanted = false;
    const current = sentinel;
    sentinel = null;
    try { current?.release?.(); } catch { /* already gone */ }
    if (status === STATE.ACTIVE) status = STATE.IDLE;
    notify();
  }

  /** The page came back to the foreground while focus was still on. */
  function reacquire() {
    if (!wanted || sentinel) return status;
    return acquire();
  }

  return {
    acquire,
    release,
    reacquire,
    subscribe(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    get status() { return status; },
    get held() { return Boolean(sentinel); },
  };
}

/**
 * The browser-side plumbing: acquire now (inside the click), release on the way out, and
 * take the lock again when the page becomes visible — only while focus is still wanted.
 * @returns {{ status: string, stop: () => void }}
 */
export function installFocusWakeLock(env = {}) {
  const doc = env.document || (typeof document !== 'undefined' ? document : null);
  const controller = createWakeLock(env);
  controller.acquire();
  const onVisibility = () => { if (doc?.visibilityState === 'visible') controller.reacquire(); };
  doc?.addEventListener?.('visibilitychange', onVisibility);
  return {
    controller,
    get status() { return controller.status; },
    subscribe: controller.subscribe,
    stop() {
      doc?.removeEventListener?.('visibilitychange', onVisibility);
      controller.release();
    },
  };
}
