import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Structural guards for the R1 live layout and its guide layer.
 *
 * These read source on purpose. The behaviour itself is covered in live-epg.test.js (parsing, linking,
 * windows, caching) and cannot be exercised by a DOM here, but the *shape* of the layout — one video,
 * a phone row that is not a scaled-down desktop pane, a guide that never becomes a server dependency —
 * is exactly the kind of thing a later edit quietly undoes. Same style as the player parity tests.
 */

const page = fs.readFileSync(new URL('../app/live/page.js', import.meta.url), 'utf8');
const guide = fs.readFileSync(new URL('../components/live/LiveGuide.js', import.meta.url), 'utf8');
const route = fs.readFileSync(new URL('../app/api/live-epg/guide/route.js', import.meta.url), 'utf8');
const lib = fs.readFileSync(new URL('../lib/liveEpg.js', import.meta.url), 'utf8');
const channelsRoute = fs.readFileSync(new URL('../app/api/live-service/channels/route.js', import.meta.url), 'utf8');

test('the live page keeps a single main <video>: the guide is a neighbour, not a wrapper', () => {
  // One player in the shell, one in the panel's preview. A third would mean a second surface that can
  // race the first — and a remount around the player is what used to restart a seek at 0.
  const shellStart = page.indexOf('id="live-player-shell"');
  const shellEnd = page.indexOf('<div className="rounded-2xl border border-white/10 bg-zinc-950/80', shellStart);
  const shell = page.slice(shellStart, shellEnd);
  assert.equal(shell.split('<JashPlayer').length - 1, 1, 'exactly one player inside the shell');
  assert.equal(page.split('<JashPlayer').length - 1, 2, 'the only other player is the service preview');
  assert.ok(shell.includes('livePolicy'), 'the shell player still runs through the live policy');
  assert.ok(!/LiveGuide[^>]*>\s*<JashPlayer/i.test(page), 'no guide component wraps the player');
});

