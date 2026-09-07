import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ASPECT_MODES, aspectLabel, isAspectMode, nextAspectMode, pictureStyle } from '../lib/player/aspect.js';
import { clampSeekTarget, readBufferedEnd } from '../lib/player/kind.js';
import { PREF_DEFAULTS, readPrefs } from '../lib/player/prefs.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

/* ------------------------------------------------------------------ the picture */

test('every aspect mode is a real mode, and Auto asks for nothing', () => {
  assert.deepEqual(ASPECT_MODES.map((mode) => mode.id), ['auto', 'fill', '16:9', '4:3', '2.39:1', '9:16', 'stretch']);
  assert.deepEqual(pictureStyle('auto'), {}, 'the class default (object-contain) must survive untouched');
  assert.equal(isAspectMode('4:3'), true);
  assert.equal(isAspectMode('21:9'), false, 'a stale value from another build falls back instead of blanking the frame');
  assert.equal(aspectLabel('9:16'), '9:16');
  assert.equal(nextAspectMode('stretch'), 'auto', 'a cycle wraps, so a key press can never strand the user off the end');
});

test('Fill crops and does not squeeze; Stretch squeezes and does not crop', () => {
  assert.deepEqual(pictureStyle('fill'), { objectFit: 'cover' });
  assert.deepEqual(pictureStyle('stretch'), { objectFit: 'fill' });
});

test('a forced ratio letterboxes inside the frame instead of resizing it', () => {
  const style = pictureStyle('4:3');
  assert.equal(style.objectFit, 'contain');
  assert.equal(style.aspectRatio, '4 / 3');
  assert.equal(style.width, 'auto');
  assert.equal(style.maxWidth, '100%', 'the drawn box may never overflow the player, only shrink');
  assert.equal(style.margin, 'auto', 'absolute-inset plus auto margins is what centres it');
  assert.equal(pictureStyle('2.39:1').aspectRatio, '2.39 / 1');
});

test('the choice is a viewer preference with a do-nothing default', () => {
  assert.equal(PREF_DEFAULTS.aspect, 'auto');
  assert.equal(readPrefs({}).aspect, 'auto', 'a device with nothing stored gets the do-nothing default');
  const player = read('../components/player/JashPlayer.js');
  assert.match(player, /import \{ aspectLabel, isAspectMode, pictureStyle \} from '@\/lib\/player\/aspect'/);
  assert.match(player, /style=\{pictureStyle\(aspectMode\)\}/, 'it must reach the <video>, not just the menu');
  assert.match(player, /onPickAspect=\{\(value\) => \{[\s\S]*?engine\.setPref\('aspect', value\)/, 'picking persists through the prefs hook');
});

test('the burger offers it next to the other picture controls', () => {
  const menus = read('../components/player/PlayerMenus.js');
  assert.match(menus, /<MenuSection label="Aspect ratio"/);
  assert.match(menus, /ASPECT_MODES\.map\(\(mode\) => \(/);
  assert.match(menus, /aria-pressed=\{aspect === mode\.id\}/, 'the active mode has to be legible at a glance');
});

/* ------------------------------------------------------------------ the sheet that "froze" */

test('a sheet is dismissed from inside the frame, not by locking the page', () => {
  const menus = read('../components/player/PlayerMenus.js');
  assert.ok(!/className="fixed inset-0 z-40"/.test(menus), 'a page-wide invisible blocker is what made everything else unclickable');
  assert.match(menus, /className="absolute inset-0 z-40 bg-black\/35"/, 'the dismissal layer is now part of the player, and you can see it');
  assert.match(menus, /node\?\.focus\?\.\(\{ preventScroll: true \}\)/, 'focus the dialog so keyboard Escape reaches it');
  assert.match(menus, /tabIndex=\{-1\}/, 'a div cannot be focused without this');
});

test('a sheet never grows taller than the player, so its header stays on screen', () => {
  const menus = read('../components/player/PlayerMenus.js');
  const sheets = menus.match(/max-h-\[min\(70%,calc\(100%-[0-9.]+rem\)\)\]/g) || [];
  assert.equal(sheets.length, 2, 'both the mobile sheet and the desktop panel are capped against the frame');
  assert.match(menus, /max-h-\[min\(52vh,calc\(100%-6rem\)\)\]/, 'the scroll region is capped too, or the footer is clipped away');
});

test('Escape closes an open sheet even when the player lost focus', () => {
  const player = read('../components/player/JashPlayer.js');
  assert.match(player, /if \(!menu && !contextMenu\) return undefined;/);
  assert.match(player, /document\.addEventListener\?\.\('keydown', onDocKey, true\)/, 'capture phase, on the document, while a sheet is up');
  assert.match(player, /setMenu\(null\);\s*\n\s*setContextMenu\(null\);/);
});

/* ------------------------------------------------------------------ hosts with no Accept-Ranges */

test('a normal host may be seeked anywhere the window allows', () => {
  const el = { duration: 600, currentTime: 10, seekable: { length: 0 }, buffered: { length: 0 } };
  assert.equal(clampSeekTarget(el, 300), 300);
  assert.equal(clampSeekTarget(el, 599.9).toFixed(2), '599.75', 'the tail is held back so the last frame is not a dead seek');
  assert.equal(clampSeekTarget(el, -20), 0);
  assert.equal(clampSeekTarget(null, 5), null);
});

test('a host that restarts the download is seek-limited to what has downloaded', () => {
  const el = {
    duration: 600,
    currentTime: 10,
    seekable: { length: 0 },
    buffered: { length: 1, start: () => 0, end: () => 120 },
  };
  assert.equal(readBufferedEnd(el), 120);
  assert.equal(clampSeekTarget(el, 90, { noRange: true }), 90, 'inside the buffer: straight through');
  assert.equal(clampSeekTarget(el, 300, { noRange: true }), 115, 'past the buffer: land 5 s before its end, still ahead of where we are');
  assert.equal(clampSeekTarget(el, 5, { noRange: true }), 5, 'backwards is free — the browser already has those bytes in the same stream');
  const nothingBuffered = { ...el, buffered: { length: 0 }, currentTime: 42 };
  assert.equal(clampSeekTarget(nothingBuffered, 300, { noRange: true }), 43, 'with no buffer report at all, only a nudge is allowed');
});

test('the engine learns the refusal from evidence, says so, and does not reload the file', () => {
  const engine = read('../components/player/usePlaybackEngine.js');
  assert.match(engine, /clampSeekTarget\(el, asked, \{ noRange: noRangeRef\.current \}\)/);
  assert.match(engine, /seekVerifyRef\.current = \{ target: clamped, tries: 0, asked \}/, 'the retry has to know what was asked, not what was settled for');
  assert.match(engine, /noRangeRef\.current = true;\s*\n\s*setSeekRefused\(true\);/, 'two refused seeks on the same host is the verdict');
  assert.match(engine, /noRangeHoldRef\.current = Date\.now\(\) \+ 20_000;/, 'the recovery ladder is held while playback continues from where the file actually is');
  assert.match(engine, /Date\.now\(\) < noRangeHoldRef\.current/, 'held means the ladder sees "seeking", so it will not reload the source');
  assert.match(engine, /if \(reason === 'initial' && noRangeRef\.current\)/, 'a new source starts clean; a reload on the same one does not');
  assert.match(engine, /^\s*seekRefused,$/m, 'the UI needs the state to stop promising a scrubber that lies');
  const player = read('../components/player/JashPlayer.js');
  assert.match(player, /engine\.seekRefused/, 'and the player shows it on the track');
});
