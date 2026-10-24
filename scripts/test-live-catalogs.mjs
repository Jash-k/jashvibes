#!/usr/bin/env node
/**
 * test-live-catalogs.mjs — v12 catalog rules, HJH self-tokenizing playback,
 * and Tamil-FTA source id alignment. Pure contracts, no database.
 *
 *   node --import ./scripts/alias-register.mjs scripts/test-live-catalogs.mjs
 */
import assert from 'node:assert/strict';
import { LIVE_CATALOGS, LIVE_CATALOG_IDS } from '@/lib/liveCatalogs';
import { classifyChannelCatalogs, isLocalTamilChannel, isMainstreamFlagship, isReligiousChannel } from '@/lib/live/catalogRules';
import { isHjhWorkerChannel } from '@/lib/jioPlayback';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { SOURCE_REGISTRY } from '@/lib/live/registry.js';
import { planLiveGroupingAndCatalogs } from '@/lib/liveService';
import { cleanHttpUrl, detectManualFormat } from '@/lib/live/manualChannel';
import { resolveHjhWorkerUrl, extractJioCookieFromText } from '@/lib/liveTv';
import http from 'node:http';

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log('  PASS', label); };

const ch = (name, category = 'Entertainment', extra = {}) => ({ name, category, sourceId: 'iptv-org-tamil', ...extra });

console.log('1. fixed catalog set + order');
check('seven catalogs including news', () => assert.deepEqual(LIVE_CATALOG_IDS, ['main', 'music', 'sports', 'kids', 'news', 'local', 'others']));
check('order matches owner request', () => {
  assert.deepEqual(LIVE_CATALOGS.map((c) => c.id), ['main', 'music', 'sports', 'kids', 'news', 'local', 'others']);
});

console.log('2. Main = curated flagship families');
check('Sun TV is flagship', () => assert.ok(isMainstreamFlagship(ch('Sun TV HD'))));
check('Star Vijay is flagship', () => assert.ok(isMainstreamFlagship(ch('Star Vijay'))));
check('Jaya TV family is flagship', () => assert.ok(isMainstreamFlagship(ch('Jaya Max'))));
check('unknown small channel is not flagship', () => assert.equal(isMainstreamFlagship(ch('Aaryaa TV')), false));
check('Sun TV lands in main only', () => assert.deepEqual(classifyChannelCatalogs(ch('Sun TV')), ['main']));
check('Sun News gets main + news', () => assert.deepEqual(classifyChannelCatalogs(ch('Sun News', 'News')), ['main', 'news']));
check('Sun Music gets main + music', () => assert.deepEqual(classifyChannelCatalogs(ch('Sun Music', 'Music')), ['main', 'music']));
check('Chutti TV gets main + kids', () => assert.deepEqual(classifyChannelCatalogs(ch('Chutti TV', 'Kids')), ['main', 'kids']));
check('Polimer News is news, not main', () => assert.deepEqual(classifyChannelCatalogs(ch('Polimer News', 'News')), ['news']));
check('Kalaignar TV is flagship', () => assert.ok(classifyChannelCatalogs(ch('Kalaignar TV')).includes('main')));
check('DD Podhigai is flagship', () => assert.ok(classifyChannelCatalogs(ch('DD Podhigai')).includes('main')));

console.log('3. topical catalogs');
check('Star Sports Tamil -> sports', () => assert.deepEqual(classifyChannelCatalogs(ch('Star Sports Tamil', 'Sports')), ['sports']));
check('category Music -> music', () => assert.deepEqual(classifyChannelCatalogs(ch('7S Music', 'Music')), ['music']));
check('Pogo Tamil -> kids', () => assert.deepEqual(classifyChannelCatalogs(ch('Pogo Tamil', 'Kids')), ['kids']));
check('Thanthi TV -> news', () => assert.deepEqual(classifyChannelCatalogs(ch('Thanthi TV', 'News')), ['news']));

console.log('4. LocalCH excludes religious channels');
check('Aathavan TV is local', () => assert.equal(isLocalTamilChannel(ch('Aathavan TV')), true));
check('Aaseervatham TV is religious, never local', () => {
  assert.equal(isReligiousChannel(ch('Aaseervatham TV', 'Religious')), true);
  assert.equal(isLocalTamilChannel(ch('Aaseervatham TV', 'Religious')), false);
});
check('Angel TV -> others', () => assert.deepEqual(classifyChannelCatalogs(ch('Angel TV America', 'Religious')), ['others']));
check('Aaseervatham -> others', () => assert.deepEqual(classifyChannelCatalogs(ch('Aaseervatham TV', 'Religious')), ['others']));
check('Vasanth TV -> local', () => assert.deepEqual(classifyChannelCatalogs(ch('Vasanth TV')), ['local']));
check('unmatched entertainment -> others', () => assert.deepEqual(classifyChannelCatalogs(ch('Aaryaa TV')), ['others']));

