/*
 * tests/sports-m3u.test.js — the live playlist family (round 23).
 *
 * The FanCode JSON dump died on 2026-09-03; the same publisher's `.m3u` playlists kept
 * refreshing every ~15 minutes and grew into a family (FanCode / SonyLiv / ICC). This file
 * pins the parser against each dialect, the normaliser against the ONE board shape, and
 * the resolver against the streams those playlists produce. The fixtures are the real
 * playlists, reduced: pipe-suffix headers, KODIPROP ClearKeys, both `#DATE:` dialects.
 */

import path from 'node:path';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { M3U_FANCODE, M3U_SONYLIV, M3U_ICC, parseM3u, parseM3uDate } from '../lib/sportsM3u.js';
import { normalizeM3uEntry, loadM3uSource, STALE_DUMP_MS } from '../lib/sportsFeed.js';
import { rankPlayableSources, pickHeroSource } from '../lib/sportsLive.js';

const NOW = Date.parse('2026-09-17T15:30:00Z');

const FAN_CODE = `#EXTM3U
# Written and Directed by someone who asks for credit
#DATE:- Thursday, 17 September 2026 at 8:42:10 pm
#EXTINF:-1 tvg-id="4248492" tvg-name="India Vs Afghanistan" tvg-language="English" group-title="Cricket",ENG | India Vs Afghanistan
https://dai-fancode.pages.dev/out/v1/4248492_english/ad-h264/index.m3u8|User-Agent=ReactNativeVideo/9.11.1 (Linux;Android 13) AndroidXMedia3/1.6.1&Referer=https://fancode.com/
#EXTINF:-1 tvg-id="4248492" tvg-name="India Vs Afghanistan" tvg-language="Hindi" group-title="Cricket",HIN | India Vs Afghanistan
https://dai-fancode.pages.dev/out/v1/4248492_hindi/ad-h264/index.m3u8|User-Agent=ReactNativeVideo/9.11.1&Referer=https://fancode.com/`;

const SONY_CODE = `#EXTM3U
#DATE:- 17-09-2026 21:00
#EXTINF:-1 tvg-id="1090542526" tvg-name="DP World Tour" tvg-language="English" group-title="Golf",ENG | BMW PGA Championship - Day 1
https://sonymtmnew-akamaized.pages.dev/hls/live/2005444/Golf_BMW1709/ENG/master.m3u8|User-Agent=Mozilla/5.0 Firefox/155.0&Referer=https://www.sonyliv.com/&Origin=https://www.sonyliv.com&x-playback-session-id=888155-1789659003184`;

const ICC_CODE = `#EXTM3U
#DATE:- 06-09-2026 16:45
#EXTINF:-1 tvg-id="6ac27684-74f9-4b4f-80da-291bec7b471c" tvg-lang="English" group-title="Cricket",English | Zimbabwe v South Africa
#KODIPROP:inputstream.adaptive.manifest_type=mpd
#KODIPROP:inputstream.adaptive.license_type=com.clearkey.alpha
#KODIPROP:inputstream.adaptive.license_key={"keys":[{"kty":"oct","k":"mGn4BLoY1-UIy_94GCkiHA","kid":"Ob0wLN7tNxCon7AE0jKrZw"}],"type":"temporary"}
#EXTVLCOPT:http-user-agent=Mozilla/5.0 (Windows NT 10.0) Firefox/155.0
#EXTVLCOPT:http-referrer=https://www.icc-cricket.com/
#EXTHTTP:{"origin":"https://www.icc-cricket.com"}
https://live-d-01-icc-we.akamaized.net/variant/manifest.mpd?vcfilter=6ac27684`;

