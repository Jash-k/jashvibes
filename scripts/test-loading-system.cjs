/**
 * test-loading-system.cjs — locks in the loading/switching contract.
 *
 * Every assertion maps to a specific failure we have already seen, so a future edit fails
 * loudly instead of quietly bringing one back:
 *
 *   1. boot      — a minimum splash time (a gate that answers in 40 ms must not flash);
 *   2. handoff   — the splash leaves when its ring closes, not when the gate answers;
 *   3. ring      — the arc cannot complete itself: real content has to arrive;
 *   4. shell     — the rail/dock never unmount on a section switch;
 *   5. one tell  — no floating "Opening X…" pill; pending shows on the pressed link;
 *   6. 200 ms    — a fast section shows no ring and no blur at all;
 *   7. geometry  — each fallback matches the grid it stands in for;
 *   8. hooks     — the veil hook runs before the early returns (React order rule).
 *
 * Run: node scripts/test-loading-system.cjs   (also part of `npm run verify`)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const read = (file) => fs.readFileSync(file, 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Loads app modules for real, into a temp dir so their relative imports resolve. */
async function loadLib(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-lib-'));
  for (const file of files) fs.copyFileSync(file, path.join(dir, path.basename(file)));
  const modules = {};
  for (const file of files) modules[path.basename(file)] = await import(pathToFileURL(path.join(dir, path.basename(file))).href);
  return modules;
}

