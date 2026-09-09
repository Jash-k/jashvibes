import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LIVE_NOW_KEY, MAX_AGE_MS, readLiveNow, writeLiveNow } from '../lib/liveNow.js';

/**
 * Rail OS: the homepage is a left rail (desktop/TV) plus one focused title you aim yourself.
 * These tests guard the two things that made the old layout wrong — a nav that existed twice, and a
 * hero that moved on its own — and the one thing that could quietly become expensive: the "on air"
 * line, which must stay a localStorage read and never grow a request.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

test('the two-field summary round-trips', () => {
  const storage = fakeStorage();
  assert.equal(writeLiveNow({ channel: 'Colors HD', title: 'Bigg Boss 18', minutesLeft: 42.6 }, { localStorage: storage }), true);
  const now = readLiveNow({ localStorage: storage });
  assert.equal(now.channel, 'Colors HD');
  assert.equal(now.title, 'Bigg Boss 18');
  assert.equal(now.minutesLeft, 43, 'rounded, because it is printed as a promise');
  assert.ok(now.age < 5000);
});

test('a half-truth is not written at all', () => {
  const storage = fakeStorage();
  assert.equal(writeLiveNow({ channel: 'Colors HD', title: '  ' }, { localStorage: storage }), false);
  assert.equal(writeLiveNow({ channel: '', title: 'Something' }, { localStorage: storage }), false);
  assert.equal(storage.map.size, 0, 'nothing lands in storage, so nothing can be read back as a lie');
  assert.equal(readLiveNow({ localStorage: storage }), null);
});

test('anything older than the age rule is dropped, not shown dimmer', () => {
  const stale = fakeStorage({
    [LIVE_NOW_KEY]: JSON.stringify({ channel: 'Colors HD', title: 'Yesterday show', minutesLeft: 5, at: Date.now() - MAX_AGE_MS - 1000 }),
  });
  assert.equal(readLiveNow({ localStorage: stale }), null);
  assert.equal(readLiveNow({ localStorage: fakeStorage({ [LIVE_NOW_KEY]: 'not json' }) }), null, 'a corrupt row must not throw on the homepage');
  assert.equal(readLiveNow({ localStorage: fakeStorage({ [LIVE_NOW_KEY]: JSON.stringify({ channel: 'X' }) }) }), null);
});

test('with no storage there is nothing to say', () => {
  // Node has no `window`, which is exactly the server render: no throw, no chip, no hydration fight.
  assert.equal(readLiveNow(), null);
  assert.equal(writeLiveNow({ channel: 'a', title: 'b', minutesLeft: 1 }), false);
});

test('the title is clipped, not allowed to break the strip', () => {
  const storage = fakeStorage();
  writeLiveNow({ channel: 'x'.repeat(80), title: 'y'.repeat(400), minutesLeft: -9 }, { localStorage: storage });
  const now = readLiveNow({ localStorage: storage });
  assert.equal(now.channel.length, 42);
  assert.equal(now.title.length, 90);
  assert.equal(now.minutesLeft, 0, 'a negative "minutes left" is a clock we should not print');
});

/* ------------------------------------------------------------------ one nav, two shells */

