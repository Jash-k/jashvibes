/*
 * tests/sports-live.test.js — the On Air Grid's resolver and its board contract.
 *
 * `lib/sportsLive.js` decides what the hero is. That decision is pure and this file
 * pins it: fresh match feeds beat a published stream, a published stream beats the
 * standing FanCode/Willow channels, catalog channels come last, and anything that
 * cannot honestly play (expired token, no URL, needs-a-key, a quarantined stale
 * "LIVE" row) is never ranked. The page contract pins the board itself: one hero,
 * one pre-focused WATCH LIVE, the stage, the hot-swap timers, and the grid.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { heroNote, matchLabel, otherLiveEntries, pickHeroSource, rankPlayableSources } from '../lib/sportsLive.js';
import { channelReadiness } from '../lib/sportsFeedView.js';

const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');
const NOW = Date.parse('2026-03-08T10:00:00Z');

const fancodeMatch = (overrides = {}) => ({
  source: 'fancode',
  id: 'm1',
  state: 'live',
  home: 'India',
  away: 'Australia',
  homeCode: 'IND',
  awayCode: 'AUS',
  competition: 'T20 Series',
  statusLine: 'India need 40 off 30',
  scoreHome: '145/3 (14.0 ov)',
  scoreAway: '',
  venue: 'Chepauk',
  matchOrder: '1st T20I',
  poster: 'https://img/poster.jpg',
  ...overrides,
});

const freshVariant = (overrides = {}) => ({
  id: 'fan-0',
  label: 'English',
  url: 'https://fresh.example/live.m3u8',
  expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
  cookie: 'Bearer=abc',
  ...overrides,
});

const channel = (overrides = {}) => ({
  id: 'ch',
  name: 'Sports Channel',
  url: 'https://cdn/ch.m3u8',
  source: 'catalog',
  format: 'hls',
  priority: 5,
  ...overrides,
});

describe('sportsLive resolver', () => {
  test('the hero is a live match feed; standing channels rank below every match entry', () => {
    const entries = rankPlayableSources({
      items: [fancodeMatch({ variants: [freshVariant()] })],
      channels: [channel({ id: 'env-fancode', name: 'FanCode 1', priority: -20 }), channel()],
      now: NOW,
    });
    assert.equal(entries[0].kind, 'variant');
    assert.equal(entries[0].label, 'IND v AUS · English');
    assert.equal(entries[0].badge, 'FanCode');
    assert.equal(entries[0].match.label, 'IND v AUS');
    assert.equal(entries[0].extra.cookie, 'Bearer=abc');
    assert.equal(entries[1].kind, 'channel', 'env channel comes after the match');
    assert.deepEqual(entries.slice(1).map((entry) => entry.label), ['FanCode 1', 'Sports Channel'], 'channels keep their priority order');
  });

  test('an expired token is never offered: the variant is skipped, not played', () => {
    const entries = rankPlayableSources({
      items: [fancodeMatch({ variants: [freshVariant({ expiresAt: new Date(NOW - 1000).toISOString() })] })],
      channels: [],
      now: NOW,
    });
    assert.equal(entries.length, 0, 'no entry at all — the card must say the dump is stale, not play a dead link');
  });

  test('when the variants are gone the published stream is the fallback, and unavailable variants are skipped', () => {
    const entries = rankPlayableSources({
      items: [
        fancodeMatch({
          id: 'm2',
          variants: [freshVariant({ unavailable: true })],
          stream: 'https://origin.example/master.m3u8',
        }),
      ],
      channels: [],
      now: NOW,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'stream');
    assert.equal(entries[0].url, 'https://origin.example/master.m3u8');
  });

  test('multiple audio feeds keep their order and each is its own entry', () => {
    const entries = rankPlayableSources({
      items: [fancodeMatch({ variants: [freshVariant(), freshVariant({ id: 'fan-1', label: 'தமிழ்', url: 'https://fresh.example/ta.m3u8' })] })],
      channels: [],
      now: NOW,
    });
    assert.deepEqual(entries.map((entry) => entry.variantId), ['fan-0', 'fan-1']);
    assert.match(entries[1].label, /தமிழ்/);
  });

  test('channels that need a key — any key — have no URL, or whose key expired are never ranked', () => {
    const entries = rankPlayableSources({
      items: [],
      channels: [
        channel({ id: 'no-url', url: undefined }),
        channel({ id: 'needs-key', keyId: 'AA' }),
        channel({ id: 'full-pair', keyId: 'AA', key: 'BB' }),
        channel({ id: 'expired', keyExpiresAt: new Date(NOW - 1000).toISOString() }),
        channel({ id: 'ok', priority: 1 }),
        channel({ id: 'proxy', referer: 'https://tv/', priority: 0 }),
      ],
      now: NOW,
    });
    const states = entries.map((entry) => entry.readiness.state);
    assert.deepEqual(states, ['proxy', 'ready'], 'key/needs-key/expired/unset never rank — keys are /live\u2019s business, not the sports board\u2019s');
  });

  test('a quarantined stale-dump LIVE row is not live and never reaches the board', () => {
    const entries = rankPlayableSources({
      items: [fancodeMatch({ staleFeed: true, variants: [freshVariant()] })],
      channels: [channel()],
      now: NOW,
    });
    assert.deepEqual(entries.map((entry) => entry.kind), ['channel'], 'the channel survives, the fake LIVE does not');
  });

  test('pickHeroSource, otherLiveEntries, matchLabel, heroNote: one pick, the rest for the grid, honest words', () => {
    const entries = rankPlayableSources({
      items: [fancodeMatch({ variants: [freshVariant()] }), fancodeMatch({ id: 'm2', homeCode: 'SA', awayCode: 'ENG', variants: [freshVariant({ id: 'fan-0' })] })],
      channels: [channel()],
      now: NOW,
    });
    const hero = pickHeroSource(entries);
    assert.equal(hero.match.source, 'fancode');
    assert.equal(hero.match.id, 'm1');
    const rest = otherLiveEntries(entries, hero);
    assert.deepEqual(rest.map((entry) => entry.label), ['SA v ENG · English', 'Sports Channel']);
    assert.equal(matchLabel({ home: 'India', away: 'Australia' }), 'India v Australia');
    assert.equal(matchLabel({ homeCode: 'IND', awayCode: 'AUS', competition: 'T20 Series' }), 'IND v AUS');
    assert.match(heroNote(hero, NOW), /token good for ~30 min/);
    assert.match(heroNote(rest[1]), /Sports Channel · /);
    assert.equal(heroNote(null), 'nothing can play on any feed right now');
    const waiting = rankPlayableSources({ items: [], channels: [], now: NOW });
    assert.equal(pickHeroSource(waiting), null);
  });
});

describe('On Air Grid board contract', () => {
  const feed = read('components/sports/SportsFeed.js');

  test('the hero exists exactly once, is fed by the resolver, and its WATCH button takes focus on load', () => {
    assert.equal((feed.match(/jv-sg-hero\b/g) || []).length >= 2, true, 'hero CSS hooks present');
    assert.match(feed, /import \{ heroNote, otherLiveEntries, pickHeroSource, rankPlayableSources \} from '@\/lib\/sportsLive';/);
    assert.match(feed, /autoFocus=\{heroIsMatch\}/, 'the hero button owns focus the moment the page loads — one D-pad press on a TV');
    assert.match(feed, /▶ WATCH LIVE/);
    assert.match(feed, /aria-label=\{`Watch live: \$\{hero\.label\}`\}/);
  });

  test('watching is the stage: one JashPlayer mount outside the hub, the Video tab keeps its own', () => {
    assert.equal((feed.match(/<JashPlayer/g) || []).length, 2, 'stage + hub Video tab — the channels box lost its inline player');
    assert.match(feed, /jv-sg-stage/);
    assert.match(feed, /setPlaying\(null\)/, 'stop returns to the board');
    assert.match(feed, /createLiveTvPolicy\(streamChannel\(/);
  });

  test('the token hot-swap is scheduled, not polled: two reads as expiry nears, then a quiet URL swap', () => {
    assert.match(feed, /5 \* 60_000/, 'first refresh five minutes before the token dies');
    assert.match(feed, /45_000/, 'second refresh 45 seconds before');
    assert.match(feed, /token refreshed · back on the live edge/);
    assert.match(feed, /swapTimersRef/, 'the timers are cleared on unmount and on every swap');
  });

  test('the grid sections are content-gated, channels are not on the board, and the card is honest', () => {
    for (const label of ['Also live', 'Today', 'Finished']) {
      assert.ok(feed.includes(label), `grid section "${label}" exists`);
    }
    assert.ok(!feed.includes('jv-sg-chans'), 'the channels section is gone from the sports board entirely');
    assert.ok(!/channelReadiness|channelLine|channelCounts/.test(feed), 'no key vocabulary anywhere on the sports page');
    assert.ok(!feed.includes('CHANNELS_URL'), 'the board no longer even asks the channels route');
    assert.match(feed, /disabled=\{!entry\}/, 'a card with nothing to play shows a disabled button, not a broken promise');
  });

  test('the sources walls are gone: healthy feeds are named, asleep ones are one quiet line', () => {
    assert.ok(!/className=\{source\.ok \? 'ok' : 'no'\}/.test(feed), 'no red per-source failure list');
    assert.match(feed, /score feed.*asleep/, 'sleeping feeds collapse to one muted sentence');
    assert.match(feed, /on air via/, 'healthy playlists are named in the footer');
    assert.match(feed, /the live playlists carry the board/, 'the sheet says what is carrying the board');
  });

  test('playback is a chain: direct, then the proxy, then the next feed, then the truth', () => {
    assert.match(feed, /onFatal: onStageFatal/, 'a dead attempt moves the stage down the chain');
    assert.match(feed, /onStatus: onStageStatus/, 'the stage shows connecting\/buffering instead of a black frame');
    assert.match(feed, /switching to/, 'the switch is announced');
    assert.match(feed, /This stream did not open/, 'exhausted chains get the honest card, with a Try again');
    assert.match(feed, /chainByMatch/, 'grid cards get the same fallback depth as the hero');
    assert.match(feed, /retries through this server/, 'the proxy step is printed, not hidden');
  });

  test('the empty-hero state is the next fixture with a countdown — never a fake play button', () => {
    assert.match(feed, /Nothing is on air yet · next fixture/);
    assert.match(feed, /countdownLine\(nextUp, now\)/);
  });

  test('the truth rules survive the rebuild: no invented scores, no storage reads, no frames', () => {
    for (const banned of ['iframe', 'localStorage', 'dangerouslySetInnerHTML', '/match-center', '/sports/player']) {
      const code = feed.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!code.includes(banned), `the board must not use ${banned}`);
    }
    assert.match(feed, /seededHub\.current = key;/, 'deep links still fetch their own hub');
  });
});

describe('On Air Grid styles', () => {
  const css = read('app/globals.css');

  test('the jv-sg block lives inside the sports slice and obeys its contract', () => {
    const block = css.slice(css.indexOf('.jv-sp-page {'));
    assert.ok(block.includes('.jv-sg-hero {'), 'the grid styles are part of the sports block');
    const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
    const sg = code.slice(code.indexOf('.jv-sg-'));
    assert.ok(!sg.includes('!important'), 'no !important in jv-sg either');
    const sizes = [...sg.matchAll(/font-size: ([\d.]+)px/g)].map(([, value]) => Number(value));
    assert.ok(sizes.length > 10, 'the grid sets real type sizes');
    assert.ok(Math.min(...sizes) >= 11, `smallest grid type is ${Math.min(...sizes)}px`);
    assert.match(css, /\.jv-sg-watch:focus-visible \{ outline: 3px solid var\(--sp-amber\)/, 'the amber D-pad ring on the one button that matters');
    assert.match(css, /\.jv-sg-play:focus-visible \{ outline: 3px solid var\(--sp-amber\)/, 'and on every grid play button');
    assert.match(css, /@media \(min-width: 1600px\)/, '10-foot sizes scale up on big screens');
  });

  test('readiness labels keep their meaning on the grid cards', () => {
    assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', keyId: 'AA', key: 'BB' }, NOW).state, 'key');
  });
});
