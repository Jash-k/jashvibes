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

describe('Live Streams board contract (round 25)', () => {
  const feed = read('components/sports/SportsFeed.js');

  test('the wall is streams only: no scores, fixtures, results, hubs or channels anywhere', () => {
    for (const gone of ['jv-sg-hero', 'Also live', 'Finished', 'Today', 'jv-sg-chans', 'channelReadiness', 'channelLine', 'CHANNELS_URL', 'hubTabs', 'fetchHub', 'ReplaysBox', 'resolveVideo', 'nextUp', 'countdownLine']) {
      assert.ok(!feed.includes(gone), `the minimal board must not contain "${gone}"`);
    }
  });

  test('one stage, one player, the chain and its honesty survive the rewrite', () => {
    assert.equal((feed.match(/<JashPlayer/g) || []).length, 1, 'the stage is the only player');
    assert.match(feed, /import \{ rankPlayableSources \} from '@\/lib\/sportsLive';/);
    assert.match(feed, /onFatal: onStageFatal/, 'a dead attempt moves the stage down the chain');
    assert.match(feed, /onStatus: onStageStatus/, 'connecting/buffering is printed instead of a black frame');
    assert.match(feed, /switching to/, 'the switch is announced');
    assert.match(feed, /This stream did not open/, 'an exhausted chain gets the honest card with Try again');
    assert.match(feed, /createLiveTvPolicy\(streamChannel\(/);
  });

  test('the deep link is a remote control: /sports/hub/{source}/{id} opens that stream', () => {
    assert.match(feed, /autoOpened\.current = key;/);
    assert.match(feed, /initialOpen/);
  });

  test('the truth rules survive: no invented state, no storage, no frames, quiet sources', () => {
    for (const banned of ['iframe', 'localStorage', 'dangerouslySetInnerHTML', '/match-center', '/sports/player']) {
      const code = feed.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
      assert.ok(!code.includes(banned), `the board must not use ${banned}`);
    }
    assert.match(feed, /Nothing is on air right now/, 'an empty wall says so, plainly');
    assert.match(feed, /on air via/, 'healthy playlists are named in the footer');
    assert.match(feed, /asleep/, 'sleeping playlists are one quiet phrase, not a wall');
    assert.match(feed, /Only streams whose manifest answered/, 'the working-streams promise is printed');
  });
});

describe('On Air Grid styles', () => {
  const css = read('app/globals.css');

  test('the jv-sg/jv-sc block lives inside the sports slice and obeys its contract', () => {
    const block = css.slice(css.indexOf('.jv-sp-page {'));
    assert.ok(block.includes('.jv-sc-card {'), 'the wall styles are part of the sports block');
    const code = block.replace(/\/\*[\s\S]*?\*\//g, '');
    const sg = code.slice(code.indexOf('.jv-sg-'));
    assert.ok(!sg.includes('!important'), 'no !important in jv-sg/jv-sc either');
    const sizes = [...sg.matchAll(/font-size: ([\d.]+)px/g)].map(([, value]) => Number(value));
    assert.ok(sizes.length > 10, 'the wall sets real type sizes');
    assert.ok(Math.min(...sizes) >= 11, `smallest wall type is ${Math.min(...sizes)}px`);
    assert.match(css, /\.jv-sc-play:focus-visible \{ outline: 3px solid var\(--sp-amber\)/, 'the amber D-pad ring on the play button that matters');
    assert.match(css, /\.jv-sg-watch:focus-visible \{ outline: 3px solid var\(--sp-amber\)/, 'and on the stage retry button');
    assert.match(css, /\.jv-sg-feedchip:focus-visible \{ outline: 3px solid var\(--sp-amber\)/, 'and on the language/zap chips');
    assert.match(css, /\.jv-sc-play \{[^}]*min-height: 44px/, 'touch targets stay at 44 px or more');
    assert.match(css, /@media \(min-width: 1600px\)/, '10-foot sizes scale up on big screens');
    assert.match(css, /@media \(max-width: 860px\)/, 'and tighten on phones');
  });

  test('readiness labels keep their meaning on the grid cards', () => {
    assert.equal(channelReadiness({ id: 'a', url: 'https://cdn/x.m3u8', keyId: 'AA', key: 'BB' }, NOW).state, 'key');
  });
});
