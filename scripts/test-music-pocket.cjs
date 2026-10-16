/**
 * test-music-pocket.cjs — the focus-mode contract (the lock button in the Music transport).
 *
 * The owner asked for three things at once, so each gets its own section here:
 *   1. the mobile Lyrics panel no longer offers an "Exit focus" button;
 *   2. pressing the lock button blurs every layer except the lyrics (or the sleeve, in
 *      artwork mode — whichever was chosen) and locks touches;
 *   3. the screen is asked to stay awake for exactly as long as focus lasts.
 *
 * The wake-lock timing rules are exercised for real (the module is loaded from a temp dir so
 * its relative imports resolve); the rest is wiring, because the browser pass proves pixels
 * and this proves the shape of the thing.
 *
 * Run: node scripts/test-music-pocket.cjs   (also part of `npm run verify`)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const read = (file) => fs.readFileSync(file, 'utf8');

async function loadLib(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-wake-'));
  for (const file of files) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const modules = {};
  for (const file of files) modules[path.basename(file)] = await import(pathToFileURL(path.join(dir, path.basename(file))).href);
  return modules;
}

/** A fake Screen Wake Lock backed by a fake navigator. */
function fakeWakeLockEnv({ supported = true, failWith = null } = {}) {
  const calls = { request: 0, release: 0 };
  let resolveRequest = null;
  const sentinel = {
    released: false,
    listeners: [],
    release() { this.released = true; calls.release += 1; },
    addEventListener(type, fn) { if (type === 'release') this.listeners.push(fn); },
    fireRelease() { for (const fn of this.listeners) fn(); },
  };
  const request = (type) => {
    calls.request += 1;
    assert.equal(type, 'screen', "the only lock type is 'screen'");
    if (failWith) return Promise.reject(Object.assign(new Error('no'), { name: failWith }));
    return new Promise((resolve) => { resolveRequest = () => resolve(sentinel); });
  };
  return {
    calls,
    sentinel,
    env: { wakeLock: supported ? { request } : null },
    settle: () => resolveRequest?.(),
  };
}

