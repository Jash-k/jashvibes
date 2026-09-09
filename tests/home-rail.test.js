import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Rail OS: the homepage is a left rail (desktop/TV) plus one poster the catalogue decides to show.
 * These tests guard the things that made the old layout wrong — a nav that existed twice, a hero that
 * moved on its own, a thumbnail rail nested inside that hero, a channel line that did not belong to the
 * title underneath it — and a light theme that repainted the artwork out from under the component.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

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

test('the banner is a poster, not a widget — no strip, no duplicate CTA', () => {
  const focus = read('../components/rail/RailFocus.jsx');
  const css = read('../app/globals.css');
  for (const gone of ['role="listbox"', 'aria-activedescendant', 'tabIndex={focused ? 0 : -1}', 'scrollIntoView', 'jv-focus-strip', 'onStripKey']) {
    assert.ok(!focus.includes(gone), `${gone} is deleted: a thumbnail rail inside the hero was a control inside a control`);
  }
  assert.ok(!css.includes('.jv-focus-strip'), 'and its CSS went with it');
  assert.ok(!css.includes('.jv-focus-tile'), 'no orphan tile rules either');
  assert.match(focus, /aria-label="Featured title"/);
  assert.ok(!focus.includes('Details'), 'one primary action, not two links to the same page');
  assert.match(focus, /slide\.progress > 0 \? `Resume · \$\{slide\.progress\}%` : 'Watch now'/);
  const page = read('../app/page.js');
  assert.match(page, /<RailFocus\s*\n?\s*slide=\{focusSlide\}/, 'one slide, chosen from history or the freshest scrape entry');
  assert.ok(!page.includes('focusSlides'), 'no list left to aim');
});

test('deleting the old header orphaned nothing', () => {
  const page = read('../app/page.js');
  const stremio = read('../app/stremio/page.js');
  const links = read('../components/EmbedSiteLinks.jsx');
  // Every destination the deleted ghost-button row carried is now in the shared nav list, and the one
  // thing that was not a destination — the env-configured embed providers — was moved rather than
  // dropped, because /embed-browser had no other link to it anywhere in the app.
  assert.match(links, /\/embed-browser\?site=/);
  assert.match(stremio, /<EmbedSiteLinks \/>/, 'still on /stremio, where the addon lives — now inside the catalogs sheet the shelf opened');
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

test('live TV stays out of the hero', () => {
  const focus = read('../components/rail/RailFocus.jsx');
  const page = read('../app/page.js');
  const live = read('../app/live/page.js');
  const css = read('../app/globals.css');
  for (const gone of ['onAir', 'jv-focus-onair', 'jv-focus-dot', 'href="/live"']) {
    assert.ok(!focus.includes(gone), `${gone} is deleted — a movie poster does not get a channel line`);
  }
  assert.ok(!page.includes('liveNow'), 'the homepage never reads guide state, so it can never print yesterday\'s "on air now"');
  assert.ok(!live.includes('writeLiveNow'), 'and /live has no publisher left behind');
  assert.ok(!fs.existsSync(new URL('../lib/liveNow.js', import.meta.url)), 'the storage contract went with its only reader');
  assert.ok(!css.includes('.jv-focus-onair') && !css.includes('.jv-focus-dot'), 'no orphan rules under the seat');
  assert.ok(!/const \[liveNow, setLiveNow\]/.test(page), 'no state, so nothing re-renders the banner after mount');
});

test('day mode keeps the artwork readable — the exact bug that was reported', () => {
  const css = read('../app/globals.css');
  // The banner must not invert: a light wash over a dark poster is "the hero is not visible", and dark
  // display type over it is "the title looks blurred".
  assert.match(css, /html\.day-mode \.jv-focus \{ background: #06060a; \}/, 'day mode keeps the poster panel dark');
  assert.match(css, /html\.day-mode \.jv-focus-title \{ color: #fff/, 'and the title white');
  assert.ok(!/html\.day-mode \.jv-focus-title \{ color: #0b0b0d/.test(css), 'no dark-on-light title, ever');
  assert.ok(!/html\.day-mode \.jv-focus \{ background: #f4f4f5/.test(css), 'no light slab behind it');
});

test('the title is crisp, not glowing, and the art is actually visible', () => {
  const css = read('../app/globals.css');
  const title = css.slice(css.indexOf('.jv-focus-title {'), css.indexOf('.jv-focus-meta {'));
  const shadow = title.match(/text-shadow:([^;]+);/);
  assert.ok(shadow, 'the title needs some edge to survive bright artwork');
  const blurs = [...shadow[1].matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const maxBlur = Math.max(...blurs);
  assert.ok(maxBlur <= 16, `a ${maxBlur}px blur under display type is what read as blur; keep it tight`);
  const art = css.slice(css.indexOf('.jv-focus-art {'), css.indexOf('.jv-focus-shade {'));
  const opacity = Number(art.match(/opacity:\s*([\d.]+)/)[1]);
  assert.ok(opacity >= 0.7, `art at ${opacity} is a texture, not a poster — the complaint was that it is invisible`);
});

test('motion is trimmed and the rows still walk', () => {
  const css = read('../app/globals.css');
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-focus-art'));
  assert.match(motion, /\.jv-focus-art \{ animation: none; \}/);
  const rowMotion = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  .jv-row-more'));
  assert.match(rowMotion, /\.jv-row-more \{ transition: none; \}/);
  assert.match(css, /\.jv-row-strip \{[\s\S]*?scroll-snap-type: x proximity;/, 'a strip a thumb or a D-pad can walk');
  for (const selector of ['.jv-rail', '.jv-rail-item-active']) {
    assert.ok(css.includes(`html.day-mode ${selector}`), `${selector} is chrome, so it needs a day-mode value`);
  }
});
