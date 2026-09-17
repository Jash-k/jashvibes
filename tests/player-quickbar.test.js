/*
 * tests/player-quickbar.test.js — the bar is four controls, one tap each.
 *
 * The old bar hid most of its pills behind `sm:` breakpoints and poured the
 * rest into one settings sheet (speed, audio, subtitle options, mirrors,
 * shortcuts) — so a phone was three taps from anything and a TV remote was
 * worse. This pins the replacement: Quality / Aspect / CC / PiP directly on
 * the bar, each opening its own list, everything else *deleted* from the UI
 * while every keyboard command survives untouched.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMMANDS } from '../lib/player/commands.js';
import { ASPECT_MODES } from '../lib/player/aspect.js';
import { buildSourceList } from '../lib/player/labels.js';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

const player = read('../components/player/JashPlayer.js');
const menus = read('../components/player/PlayerMenus.js');
const css = read('../app/globals.css');

/* ------------------------------------------------- the four controls */

test('the bar carries quality, aspect, CC and PiP — each a single tap', () => {
  assert.match(player, /setMenu\(menu === 'quality' \? null : 'quality'\)/, 'quality pill opens the quality list');
  assert.match(player, /setMenu\(menu === 'aspect' \? null : 'aspect'\)/, 'aspect pill opens the aspect list');
  assert.match(player, /data-jash-command="cycleCaptions"/, 'CC is a real toggle on the bar');
  assert.match(player, /data-jash-command="togglePip"/, 'PiP is a real toggle on the bar');
});