(async () => {
  // ── 1/2. boot timing ───────────────────────────────────────────────────────
  const { 'bootPhase.js': boot } = await loadLib(['lib/loadProgress.js', 'lib/bootPhase.js']);
  assert.equal(boot.SPLASH_MIN_MS, 500);
  assert.equal(boot.SPLASH_HANDOFF_MS, boot.SPLASH_MIN_MS + boot.SPLASH_CLOSE_MS, 'the hand-off is the minimum plus the ring closing');

  assert.deepEqual(boot.splashPhase({ status: 'checking', elapsedMs: 0 }), { visible: true, phase: 'brand' });
  assert.deepEqual(boot.splashPhase({ status: 'checking', elapsedMs: 9000 }), { visible: true, phase: 'slow' });
  assert.deepEqual(boot.splashPhase(), { visible: true, phase: 'brand' });
  for (const status of ['locked', 'unlocked']) {
    assert.deepEqual(boot.splashPhase({ status, elapsedMs: 0 }), { visible: true, phase: 'brand' });
    // answered, but the ring has not closed yet: still the splash
    assert.deepEqual(boot.splashPhase({ status, elapsedMs: boot.SPLASH_MIN_MS }), { visible: true, phase: 'brand' });
    assert.deepEqual(boot.splashPhase({ status, elapsedMs: boot.SPLASH_HANDOFF_MS - 1 }), { visible: true, phase: 'brand' });
    assert.deepEqual(boot.splashPhase({ status, elapsedMs: boot.SPLASH_HANDOFF_MS }), { visible: false, phase: 'done' });
  }
  assert.deepEqual(boot.splashPhase({ status: 'checking', elapsedMs: boot.SPLASH_SLOW_MS }), { visible: true, phase: 'slow' });

  // The splash ring creeps, then closes on the answer — and only reaches 1 at the hand-off.
  let previous = -1;
  for (const t of [0, 100, 300, 500, 900, 1500, 2600]) {
    const value = boot.splashProgress({ elapsedMs: t, answered: false });
    assert(value >= previous, 'the splash ring must never go backwards');
    assert(value <= 0.92 + 1e-9, 'the splash ring must never close itself');
    previous = value;
  }
  assert.equal(boot.splashProgress({ elapsedMs: 1000, answered: true, answeredAtMs: 1000 }), 0.92);
  assert.equal(boot.splashProgress({ elapsedMs: 1000 + boot.SPLASH_CLOSE_MS, answered: true, answeredAtMs: 1000 }), 1);

  // ── 3/6. the ring, the 200 ms rule and the settle rules ────────────────────
  const { 'loadProgress.js': load } = await loadLib(['lib/loadProgress.js']);
  assert.equal(load.VEIL_DELAY_MS, 200);
  assert.equal(load.READY_CAP, 0.92);

  // Pure arc maths.
  assert.equal(load.arcProgress({ elapsedMs: 0 }), 0);
  assert(load.arcProgress({ elapsedMs: 300 }) > 0, 'the floor must always be moving');
  assert(load.arcProgress({ elapsedMs: 60000 }) <= load.READY_CAP, 'time alone can never complete the arc');
  assert(load.arcProgress({ elapsedMs: 60000, pending: 3 }) < load.arcProgress({ elapsedMs: 60000 }),
    'a request in flight must slow the floor, not stop it');
  const closing = load.arcProgress({ elapsedMs: 4000, settled: true, settledAtMs: 4000 });
  assert.equal(closing, load.READY_CAP, 'the close starts exactly at the cap');
  assert.equal(load.arcProgress({ elapsedMs: 4000 + load.CLOSE_MS, settled: true, settledAtMs: 4000 }), 1);

  assert.equal(load.veilVisible({ active: false, elapsedMs: 5000 }), false);
  assert.equal(load.veilVisible({ active: true, elapsedMs: 199 }), false, 'nothing is shown before 200 ms');
  assert.equal(load.veilVisible({ active: true, elapsedMs: 200 }), true);

  // Request tracking: section data yes, streams and the auth handshake no.
  for (const url of ['/api/vault', '/api/tamilmv?page=1', '/api/live-service/channels', '/api/stream?id=x']) {
    assert.equal(load.shouldTrack(url), true, `${url} is section data`);
  }
  for (const url of ['/api/health', '/api/auth', '/api/live-proxy?u=x', '/api/live-pocket/proxy?u=x', '/api/cron/tamilmv', '/brand/logo.png', 'https://lrclib.net/api/get/1']) {
    assert.equal(load.shouldTrack(url), false, `${url} must not hold the ring open`);
  }

  // A real switch, the normal shape: tap → commit → one request → done.
  load.__resetLoadProgress();
  assert.equal(load.readLoad().active, false);
  load.beginPendingLoad({ href: '/vault', label: 'Vault' });
  assert.equal(load.readLoad().visible, false, 'the first 200 ms show nothing');
  load.noteCommitted('/vault');
  assert.equal(load.readLoad().phase, 'loading', 'straight after the commit nothing is decided yet');
  await sleep(220);
  const midway = load.readLoad();
  assert.equal(midway.visible, true, 'past 200 ms the veil is up');
  assert.equal(midway.phase, 'closing', 'a page that asks for nothing settles on the quiet rule');
  assert(midway.progress >= load.READY_CAP);

  // The interesting case: content is still being fetched, so the ring must not close.
  load.__resetLoadProgress();
  load.beginPendingLoad({ href: '/vault', label: 'Vault' });
  load.noteCommitted('/vault');
  load.noteFetch(1);
  await sleep(load.QUIET_MS + 120);
  assert.equal(load.readLoad().phase, 'loading', 'an in-flight request keeps the ring open');
  load.noteFetch(-1);
  assert.equal(load.readLoad().phase, 'closing', 'when nothing is pending the arc closes');
  await sleep(load.CLOSE_MS + 60);
  const finished = load.readLoad();
  assert.equal(finished.done, true, 'the arc completes');
  assert.equal(finished.progress, 1);
  load.finishLoad();
  assert.equal(load.readLoad().active, false);

  // A request that never answers must not hold the veil forever.
  load.__resetLoadProgress();
  load.beginPendingLoad({ href: '/live', label: 'Live Tv' });
  load.noteCommitted('/live');
  load.noteFetch(1);
  assert.equal(load.readLoad().done, false);
  const escape = { ...load.readLoad() };
  assert.equal(escape.phase, 'loading');
  // (VEIL_MAX_MS is the escape hatch; the arithmetic is asserted directly instead of waiting it out.)
  assert(load.arcProgress({ elapsedMs: load.VEIL_MAX_MS + load.CLOSE_MS, settled: true, settledAtMs: load.VEIL_MAX_MS }) === 1,
    'past the cap the arc still closes');
  load.__resetLoadProgress();

  // A cancelled tap must not cancel a *later* load.
  const first = load.beginPendingLoad({ href: '/live', label: 'Live Tv' });
  const second = load.beginPendingLoad({ href: '/extras', label: 'ExTraS' });
  load.abortLoad(first.id);
  assert.equal(load.readLoad().label, 'ExTraS', 'the newest load survives a stale abort');
  load.abortLoad(second.id);
  assert.equal(load.readLoad().active, false, 'an uncommitted load can be dropped');
  // Scope: every route, no exceptions. Watch, the embed browser and Admin are covered too, and
  // the suppression switch that used to exclude them is gone rather than left as dead code.
  load.__resetLoadProgress();
  load.beginPendingLoad({ href: '/watch/movie/599', label: 'Watch' });
  const watchLoad = load.readLoad();
  assert.equal('suppressed' in watchLoad, false, 'the store must not score routes as un-ringable');
  assert.equal(watchLoad.active, true);
  assert.equal(load.beginPendingLoad({ href: '/admin', label: 'Admin' }).href, '/admin');
  load.__resetLoadProgress();

  // ── 4. the shell owns the chrome; pages must not draw their own ────────────
  const gate = read('components/AuthGate.js');
  assert.equal(gate.match(/<RailNav/g).length, 1, 'AuthGate must be the only rail host');
  assert.equal(gate.match(/<MobileDock/g).length, 1, 'AuthGate must be the only dock host');
  assert(gate.includes('key={pathname} className={`jv-route-content'), 'content wrapper must be keyed by pathname');
  assert(gate.includes('veil.blurring ? ' ), 'the wrapper must carry the blur while a switch is in flight');
  assert(gate.includes('<LoadVeil'), 'the shell must render the ring');
  // Within the shell branch specifically: the first `<LoadVeil` in the file is Admin's copy.
  const shellBranch = gate.slice(gate.indexOf('const showRail'), gate.indexOf('<CommandPalette'));
  assert(shellBranch.includes('jv-route-content') && shellBranch.includes('<LoadVeil'));
  assert(shellBranch.indexOf('<LoadVeil') > shellBranch.indexOf('jv-route-content'),
    'the ring must sit OUTSIDE the keyed wrapper, or it remounts mid-transition');
  // Anchored on the early return itself: `pathname.startsWith('/admin')` also appears in
  // ownsOwnChrome near the top, and matching that would make this assertion meaningless.
  assert(gate.indexOf('useLoadVeil(pathname)') < gate.indexOf("if (pathname.startsWith('/admin')) {"),
    'the veil hook must run before the early returns — a conditional hook unwinds the tree');
  assert(/const RAIL_SECTIONS = \['\/', '\/vault', '\/extras', '\/stremio', '\/classics'\]/.test(gate));
  assert(/ownsOwnChrome[\s\S]{0,160}'\/music'[\s\S]{0,200}'\/admin'[\s\S]{0,200}'\/watch'[\s\S]{0,200}'\/embed-browser'/.test(gate));
  assert(gate.includes('BootSplash'), 'the checking state must render the splash, not a bare spinner');
  // Admin returns before the shell branch, so it carries its own copy of the veil.
  const adminBranch = gate.slice(gate.indexOf("if (pathname.startsWith('/admin')) {"), gate.indexOf("if (pathname.startsWith('/admin')) {") + 700);
  assert(adminBranch.includes('<LoadVeil'), 'Admin is a destination too: the ring must be rendered there');
  assert(!gate.includes('veil.suppressed'), 'no route may skip the ring');
  const storeCode = read('lib/loadProgress.js');
  assert(!storeCode.includes('NO_VEIL') && !storeCode.includes('suppressed'), 'no suppression switch left behind');
  assert(/<RailNav onOpenSearch=\{/.test(gate), 'the rail must be handed the palette opener');

  for (const file of [
    'app/vault/page.js',
    'app/classics/page.js',
    'app/stremio/page.js',
    'components/extras/ExtrasApp.jsx',
    'components/home/HomeClient.jsx',
  ]) {
    assert(!read(file).includes('RailNav'), `${file} must not render its own rail (double rail = the old flicker)`);
  }
  const musicShell = read('components/music/MusicShell.jsx');
  assert(musicShell.includes('RailNav') && musicShell.includes('MobileDock'));
  assert(gate.includes("pathname.startsWith('/music')"), 'Music must be excluded from shell chrome');

  // ── 5. exactly one pending indicator, and it starts the ring ───────────────
  const link = read('components/SectionLink.jsx');
  assert(link.includes('useLinkStatus'));
  assert(link.includes("closest('a')"), 'pending state must be applied to the anchor itself');
  assert(link.includes("classList.toggle('is-pending'"), 'the pending class must be toggled on the link');
  assert(link.includes('aria-busy'));
  assert(link.includes('beginPendingLoad'), 'the pressed link is what starts the ring');
  assert(link.includes('abortLoad(loadId.current)'), 'a cancelled tap must only cancel its own load');
  assert(link.includes('idleWarm'), 'idle prefetch must stay wired');
  assert(link.includes('saveData'), 'idle prefetch must respect save-data');
  assert(link.includes('prefetch={false}'), 'next/link prefetch must stay off; warming is explicit');
  assert(!link.includes('jv-navigation-feedback'));
  for (const file of ['components/rail/RailNav.jsx', 'components/MobileDock.jsx']) {
    assert(read(file).includes('idleWarm={!active}'), `${file} must request idle warming`);
  }

  // ── CSS: the delay, the ring, the blur, and no leftovers ──────────────────
  const css = read('app/globals.css');
  assert(!css.includes('jv-navigation-feedback'), 'the floating pill CSS must be gone');
  // Rules, not words: the comment explaining the removal is allowed to name it.
  assert(!/\.jv-boot-(bar|fill)\s*[.{:]/.test(css) && !css.includes('@keyframes jv-boot-fill'),
    'the linear boot bar is retired: the ring is the progress');
  assert(/\.jv-skeleton-stage\s*\{[^}]*animation:\s*jv-load-in[^}]*180ms[^}]*both/.test(css),
    '.jv-skeleton-stage must delay the fallback ~180 ms with fill-mode both (hidden before the delay)');
  assert(/@keyframes\s+jv-load-in/.test(css));
  assert(/\.jv-route-content\s*\{[^}]*animation:\s*jv-content-in/.test(css), 'content-only crossfade missing');
  assert(/@keyframes\s+jv-content-in/.test(css));
  assert(/\.jv-route-content\.is-loading\s*\{[^}]*filter:\s*blur\(/.test(css), 'the section must blur while a switch is in flight');
  assert(/\.jv-route-content\.is-loading\s*\{[^}]*animation:\s*none/.test(css), 'the crossfade animation must not fight the blur transform');
  assert(/\.jv-route-content\s*\{[^}]*transition:\s*filter/.test(css), 'the reveal must be a transition, not a jump');
  assert(/\.jv-ring-arc\s*\{[^}]*stroke-linecap:round/.test(css));
  assert(/\.jv-ring\s+svg\s*\{[^}]*rotate\(-90deg\)/.test(css), 'the arc must start at 12 o clock');
  assert(/@keyframes\s+jv-ring-blink/.test(css), 'the logo blink is part of the effect');
  assert(/\.jv-veil\s*\{[^}]*pointer-events:none/.test(css), 'the veil must never swallow a tap');
  assert(/\.jv-veil\s*\{[^}]*z-index:35/.test(css), 'the veil sits above content, below the rail (z-40) and dock (z-60)');
  assert(/@keyframes\s+jv-veil-out/.test(css));
  assert(/\.jv-skl\s*\{[^}]*animation:\s*jv-skl-sheen/.test(css), 'shimmer missing on the base skeleton');
  assert(/@keyframes\s+jv-skl-sheen/.test(css));
  assert(/a\.is-pending\s*\{/.test(css), 'pressed link style missing');
  assert(/\{\s*\.jv-route-content,\s*\.jv-skeleton-stage,\s*\.jv-skl\s*\{[^}]*animation:none/.test(css.replace(/\s+/g, ' ')),
    'reduced motion must switch the animation off');

  // ── the ring component itself ─────────────────────────────────────────────
  const ring = read('components/RingLogo.jsx');
  assert(ring.includes('strokeDashoffset'), 'the arc is drawn by stroke-dashoffset');
  assert(ring.includes('strokeDasharray={c}'));
  assert(ring.includes('linearGradient') && ring.includes('#d946ef') && ring.includes('#38bdf8'), 'brand gradient');
  assert(ring.includes('jv-ring-head'), 'the lit head is what makes it read as light travelling');
  assert(ring.includes('useId'), 'gradient ids must be unique per instance');
  assert(ring.includes('/brand/logo-source.webp'), 'the logo needs its fallback');

  const splash = read('components/BootSplash.js');
  assert(splash.includes('RingLogo'), 'the splash uses the same ring as a section switch');
  assert(!splash.includes('jv-boot-bar'), 'the linear bar is gone');
  assert(splash.includes('requestAnimationFrame'), 'the ring must not tick on the parent 120 ms timer');

  const veil = read('components/LoadVeil.jsx');
  assert(veil.includes('subscribeFrame'), 'only the ring listens to frames');
  const hook = read('components/useLoadVeil.js');
  assert(!hook.includes('subscribeFrame('), 'the shell must subscribe to events, not frames');
  assert(hook.includes('noteCommitted'), 'the commit is what starts measuring the new page');

  // ── skeleton geometry per section (unchanged from the previous pass) ──────
  const skeletons = read('components/Skeletons.jsx');
  for (const variant of ['posters', 'channels', 'cards', 'shelf', 'player']) {
    assert(skeletons.includes(variant), `Skeletons.jsx must offer a ${variant} variant`);
  }
  assert(skeletons.includes('jv-skl-posters') && skeletons.includes('jv-skl-channels')
    && skeletons.includes('jv-skl-cards') && skeletons.includes('jv-skl-shelf') && skeletons.includes('jv-skl-player'));
  assert(/VARIANTS\s*=/.test(skeletons) && skeletons.includes('VARIANTS[variant] ||'), 'unknown variants must fall back, never crash');
  assert(skeletons.includes('aria-hidden="true"'), 'skeletons must be hidden from assistive tech');

  const loadingVariants = {
    'app/loading.js': 'shelf',
    'app/live/loading.js': 'channels',
    'app/music/loading.js': 'shelf',
    'app/extras/loading.js': 'cards',
    'app/stremio/loading.js': 'posters',
    'app/vault/loading.js': 'posters',
  };
  for (const [file, variant] of Object.entries(loadingVariants)) {
    const code = read(file);
    assert(code.includes(`variant="${variant}"`), `${file} should use the ${variant} skeleton`);
    assert(code.includes('SectionLoading'));
  }
  const sectionLoading = read('components/SectionLoading.jsx');
  assert(!sectionLoading.includes('RailNav'), 'a route fallback must not draw shell chrome');
  assert(sectionLoading.includes('jv-skeleton-stage') && sectionLoading.includes('aria-busy'));
  assert(!css.includes('.jv-section-skeleton'), 'the old one-shape grid for every section must be gone');

  console.log('PASS loading system: splash minimum + ring hand-off, cap-then-close arc, 200 ms rule, shell-owned chrome, one pending indicator, section blur + reveal, per-section skeleton geometry.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
