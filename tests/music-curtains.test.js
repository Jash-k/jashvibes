/*
 * tests/music-curtains.test.js — the Light Curtains music section (v8.15.0).
 *
 * Two jobs. First, the pure model in `lib/musicCore.js`, which is where the design's promises live (a `0`
 * count is a real count, an unsynchronised lyric is not a button, a hold has a progress). Second, a set of
 * structural assertions on the shipped files, written as the rules a future "tidy up" would break: that the
 * old UI is gone rather than hidden, that exactly two surfaces are frosted, that the lock machine survived the
 * rewrite, and that the theme is a token swap. Pixels are verified in the browser pass, not here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const core = require('../lib/musicCore');
const css = read('app/globals.css');
const curtains = read('components/music/Curtains.jsx');
const section = read('components/music/MusicCurtains.jsx');
const page = read('app/music/page.js');

/* ───────────────────────────────── the model ───────────────────────────────── */

test('tabs report real counts, including zero', () => {
  const tabs = core.muTabs({ albums: 12, artists: 0, playlists: 3 });
  assert.deepEqual(tabs.map((t) => [t.id, t.label, t.count]), [
    ['albums', 'Albums', 12],
    ['artists', 'Artists', 0],
    ['playlists', 'Playlists', 3],
  ], 'an empty facet stays visible as 0 — a tab that hides itself is how a library starts lying');
  assert.deepEqual(core.muTabs({}).map((t) => t.count), [0, 0, 0]);
  assert.deepEqual(core.muTabs({ albums: -5 }).map((t) => t.count), [0, 0, 0], 'never a negative count');
});

test('the non-facet views are chips, never a fourth tab', () => {
  assert.deepEqual(core.MU_TABS.map((t) => t.id), ['albums', 'artists', 'playlists']);
  assert.deepEqual(core.MU_CHIPS.map((c) => c.id), ['search', 'favorites', 'recent']);
});

test('lyric rows: only timed lines are tappable', () => {
  const lines = [{ time: 12, text: 'one' }, { time: 20, text: 'two' }, { time: 31, text: 'three' }];
  const rows = core.muLyricRows(lines, 1, { radius: 1 });
  assert.deepEqual(rows.map((r) => r.state), ['past', 'current', 'future']);
  assert.deepEqual(rows.map((r) => r.tappable), [true, true, true]);
  assert.deepEqual(rows.map((r) => r.visible), [true, true, true], 'radius only dims the window, it never drops lines from the list');

  const unsynced = core.muLyricRows([{ time: null, text: 'a' }, { time: null, text: 'b' }], -1, { radius: 4 });
  assert.deepEqual(unsynced.map((r) => r.state), ['plain', 'plain']);
  assert.deepEqual(unsynced.map((r) => r.tappable), [false, false],
    'no timestamps means no seek affordance — a row that looks pressable and is not one is a decorative control');

  assert.deepEqual(core.muLyricRows([], -1), []);
  assert.deepEqual(core.muLyricRows(null, 0), [], 'a missing list is not a crash');
});

test('the curtain position comes from playback, and never from a timer', () => {
  assert.equal(core.muCurtainPosition(51, 225), 51 / 225);
  assert.equal(core.muCurtainPosition(0, 0), 0, 'an unknown duration is 0, not Infinity');
  assert.equal(core.muCurtainPosition(300, 225), 1, 'clamped at the end');
  assert.equal(core.muCurtainPosition(-4, 100), 0);
  assert.equal(core.muCurtainPosition('x', 'y'), 0);
});

test('the hue rotates by track, so a playlist shifts light instead of flashing wallpaper', () => {
  const a = core.muCurtainVars('song-one');
  const b = core.muCurtainVars('song-one');
  const c = core.muCurtainVars('');
  assert.deepEqual(a, b, 'same key, same colours — a re-render must not restyle the room');
  assert.notEqual(a['--mu-curtain-a'], core.muCurtainVars('other-song')['--mu-curtain-a']);
  assert.deepEqual(Object.keys(c), ['--mu-curtain-a', '--mu-curtain-b', '--mu-curtain-c']);
});

test('quality chips keep the ladder order and mark what is current', () => {
  const chips = core.muQualityChips({ '96kbps': 'u', '320kbps': 'u', auto: 'u' }, '320kbps');
  assert.deepEqual(chips.map((c) => c.label), ['320k', '96k', 'Auto']);
  assert.deepEqual(chips.map((c) => c.current), [true, false, false]);
  assert.deepEqual(core.muQualityChips({}, ''), []);
  const odd = core.muQualityChips({ 'weird-host': 'u' }, '');
  assert.deepEqual(odd, [{ key: 'weird-host', label: 'weird-host', current: false }], 'an unknown key is still selectable, and shows its own name');
});