console.log('5. every result is a valid non-empty catalog set');
for (const sample of [ch('Sun TV'), ch('Random X'), ch('Jesus Calls', 'Religious'), ch('News7 Tamil', 'News'), ch('Nick Tamil', 'Kids')]) {
  const ids = classifyChannelCatalogs(sample);
  check(`${sample.name} -> valid ids`, () => {
    assert.ok(ids.length > 0);
    for (const id of ids) assert.ok(LIVE_CATALOG_IDS.includes(id));
  });
}

console.log('6. HJH worker channels: worker-redirect token + signed segments');
check('worker URL is detected', () => {
  assert.equal(isHjhWorkerChannel({ url: 'https://hjh-545.pages.dev/stream?id=starplus' }), true);
  assert.equal(isHjhWorkerChannel({ url: 'https://jiotvpllive.cdn.jio.com/x/index.mpd?__hdnea__=a' }), false);
});
{
  // Loopback stand-in for the Cloudflare worker: 302 to a signed Jio CDN MPD.
  const token = '__hdnea__=st=1700000000~exp=9999999999~acl=/bpk-tv/J_Movies_MOB/WDVLive/*~hmac=abcdef0123456789';
  let finalSigned = '';
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/stream')) { res.writeHead(302, { Location: finalSigned }); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/dash+xml' }); res.end('<MPD/>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const workerUrl = `http://127.0.0.1:${port}/stream?id=jmovies`;
  finalSigned = `http://127.0.0.1:${port}/bpk-tv/J_Movies_MOB/WDVLive/index.mpd?${token}`;

  const resolvedWorker = await resolveHjhWorkerUrl(workerUrl);
  check('resolveHjhWorkerUrl follows the 302 and returns the signed MPD', () => {
    assert.equal(resolvedWorker, finalSigned);
  });
  check('token extracted from inside the signed URL query', () => {
    assert.equal(extractJioCookieFromText(finalSigned), token);
  });

  // Channel shape exactly as /api/live/resolve builds it after worker resolution.
  const channel = {
    id: 'h1', channelId: 'h1', name: 'J Movies', sourceId: 'hjh-jio', source: 'HJH',
    url: finalSigned, workerUrl, format: 'dash',
    keyId: 'ae3d3b12ab0f5dada0f2423d1cc7b403', key: '4577d96a74683b0c261cc5c0e30af011',
    headers: {}, cookie: token, referer: '', userAgent: '', category: 'Movies',
  };
  // Any call to /api/live-jio would hit this and fail the check.
  const fetchImpl = async (url) => { throw new Error(`unexpected fetch: ${url}`); };
  const policy = createLiveTvPolicy(channel, { origin: 'http://localhost:7860', fetchImpl });
  const resolved = await policy.resolve({});

  check('HJH never calls the Render /api/live-jio sweep', () => {
    assert.equal(resolved.meta.accessSource, 'hjh-worker');
  });
  check('HJH keeps the signed CDN manifest URL', () => assert.equal(resolved.url, finalSigned));
  check('HJH keeps its ClearKey DRM', () => {
    assert.equal(Object.keys(resolved.drm.clearKeys || {}).length, 1);
    assert.equal(resolved.hasDrm, true);
  });

  // The reported production failure: relative DASH segments lose the query.
  const bareSegment = `http://127.0.0.1:${port}/bpk-tv/J_Movies_MOB/WDVLive/dash/J_Movies_MOB-audio_98834_eng=98800.dash`;
  const req = { uris: [bareSegment], headers: {} };
  resolved.http.requestFilter(1, req, { shaka: { net: { NetworkingEngine: { RequestType: { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 } } } } });
  check('unsigned segment URLs get the __hdnea__ token re-attached (fixes 403)', () => {
    assert.match(req.uris[0], /__hdnea__=/);
    assert.ok(req.uris[0].startsWith(bareSegment));
  });
  // Idempotent on an already-signed URL.
  const req2 = { uris: [finalSigned], headers: {} };
  resolved.http.requestFilter(1, req2, { shaka: { net: { NetworkingEngine: { RequestType: { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 } } } } });
  check('signed manifest URL is not double-tokenized', () => {
    const occurrences = (req2.uris[0].match(/__hdnea__=/g) || []).length;
    assert.equal(occurrences, 1);
  });

  // Recovery must refresh via the worker, never enable a Render Jio proxy.
  const first = await policy.recover({ error: { code: 1002, message: '403' } });
  check('first HJH recovery is a worker reload, not a proxy rung', () => {
    assert.equal(first.retry, 'reload');
  });
  const second = await policy.recover({ error: { code: 1002, message: '403' } });
  check('HJH recovery ends after one refresh (no proxy loop)', () => assert.equal(second, null));

  server.close();
}