(async () => {
  // ── 1. the wake lock tells the truth ──────────────────────────────────────
  const { 'wakeLock.js': wake } = await loadLib(['lib/wakeLock.js']);

  // Unsupported (iOS before 16.4, some in-app browsers) is a state, not a crash.
  const unsupported = wake.createWakeLock({ wakeLock: null });
  assert.equal(await unsupported.acquire(), 'unsupported');
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.held, false);
  unsupported.release(); // must not throw

  // The happy path: one request, released on the way out.
  const ok = fakeWakeLockEnv();
  const lock = wake.createWakeLock(ok.env);
  const acquiring = lock.acquire();
  assert.equal(ok.calls.request, 1);
  assert.equal(lock.status, 'idle', 'still idle until the browser answers');
  ok.settle();
  await acquiring;
  assert.equal(lock.status, 'active');
  assert.equal(lock.held, true);
  lock.release();
  assert.equal(ok.sentinel.released, true, 'the sentinel must be handed back');
  assert.equal(lock.held, false);
  assert.equal(lock.status, 'idle');

  // A refusal (battery saver, permissions policy) is surfaced, never thrown.
  const denied = fakeWakeLockEnv({ failWith: 'NotAllowedError' });
  const deniedLock = wake.createWakeLock(denied.env);
  assert.equal(await deniedLock.acquire(), 'denied');
  assert.equal(deniedLock.held, false);

  // Focus can end while the request is still in flight: then the lock must be given straight back.
  const slow = fakeWakeLockEnv();
  const slowLock = wake.createWakeLock(slow.env);
  const pending = slowLock.acquire();
  slowLock.release();
  slow.settle();
  await pending;
  assert.equal(slow.sentinel.released, true, 'a lock that arrives after focus ended is released immediately');
  assert.equal(slowLock.held, false);

  // The browser releases the sentinel when the page hides; coming back re-takes it, but only
  // while focus is still wanted.
  const revive = fakeWakeLockEnv();
  const reviveLock = wake.createWakeLock(revive.env);
  const first = reviveLock.acquire(); revive.settle(); await first;
  revive.sentinel.fireRelease();
  assert.equal(reviveLock.held, false, 'a browser-released sentinel is forgotten');
  const again = reviveLock.reacquire();
  revive.settle();
  await again;
  assert.equal(revive.calls.request, 2, 'returning to the tab takes the lock again');
  assert.equal(reviveLock.held, true);
  reviveLock.release();
  assert.equal(await reviveLock.reacquire(), 'idle', 'after focus ends nothing is re-taken');

  // installFocusWakeLock: acquires at once (the click is the gesture), listens for visibility,
  // and stops cleanly.
  const listeners = [];
  const fakeDoc = {
    visibilityState: 'hidden',
    addEventListener: (type, fn) => listeners.push({ type, fn }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
  };
  const installedEnv = fakeWakeLockEnv();
  const installed = wake.installFocusWakeLock({ wakeLock: installedEnv.env.wakeLock, document: fakeDoc });
  assert.equal(installedEnv.calls.request, 1, 'requested synchronously, inside the click');
  assert.equal(listeners.filter((l) => l.type === 'visibilitychange').length, 1);
  fakeDoc.visibilityState = 'visible';
  listeners.find((l) => l.type === 'visibilitychange').fn();
  installedEnv.settle();
  await new Promise((resolve) => setTimeout(resolve, 0)); // let the request settle
  assert.equal(installedEnv.calls.request, 1, 'being visible again does not re-request a lock already held');
  assert.equal(installedEnv.sentinel.released, false);
  installed.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(installedEnv.sentinel.released, true, 'stop() hands the lock back');
  assert.equal(listeners.length, 0, 'stop() must unhook the listener');

  // ── 2. the mobile Lyrics panel has no exit button ─────────────────────────
  const lyrics = read('components/music/CanvasLyrics.jsx');
  assert(!lyrics.includes('mc-lyrics-exit'), 'the Exit focus button must not be rendered at all');
  assert(!lyrics.includes('>Exit focus<'), 'no text exit left in the Lyrics panel');
  assert(lyrics.includes('mc-lyrics-expand'), 'desktop keeps the expand glyph as its focus control');
  const css = read('components/music/music-canvas.css');
  assert(!/\.mc-lyrics-exit\s*\{[^}]*display:inline-flex/.test(css), 'nothing may reveal the retired exit button on mobile');
  assert(/\.mc-lyrics-exit\s*\{\s*display:none/.test(css), 'the class stays hidden if it ever reappears');
  const mobileBlock = css.slice(css.indexOf('@media (max-width:1023px) {\n  .mc-lyrics-expand'), css.indexOf('@media (max-width:1023px) {\n  .mc-lyrics-expand') + 120);
  assert(mobileBlock.includes('.mc-lyrics-expand { display:none; }'), 'mobile still hides the glyph');

  // ── 3. the blur map ──────────────────────────────────────────────────────
  for (const selector of ['.mc-topbar', '.mc-library-dock', '.mc-transport', '.mc-now-text', '.mc-lyrics > header', '.mc-lyrics > footer', '.jv-rail', '.mobile-dock']) {
    assert(css.includes(`.mc-app.is-pocket ${selector}`), `${selector} must blur in focus mode`);
  }
  assert(/\.mc-app\.is-pocket \.mc-player:not\(\.is-artwork-mode\) \.mc-now-art \{[^}]*filter:blur/.test(css),
    'in lyrics mode the sleeve is chrome too and must blur');
  assert(!/\.mc-app\.is-pocket \.mc-now \{[^}]*blur/.test(css),
    'the sleeve must not be blurred wholesale: artwork mode keeps it sharp');
  assert(/\.mc-app\.is-pocket \.mc-lyric-scroll/.test(css) === false, 'the lyrics themselves must never blur');
  // which layer is on top decides which control stays usable
  const modesZ = Number(css.match(/\.mc-app\.is-pocket \.mc-player-modes \{[^}]*z-index:(\d+)/)[1]);
  const lockZ = Number(css.match(/\.mc-pocket-lock \{[^}]*z-index:(\d+)/)[1]);
  assert(modesZ > lockZ, `the Artwork/Lyrics toggle (z-${modesZ}) must sit above the lock layer (z-${lockZ})`);
  assert(/\.mc-pocket-lock \{[^}]*touch-action:none/.test(css), 'the guard must swallow gestures');
  assert(!css.includes('#04070afa'), 'the old opaque pocket overlay must be gone: the blurred section stays visible');
  assert(/\.mc-pocket-lock \{[^}]*radial-gradient/.test(css), 'the guard is a vignette, not a curtain');
  assert(/\.mc-pocket-lock \{[^}]*var\(--mc-pocket-drag/.test(css), 'the swipe must fade the vignette as feedback');

  // ── 3b. the sleeve keeps the size it had before focus ────────────────────
  // The owner saw the artwork shrink to a thumbnail on locking and asked for the size it has
  // unlocked to be "enough". So focus itself must not touch the artwork at all — not on desktop,
  // not on a phone — and every unlocked size must survive.
  assert(!/\.mc-app\.is-focus[^{]*\.mc-now-art\s*\{/.test(css),
    'focus must not resize the sleeve: locking changes what is sharp, not how big the record is');
  assert(!/\.mc-app\.is-focus \.mc-now \{/.test(css),
    'focus must not re-arrange the now-playing block on phones either');
  for (const size of [
    '.mc-now-art { width:clamp(110px,13vw,190px)',
    '.mc-now-art { width:auto; height:min(25dvh,220px)',
    '.mc-player.is-artwork-mode .mc-now-art { width:auto; height:min(36dvh,360px)',
    '.mc-player.is-artwork-mode .mc-now-art { height:min(43dvh,400px)',
    '.mc-player.is-artwork-mode .mc-now-art { width:auto; height:min(38dvh,260px)',
  ]) assert(css.includes(size), `the sleeve keeps its unlocked size: missing ${size}`);
  // The artwork is a disc, so the sleeve rules must not leave it square: one aspect ratio, no explicit height in lyrics mode.
  assert(!/\.mc-app\.is-focus \.mc-now-art[^}]*height/.test(css), 'no focus rule may pin the sleeve height');

  // ── 4. the guard's gestures ──────────────────────────────────────────────
  const guard = read('components/music/PocketLock.jsx');
  // Assertions read the code, not the commentary: the component's doc comment is allowed to explain
  // what was removed, or the next reader will add the wording back as an "obvious improvement".
  const guardCode = guard.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const needed of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onPointerCancel']) {
    assert(guard.includes(needed), `the swipe needs ${needed}`);
  }
  assert(guard.includes('SWIPE_COMMIT'), 'the swipe threshold must be a named constant');
  assert(guard.includes("event.key === 'Escape'"), 'Escape unlocks on desktop');
  assert(guard.includes('ctrlKey && event.shiftKey'), 'the keyboard chord stays available');
  assert(guard.includes('mc-pocket-slider'), 'the slide-to-unlock puck is kept');
  assert(guard.includes('event.target.closest?.('), 'the slider must not be mistaken for a swipe start');
  assert(guardCode.includes('role="region"') && !guardCode.includes('aria-modal="true"'),
    'it is not a modal dialog: one control outside it is meant to be used');

  // ── 4b. the guard draws no words (owner's call: the locked screen is the lyrics) ──
  // The overlay used to carry a lock glyph, a "Focus locked" heading, a paragraph, a swipe hint
  // and a footer. All of it is gone: advice printed over the thing you locked the screen to look
  // at defeats the point. The gesture is the feedback, and the outcomes are announced instead.
  for (const phrase of ['Focus locked', 'Swipe down to unlock', 'Slide to unlock', 'also unlocks', 'stay awake', 'Only your lyrics stay sharp']) {
    assert(!guardCode.includes(phrase), `the guard must not print “${phrase}” any more`);
  }
  assert(!guardCode.includes('MusicIcon name="lock"'), 'the lock glyph is gone from the locked screen');
  assert(!/hint|is-hinting/.test(guardCode), 'and so is the hint timer that used to bring the wording back');
  assert(!css.includes('.mc-pocket-grab') && !css.includes('.mc-pocket-copy') && !css.includes('.mc-pocket-foot'),
    'no orphaned rules for the removed blocks');
  // It must still be a control someone can find and use, and still explain itself to assistive tech.
  assert(guard.includes('aria-label="Focus mode"'), 'the region keeps an accessible name');
  assert(guard.includes('Drag right to leave focus mode'), 'the handle keeps an accessible label');
  // Silence would be the one lie this state must not tell — see §5 for where the outcome is announced.
  assert(!guardCode.includes('awake'), 'the guard no longer renders the wake-lock result');

  // ── 5. the shell: enter, exit, and Back ──────────────────────────────────
  const shell = read('components/music/MusicShell.jsx');
  assert(/onClick=\{enterPocket\}/.test(shell), 'the lock button is the way in');
  assert(shell.includes('Focus: blur everything but the lyrics or sleeve'), 'the button must say what it now does');
  assert(shell.includes('is-pocket'), 'the app must carry the locked state for the CSS');
  assert(/const awake = useWakeLock\(pocketLocked\)/.test(shell), 'wake lock follows focus, nothing else');
  assert(shell.includes('<PocketLock onUnlock={() => exitPocket()}/>'), 'the silent guard is mounted with just its exit');
  assert(/if \(!pocketLocked\) return;/.test(shell), 'the wake-lock notice is tied to focus, not to any render');
  // With the caption gone, the announcement is the only honest report of a browser that cannot hold
  // the screen awake (iOS < 16.4, in-app browsers) or a refusal.
  assert(shell.includes("awake === 'unsupported'") && shell.includes("awake === 'denied'"),
    'the shell announces an unsupported wake lock, and a refusal');
  assert(/setNotice\('This browser will not hold the screen awake'\)/.test(shell),
    'the announcement names the consequence in plain words');
  assert(shell.includes('pocketReturn.current'), 'the pre-focus layout is remembered');
  assert(/setFull\(back.full\)/.test(shell) && /setLibraryOpen\(back.libraryOpen\)/.test(shell),
    'unlocking must put the screen back as it was');
  assert(shell.includes('jvFocus'), 'focus pushes one history entry');
  assert(/locationState\(tab, false, false, true, mode\)/.test(shell),
    'the locked layout is written to the URL by replace, so a rotate cannot re-open the library under the blur');
  assert(guard.includes('dragRef'), 'a flicked swipe must judge a ref, not a possibly-stale render');
  assert(/addEventListener\('popstate', onPop\)/.test(shell), 'Back must be able to unlock');
  assert(/if \(pocketRef\.current\) exitPocket\(true\)/.test(shell), 'the pop handler unlocks rather than navigating');
  assert(/if \(!fromHistory\) \{[\s\S]{0,220}window\.history\.back\(\)/.test(shell),
    'a gesture exit restores the URL it changed and then returns the history entry');
  assert(shell.includes('const chooseView = (view)') && shell.includes("chooseView('artwork')") && shell.includes("chooseView('lyrics')"),
    'the mode toggle goes through the pocket-aware path');
  assert(/if \(pocketLocked\) \{\s*setMode\(view\);/.test(shell), 'switching the view must not sneak focus off');
  assert(!/setPocketLocked\(true\)[^;]*;[^}]*notice/s.test(shell), 'no toast under the blur');

  const hook = read('components/music/useWakeLock.js');
  assert(hook.includes('installFocusWakeLock') && hook.includes('lock.stop()'), 'the hook owns acquire and release');
  assert(hook.includes("if (!active) { setStatus('idle')"), 'leaving focus releases immediately');

  // ── 6. the old prototype is gone, not shadowed ───────────────────────────
  const engine = read('components/music/MusicEngine.jsx');
  for (const dead of ['pocketMode', 'pocketHold', 'startPocketUnlock', 'listeningMode', 'wakeLockStatus', 'requestWakeLock', 'muLockView', 'startUnlockHold']) {
    assert(!engine.includes(dead), `${dead} was dead code beside the new focus mode and must not come back`);
  }
  assert(!read('lib/musicCore.js').includes('muLockView'), 'muLockView existed only for that dead memo');

  console.log('PASS focus mode: the sleeve keeps its unlocked size under focus (no shrinking rule left), wake lock acquired/released/re-taken truthfully and announced by the shell when it cannot be, blur map per view, one live control above the lock, a locked screen that prints no words (lock glyph, heading, hint, labels and footer removed, no hint timer), swipe-down + slide + Esc + Back exits, no mobile exit button, old pocket prototype removed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
