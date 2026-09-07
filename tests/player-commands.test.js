import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { COMMANDS, IGNORED_TARGETS, classifyGesture, commandForKey, digitSeekPercent, keyMap, parityReport, tapZone } from '../lib/player/commands.js';

const keyEvent = (key, extra = {}) => ({ key, target: { tagName: 'DIV' }, ...extra });

test('desktop keys resolve to commands, and the ignore list is honoured', () => {
  assert.equal(commandForKey(keyEvent(' ')), 'togglePlay');
  assert.equal(commandForKey(keyEvent('k')), 'togglePlay');
  assert.equal(commandForKey(keyEvent('m')), 'mute');
  assert.equal(commandForKey(keyEvent('f')), 'toggleFullscreen');
  assert.equal(commandForKey(keyEvent('Escape')), 'closeMenus');
  assert.equal(commandForKey(keyEvent('PageDown')), 'nextItem');
  assert.equal(commandForKey(keyEvent('z')), null, 'unbound keys must reach the page');
  assert.equal(commandForKey(keyEvent('k'), { enabled: false }), null);

  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(commandForKey({ key: 'k', target: { tagName: tag } }), null, `${tag} keeps its keystrokes`);
    assert.ok(IGNORED_TARGETS.has(tag.toLowerCase()));
  }
  assert.equal(commandForKey({ key: 'k', target: { isContentEditable: true } }), null);
});

test('modifier combos win over the bare arrow bindings', () => {
  assert.equal(commandForKey(keyEvent('ArrowUp')), 'nudgeVolumeUp');
  assert.equal(commandForKey(keyEvent('ArrowUp', { shiftKey: true })), 'subtitleDelayUp');
  assert.equal(commandForKey(keyEvent('ArrowDown', { shiftKey: true })), 'subtitleDelayDown');
  assert.equal(commandForKey(keyEvent('ArrowLeft', { shiftKey: true })), 'seekBack30');
  assert.equal(commandForKey(keyEvent('Q', { shiftKey: true })), 'qualityAuto');
  assert.equal(commandForKey(keyEvent('q')), 'cycleQuality');
});

test('digit seeks carry the percentage the chrome needs', () => {
  assert.equal(commandForKey(keyEvent('5')), 'jumpToPercent');
  assert.equal(digitSeekPercent(keyEvent('5')), 50);
  assert.equal(digitSeekPercent(keyEvent('0')), 0);
  assert.equal(digitSeekPercent(keyEvent('9')), 90);
  assert.equal(digitSeekPercent(keyEvent('x')), null);
});

test('the key map is conflict-free for the bindings that must be unique', () => {
  const map = keyMap();
  // shift+x used to be shared by "skip intro" and "A-B loop"; one command each.
  assert.deepEqual(map['shift+x'], ['skipMarks']);
  assert.deepEqual(map['shift+r'], ['loopSegment']);
  assert.deepEqual(map[' '], ['togglePlay']);
  assert.ok(map['shift+arrowup'].includes('subtitleDelayUp'));
});

test('gesture classification covers tap zones, swipes and scrubbing', () => {
  const rect = { left: 0, width: 1000 };

  assert.deepEqual(tapZone(100, rect), 'left');
  assert.deepEqual(tapZone(500, rect), 'middle');
  assert.deepEqual(tapZone(900, rect), 'right');

  // state (double-tap memory) is the SECOND argument — the chrome keeps it in a ref.
  const tap = (x, y = 100, state = {}) =>
    classifyGesture({ startX: x, startY: y, endX: x, endY: y, durationMs: 120, pointerType: 'touch', zone: tapZone(x, rect) }, state);
  assert.equal(tap(500).command, 'togglePlay');
  assert.equal(tap(100).command, 'seekBack');
  assert.equal(tap(900).command, 'seekForward');
  assert.equal(tap(500).doubleTap, false);
  assert.equal(tap(500, 100, { recentTap: true }).doubleTap, true);

  const swipe = (x, y, dx, dy, extra = {}) =>
    classifyGesture({ startX: x, startY: y, endX: x + dx, endY: y + dy, durationMs: 300, pointerType: 'touch', zone: tapZone(x, { left: 0, width: 1000 }), ...extra });
  assert.equal(swipe(100, 500, 4, -120).command, 'brightnessUp');
  assert.equal(swipe(100, 500, 4, 120).command, 'brightnessDown');
  assert.equal(swipe(900, 500, 4, -120).command, 'nudgeVolumeUp');
  assert.equal(swipe(900, 500, 4, 120).command, 'nudgeVolumeDown');
  assert.equal(swipe(500, 500, 2, -120).type, 'ignore', 'a vertical swipe in the middle does nothing');
  assert.equal(swipe(500, 500, 200, 0).command, 'seekForward');
  assert.equal(swipe(500, 500, -200, 0).command, 'seekBack');
  assert.equal(swipe(500, 500, 20, 10).type, 'ignore', 'a lazy drag is not a gesture');

  assert.equal(classifyGesture({ startX: 0, startY: 0, endX: 0, endY: 0, durationMs: 50, pointerType: 'mouse' }).type, 'click');
  assert.equal(classifyGesture({ startX: 0, startY: 0, endX: 300, endY: 0, durationMs: 50, pointerType: 'mouse' }).type, 'drag');
});

test('parity: no command is reachable on exactly one device class by accident', () => {
  const report = parityReport();
  assert.deepEqual(report.gaps, [], JSON.stringify(report.gaps));
  assert.equal(report.total, Object.keys(COMMANDS).length);
  assert.ok(report.total >= 30, `the command surface should not shrink (found ${report.total})`);

  for (const [name, command] of Object.entries(COMMANDS)) {
    assert.ok(command.label?.length > 2, `${name} needs a label for the help sheet`);
    const reachable = Boolean(command.gesture || command.button || command.menu || command.desktopOnly);
    assert.equal(reachable, true, `${name} must declare how touch users reach it`);
  }
});

test('the chrome wires every declared command and never hard-codes keys', (t) => {
  const chromePath = path.resolve(import.meta.dirname, '../components/player/JashPlayer.js');
  if (!existsSync(chromePath)) return t.skip('components/player/JashPlayer.js does not exist yet');
  const source = readFileSync(chromePath, 'utf8');
  assert.match(source, /from '@\/lib\/player\/commands'/, 'the chrome must import the command table');
  assert.match(source, /commandForKey/, 'the chrome must resolve keys through commandForKey');
  for (const name of Object.keys(COMMANDS)) {
    assert.ok(new RegExp(`\\b${name}\\b`).test(source), `${name} is declared but never handled in the chrome`);
  }
  // Keys must come from the table, not from literals scattered in the component.
  assert.doesNotMatch(source, /case 'ArrowUp'/, 'arrow handling belongs to commandForKey');
});