test('phone layout: the guide shares the sticky strip with the player, and the choice persists', () => {
  const strip = page.slice(page.indexOf('R1 phone row'), page.indexOf('<div className="rounded-2xl border border-white/10 bg-zinc-950/80'));
  assert.match(strip, /sticky top-0 z-40 flex flex-col/, 'the strip is sticky and stacks on phone');
  assert.match(strip, /guideCompact \? 'max-sm:flex-row/, 'compact mode puts the guide beside the player below 640px');
  assert.match(strip, /max-sm:w-\[54%\]/, 'the video keeps a 16:9 letterbox next to the guide row');
  assert.match(strip, /sm:top-\[var\(--live-header-h,84px\)\]/, 'it clears the header from sm up');
  assert.match(strip, /lg:static/, 'and goes back into flow where the left pane is the sticky one');
  assert.match(page, /LIVE_GUIDE_ROW_STORAGE_KEY = 'jash_live_guide_row'/, 'the row preference is stored per device');
  assert.match(page, /toggleGuideRow/, 'both directions of the toggle are wired');
});

test('desktop layout: the left pane is unclipped, and the rail rows carry real listings', () => {
  assert.match(page, /lg:block lg:min-h-0 lg:sticky/, 'the left pane can scroll instead of clipping its card');
  assert.match(page, /lg:top-\[calc\(var\(--live-header-h,84px\)\+1rem\)\]/, 'it is lifted clear of the sticky header');
  assert.match(page, /<ProgrammeCard[\s\S]{0,240}guide\.get\(active\?\.id\)/, 'the card under the player is the focused channel');
  assert.match(page, /<DayStrip row=\{guide\.get\(active\?\.id\)\}/, "today's blocks render for the focused channel");
  assert.match(page, /<GuideNowLine row=\{guide\.get\(channel\.id\)\}/, 'every rail row answers with its own schedule');
  assert.ok(!page.includes('>LIVE HD<'), 'the placeholder "LIVE HD" line is gone — a fake listing is worse than none');
  assert.match(page, /<GuideStatus/, 'the rail states how much of the lineup actually links');
  // One live marker for the whole surface: the player owns it, the rail row marks the tuned channel
  // with styling instead of a second pulsing dot.
  assert.ok(!page.includes('animate-ping'), 'no ping dot in the channel list');
  assert.ok(!page.includes('jv-badge-live'), 'no repeated Live pill under the player');
});

test('the guide is fetched once for the whole lineup, never per filter keystroke', () => {
  assert.match(page, /useLiveGuide\(\{ channels, activeId/, 'the hook takes the full lineup, not filteredChannels');
  assert.match(guide, /function lineupPayload/, 'the lineup is a stringified payload, so the effect deps are stable');
  assert.match(guide, /\.slice\(0, 500\)/, 'a huge lineup is capped rather than turning into a giant query');
  assert.match(guide, /if \(document\.visibilityState === 'visible'\) load\(\{ day: activeId \}\);/, 'a hidden tab does not fetch at all');
  assert.match(guide, /const onVisibility = \(\) => \(document\.visibilityState === 'visible' \? start\(\) : stop\(\)\);/, 'and the interval is torn down while it stays hidden');
  assert.match(guide, /Math\.max\(15_000, Number\(intervalMs\)/, 'the tick rate is floored, so a bad prop cannot spin the network');
  assert.match(guide, /if \(requestRef\.current !== id\) return null/, 'a stale response cannot overwrite a newer one');
});

test('a guide failure is a state, not a crash', () => {
  // Unmatched channels, an empty day and a failed fetch each have their own copy and controls.
  assert.match(guide, /No guide match — map it in the service panel/);
  assert.match(guide, /This source has no entry in the guide feed/);
  assert.match(guide, /row && !row\.matched \? 'No guide data linked'/);
  assert.match(guide, /Loading the guide…/, 'a cold cache is not reported as "nothing scheduled"');
  // Errors from the ticker are shown next to the last known guide, and the page keeps playing.
  assert.match(guide, /Keep the last known guide on screen/);
  assert.ok(!/router\.refresh|window\.location\.reload/.test(guide), 'a failed listing never reloads the page');
});

test('the route never returns a 500 for a listing problem, and its writes are gated', () => {
  assert.match(route, /ok: false, error: String\(error\?\.message \|\| error\), channels: \[\], linked: 0, unlinked: 0, status: \{\} \}, 200\)/,
    'the GET catch answers 200 with the same shape, so /live can never break on the guide');
  assert.match(route, /requireServiceAuth\(request\)/, 'POST refresh needs the service token');
  assert.match(route, /if \(action !== 'refresh'\)/, 'and rejects anything else');
  assert.match(route, /lookup/, 'the panel picker is served by the same route');
  assert.match(route, /MAX_CHANNELS = 400/, 'a request lineup is bounded');
});

test('the guide layer is derived data: no database in the read path', () => {
  assert.ok(!/from '@\/models/.test(lib), 'lib/liveEpg does not import a model');
  assert.ok(!/from '@\/models/.test(guide), 'the client guide does not either');
  assert.match(lib, /globalThis\.__jashLiveEpg/, 'the index is a process cache, rebuilt after a restart');
  assert.match(lib, /export function clearGuideCache/, 'and it is explicitly resettable, because tests must not share it');
  // One hour, floored: below a minute it would turn into a download loop on a free instance.
  assert.match(lib, /Math\.max\(60_000, Number\(process\.env\.LIVE_EPG_TTL_MS\) \|\| DEFAULT_TTL_MS\)/, 'one hour, floored at a minute');
});

test('mapping a channel to the feed is one PATCH on tvgId', () => {
  assert.match(page, /\['epg', 'Guide \(EPG\)'\]/, 'the panel gains a tab instead of a new surface');
  assert.match(page, /<LiveEpgPanel channels=\{selectedChannels\} onAction=\{channelAction\} epg=\{epg\}/);
  assert.match(page, /onAction\?\.\(channel, 'setEpg'/, 'the picker saves through the existing channel action plumbing');
  assert.match(channelsRoute, /action === 'setEpg' \|\| body\.epgId !== undefined/, 'the route accepts the binding, including an empty one');
  assert.match(channelsRoute, /doc\.tvgId = String\(body\.epgId \|\| ''\)\.trim\(\)/);
  assert.match(page, /await api\('\/api\/live-service\/channels', \{\s*method: 'PATCH'/, 'channelAction is the only writer, so a binding lands in the same merge path as a mapping change');
});
