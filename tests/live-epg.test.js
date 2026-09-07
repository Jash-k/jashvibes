/**
 * Pocket-EPG layer tests.
 *
 * The feed's whole schedule is generated data, so these fixtures are hand-written XMLTV with the
 * awkward cases the real file contains: `+0530` stamps, a programme with no `<stop>`, entities, an
 * unclosed tail, and channel names that differ only by quality suffix. Everything that reads the
 * clock takes an injected `at`, so "now" is a value under test rather than a wait.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

import {
  __test,
  channelKey,
  clearGuideCache,
  dayBounds,
  getGuide,
  lineupFingerprint,
  lookupEpgChannels,
  parseXmltv,
  parseXmltvTime,
  resolveLinks,
  slugName,
  windowFor,
} from '@/lib/liveEpg';

// The index is a process-wide cache on purpose (it must survive Next's module reloads), so each
// test starts from an empty one instead of inheriting a sibling's — that shared state is exactly how
// a "refreshes once" assertion turns into a false pass.
beforeEach(() => clearGuideCache());

/** 2026-09-06 20:00 IST, the "now" almost every case below uses. */
const AT = parseXmltvTime('20260906200000 +0530');

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="jiotv-epg">
  <channel id="144">
    <display-name>Colors HD</display-name>
    <icon src="https://cdn.example/ColorsHD.png" />
  </channel>
  <channel id="143">
    <display-name>CNBC TV18 Prime</display-name>
  </channel>
  <channel id="900">
    <display-name>Sun News HD</display-name>
  </channel>
  <channel id="901">
    <display-name>Sun Life</display-name>
  </channel>
  <programme start="20260906193000 +0530" stop="20260906203000 +0530" channel="144">
    <title>Bigg Boss &amp; the house</title>
    <desc>Nominations round.</desc>
    <category>Reality</category>
    <icon src="https://cdn.example/ep1.jpg" />
  </programme>
  <programme start="20260906203000 +0530" stop="20260906220000 +0530" channel="144">
    <title>Tamil News @ 8:30</title>
  </programme>
  <programme start="20260906220000 +0530" channel="144">
    <title>Movie: Ponniyin Selvan</title>
  </programme>
  <programme start="20260905213000 +0530" stop="20260905223000 +0530" channel="144">
    <title>Yesterday show</title>
  </programme>
  <programme start="20260906180000 +0530" stop="20260906190000 +0530" channel="900">
    <title>Evening Bulletin</title>
  </programme>
  <programme start="20260906200000 +0530" stop="20260906203000 +0530" channel="901">
    <title>Life Show</title>
  </programme>
