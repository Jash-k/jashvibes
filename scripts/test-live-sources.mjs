#!/usr/bin/env node
/**
 * test-live-sources.mjs — the Live TV source contracts, without a database.
 *
 *   node --import ./scripts/alias-register.mjs scripts/test-live-sources.mjs
 *
 * The Sony/Stream4Liv feed was wired in and every channel in it parsed to
 * nothing — not because the feed was wrong, but because it names its stream
 * field `stream_url` and the parser only knew `url` / `streamUrl`. That class
 * of bug is invisible from the UI: the source syncs "successfully" and reports
 * zero channels. So this test pins the whole chain from feed shape to catalog
 * membership using the app's own parser, against a payload with the real
 * field names, served over a loopback HTTP server.
 *
 * It also pins the two things that keep a source honest over time: a host we
 * know is gone must be tombstoned (so a database seeded by an older release
 * self-heals instead of failing forever), and a source that nominates a
 * catalog must never be able to overwrite a manual mapping.
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getDefaultLiveSources,
  isDeadSourceUrl,
  parseLiveSourceChannels,
  probeLiveSourceUrl,
} from '@/lib/liveTv';
import { autoMapInsertDefaults } from '@/lib/liveService';
import { isLiveCatalogId } from '@/lib/liveCatalogs';

/* ------------------------------------------------------------------ harness */

let passed = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${label}`);
  } catch (error) {
    failures.push(label);
    console.log(`  FAIL  ${label}\n        ${error.message.split('\n')[0]}`);
  }
}

/** A payload with the exact field names the Sony/Stream4Liv feeds use. */
const SONY_SHAPED = [
  {
    id: 'set-sd',
    name: 'SET SD',
    stream_url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Sony_SD_MOB/WDVLive/index.mpd',
    cookie: '__hdnea__=st=1792728005~exp=1792749605~acl=/*~hmac=d83a5d46d409842924f89d481d61e8c',
    key_id: '041a2752e99f5c6c8d4835fe221e16de',
    key: '73bc7d13c8beb7aa7f798e717544e005',
    logo: 'https://jiotvimages.cdn.jio.com/dare_images/images/Sony_HD.png',
  },
  {
    id: 'sony-sports-1-hd',
    name: 'Sony Sports 1 HD',
    stream_url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Ten_HD_MOB/WDVLive/index.mpd',
    cookie: '__hdnea__=st=1792728005~exp=1792749605~acl=/*~hmac=d83a5d46d409842924f89d481d61e8c',
    key_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    key: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Sony_HD.png',
  },
  {
    // The maintained file calls this "Sony Sports 4 Tamil"; Stream4Liv's tab
    // calls the same stream "Sony Ten 4 Tamil". Both spellings must be caught.
    id: 'sony-sports-4-tamil',
    name: 'Sony Sports 4 Tamil',
    stream_url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Ten_4_Tamil_MOB/WDVLive/index.mpd',
    cookie: '__hdnea__=st=1792728005~exp=1792749605~acl=/*~hmac=d83a5d46d409842924f89d481d61e8c',
    key_id: 'cccccccccccccccccccccccccccccccc',
    key: 'dddddddddddddddddddddddddddddddd',
    logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Sony_HD.png',
  },
  {
    id: 'sony-ten-2',
    name: 'Sony Ten 2',
    stream_url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/Ten_2_MOB/WDVLive/index.mpd',
    cookie: '__hdnea__=st=1792728005~exp=1792749605~acl=/*~hmac=d83a5d46d409842924f89d481d61e8c',
    key_id: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    key: 'ffffffffffffffffffffffffffffffff',
    logo: 'https://jiotv.catchup.cdn.jio.com/dare_images/images/Sony_HD.png',
  },
];

let payload = SONY_SHAPED;
const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const FEED_URL = `http://127.0.0.1:${server.address().port}/feed.json`;

const sonyDefault = getDefaultLiveSources().find((item) => item.id === 'sony-jio');

