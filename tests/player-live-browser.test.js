import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMMANDS, commandForKey } from '../lib/player/commands.js';

/**
 * Guards for the in-player channel drawer (the fullscreen Side Drawer).
 *
 * The drawer renders inside the player root so it survives fullscreen, the page feeds it
 * precomputed rows and owns tuning, and the keyboard path uses a native listener because the
 * player's own keydown handler sits on an ancestor. These assertions keep that contract honest.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const player = read('../components/player/JashPlayer.js');
const drawer = read('../components/player/PlayerBrowser.js');
const page = read('../app/live/page.js');

const keyEvent = (key) => ({ key, target: { tagName: 'DIV' } });

test('the guide is a first-class command on a free key', () => {
  assert.equal(COMMANDS.toggleBrowser.label, 'Channel guide');
  assert.deepEqual(COMMANDS.toggleBrowser.keys, ['g']);
  assert.equal(commandForKey(keyEvent('g')), 'toggleBrowser');
  assert.equal(commandForKey(keyEvent('z')), null, 'unbound keys must still reach the page');
});

test('the chrome handles the command and keeps the bar honest', () => {
  assert.match(player, /liveBrowser = null/, 'the prop is optional: movies and sports never pass it');
  assert.match(player, /case 'toggleBrowser':\s+if \(liveBrowser\) setBrowserOpen/, 'no prop, no drawer');
  assert.match(player, /data-jash-command="toggleBrowser"/, 'the bar button carries the command name');
  assert.match(player, /aria-pressed=\{browserOpen\}/, 'the button says whether the drawer is open');
  assert.ok(!player.includes('<ChannelDrawer') || player.includes('liveBrowser ? ('), 'the drawer only mounts for live');
});

test('the drawer joins the busy contract, so browsing never hides mid-scroll', () => {
  assert.match(player, /controlsAreBusy =\s+!playing \|\|\s+Boolean\(menu\) \|\|\s+browserOpen \|\|/, 'open drawer pins the chrome up like a menu');
  assert.match(player, /case 'closeMenus':\s+if \(browserOpen\) setBrowserOpen\(false\);/, 'Escape closes the topmost panel first');
});

test('live TV vetoes the page dim — the wall must stay readable while watching', () => {
  assert.match(player, /policy\.ambient !== false && Boolean\(prefs\.ambient\)/, 'a policy can veto ambient');
  assert.match(page, /shellPolicy = useMemo\(\(\) => \(\{ ambient: false \}\), \[\]\)/, 'and the live shell freezes that veto (a fresh literal would rebuild the engine)');
  assert.match(page, /policy=\{shellPolicy\}/, 'and passes it to the shell player');
});

test('the drawer reports picks; the page resolves them to channels', () => {
  assert.match(drawer, /onPick\?\.\(item, \{ via: 'pointer' \}/, 'a tap zaps and keeps browsing');
  assert.match(drawer, /onPick\?\.\(item, \{ via: 'keyboard' \}/, 'Enter reports the keyboard path');
  assert.match(player, /if \(info\?\.via === 'keyboard'\) setBrowserOpen\(false\)/, 'so a TV viewer lands back on the video');
  assert.match(page, /pickBrowserItem[\s\S]{0,400}selectChannel\(channel\)/, 'an id becomes a channel through the same tune path as the wall');
});

test('the drawer is a remote-friendly list, not a second video surface', () => {
  assert.match(drawer, /role="dialog"[\s\S]{0,200}aria-label="Channels"/, 'announced as the channels dialog');
  assert.match(drawer, /addEventListener\('keydown', onKey\)/, 'native keys: the player ancestor would eat bubbled ones');
  assert.match(drawer, /querySelectorAll\('\[data-ch\]'\)/, 'arrows walk the rows');
  assert.match(drawer, /querySelector\?\.\('\[data-active="1"\]'\)\?\.scrollIntoView\?\.\(\{ block: 'nearest' \}\)/, 'opening (and zapping) scrolls to the tuned row');
  assert.match(drawer, /filtered\.slice\(0, shown\)/, 'a 5,000-row source pages instead of mounting');
  assert.ok(!drawer.includes('<video'), 'no media element: the picture keeps playing underneath');
  assert.ok(!drawer.includes('animate-ping'), 'and no live marker sneaks back in');
});

test('typing in the drawer never tunes a channel or drives the player', () => {
  assert.equal(commandForKey({ key: 'g', target: { tagName: 'INPUT' } }), null, 'the command table ignores inputs');
  assert.match(drawer, /const id = el\?\.getAttribute\?\.\('data-id'\);[\s\S]{0,160}?if \(!id\) return;/, 'Enter outside a row (e.g. in search) is not a pick');
  assert.match(drawer, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/, 'taps do not leak to the gesture sheet below');
});

test('a stored day from the auto-era is migrated to night exactly once', () => {
  const gate = read('../components/AuthGate.js');
  assert.match(gate, /jash_theme_sealed/, 'an explicit human choice seals the preference');
  assert.match(gate, /initial = saved === 'day' \? 'day' : 'night'/, 'and only a sealed choice can wake the app white');
  assert.match(gate, /setItem\('jash_theme_sealed', '1'\)/, 'the toggle re-seals on every tap');
});

test('the ambient dim can never white-veil the video, in either mode', () => {
  const css = read('../app/globals.css');
  assert.match(css, /html\.day-mode \[data-dvp="ambient"\] \{ background-color: rgba\(0, 0, 0, 0\.75\) !important; \}/);
  const guardAt = css.indexOf('[data-dvp="ambient"]');
  assert.ok(guardAt < css.indexOf('.jv-sp-page {'), 'the guard sits before the sports block, outside every section slice');
});

test('the release carries a visible build stamp on the live surfaces', () => {
  const sw = read('../public/sw.js');
  assert.match(sw, /CACHE_VERSION = 'jash-vibes-pwa-v\d+';/, 'a versioned SW so a release can force takeover');
  assert.ok(page.includes('>K5</span>'), 'the live header shows the build');
  assert.ok(drawer.includes('· K5</span>'), 'and so does the drawer');
});

test('the wall logo is capped, so a raw upload cannot blow up the grid', () => {
  const css = read('../app/globals.css');
  assert.match(css, /\.jv-lv-tune img \{ max-width: 100%; max-height: 56px; object-fit: contain; \}/, 'the logo fits its tile');
  assert.match(css, /\.jv-lv-tune \{ display: grid; place-items: center;/, 'the tile centers it');
});
