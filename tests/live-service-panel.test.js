import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Guards for the live service panel and the surfaces it drives.
 *
 * The panel is the one place in this app that has to show somebody else's whole catalog — 5,000 rows
 * from a fresh M3U — so the failure mode is not a wrong value, it is the browser stopping to respond.
 * These assertions keep the four fixes honest: rows are never all mounted at once, the filters are the
 * server's job, the preview player actually occupies a box, and a live broadcast is marked once.
 */

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const page = read('../app/live/page.js');
const player = read('../components/player/JashPlayer.js');
const overlays = read('../components/player/PlayerOverlays.js');
const home = read('../app/page.js');
// LiveEpgPanel is defined *before* the panel, so the slice runs to the list helpers underneath it.
const panel = page.slice(page.indexOf('function LiveServicePanel('), page.indexOf('function PanelPager('));

test('a fresh source pages its catalog instead of mounting all of it', () => {
  assert.match(page, /const PANEL_PAGE_SIZE = 200;/, 'one page of the source catalog');
  assert.match(page, /const ROW_STEP = 400;/, 'and the capped lists grow in bounded steps');
  assert.match(panel, /limit: mapped \? '1000' : String\(PANEL_PAGE_SIZE\)/, 'the unbounded 5000-row fetch is gone');
  assert.ok(!/limit: mapped \? '1000' : '5000'/.test(page), 'no 5,000-channel response any more');
  assert.match(panel, /params\.set\('page', String\(Math\.max\(1, Number\(page\) \|\| 1\)\)\)/, 'page is a server parameter');
  assert.match(panel, /PanelPager/, 'prev/next is explicit UI, not infinite scroll');
  assert.match(panel, /\.slice\(0, rowLimit\)/, 'the mapped and preview lists are capped');
  assert.match(panel, /RowShowMore/, 'and the cap says how much is still hidden');
  assert.match(panel, /startTransition\(\(\) => setRowLimit/, 'revealing more rows is interruptible, so the panel keeps responding');
});

test('search and the two selects go to the API, and never filter the same page twice', () => {
  assert.match(panel, /if \(needle\) params\.set\('q', needle\)/, 'name search is a server query');
  assert.match(panel, /if \(map === 'mapped'\) params\.set\('mapped', '1'\)/);
  assert.match(panel, /if \(map === 'unmapped'\) params\.set\('mapped', '0'\)/);
  assert.match(panel, /if \(category\) params\.set\('category', category\)/);
  assert.match(panel, /const timer = window\.setTimeout\(\(\) => \{\s*loadChannels\(\{ sourceId: sourceFilter, page: 1, q, map: mappingFilter, category: categoryFilter \}\)/, 'debounced, and back to page 1 when the criteria change');
  assert.match(panel, /}, 320\);/, 'and the debounce is short enough to feel instant on a fast connection');
  assert.match(panel, /if \(applied\) return channels; \/\/ the page in hand is already the answer/, 'the client only filters what the server has not already filtered');
  assert.match(panel, /}, \[channelQuery, mappingFilter, categoryFilter, open, tab, channelsLoaded, sourceFilter\]\);/, 'one effect drives all three controls');
});

test('the preview player fills the box it is given', () => {
  // Its children are absolutely positioned, so a compact root without a size collapsed to 0px: the
  // preview looked dead because there was nothing to see, not because playback failed.
  const compactAt = player.indexOf('if (compact) {');
  const compact = player.slice(compactAt, compactAt + 1500);
  assert.match(compact, /relative isolate h-full w-full overflow-hidden/);
  assert.match(page, /<div className="relative aspect-video bg-black">/, 'the caller gives it a positioned 16:9 box');
  assert.match(page, /has no stream URL to preview/, 'a channel without a URL says so instead of showing an empty frame');
});

test('a live broadcast is marked once per player', () => {
  const topBar = overlays.slice(overlays.indexOf('export const TopBar'), overlays.indexOf('export const LiveBadge'));
  assert.match(topBar, /\{live && canSeek \? \(/, 'the header only adds LIVE when the bar has a seek track instead of the badge');
  assert.ok(!topBar.includes('live && !canSeek'), 'the duplicate ping+LIVE row for a simulcast is gone');
  assert.equal(overlays.split('animate-ping').length - 1, 2, 'two ping dots exist: one per live marker style, never both at once');
  assert.ok(!page.includes('jv-badge-live'), 'the card under the player no longer repeats the same symbol');
});

test('the homepage has no client-side filter rail', () => {
  assert.ok(!home.includes('filterMode'), 'filter state is gone, not hidden');
  assert.ok(!home.includes('{/* Quick Filter Rail */}'), 'the rail markup is deleted, not hidden behind a flag');
  assert.ok(!home.includes('setFilterMode'), 'no leftover setter for a filter nobody can reach');
  assert.match(home, /items=\{movies\}/, 'a row per group shows both, so a page boundary cannot look empty');
  assert.match(home, /onMore=\{\(\) => loadMore\('movies'\)\}/, 'and each row pages its own group from the provider');
  assert.ok(!home.includes('TabButton'), 'the tab switcher is deleted: it only hid half of what was already loaded');
});