async function parse(sourceOverrides = {}, rows = SONY_SHAPED) {
  payload = rows;
  return parseLiveSourceChannels(
    { id: 'test-sony', label: 'Test Sony', type: 'json', url: FEED_URL, priority: 0, ...sourceOverrides },
    { includeAll: true },
  );
}

console.log('\ntest-live-sources.mjs — Live TV source contracts\n');

/* ------------------------------------------------- 1. the parser gap itself */

console.log('1. the feed field names the parser must understand');

const parsed = await parse();

check('stream_url is recognised (this feed parsed to 0 before)', () => {
  assert.equal(parsed.length, 4, `expected 4 channels, got ${parsed.length}`);
});

check('url and streamUrl still work — the chain keeps all three spellings', () => {
  const source = readFileSync(new URL('../lib/liveTv.js', import.meta.url), 'utf8');
  const line = source.split('\n').find((text) => text.includes('const rawUrl ='));
  assert.ok(line, 'could not find the rawUrl line in lib/liveTv.js');
  for (const field of ['raw.url', 'raw.streamUrl', 'raw.stream_url']) {
    assert.ok(line.includes(field), `${field} missing from: ${line.trim()}`);
  }
});

check('the ClearKey pair survives parsing', () => {
  const hd = parsed.find((channel) => channel.name === 'Sony Sports 1 HD');
  assert.equal(hd.keyId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(hd.key, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
});

check('the CDN cookie survives parsing', () => {
  assert.ok(parsed.every((channel) => channel.cookie.startsWith('__hdnea__=')));
});

check('Jio DASH manifests are classified as dash and playable', () => {
  assert.ok(parsed.every((channel) => channel.format === 'dash'));
  assert.ok(parsed.every((channel) => channel.playable === true));
});

/* ------------------------------------------------- 2. the Sony source config */

console.log('\n2. the Sony source as it ships');

check('the Sony source exists in the defaults', () => {
  assert.ok(sonyDefault, 'sony-jio missing from DEFAULT_SOURCES');
});

check('it does not point at the host that no longer resolves', () => {
  assert.ok(!isDeadSourceUrl(sonyDefault.url), `still dead: ${sonyDefault.url}`);
  assert.ok(!sonyDefault.url.includes('sayan-sportlink-sonynetwork'));
});

check('it is a json source on the maintained file', () => {
  assert.equal(sonyDefault.type, 'json');
  assert.ok(/\/sony\.json$/.test(sonyDefault.url), sonyDefault.url);
});

check('it is filtered to sports', () => {
  assert.equal(sonyDefault.titleFilter, 'Sony Sports|Sony Ten');
});

check('it auto-maps into a catalog that exists', () => {
  assert.equal(sonyDefault.autoMapCatalog, 'sports');
  assert.ok(isLiveCatalogId(sonyDefault.autoMapCatalog));
});

const filtered = await parse({ titleFilter: sonyDefault.titleFilter });
check('titleFilter yields only the sports rows', () => {
  assert.deepEqual(
    filtered.map((channel) => channel.name).sort(),
    ['Sony Sports 1 HD', 'Sony Sports 4 Tamil', 'Sony Ten 2'],
  );
});

check('rows named "Sony Sports …" are categorised as Sports', () => {
  const named = filtered.filter((channel) => channel.name.startsWith('Sony Sports'));
  assert.ok(named.length > 0);
  assert.ok(named.every((channel) => channel.category === 'Sports'));
});

check('the "Sony Ten …" spelling is still kept by the filter', () => {
  // Stream4Liv names these "Sony Ten 2" / "Sony Ten 4 Tamil", which the text
  // classifier does not read as sports, so the row lands in the default
  // category. It is still auto-mapped into Sports by autoMapCatalog — the
  // name alone must not decide catalog membership.
  const ten = filtered.find((channel) => channel.name === 'Sony Ten 2');
  assert.ok(ten, 'the Ten-spelled row was filtered out');
  assert.notEqual(ten.category, 'Sports');
  const mapping = autoMapInsertDefaults(sonyDefault, 0).catalogs[0].catalogId;
  assert.equal(mapping, 'sports');
});

/* ------------------------------------------------- 3. dead host tombstoning */

console.log('\n3. a host we know is gone');

check('the dead Sony host is recognised as dead', () => {
  assert.equal(isDeadSourceUrl('https://sayan-sportlink-sonynetwork.pages.dev/sonyliv.json'), true);
});

check('the live replacement is not', () => {
  assert.equal(isDeadSourceUrl(sonyDefault.url), false);
});

check('no default source points at a dead host', () => {
  const dead = getDefaultLiveSources({ includePocket: true }).filter((item) => isDeadSourceUrl(item.url));
  assert.deepEqual(dead.map((item) => item.id), [], `dead defaults: ${dead.map((i) => i.id)}`);
});

/* ------------------------------------------------- 4. auto-map contract */

console.log('\n4. auto-map must never overwrite a manual mapping');

check('a source with no autoMapCatalog inserts rows unmapped', () => {
  const row = autoMapInsertDefaults({ autoMapCatalog: '' }, 0);
  assert.deepEqual(row.catalogs, []);
  assert.equal(row.selected, false);
});

check('a source with autoMapCatalog inserts rows mapped and selected', () => {
  const row = autoMapInsertDefaults({ autoMapCatalog: 'sports' }, 2);
  assert.deepEqual(row.catalogs, [{ catalogId: 'sports', position: 300 }]);
  assert.equal(row.selected, true);
});

check('position rises with the index so ordering is stable', () => {
  const first = autoMapInsertDefaults({ autoMapCatalog: 'sports' }, 0);
  const second = autoMapInsertDefaults({ autoMapCatalog: 'sports' }, 1);
  assert.ok(second.catalogs[0].position > first.catalogs[0].position);
});

check('a catalog that does not exist is refused, not created', () => {
  const row = autoMapInsertDefaults({ autoMapCatalog: 'not-a-catalog' }, 0);
  assert.deepEqual(row.catalogs, []);
  assert.equal(row.selected, false);
});

check('undefined / junk autoMapCatalog is refused', () => {
  for (const value of [undefined, null, {}, 42]) {
    assert.deepEqual(autoMapInsertDefaults({ autoMapCatalog: value }, 0).catalogs, []);
  }
});

check('the defaults never claim to be favourite or hidden', () => {
  const row = autoMapInsertDefaults({ autoMapCatalog: 'sports' }, 0);
  assert.equal(row.favorite, false);
  assert.equal(row.hidden, false);
});

/* ------------------------------------------------- 5. the health probe */

console.log('\n5. the source health probe');

const liveProbe = await probeLiveSourceUrl(FEED_URL);
check('probe marks a live feed reachable', () => {
  assert.equal(liveProbe.ok, true);
  assert.equal(liveProbe.status, 200);
  assert.ok(liveProbe.ms >= 0);
});

const deadProbe = await probeLiveSourceUrl('http://127.0.0.1:1/nothing-here.json', { timeoutMs: 1500 });
check('probe reports a dead feed instead of throwing', () => {
  assert.equal(deadProbe.ok, false);
  assert.ok(deadProbe.error, 'expected an error message');
});

const emptyProbe = await probeLiveSourceUrl('');
check('probe explains an unusable URL instead of throwing', () => {
  assert.equal(emptyProbe.ok, false);
  assert.match(emptyProbe.error, /usable/i);
});

// A bare word is turned into https://<word> and then simply fails to resolve.
// Assert the verdict, not the wording: which error you get depends on DNS.
const junkProbe = await probeLiveSourceUrl('not-a-real-host', { timeoutMs: 1500 });
check('probe reports an unresolvable host instead of throwing', () => {
  assert.equal(junkProbe.ok, false);
  assert.ok(junkProbe.error.length > 0, 'expected an error message');
});

/* ------------------------------------------------------------------ teardown */

server.close();

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log(`\nfailing:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('Live source contracts OK\n');