test('the lock surface says what it is doing in every state', () => {
  const pocket = core.muLockView({ pocketMode: true, hold: 0.5, nextTitle: 'Vaan Megam' });
  assert.equal(pocket.kind, 'pocket');
  assert.equal(pocket.progress, 50, 'the hold ring is a percentage the CSS can draw');
  assert.equal(pocket.nextTitle, 'Vaan Megam', 'pocket mode is for not looking at the phone, so the next song belongs on it');

  for (const [status, fragment] of [
    ['active', 'keeping the screen awake'],
    ['unsupported', 'no wake lock in this browser'],
    ['blocked', 'refused'],
    ['released', 'took the lock back'],
  ]) {
    assert.match(core.muLockView({ listeningMode: true, wakeLockStatus: status }).status, new RegExp(fragment, 'i'),
      `${status} must be named, not hidden behind a spinner`);
  }
  assert.equal(core.muLockView({}).kind, 'off');
});

test('the helpers the player depends on still behave after moving out of the page', () => {
  assert.equal(core.trackKey({ seokey: 'a', id: 'b' }), 'a');
  assert.equal(core.trackKey(null), '');
  assert.equal(core.chooseBestQuality({ '96kbps': 'u', '320kbps': 'u' }), '320kbps');
  assert.equal(core.chooseBestQuality({}), '');
  assert.equal(core.isHlsUrl('https://x/y.M3U8?a=1'), true);
  assert.equal(core.formatTime(75), '1:15');
  assert.equal(core.formatTime('nope'), '0:00');
  assert.deepEqual(core.dedupeQueue([{ seokey: 'a' }, { seokey: 'a' }, { seokey: 'b' }]).length, 2);

  const parsed = core.parseSyncedLyrics('[01:12.50][01:20] two stamps one line\nplain line');
  assert.deepEqual(parsed, [
    { time: 72.5, text: 'two stamps one line' },
    { time: 80, text: 'two stamps one line' },
  ]);
  assert.equal(core.plainFromSyncedLyrics('[00:01] a\n[00:02] b'), 'a\nb');
  assert.deepEqual(core.normalizeSearchResults(['x']), { songs: ['x'], albums: [], artists: [], playlists: [] });
  assert.equal(core.searchResultCount({ songs: [1, 2], albums: [1] }), 3);
  assert.deepEqual(core.artistChipsFromTrack({ artists: 'A, B & C' }).map((a) => a.name), ['A', 'B', 'C']);
});

/* ─────────────────────── the section: old UI gone, promises kept ─────────────────────── */

test('the page is a thin shell over one new component', () => {
  assert.match(page, /import MusicCurtains from '@\/components\/music\/MusicCurtains'/);
  assert.match(page, /return <MusicCurtains \/>;/);
  assert.ok(page.length < 1200, 'the 1697-line page is gone; the logic moved with the new render, not beside it');
  assert.match(page, /No `export const dynamic`|Static shell/, 'the shell stays static so browsing does not wake the server');
});

test('the previous music UI is deleted, not restyled', () => {
  assert.ok(!/className="[^"]*palette-music-magenta/.test(section), 'the old palette class is not applied anywhere');
  assert.ok(!css.includes('.palette-music-magenta'),
    'and its rule blocks were deleted with it — the section is tinted by --mu-* now');
  for (const kept of ['deepsea', 'nordic', 'cybergrape']) {
    assert.ok(css.includes(`.palette-${kept}`),
      `the ${kept} palette belongs to another page and must not be collateral damage`);
  }
  for (const gone of ['VinylArt', 'SectionHeader', 'HorizontalRow', 'TrackTile', 'AlbumTile', 'ArtistTile', 'PlaylistTile', 'TrackList', 'SidebarButton', 'IconButton']) {
    assert.ok(!new RegExp(`function ${gone}\\b`).test(section), `${gone} was removed rather than kept around for old markup`);
    assert.ok(!new RegExp(`<${gone}[\\s/>]`).test(section), `${gone} is not rendered anywhere`);
  }
  const soup = /className="[^"]*(rounded-3xl|bg-\[#050012\]|backdrop-blur)/;
  assert.ok(!soup.test(section), 'no Tailwind soup left in the section — it is one class family now');
  assert.ok(!soup.test(curtains), 'the primitives are clean too');
});