test('each control is rendered only where it can do something', () => {
  const cc = player.slice(player.indexOf('{hasSubtitles ?'), player.indexOf('{canPip ?'));
  assert.ok(cc.includes('runCommand'), 'CC rides the command path');
  assert.match(player, /\{canPip \?[\s\S]{0,200}data-jash-command="togglePip"/, 'PiP is behind the capability check');
  assert.match(player, /const hasSubtitles = \(tracks\.text \|\| \[\]\)\.length > 0 \|\| Boolean\(engine\.externalSubtitle\)/,
    'CC exists only when a track exists — no control that controls nothing');
});

test('the quality pill names the active stream, not a generic word', () => {
  assert.match(player, /activeStreamQuality \|\| renditionLabel/,
    'labeled streams win ("1080p"), plain files fall back to Auto/height');
});

/* ------------------------------------------------- the sheet is gone */

test('the settings sheet and its sub-sheets are deleted outright', () => {
  for (const gone of ['SettingsMenu', 'SpeedMenu', 'AudioMenu', 'SubtitlesMenu', 'SourcesMenu', 'ShortcutList', 'MenuSlider', 'MenuToggle', 'MenuSection', 'SPEED_OPTIONS']) {
    assert.ok(!new RegExp(`export const ${gone}\\b`).test(menus), `${gone} is not exported anymore`);
    assert.ok(!new RegExp(`<${gone}[\\s/>]`).test(player), `${gone} is not rendered`);
  }
  assert.ok(!/menu === 'settings'/.test(player), 'no settings branch anywhere');
});

test('what was removed from the UI still exists as keyboard commands', () => {
  for (const name of ['speedUp', 'speedDown', 'speedReset', 'cycleAudioTrack', 'cycleCaptions', 'openSubtitles', 'subtitleDelayUp', 'subtitleDelayDown', 'cycleQuality', 'qualityAuto', 'togglePip', 'freezeFrame', 'restart']) {
    assert.ok(COMMANDS[name], `${name} still a command`);
    assert.ok(COMMANDS[name].keys?.length, `${name} still has keys`);
  }
});

test('shift+C now toggles captions instead of opening the deleted sheet', () => {
  assert.equal(COMMANDS.openSubtitles.keys[0], 'shift+c', 'the key mapping is unchanged');
  const openCase = player.slice(player.indexOf("case 'openSubtitles'"), player.indexOf("case 'subtitleDelayUp'"));
  assert.match(openCase, /engine\.cycleCaptions\(\)/, 'shift+C does what C does now');
  assert.ok(!openCase.includes("setMenu("), 'and opens nothing');
});

test('a stream with no subtitles says so instead of opening a dead menu', () => {
  const ccCase = player.slice(player.indexOf("case 'cycleCaptions'"), player.indexOf("case 'openSubtitles'"));
  assert.match(ccCase, /carries no subtitles/, 'the fallback is a sentence, not a sheet');
});

/* ------------------------------------------------- the lists themselves */

test('quality opens the labeled stream list when the page discovered streams', () => {
  assert.match(menus, /streams\.map\(\(source, index\)/, 'the stream rows come from the page lineup');
  assert.match(menus, /fmtSize\(Number\(source\.sizeBytes\)\)/, 'sizes print when known ("1080p 2.4GB")');
  assert.match(menus, /onPickStream/, 'a tap hands the choice back to the player');
});

test('plain files fall back to Auto + height rows', () => {
  const fallback = menus.slice(menus.indexOf('export const QualityMenu'), menus.indexOf('export const AspectMenu'));
  assert.match(fallback, /<MenuItem[^>]*command="qualityAuto"[^>]*active=\{auto\}/, 'Auto first');
  assert.match(fallback, /heights\.map\(\(height\)/, 'then the manifest heights');
  assert.match(fallback, /one rendition/, 'and a single-rendition source explains itself');
});

test('aspect lists all seven modes with hints', () => {
  const aspect = menus.slice(menus.indexOf('export const AspectMenu'), menus.indexOf('/** Right-click menu'));
  assert.match(aspect, /ASPECT_MODES\.map/, 'the rows come from the one modes list, not a hand copy');
  assert.deepEqual(ASPECT_MODES.map((mode) => mode.id), ['auto', 'fill', '16:9', '4:3', '2.39:1', '9:16', 'stretch']);
  assert.match(aspect, /hint=\{mode\.hint\}/);
});

/* ------------------------------------------------- the physical rules */

test('±10s buttons hide on phones — double-tap seeks there', () => {
  for (const command of ['seekBack', 'seekForward']) {
    const idx = player.indexOf(`data-jash-command="${command}"`);
    const button = player.slice(idx, player.indexOf('</button>', idx));
    assert.match(button, /hidden[^"']*sm:grid/, `${command} is hidden until sm`);
  }
});

test('rows stay at thumb height, and TV screens get roomier rows', () => {
  assert.match(menus, /jv-menu-row/, 'the row class is on every menu item');
  assert.match(css, /\.jv-menu-row \{\s*min-height: 44px;/s);
  assert.match(css, /@media \(min-width: 1600px\)\s*\{\s*\.jv-menu-row \{\s*min-height: 52px;/s);
});

/* ------------------------------------------------- page sync */

test('the quality stream switch tells the page, so page dropdowns re-sync', () => {
  const pick = player.slice(player.indexOf('onPickStream='), player.indexOf('heights={heights}'));
  assert.match(pick, /engine\.rotateFallback\(index\)/, 'the engine switches with the position kept');
  assert.match(pick, /onPickSource\?\.\(index\)/, 'and the page is told — its dropdown follows');
});

test('the Watch page derives its Stremio dropdown from the playing stream', () => {
  const page = read('../app/watch/[type]/[tmdbId]/page.js');
  assert.match(page, /activeStremioStream = useMemo\(/, 'the active stream is derived, not remembered');
  assert.match(page, /stream\.url === currentStreamUrl/, 'by the URL that is actually playing');
  assert.match(page, /value=\{activeStremioStream\?\.id \|\| selectedStremioStreamId/,
    'the select shows the playing stream first');
});

/* ------------------------------------------------- labeled rows carry quality */

test('buildSourceList rows carry quality and size for the pill', () => {
  const rows = buildSourceList({
    urls: ['https://host/file.mkv'],
    streams: [{ id: 'a', label: '1080p · 2.4GB', url: 'https://host/file.mkv', size: '2.4GB' }],
  });
  assert.equal(rows[0].quality, '1080p');
  assert.equal(rows[0].size, '2.4GB');

  const fromUrl = buildSourceList({ urls: ['https://host/Movie.2023.1080p.x264-Group.mkv'] });
  assert.equal(fromUrl[0].quality, '1080p', 'resolution is parsed from the release name when the resolver is silent');

  const quiet = buildSourceList({ urls: ['https://host/just-a-file.mkv'] });
  assert.equal(quiet[0].quality, '', 'no invented quality — the pill falls back to Auto/height');
});