console.log('7. Tamil FTA source id alignment');
check('registry uses the same id the sync pipeline writes', () => {
  assert.ok(SOURCE_REGISTRY['iptv-org-tamil']);
  assert.equal(SOURCE_REGISTRY['tamil-iptv'], undefined);
});

console.log('8. background grouping planner (no database)');
const doc = (over) => ({
  channelId: `d${Math.random().toString(36).slice(2, 8)}`, sourceId: 'iptv-org-tamil',
  name: 'X', normalizedName: 'x', category: 'Entertainment', url: 'https://e.test/a.m3u8',
  format: 'hls', playable: true, hidden: false, catalogs: [], headers: {}, ...over,
});
{
  const v1 = doc({ channelId: 'g1', sourceId: 'hjh-jio', name: 'Star Vijay HD', normalizedName: 'star vijay hd', format: 'dash' });
  const v2 = doc({ channelId: 'g2', name: 'Star Vijay HD', normalizedName: 'star vijay hd' });
  const religious = doc({ channelId: 'g3', name: 'Aaseervatham TV', normalizedName: 'aaseervatham tv', category: 'Religious' });
  const hindi = doc({ channelId: 'g4', sourceId: 'hjh-jio', name: 'Star Plus HD', normalizedName: 'star plus hd' });
  const locked = doc({ channelId: 'g5', name: 'Sun TV', normalizedName: 'sun tv', mappingManaged: true, catalogs: [{ catalogId: 'others', position: 7 }] });
  const dead = doc({ channelId: 'g6', name: 'Dead Feed', normalizedName: 'dead feed', playable: false });
  const plan = planLiveGroupingAndCatalogs([v1, v2, religious, hindi, locked, dead]);

  check('same-name variants get one shared logical id', () => {
    const g1 = plan.groupOps.find((op) => op.channelId === 'g1');
    const g2 = plan.groupOps.find((op) => op.channelId === 'g2');
    assert.ok(g1 && g2 && g1.logicalId === g2.logicalId);
  });
  check('eligible Tamil channels receive catalog ops', () => {
    const ids = plan.catalogOps.map((op) => op.channelId);
    assert.ok(ids.includes('g1'));
    assert.ok(ids.includes('g3')); // religious -> others, but still Tamil/eligible
  });
  check('non-Tamil, locked, unplayable rows never auto-mapped', () => {
    const ids = plan.catalogOps.map((op) => op.channelId);
    assert.ok(!ids.includes('g4'));
    assert.ok(!ids.includes('g5'));
    assert.ok(!ids.includes('g6'));
  });
  check('catalog op publishes (selected=true) with valid memberships', () => {
    const op = plan.catalogOps.find((item) => item.channelId === 'g1');
    assert.equal(op.updateOne.update.$set.selected, true);
    assert.ok(op.memberships.some((m) => m.catalogId === 'main'));
  });
  check('religious channel maps to others, never local', () => {
    const op = plan.catalogOps.find((item) => item.channelId === 'g3');
    assert.deepEqual(op.memberships.map((m) => m.catalogId), ['others']);
  });
  check('positions are unique within a catalog', () => {
    const mainPositions = plan.catalogOps
      .flatMap((op) => op.memberships.filter((m) => m.catalogId === 'main').map((m) => m.position));
    assert.equal(new Set(mainPositions).size, mainPositions.length);
  });
  // Idempotency: after applying the plan (catalogs now populated), a second plan emits nothing new
  const mapped = plan.catalogOps.map((op) => ({
    ...doc({ channelId: op.channelId, name: 'M', normalizedName: 'm' }),
    catalogs: op.memberships,
  }));
  const second = planLiveGroupingAndCatalogs(mapped);
  check('re-planning mapped rows is idempotent', () => assert.equal(second.catalogOps.length, 0));
}

console.log('9. manual channel helpers');
check('cleanHttpUrl accepts http(s) only', () => {
  assert.equal(cleanHttpUrl('  https://a.test/x.m3u8  '), 'https://a.test/x.m3u8');
  assert.equal(cleanHttpUrl('ftp://a.test/x'), '');
  assert.equal(cleanHttpUrl('not a url'), '');
});
check('detectManualFormat honors hint then extension', () => {
  assert.equal(detectManualFormat('https://a.test/stream?id=1', 'dash'), 'dash');
  assert.equal(detectManualFormat('https://a.test/a.mpd'), 'dash');
  assert.equal(detectManualFormat('https://a.test/b.m3u8'), 'hls');
  assert.equal(detectManualFormat('https://a.test/c.mp4'), 'video');
  assert.equal(detectManualFormat('https://a.test/worker'), 'unknown');
});

console.log(`\n${passed} passed, 0 failed — live catalog/playback contracts OK.`);