test('the tabs the user asked for are in the layout and wired to the facets', () => {
  assert.match(section, /<MuTabs[\s\S]{0,600}onSelect=\{\(id\) => \{[\s\S]{0,160}setView\(id\);\n\s{12}loadFacet\(id, query\);/);
  assert.match(section, /const loadFacet = useCallback\(async \(id, searchTerm = ''\)/,
    'a tab asks its own endpoint, so it is never an absence the app could have filled');
  assert.match(section, /fetch\(url, \{ cache: 'no-store' \}\)[\s\S]{0,220}facet\.status|setFacet\(\{ id, status: 'ready', items, error: '' \}\)/);
  assert.match(section, /onClick=\{\(\) => loadFacet\(activeTab, query\)\}>retry/, 'and an empty facet has a way out');
  assert.match(curtains, /role="tablist"[\s\S]*role="tab"/);
  assert.match(curtains, /aria-selected=\{active === tab\.id\}/);
  assert.match(curtains, /jv-mu-tab-count/);
  assert.match(section, /muTabs\(facetCounts\)/);
  assert.match(section, /facetLists = \{[\s\S]*albums:[\s\S]*artists:[\s\S]*playlists:/);
});

test('the rail is mounted and its clearance is kept', () => {
  assert.match(section, /import RailNav from '@\/components\/rail\/RailNav'/);
  assert.match(section, /<RailNav onOpenSearch=/);
  assert.match(section, /className="jv-mu jv-rail-shift"/, 'the page must render the nav it reserves room for');
});

test('exactly two surfaces are frosted, because blur is the expensive part of this design', () => {
  const opted = [section, curtains].join('\n').match(/data-mu-blur="true"/g) || [];
  assert.equal(opted.length, 2, 'the playing panel and the open lyrics panel; a third would be a budget breach');
  const rules = css.match(/\.jv-mu-panel\[data-mu-blur\], \.jv-mu-lyrics\.is-open \{ backdrop-filter: \.\.\. \}/);
  assert.match(css, /\.jv-mu-panel\[data-mu-blur\], \.jv-mu-lyrics\.is-open \{ backdrop-filter: blur\(18px\) saturate\(1\.15\); \}/);
  assert.ok(!rules, 'placeholder guard');
  assert.ok(!/\.jv-mu-(transport|mini|veil)[^{]*\{[^}]*backdrop-filter/.test(css),
    'the transport strip, the mini capsule and the veil are flat rgba by rule, not by accident');
});

test('the theme is a token swap, with a contrast floor that is a property of the tokens', () => {
  const night = css.slice(css.indexOf('.jv-mu {'), css.indexOf('html.day-mode .jv-mu {'));
  const day = css.slice(css.indexOf('html.day-mode .jv-mu {'));
  for (const token of ['--mu-bg', '--mu-ink', '--mu-ink-dim', '--mu-line', '--mu-glass', '--mu-accent']) {
    assert.ok(night.includes(`${token}:`), `night declares ${token}`);
    assert.ok(day.slice(0, day.indexOf('}')).includes(`${token}:`), `day re-declares ${token} instead of overriding rules`);
  }
  assert.match(night, /--mu-ink-dim: #93a0bf/, 'muted lyric text on night — 7.24:1 against the composited panel, 7.4:1 on the bare bg');
  assert.match(day.slice(0, day.indexOf('}')), /--mu-ink-dim: #5b6376/, 'and 5.98:1 in day mode against its composited panel — above the 4.5:1 floor');
  assert.match(css, /\.jv-mu-line\[data-state="current"\] \.jv-mu-line-text \{ color: var\(--mu-ink\);/,
    'the current line is full ink, not accent-on-glass');
});

test('the lock machine survived the rewrite, in both its moods', () => {
  for (const kept of ['startPocketUnlock', 'cancelPocketUnlock', 'enableListeningMode', 'disableListeningMode',
    'wakeLockStatusText', 'requestWakeLock', 'startUnlockHold', 'cancelUnlockHold', 'visibilitychange']) {
    assert.ok(new RegExp(kept).test(section), `${kept} is still in the section`);
  }
  assert.match(section, /muLockView\(\{[\s\S]*pocketMode,[\s\S]*listeningMode,[\s\S]*wakeLockStatus/);
  assert.match(section, /<LockVeil[\s\S]*onHoldStart=\{startPocketUnlock\} onHoldEnd=\{cancelPocketUnlock\}/);
  assert.match(curtains, /conic-gradient\(var\(--mu-accent\) \$\{view\.progress\}%/, 'the hold ring is driven by the real hold progress');
  assert.match(curtains, /onKeyDown=\{\(event\) => \{ if \(event\.key === 'Enter' \|\| event\.key === ' '\) onHoldStart\(\); \}\}/,
    'a hold has to be doable with a keyboard or a remote, not only a thumb');
  assert.match(css, /\.jv-mu-veil \{ position: fixed; inset: 0; z-index: 90/);
});

test('the things that were hard-won in the old page are still wired', () => {
  assert.match(section, /total - now <= 0\.9/, 'the pre-end auto-advance that keeps a locked phone on the queue');
  assert.match(section, /prefetchTrack/);
  assert.match(section, /restoreScroll|saveScroll/, 'scroll position is still restored from the client cache');
  assert.match(section, /writeSessionCache\(MUSIC_CACHE_KEY/);
  assert.match(section, /readSessionCache\(MUSIC_CACHE_KEY/);
  assert.match(section, /window\.localStorage\.setItem\(FAVORITES_KEY|FAVORITES_KEY/, 'favorites stay on the device');
  assert.match(section, /RECENTS_KEY/);
  assert.match(section, /VOLUME_KEY/);
  assert.match(section, /importSpotifyPlaylists|refreshImportedPlaylists/, 'the Spotify import is not collateral damage');
  assert.match(section, /addImportedTrack\(\)[\s\S]*replaceImportedTrack|replaceImportedTrack/, 'song CRUD still reachable');
  assert.match(section, /<audio ref=\{videoRef\}/, 'one element owns playback; the mini capsule never gets its own');
});

test('the mini capsule is a control surface, and dismissible by drag', () => {
  assert.match(curtains, /if \(!visible\) return null;/);
  assert.match(section, /onDragEnd=\{\(\) => \{ if \(dragDy > MU_MINI_DRAG_CLOSE_PX\) closeMiniPlayer\(\)/);
  assert.equal(core.MU_MINI_DRAG_CLOSE_PX, 120);
  assert.ok(!/jv-mu-mini[\s\S]{0,80}<audio/.test(curtains), 'no second audio element inside the capsule');
  assert.match(css, /\.jv-mu-mini \{[\s\S]*touch-action: pan-y/);
});

test('lyrics: the column of light is one node, and the panel is closable', () => {
  assert.match(curtains, /\{row\.state === 'current' \? <span className="jv-mu-line-light" aria-hidden="true" \/> : null\}/);
  assert.match(section, /onJump=\{\(time\) => \{ if \(Number\.isFinite\(time\)\) seekTo\(time\); \}\}/);
  assert.match(section, /showLyrics && lyricAutoScroll && activeLyricRef\.current/,
    'auto-scroll is a real toggle, so turning it off stops the scrollIntoView, not just the label');
  assert.match(section, /the source has no timed lyrics for this song/, 'and the empty state says so in words');
  assert.match(css, /\.jv-mu-lines\.is-blur \.jv-mu-line:not\(\[data-state="current"\]\) \{ filter: blur\(0\.5px\); opacity: 0\.7; \}/);
});

test('the design still works when motion and blur are taken away', () => {
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-mu-shaft'));
  assert.ok(reduced.length > 40, 'the music block has its own reduced-motion section');
  assert.match(reduced.slice(0, 700), /animation: none/);
  assert.match(reduced.slice(0, 700), /transition: none/);
  assert.ok(!/\.jv-mu-bead/.test(reduced.slice(0, 700)), 'the bead keeps reporting position — progress is information, not decoration');
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/,
    'and there is a flat fallback for engines without blur: same layout, solid panel');
});

/**
 * A scanner, not a regex: every `<button` must be closed before another one opens. That is the rule book's
 * "no control nested in a control", and it is the thing a "just wrap the whole row in a link" refactor
 * reintroduces while every other test stays green.
 */
function deepestButtonNesting(src) {
  const tokens = src.match(/<button\b[^>]*\/>|<button\b|<\/button>/g) || [];
  let depth = 0;
  let max = 0;
  for (const token of tokens) {
    if (token === '</button>') { depth = Math.max(0, depth - 1); continue; }
    const selfClosing = token.endsWith('/>');
    max = Math.max(max, depth + 1);
    if (!selfClosing) depth += 1;
  }
  return max;
}

test('no control sits inside a control, in either file', () => {
  assert.equal(deepestButtonNesting(curtains), 1, `Curtains.jsx nests a button (depth ${deepestButtonNesting(curtains)})`);
  assert.equal(deepestButtonNesting(section), 1, `MusicCurtains.jsx nests a button (depth ${deepestButtonNesting(section)})`);
  // and the row keeps its two actions as siblings, which is what that depth proves in practice
  assert.match(curtains, /<\/button>\n {6}\{onFavorite \? \(\n {8}<button/,
    'favourite is a sibling of the play button in every track row');
});
