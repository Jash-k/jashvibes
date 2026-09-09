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
  for (const href of ['/', '/live', '/anime', '/music', '/sports', '/classics', '/stremio?home=1']) {
    assert.ok(shared.includes(`href: '${href}'`), `NAV_ITEMS must carry ${href}`);
  }
  assert.ok(!shared.includes("href: '/my-list'"), 'My List is not a destination on this page any more');
  assert.match(shared, /label: 'Anime', emoji: '🌸'/, 'the anime entry point is an emoji, per the brief');
  assert.match(shared, /label: 'Stremio'[\s\S]*?hard: true/, 'Stremio hard-navigates so a changed manifest is not cached');
  assert.match(shared, /export function isNavItemActive/, 'one active-state rule for both shells');
  const dock = read('../components/MobileDock.jsx');
  const rail = read('../components/rail/RailNav.jsx');
  assert.match(dock, /import \{ NAV_ITEMS[^}]*\} from '@\/components\/navItems'/);
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

test('deleting the old header orphaned nothing', () => {
  const page = read('../app/page.js');
  const stremio = read('../app/stremio/page.js');
  const links = read('../components/EmbedSiteLinks.jsx');
  // Every destination the deleted ghost-button row carried is now in the shared nav list, and the one
  // thing that was not a destination — the env-configured embed providers — was moved rather than
  // dropped, because /embed-browser had no other link to it anywhere in the app.
  assert.match(links, /\/embed-browser\?site=/);
  assert.match(stremio, /<EmbedSiteLinks \/>/, 'next to the addon it belongs to');
  assert.match(links, /fetch\('\/api\/embed-sites'/, 'the fetch moved with it');
  assert.ok(!page.includes('embed-sites'), 'and the homepage no longer makes that request at all');
  const focus = read('../components/rail/RailFocus.jsx');
  assert.match(focus, /\/my-list\?tab=history/, 'the library is still one tap away from a half-watched title');
});

test('the page is the new layout only — no header remnants, and search is the palette', () => {
  const page = read('../app/page.js');
  for (const gone of ['SearchBox', 'CleanEmbedButtons', 'LibraryRows', 'TabButton', 'MediaGrid', 'LoadingGrid', 'jv-btn-ghost', 'syncLatestReleases']) {
    assert.ok(!page.includes(gone), `${gone} is deleted, not hidden — a half-removed header is still a header`);
  }
  assert.match(page, /<CommandPalette open=\{paletteOpen\} onClose=\{setPaletteOpen\} \/>/, 'the ⌘K palette stays mounted');
  assert.match(page, /onOpenSearch=\{\(\) => setPaletteOpen\(true\)\}/, 'the rail opens it, since there is no field to focus');
  assert.ok(!/getElementById\('tmdb-search'\)/.test(page), 'and nothing reaches for a search input that no longer exists');
});

test('two rows, each paging its own group', () => {
  const page = read('../app/page.js');
  const movies = page.match(/<CatalogRow[\s\S]*?id="movies"[\s\S]*?\/>/);
  const series = page.match(/<CatalogRow[\s\S]*?id="series"[\s\S]*?\/>/);
  assert.ok(movies && series, 'one row per group');
  assert.match(movies[0], /items=\{movies\}/);
  assert.match(movies[0], /info=\{paging\.movies\}/);
  assert.match(movies[0], /onMore=\{\(\) => loadMore\('movies'\)\}/);
  assert.match(series[0], /onMore=\{\(\) => loadMore\('series'\)\}/);
  assert.ok(!/activeTab/.test(page), 'no tab state left behind to confuse a reader');
  assert.ok(!/IntersectionObserver/.test(page), 'per-row Load more replaces the sentinel that auto-paged the active tab');
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
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-focus-art'));
  assert.match(motion, /\.jv-focus-art \{ animation: none; \}/);
  assert.match(motion, /\.jv-focus-tile,[\s\S]{0,40}\.jv-focus-tile-on \{ transition: none; transform: none; \}/);
  const rowMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-row-more'));
  assert.match(rowMotion, /\.jv-row-more \{ transition: none; \}/);
  assert.match(css, /\.jv-row-strip \{[\s\S]*?scroll-snap-type: x proximity;/, 'a strip a thumb or a D-pad can walk');
});