</tv>`;

function fixture() {
  return Buffer.from(XML, 'utf8');
}

test('parseXmltvTime honours the feed offset and survives the sloppy variants', () => {
  assert.equal(parseXmltvTime('20260906200000 +0530'), Date.UTC(2026, 8, 6, 14, 30));
  assert.equal(parseXmltvTime('20260906200000 -0500'), Date.UTC(2026, 8, 7, 1, 0));
  assert.equal(parseXmltvTime('20260906200000Z'), Date.UTC(2026, 8, 6, 20, 0));
  // No offset at all is how some mirrors publish: treat it as the feed's own zone, not UTC.
  assert.equal(parseXmltvTime('20260906200000'), Date.UTC(2026, 8, 6, 14, 30), 'offset-less = feed zone');
  assert.equal(parseXmltvTime('20260906200000', { fallbackOffsetMinutes: 0 }), Date.UTC(2026, 8, 6, 20, 0));
  assert.equal(parseXmltvTime(''), null);
  assert.equal(parseXmltvTime('tomorrow evening'), null);
  assert.equal(parseXmltvTime('20261345000000 +0530'), Date.UTC(2026, 12, 45, 0, 0) - 330 * 60_000);
});

test('dayBounds is the IST day, including one minute before midnight', () => {
  const { start, end } = dayBounds(parseXmltvTime('20260906235900 +0530'));
  assert.equal(start, parseXmltvTime('20260906000000 +0530'));
  assert.equal(end - start, 86_400_000);
  // 00:00 IST belongs to the next day, which is why the index is keyed by day.
  const next = dayBounds(parseXmltvTime('20260907000000 +0530'));
  assert.equal(next.start, end);
});

test('channelKey ignores case, punctuation and quality noise', () => {
  assert.equal(slugName('STAR Vijay & TV (HD)'), 'star vijay and tv hd');
  assert.equal(channelKey('Colors HD 1080p'), 'colors');
  assert.equal(channelKey('Sony Ten 1 HD'), 'sony ten 1');
  assert.notEqual(channelKey('Sun News HD'), channelKey('Sun Life'));
});

test('resolveLinks: explicit binding first, then name, then a unique prefix', () => {
  const parsed = parseXmltv(fixture(), { at: AT });
  const ids = new Map([...parsed.channels, ['777', { id: '777', name: 'Bigg Boss Tamil' }]]);
  // tvgId wins even when the name would also match.
  const byId = resolveLinks([{ id: 'a', name: 'Totally Different', tvgId: '144' }], ids);
  assert.equal(byId.get('a').epgId, '144');
  assert.equal(byId.get('a').via, 'tvgId');
  // Exact normalised name match survives the "HD" suffix.
  const byName = resolveLinks([{ id: 'b', name: 'Colors' }], ids);
  assert.equal(byName.get('b').epgId, '144');
  assert.equal(byName.get('b').via, 'name');
  // Two mirrors of one channel share one guide instead of competing for it.
  const mirrors = resolveLinks([{ id: 'c', name: 'Colors HD' }, { id: 'd', name: 'Colors HD' }], ids);
  assert.equal(mirrors.get('c').epgId, mirrors.get('d').epgId);
  // A short lineup name must not prefix-swallow a different channel.
  const short = resolveLinks([{ id: 'e', name: 'Sun' }], ids);
  assert.equal(short.has('e'), false);
  // A shorter lineup name that no channel matches exactly falls back to a unique prefix.
  const prefix = resolveLinks([{ id: 'g', name: 'Bigg Boss' }], ids);
  assert.equal(prefix.get('g').epgId, '777');
  assert.equal(prefix.get('g').via, 'prefix');
  // Quality noise is stripped first, so "Sun News" *is* "Sun News HD" — an exact link, not a
  // guess. The prefix rule only fires when the lineup name is genuinely shorter.
  const exact = resolveLinks([{ id: 'f', name: 'Sun News' }], ids);
  assert.equal(exact.get('f').epgId, '900');
  assert.equal(exact.get('f').via, 'name');
});

test('parseXmltv keeps the whole day for every channel, in a lean shape', () => {
  const parsed = parseXmltv(fixture(), { at: AT });
  const list = parsed.programmes.get('144');
  assert.equal(list.length, 3, 'yesterday is dropped, today is kept');
  assert.equal(list[0].title, 'Bigg Boss & the house', 'entities are decoded');
  assert.deepEqual(list.map((show) => show.from), [...list.map((show) => show.from)].sort((a, b) => a - b), 'sorted by start');
  // A programme with no <stop> gets one slot rather than an infinite block.
  const movie = list[2];
  assert.equal(movie.title, 'Movie: Ponniyin Selvan');
  assert.equal(movie.to - movie.from, 30 * 60_000);
  // Channels nobody linked are still indexed, so searching or filtering the lineup never re-parses
  // a 65 MB feed — resolution is per request, the index is per day.
  assert.ok(parsed.programmes.has('900'), 'every feed channel is available');
  assert.equal(parsed.programmes.has('143'), false, 'a channel with no programme today has no list');
  assert.equal(parsed.channels.size, 4, 'the feed channel list is kept whole, for lookups');
  // Only the programme that is airing right now carries a synopsis; the rest are cheap.
  assert.equal(list[0].desc, 'Nominations round.');
  assert.equal(list[1].desc, '');
  assert.equal(list.every((show) => !('icon' in show) && !('rawFrom' in show)), true, 'no per-block image or duplicate start field');
  // A pathological channel (or a feed that publishes minutes) is capped, not unbounded.
  const capped = parseXmltv(Buffer.from(`<tv>${'<programme start="20260906200000 +0530" stop="20260906200030 +0530" channel="144"><title>x</title></programme>'.repeat(200)}</tv>`), { at: AT, maxPerChannel: 48 });
  assert.equal(capped.programmes.get('144').length, 48);
});

test('parseXmltv accepts gzip and survives a truncated tail', () => {
  const gz = zlib.gzipSync(fixture());
  const ok = parseXmltv(gz, { at: AT });
  assert.equal(ok.programmes.get('144').length, 3);
  assert.equal(__test.isGzip(gz), true);
  const cut = Buffer.from(`${XML.slice(0, XML.indexOf('<programme start="20260906203000'))}<programme start="20260906220000 +0530" channel="144"><title>Unfinished`);
  const parsed = parseXmltv(cut, { at: AT });
  assert.equal(parsed.truncatedTail, true);
  assert.ok(parsed.programmes.get('144').length >= 1, 'what was parsed before the cut is still usable');
});

test('windowFor answers now / next / later and marks the day blocks', () => {
  const parsed = parseXmltv(fixture(), { at: AT });
  const win = windowFor(parsed.programmes.get('144'), { at: AT, graceMs: 15 * 60_000 });
  assert.equal(win.now.title, 'Bigg Boss & the house');
  assert.equal(win.nowMinutesLeft, 30);
  assert.equal(win.next.title, 'Tamil News @ 8:30');
  assert.equal(win.minutesToNext, 30);
  assert.deepEqual(win.later.map((show) => show.title), ['Movie: Ponniyin Selvan']);
  assert.equal(win.progress, 0.5, '19:30-20:30 at 20:00 is half over');
  assert.deepEqual(win.day.map((show) => show.state), ['now', 'later', 'later']);
  assert.equal(win.count, 3);

  // "just ended" is measured from the show's own end, so the strip survives a published gap.
  const base = parseXmltvTime('20260906200000 +0530');
  const one = [{ from: base - 60 * 60_000, to: base, rawFrom: base - 60 * 60_000, title: 'Just Over' }];
  assert.equal(windowFor(one, { at: base + 30_000, graceMs: 60_000 }).lastEnded.title, 'Just Over');
  assert.equal(windowFor(one, { at: base + 90_000, graceMs: 60_000 }).lastEnded, null);
  const blank = windowFor(parsed.programmes.get('144'), { at: parseXmltvTime('20260907070000 +0530'), graceMs: 15 * 60_000 });
  assert.equal(blank.now, null);
  assert.equal(blank.next, null);
  assert.equal(blank.progress, 0);
});

test('the index is keyed by day + lineup, so a new channel re-parses instead of showing holes', () => {
  const one = lineupFingerprint([{ id: 'a', name: 'Colors HD' }]);
  const same = lineupFingerprint([{ id: 'a', name: 'Colors HD 1080p' }]);
  const two = lineupFingerprint([{ id: 'a', name: 'Colors HD' }, { id: 'b', name: 'Sun TV' }]);
  assert.equal(one, same, 'quality noise must not count as a lineup change');
  assert.notEqual(one, two);
});

test('getGuide refreshes once for concurrent callers, and serves stale instead of failing', async () => {
  const previous = process.env.LIVE_EPG_TTL_MS;
  process.env.LIVE_EPG_TTL_MS = '60000';
  try {
    let calls = 0;
    const slow = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return fixture();
    };
    const lineup = [{ id: 'colors', name: 'Colors HD', tvgId: '144' }];
    const [a, b] = await Promise.all([getGuide({ channels: lineup, at: AT, fetchImpl: slow }), getGuide({ channels: lineup, at: AT, fetchImpl: slow })]);
    assert.equal(calls, 1, 'one refresh shared by both requests');
    assert.equal(a.channels[0].now.title, 'Bigg Boss & the house');
    assert.equal(a.linked, 1);
    assert.equal(b.channels[0].matched, true);

    // Feed down: the cached guide still answers (and the request does not wait for the retry),
    // while the failure is recorded for the service panel to show.
    const boom = async () => {
      throw new Error('EPG feed responded 503');
    };
    const nowMs = Date.now();
    const realNow = Date.now;
    const loadedAtBefore = (await import('@/lib/liveEpg')).epgStatus().loadedAt;
    Date.now = () => nowMs + 5 * 60_000; // past the 60 s TTL
    let stale;
    try {
      stale = await getGuide({ channels: lineup, at: AT, fetchImpl: boom });
    } finally {
      Date.now = realNow;
    }
    assert.equal(stale.ok, true, 'a dead feed must not blank the guide');
    assert.equal(stale.channels[0].now.title, 'Bigg Boss & the house');
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the background retry settle
    const status = (await import('@/lib/liveEpg')).epgStatus();
    assert.match(status.error, /503/);
    assert.equal(status.loadedAt, loadedAtBefore, 'the failed refresh must not reset the index age');
  } finally {
    if (previous == null) delete process.env.LIVE_EPG_TTL_MS;
    else process.env.LIVE_EPG_TTL_MS = previous;
  }
});

test('a different lineup reuses the same index — searching the guide must not re-download the feed', async () => {
  const previous = process.env.LIVE_EPG_TTL_MS;
  process.env.LIVE_EPG_TTL_MS = '600000';
  try {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return fixture();
    };
    const first = await getGuide({ channels: [{ id: 'a', name: 'Colors HD' }], at: AT, fetchImpl });
    assert.equal(first.linked, 1);
    const second = await getGuide({ channels: [{ id: 'b', name: 'Sun News' }, { id: 'a', name: 'Colors HD' }], at: AT, fetchImpl });
    assert.equal(calls, 1, 'the second lineup is resolved from the cached day index');
    assert.equal(second.linked, 2);
    // 144, 900 and 901 all have programmes that day: the index covers the feed, not the lineup.
  assert.equal(second.status.indexedChannels, 3, 'the index itself is lineup-independent');
  } finally {
    if (previous == null) delete process.env.LIVE_EPG_TTL_MS;
    else process.env.LIVE_EPG_TTL_MS = previous;
  }
});

test('lookupEpgChannels ranks for the manual-binding picker', async () => {
  await getGuide({ channels: [], at: AT, fetchImpl: async () => fixture() });
  const exact = await lookupEpgChannels('Colors HD', { fetchImpl: async () => fixture() });
  assert.equal(exact.results[0].id, '144');
  const partial = await lookupEpgChannels('sun', { fetchImpl: async () => fixture() });
  assert.deepEqual(partial.results.map((row) => row.id).sort(), ['900', '901']);
  const nothing = await lookupEpgChannels('nonexistent channel', { fetchImpl: async () => fixture() });
  assert.equal(nothing.results.length, 0);
});