test('the nav exists once and is rendered per breakpoint', () => {
  const shared = read('../components/navItems.js');
  for (const href of ['/', '/live', '/music', '/sports', '/classics', '/my-list']) {
    assert.ok(shared.includes(`href: '${href}'`), `NAV_ITEMS must carry ${href}`);
  }
  const dock = read('../components/MobileDock.jsx');
  const rail = read('../components/rail/RailNav.jsx');
  assert.match(dock, /import \{ NAV_ITEMS \} from '@\/components\/navItems'/);
  assert.ok(!/const DOCK_ITEMS = \[\n\s*\{ href:/.test(dock), 'the bottom bar may not keep its own copy of the list');
  assert.match(rail, /NAV_ITEMS\.map\(\(item\) => \{/);
  assert.match(rail, /className="jv-rail fixed[^"]*hidden[^"]*lg:flex/);
  assert.match(dock, /mobile-dock fixed inset-x-0 bottom-0[^"]*lg:hidden/, 'one of the two is on screen at a time');
  assert.match(rail, /aria-current=\{active \? 'page' : undefined\}/);
});

test('the homepage pays for the rail and does not double-pad on phones', () => {
  const page = read('../app/page.js');
  const css = read('../app/globals.css');
  assert.match(page, /<main className="jv-rail-shift/);
  assert.match(css, /@media \(min-width: 1024px\) \{ \.jv-rail-shift \{ padding-left: 78px; \} \}/);
  assert.match(css, /@media \(min-width: 1280px\) \{ \.jv-rail-shift \{ padding-left: 188px; \} \}/);
  assert.match(css, /@media \(min-width: 1280px\) \{ \.jv-rail-label \{ display: block; \} \}/, 'labels appear when there is room for them');
});

/* ------------------------------------------------------------------ the focus, and the timer that had to go */

test('nothing moves the homepage by itself any more', () => {
  const page = read('../app/page.js');
  const focus = read('../components/rail/RailFocus.jsx');
  assert.ok(!page.includes('HeroCarousel'), 'the autoplaying hero is deleted, not hidden');
  assert.ok(!page.includes('jv-hero'), 'and its classes are not reused by the new panel');
  assert.ok(!/setInterval|requestAnimationFrame/.test(page), 'no 50ms interval redrawing a TV box');
  assert.ok(!/setInterval|setTimeout/.test(focus), 'the focus panel is state, not an animation loop');
});

test('a remote or a Tab key can aim it', () => {
  const focus = read('../components/rail/RailFocus.jsx');
  for (const key of ["'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'"]) {
    assert.ok(focus.includes(key), `${key} must move focus`);
  }
  assert.match(focus, /tabIndex=\{focused \? 0 : -1\}/, 'roving tabindex, so Tab leaves the strip instead of walking 14 tiles');
  assert.match(focus, /aria-selected=\{focused\}/);
  assert.match(focus, /scrollIntoView\?\.\(\{ block: 'nearest', inline: 'center'/, 'the focused tile is kept in view');
  assert.match(focus, /role="listbox"[\s\S]*aria-activedescendant=/);
});

test('nothing the old header carried is orphaned by the rail', () => {
  const page = read('../app/page.js');
  // The rail owns the six destinations on lg+, the dock owns them below it. Utilities that live nowhere
  // else — Stremio and the dynamic embed-provider buttons — have to stay in a cluster both devices show.
  assert.match(page, /\/stremio\?home=1/);
  assert.match(page, /<CleanEmbedButtons \/>/);
  assert.match(page, /window\.location\.assign\('\/stremio\?home=1'\)/, 'the hard reload that drops a stale manifest config');
  assert.ok(!/footer=\{\(\s*<a[\s\S]{0,240}stremio/.test(page), 'and not twice, which is how a rail grows a second Stremio');
});

test('the watch link is built in one place', () => {
  const page = read('../app/page.js');
  assert.match(page, /function watchHref\(item\) \{/);
  const literals = page.match(/\/watch\/\$\{item\.type\}\/\$\{item\.tmdbId\}/g) || [];
  assert.equal(literals.length, 1, 'MediaCard and the focus panel share one builder, so neither drops the quality hint');
  assert.match(page, /const href = hasTMDB \? watchHref\(item\) : undefined;/);
});

/* ------------------------------------------------------------------ the "on air" line stays free */

test('the homepage never asks for guide data', () => {
  const page = read('../app/page.js');
  const live = read('../app/live/page.js');
  assert.match(live, /writeLiveNow\(\{ channel: active\?\.name \|\| row\?\.name \|\| ''/  , '/live is the only writer');
  assert.match(page, /setLiveNow\(readLiveNow\(\)\);/, 'the homepage reads once after mount');
  assert.match(page, /const \[liveNow, setLiveNow\] = useState\(null\);/, 'not during render — the server has no storage');
  assert.ok(!/live-epg|live-service/.test(page), 'and no new request from /');
  const lib = read('../lib/liveNow.js');
  assert.ok(!/fetch\(/.test(lib), 'the store itself cannot reach the network');
});

test('the light theme and reduced motion were thought about', () => {
  const css = read('../app/globals.css');
  for (const selector of ['.jv-rail', '.jv-rail-item-active', '.jv-focus', '.jv-focus-title', '.jv-focus-tile-on', '.jv-focus-onair']) {
    assert.ok(css.includes(`html.day-mode ${selector}`), `${selector} needs a day-mode value or it is unreadable in the light theme`);
  }
  const motion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(motion, /\.jv-focus-art \{ animation: none; \}/);
  assert.match(motion, /\.jv-focus-tile,\n?\s*\.jv-focus-tile-on \{ transition: none; transform: none; \}/);
});