const freshFanDate = (ms = NOW) => {
  const d = new Date(ms + 5.5 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `#DATE:- ${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

describe('parseM3u: the playlist dialects', () => {
  test('FanCode dialect: long #DATE, pipe-suffix UA/Referer, per-language entries', () => {
    const parsed = parseM3u(FAN_CODE, { now: NOW });
    assert.equal(parsed.entries.length, 2);
    assert.equal(parsed.dumpMs, Date.parse('2026-09-17T15:12:10Z'), 'the 8:42:10 pm IST line reads as 15:12:10 UTC — 18 minutes before NOW, well inside STALE_DUMP_MS');
    const [eng, hin] = parsed.entries;
    assert.equal(eng.id, '4248492');
    assert.equal(eng.name, 'India Vs Afghanistan');
    assert.equal(eng.langCode, 'ENG');
    assert.equal(eng.group, 'Cricket');
    assert.ok(eng.url.startsWith('https://dai-fancode.pages.dev/'), 'the URL is clean of the pipe suffix');
    assert.match(eng.userAgent, /AndroidXMedia3/);
    assert.equal(eng.referer, 'https://fancode.com/');
    assert.equal(hin.langCode, 'HIN');
  });

  test('SonyLiv dialect: short #DATE, Origin and session-id ride along as extra headers', () => {
    const parsed = parseM3u(SONY_CODE, { now: NOW });
    assert.equal(parsed.entries.length, 1);
    const entry = parsed.entries[0];
    assert.equal(entry.id, '1090542526');
    assert.equal(entry.name, 'BMW PGA Championship - Day 1', 'the display title wins over the tvg-name');
    assert.equal(entry.group, 'Golf');
    assert.equal(entry.origin, 'https://www.sonyliv.com');
    assert.equal(entry.extraHeaders['x-playback-session-id'], '888155-1789659003184');
  });

  test('ICC dialect: KODIPROP ClearKey pair, manifest type, EXTVLCOPT and EXTHTTP headers', () => {
    const parsed = parseM3u(ICC_CODE, { now: NOW });
    const entry = parsed.entries[0];
    assert.equal(entry.format, 'dash', 'manifest_type=mpd is a DASH stream');
    assert.equal(entry.clearKeyId, 'Ob0wLN7tNxCon7AE0jKrZw');
    assert.equal(entry.clearKey, 'mGn4BLoY1-UIy_94GCkiHA');
    assert.match(entry.userAgent, /Firefox/);
    assert.equal(entry.referer, 'https://www.icc-cricket.com/');
    assert.equal(entry.origin, 'https://www.icc-cricket.com');
  });

  test('a playlist with no date line parses anyway (undated is not a verdict, staleness is decided later)', () => {
    const parsed = parseM3u(FAN_CODE.replace(/^#DATE:.*$/m, ''), { now: NOW });
    assert.equal(parsed.dumpMs, 0);
    assert.equal(parsed.entries.length, 2);
  });

  test('parseM3uDate reads both dialects as IST, and garbage as 0', () => {
    assert.equal(parseM3uDate('#DATE:- 17-09-2026 21:00'), Date.UTC(2026, 8, 17, 15, 30));
    assert.equal(parseM3uDate('Thursday, 17 September 2026 at 8:42:10 pm'), Date.UTC(2026, 8, 17, 15, 12, 10));
    assert.equal(parseM3uDate('not a date'), 0);
    assert.equal(parseM3uDate(''), 0);
  });
});

describe('normalizeM3uEntry: playlist rows become the ONE board shape', () => {
  const parsed = parseM3u(FAN_CODE.replace('#DATE:- Thursday, 17 September 2026 at 8:42:10 pm', freshFanDate()), { now: NOW });

  test('a fresh entry is a live card with one playable variant carrying its headers', () => {
    const item = normalizeM3uEntry(parsed.entries[0], { kind: 'fancode', now: NOW, dumpAt: parsed.dumpAt, stale: false });
    assert.equal(item.source, 'fancode');
    assert.equal(item.state, 'live', 'a playlist entry is on air by definition; staleness is the loader\'s verdict');
    assert.equal(item.home, 'India');
    assert.equal(item.away, 'Afghanistan');
    assert.equal(item.homeCode, 'IND', 'full country names get their codes');
    assert.equal(item.awayCode, 'AFG');
    const variant = item.variants[0];
    assert.equal(variant.url, parsed.entries[0].url);
    assert.equal(variant.userAgent, parsed.entries[0].userAgent);
    assert.equal(variant.referer, 'https://fancode.com/');
    assert.equal(item.stream, variant.url);
    assert.match(item.href, /\/sports\/hub\/fancode\/4248492$/, 'the card deep-links like any other');
    assert.equal(item.statusLine.includes('playlist published'), true);
  });

  test('a stale playlist has nothing honest left to say: its rows are dropped, not quarantined', () => {
    assert.equal(normalizeM3uEntry({ name: 'X v Y', url: 'https://x/1.m3u8' }, { stale: true, now: NOW }), null);
    assert.equal(normalizeM3uEntry({}, { now: NOW }), null, 'a nameless entry is not a card');
  });

  test('a single-name entry (golf, a channel) still makes a card, not a dropped row', () => {
    const sony = parseM3u(SONY_CODE, { now: NOW });
    const item = normalizeM3uEntry(sony.entries[0], { kind: 'sonyliv', now: NOW, dumpAt: sony.dumpAt });
    assert.equal(item.home, 'BMW PGA Championship - Day 1');
    assert.equal(item.away, '');
    assert.equal(item.source, 'sonyliv');
  });

  test('loadM3uSource drops a provably old playlist (ok:false, rows still described)', async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({}), text: async () => ICC_CODE };
    };
    const result = await loadM3uSource({ kind: 'icc', url: 'https://example/icc.m3u', fetchImpl, env: {}, now: NOW });
    assert.equal(result.ok, false);
    assert.match(result.note, /too old to show/);
    assert.ok(result.rows.length, 'the rows stay for the sources list to describe');
    assert.equal(calls.length, 1);
  });
});

describe('the resolver plays playlist streams: one press, no walk', () => {
  test('a fresh FanCode playlist entry is hero-grade: variant with headers outranks a bare channel', () => {
    const parsed = parseM3u(FAN_CODE.replace('#DATE:- Thursday, 17 September 2026 at 8:42:10 pm', freshFanDate()), { now: NOW });
    const item = normalizeM3uEntry(parsed.entries[0], { kind: 'fancode', now: NOW, dumpAt: parsed.dumpAt });
    const channel = { id: 'env-fancode', name: 'FanCode', url: 'https://cdn/fc.m3u8', source: 'fancode', priority: -20 };
    const ranked = rankPlayableSources({ items: [item], channels: [channel], now: NOW });
    assert.equal(ranked[0].kind, 'variant');
    assert.equal(ranked[0].url, parsed.entries[0].url);
    assert.equal(ranked[0].extra.userAgent, parsed.entries[0].userAgent);
    assert.deepEqual(ranked.map((entry) => entry.kind), ['variant', 'channel']);
    assert.ok(pickHeroSource(ranked).match);
  });

  test('an ICC ClearKey entry arrives at the player with its kid/key pair intact', () => {
    const parsed = parseM3u(ICC_CODE, { now: NOW });
    const item = normalizeM3uEntry(parsed.entries[0], { kind: 'icc', now: NOW, dumpAt: parsed.dumpAt });
    const ranked = rankPlayableSources({ items: [item], channels: [], now: NOW });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0].extra.keyId, 'Ob0wLN7tNxCon7AE0jKrZw');
    assert.equal(ranked[0].extra.key, 'mGn4BLoY1-UIy_94GCkiHA');
    assert.match(ranked[0].extra.licenseKey, /^Ob0wLN7tNxCon7AE0jKrZw:mGn4BLoY1-UIy_94GCkiHA$/, 'the pair the ClearKey ladder already understands');
  });
});

describe('the family is env-overridable and pinned', () => {
  test('the three default playlists are raw.githubusercontent URLs', () => {
    for (const url of [M3U_FANCODE, M3U_SONYLIV, M3U_ICC]) {
      assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/[\w.-]+\/[\w.-]+\//);
    }
  });
});
