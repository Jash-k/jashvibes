#!/usr/bin/env node
/**
 * test-live-catalogs.mjs — v13 catalog rules (religious exclusion, source
 * ladders), HJH self-tokenizing playback, and Tamil-FTA source id alignment.
 * Pure contracts, no database.
 *
 *   node --import ./scripts/alias-register.mjs scripts/test-live-catalogs.mjs
 */
import assert from 'node:assert/strict';
import { LIVE_CATALOGS, LIVE_CATALOG_IDS } from '@/lib/liveCatalogs';
import { classifyChannelCatalogs, isLocalTamilChannel, isMainstreamFlagship, isReligiousChannel, isReligiousExcludedGroup } from '@/lib/live/catalogRules';
import { orderVariantsByLadder } from '@/lib/live/pipeline/deduplicate.js';
import { isHjhWorkerChannel } from '@/lib/jioPlayback';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { SOURCE_REGISTRY } from '@/lib/live/registry.js';
import { planLiveGroupingAndCatalogs } from '@/lib/liveService';
import { cleanHttpUrl, detectManualFormat } from '@/lib/live/manualChannel';
import { resolveHjhWorkerUrl, extractJioCookieFromText } from '@/lib/liveTv';
import { pickLandingGroup } from '@/lib/live/landing';
import { channelDocToLogicalGroup } from '@/lib/live/preview';
import { canonicalChannelName, displayNameForChannel, deduplicateChannels, logicalIdForChannel } from '@/lib/live/pipeline/deduplicate.js';
import { summarizeLiveCatalogue } from '@/lib/live/adminBrowse';
import { liveFamilyRank } from '@/lib/live/catalogRules';
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

console.log('4. LocalCH excludes religious; religious excluded everywhere (v13)');
check('Aathavan TV is local', () => assert.equal(isLocalTamilChannel(ch('Aathavan TV')), true));
check('Aaseervatham TV is religious, never local', () => {
  assert.equal(isReligiousChannel(ch('Aaseervatham TV', 'Religious')), true);
  assert.equal(isLocalTamilChannel(ch('Aaseervatham TV', 'Religious')), false);
});
check('Angel TV -> excluded (empty), not others', () => assert.deepEqual(classifyChannelCatalogs(ch('Angel TV America', 'Religious')), []));
check('Aaseervatham -> excluded (empty)', () => assert.deepEqual(classifyChannelCatalogs(ch('Aaseervatham TV', 'Religious')), []));
check('Vasanth TV -> local', () => assert.deepEqual(classifyChannelCatalogs(ch('Vasanth TV')), ['local']));
check('unmatched entertainment -> others', () => assert.deepEqual(classifyChannelCatalogs(ch('Aaryaa TV')), ['others']));

console.log('4b. religious group exclusion with manual override');
check('all-religious unmapped group is excluded', () => {
  const group = { variants: [ch('Jesus Calls', 'Religious'), ch('Jesus Calls Tamil', 'Devotional')] };
  assert.equal(isReligiousExcludedGroup(group), true);
});
check('one non-religious variant keeps the group visible', () => {
  const group = { variants: [ch('Jesus Calls', 'Religious'), ch('Sun TV')] };
  assert.equal(isReligiousExcludedGroup(group), false);
});
check('manual mapping on a religious variant overrides exclusion', () => {
  const group = { variants: [{ ...ch('Angel TV', 'Religious'), mappingManaged: true, catalogIds: ['others'] }] };
  assert.equal(isReligiousExcludedGroup(group), false);
});
check('unmapped religious row without mappingManaged stays excluded', () => {
  const group = { variants: [{ ...ch('Angel TV', 'Religious'), mappingManaged: false, catalogIds: [] }] };
  assert.equal(isReligiousExcludedGroup(group), true);
});

console.log('4c. per-channel source ladder override');
check('ladder reorders listed sources and keeps the rest stable', () => {
  const variants = [
    { sourceId: 'hjh-jio' }, { sourceId: 'jio-tamil' }, { sourceId: 'jash-live' }, { sourceId: 'pocket-tamil' },
  ];
  const out = orderVariantsByLadder(variants, ['pocket-tamil', 'jio-tamil']).map((v) => v.sourceId);
  assert.deepEqual(out, ['pocket-tamil', 'jio-tamil', 'hjh-jio', 'jash-live']);
});
check('empty ladder is a no-op', () => {
  const variants = [{ sourceId: 'a' }, { sourceId: 'b' }];
  assert.equal(orderVariantsByLadder(variants, []), variants);
});

console.log('5. every non-religious result is a valid non-empty catalog set');
for (const sample of [ch('Sun TV'), ch('Random X'), ch('News7 Tamil', 'News'), ch('Nick Tamil', 'Kids')]) {
  const ids = classifyChannelCatalogs(sample);
  check(`${sample.name} -> valid ids`, () => {
    assert.ok(ids.length > 0);
    for (const id of ids) assert.ok(LIVE_CATALOG_IDS.includes(id));
  });
}
check('religious sample is the only empty classification', () => {
  assert.deepEqual(classifyChannelCatalogs(ch('Jesus Calls', 'Religious')), []);
});

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

  check('live policy opts out of ambient blur (whole-page blur bug)', () => {
    assert.equal(policy.ambient, false);
  });
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
    assert.ok(!ids.includes('g3')); // v13: religious excluded from every catalog
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
  check('religious channel is never auto-mapped (owner can still add it manually)', () => {
    const op = plan.catalogOps.find((item) => item.channelId === 'g3');
    assert.equal(op, undefined);
    // A manual mapping on the same row is untouched by the planner.
    const manual = doc({ channelId: 'g3m', name: 'Aaseervatham TV', normalizedName: 'aaseervatham tv', category: 'Religious', mappingManaged: true, catalogs: [{ catalogId: 'others', position: 5 }] });
    const manualPlan = planLiveGroupingAndCatalogs([manual]);
    assert.equal(manualPlan.catalogOps.find((item) => item.channelId === 'g3m'), undefined);
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

console.log('10. full remote-key coverage in the live player');
{
  const { commandForKey } = await import('@/lib/player/commands');
  const ev = (key, target) => ({ key, target: target || documentStub(), shiftKey: false, ctrlKey: false, metaKey: false });
  function documentStub() { return { tagName: 'DIV', isContentEditable: false }; }
  const remoteMap = [
    ['MediaPlayPause', 'togglePlay'], ['MediaPlay', 'togglePlay'], ['MediaPause', 'togglePlay'],
    ['MediaStop', 'togglePlay'], ['Enter', 'togglePlay'], [' ', 'togglePlay'], ['k', 'togglePlay'],
    ['MediaTrackNext', 'nextItem'], ['PageDown', 'nextItem'],
    ['MediaTrackPrevious', 'prevItem'], ['PageUp', 'prevItem'],
    ['MediaFastForward', 'seekForward'], ['MediaRewind', 'seekBack'],
    ['ArrowRight', 'seekForward'], ['ArrowLeft', 'seekBack'],
    ['ArrowUp', 'nudgeVolumeUp'], ['ArrowDown', 'nudgeVolumeDown'],
    ['g', 'toggleBrowser'], ['f', 'toggleFullscreen'], ['m', 'mute'],
    ['Escape', 'closeMenus'], ['t', 'cycleCaptions'],
  ];
  for (const [key, command] of remoteMap) {
    check(`remote key "${key}" -> ${command}`, () => assert.equal(commandForKey(ev(key)), command));
  }
  check('GoBack/BrowserBack normalize to closeMenus', () => {
    assert.equal(commandForKey(ev('GoBack')), 'closeMenus');
    assert.equal(commandForKey(ev('BrowserBack')), 'closeMenus');
  });
  check('remote keys never fire while typing in a field', () => {
    const input = { tagName: 'INPUT', isContentEditable: false };
    assert.equal(commandForKey(ev('MediaPlayPause', input)), null);
    assert.equal(commandForKey(ev('Enter', input)), null);
  });
}

console.log('11. /live landing choice (Main catalog → Star Vijay)');
{
  const group = (name, ids) => ({ logicalId: name, displayName: name, variants: [{ catalogIds: ids, catalogs: ids.map((id) => ({ catalogId: id, position: 100 })) }] });
  const groups = [
    group('Sun TV', ['main']),
    group('Star Vijay', ['main']),
    group('Vijay Super', ['main']),
    group('Sun Music', ['main', 'music']),
    group('Madurai Vision', ['local']),
  ];
  check('lands on Star Vijay inside Main', () => assert.equal(pickLandingGroup(groups).displayName, 'Star Vijay'));
  check('exact Vijay TV spelling also wins', () => {
    const alt = [group('Sun TV', ['main']), group('Vijay TV', ['main'])];
    assert.equal(pickLandingGroup(alt).displayName, 'Vijay TV');
  });
  check('falls back to first Main channel when no Vijay exists', () => {
    const noVijay = [group('KTV', ['main']), group('Sun News', ['news', 'main'])];
    assert.equal(pickLandingGroup(noVijay).displayName, 'KTV');
  });
  check('falls back to any group when Main is empty', () => {
    assert.equal(pickLandingGroup([group('Madurai Vision', ['local'])]).displayName, 'Madurai Vision');
  });
  check('empty catalogue yields null', () => assert.equal(pickLandingGroup([]), null));
}

console.log('12. admin preview adapter (same shape the live player consumes)');
{
  const doc = {
    channelId: 'manual-ab12', sourceId: 'manual', source: 'Manual', name: 'Madurai Vision',
    customName: 'Madurai Vision TV', logo: 'https://img.test/m.png', category: 'Local',
    url: 'https://feed.test/live.m3u8', format: 'HLS', playable: true,
    keyId: 'kid1', licenseKey: 'kid1:key1', cookie: 'c=1', referer: 'https://ref.test',
    userAgent: 'ua', headers: { 'X-Test': 'yes' }, tvgId: 'tvg-9', order: 300,
    catalogs: [{ catalogId: 'local', position: 200 }],
  };
  const group = channelDocToLogicalGroup(doc);
  check('becomes a one-variant logical group with the stored channelId', () => {
    assert.equal(group.logicalId, 'manual-ab12');
    assert.equal(group.variants.length, 1);
    assert.equal(group.variants[0].channelId, 'manual-ab12');
    assert.equal(group.best.channelId, 'manual-ab12');
  });
  check('carries every DRM/header field the resolve/policy path reads', () => {
    const v = group.variants[0];
    assert.equal(v.keyId, 'kid1');
    assert.equal(v.licenseKey, 'kid1:key1');
    assert.equal(v.cookie, 'c=1');
    assert.equal(v.referer, 'https://ref.test');
    assert.deepEqual(v.headers, { 'X-Test': 'yes' });
    assert.equal(v.format, 'hls'); // normalized to lowercase
  });
  check('exposes catalog ids for the modal chips', () => {
    assert.deepEqual(group.variants[0].catalogIds, ['local']);
  });
  check('never throws on an empty/partial row', () => {
    const empty = channelDocToLogicalGroup({});
    assert.equal(empty.variants.length, 1);
    assert.equal(empty.variants[0].playable, true);
    assert.equal(empty.displayName, 'Channel preview');
  });
}

console.log('13. canonical duplicate arrest (HD / DASH / ClearKey variants merge)');
{
  check('canonicalChannelName strips every delivery/quality/DRM token', () => {
    const cases = [
      ['Star Vijay', 'star vijay'],
      ['Star Vijay HD', 'star vijay'],
      ['Star Vijay DASH', 'star vijay'],
      ['Star Vijay ClearKey', 'star vijay'],
      ['Star Vijay_ClearKey [HLS · JioTV proxy]', 'star vijay'],
      ['STAR VIJAY (DASH)', 'star vijay'],
      ['Sun TV 4K', 'sun'],
      ['KTV HD', 'ktv'],
      ['J Movies MOB 720p', 'j movies mob'],
      [' Polimer   TV  HLS ', 'polimer'],
    ];
    for (const [input, want] of cases) assert.equal(canonicalChannelName(input), want, input);
  });
  check('brand differentiators survive — sister channels never merge', () => {
    assert.notEqual(canonicalChannelName('Star Vijay'), canonicalChannelName('Star Vijay Super'));
    assert.notEqual(canonicalChannelName('Star Vijay'), canonicalChannelName('Vijay Takkar'));
    assert.notEqual(canonicalChannelName('Sun TV HD'), canonicalChannelName('Sun Music HD'));
    assert.notEqual(canonicalChannelName('Star Sports 1 HD'), canonicalChannelName('Star Sports 2 HD'));
    assert.notEqual(canonicalChannelName('KTV HD'), canonicalChannelName('K TV'));
  });
  check('displayNameForChannel keeps friendly words and original casing', () => {
    assert.equal(displayNameForChannel('Star Vijay HD (DASH)'), 'Star Vijay');
    assert.equal(displayNameForChannel('Sun TV HD'), 'Sun TV'); // "TV" stays for humans
    assert.equal(displayNameForChannel('Madurai Vision [HLS proxy]'), 'Madurai Vision');
    assert.equal(displayNameForChannel(''), 'Channel');
  });
  check('logicalIdForChannel never returns an empty id', () => {
    assert.ok(logicalIdForChannel({ name: '   ' }).length > 0);
    assert.equal(logicalIdForChannel({ name: 'Star Vijay HD' }), 'star vijay');
  });

  const flat = (over) => ({
    channelId: `c${Math.random().toString(36).slice(2, 8)}`, sourceId: 'iptv-org-tamil',
    source: 'Test', name: 'X', category: 'Entertainment', url: 'https://e.test/a.m3u8',
    format: 'hls', playable: true, headers: {}, catalogs: [], ...over,
  });
  const merged = deduplicateChannels([
    flat({ channelId: 'a1', name: 'Star Vijay', format: 'hls' }),
    flat({ channelId: 'a2', sourceId: 'hjh-jio', name: 'Star Vijay HD', format: 'dash', licenseType: 'clearkey' }),
    flat({ channelId: 'a3', sourceId: 'jash', name: 'Star Vijay DASH', format: 'dash' }),
    flat({ channelId: 'a4', sourceId: 'jash', name: 'Star Vijay_ClearKey [HLS · proxy]', format: 'hls' }),
    flat({ channelId: 'b1', name: 'Star Vijay Super', format: 'hls' }),
    flat({ channelId: 'b2', name: 'Star Vijay Super HD', format: 'dash' }),
    flat({ channelId: 'c1', sourceId: 'jash', name: 'Dead Key', licenseKey: 'null:null', url: 'https://e.test/d.m3u8' }),
  ]);
  check('one card per broadcaster with all delivery rows as its ladder', () => {
    assert.equal(merged.length, 2); // Star Vijay family + Star Vijay Super; dummy row dropped
    const vijay = merged.find((g) => g.logicalId === 'star vijay');
    assert.ok(vijay);
    assert.equal(vijay.variantCount, 4);
    assert.equal(vijay.displayName, 'Star Vijay');
    assert.deepEqual(vijay.sourceIds.sort(), ['hjh-jio', 'iptv-org-tamil', 'jash'].sort());
  });
  check('sister channel stays its own card even with an HD twin', () => {
    const superG = merged.find((g) => g.logicalId === 'star vijay super');
    assert.ok(superG);
    assert.equal(superG.variantCount, 2);
  });
}

console.log('14. admin browse summary mirrors /live exactly (cards, not rows)');
{
  const tamilRow = (over) => ({
    channelId: `x${Math.random().toString(36).slice(2, 8)}`, sourceId: 'iptv-org-tamil',
    name: 'X', category: 'Entertainment', url: 'https://e.test/a.m3u8', format: 'hls',
    playable: true, hidden: false, catalogs: [], headers: {}, ...over,
  });
  const rows = [
    // One broadcaster, three delivery rows — must count as ONE /live card.
    tamilRow({ channelId: 'v1', name: 'Star Vijay', catalogs: [{ catalogId: 'main' }] }),
    tamilRow({ channelId: 'v2', sourceId: 'hjh-jio', name: 'Star Vijay HD', format: 'dash', catalogs: [{ catalogId: 'main' }] }),
    tamilRow({ channelId: 'v3', sourceId: 'jash', name: 'Star Vijay DASH', catalogs: [{ catalogId: 'main' }, { catalogId: 'music' }] }),
    // A second, unmapped card.
    tamilRow({ channelId: 'v4', name: 'Polimer TV', catalogs: [] }),
    // Hidden duplicate of an existing card — dropped, must not inflate counts.
    tamilRow({ channelId: 'v5', name: 'Star Vijay ClearKey', hidden: true, catalogs: [{ catalogId: 'main' }] }),
    // Unplayable / URL-less / dummy licence rows never reach /live.
    tamilRow({ channelId: 'v6', name: 'Dead Feed', playable: false }),
    tamilRow({ channelId: 'v7', name: 'No URL Feed', url: '' }),
    tamilRow({ channelId: 'v8', name: 'Dummy Licence', licenseKey: 'null:null' }),
    // Religious group — excluded from every catalog, counted separately.
    tamilRow({ channelId: 'v9', name: 'Aaseervatham TV', category: 'Devotional', catalogs: [] }),
    // Non-Tamil source/name — filtered out exactly like tamilOnly=1.
    { channelId: 'v10', sourceId: 'hjh-jio', name: 'Star Plus HD', category: 'Entertainment', url: 'https://e.test/s.m3u8', playable: true, catalogs: [{ catalogId: 'main' }] },
  ];
  const summary = summarizeLiveCatalogue(rows);
  check('delivery variants merge: one Star Vijay card in main, not three', () => {
    assert.equal(summary.catalogs.main, 1);
    assert.equal(summary.catalogs.music, 1); // union of the merged group's memberships
  });
  check('total counts visible cards incl. unmapped; hidden/dead/dummy/non-Tamil excluded', () => {
    assert.equal(summary.total, 2); // Star Vijay + Polimer
    assert.equal(summary.unmapped, 1); // Polimer
  });
  check('religious group is excluded and reported in its own bucket', () => {
    assert.equal(summary.religious, 1);
    assert.equal(summary.catalogs.others, 0);
  });
  check('empty scope is a zeroed summary, never a throw', () => {
    const empty = summarizeLiveCatalogue([]);
    assert.equal(empty.total, 0);
    assert.equal(empty.unmapped, 0);
    assert.equal(empty.catalogs.main, 0);
  });
}

console.log('15. /live family ranking — Vijay, Sun+sisters, Jaya, then other mainstream');
{
  check('Vijay family is tier 0', () => {
    assert.equal(liveFamilyRank('Star Vijay'), 0);
    assert.equal(liveFamilyRank('Star Vijay HD'), 0);
    assert.equal(liveFamilyRank('Vijay TV'), 0);
    assert.equal(liveFamilyRank('Vijay Super'), 0);
    assert.equal(liveFamilyRank('Vijay Takkar'), 0);
  });
  check('Sun family incl. KTV/Adithya/Chutti sisters is tier 1', () => {
    assert.equal(liveFamilyRank('Sun TV'), 1);
    assert.equal(liveFamilyRank('Sun Music'), 1);
    assert.equal(liveFamilyRank('Sun News'), 1);
    assert.equal(liveFamilyRank('KTV'), 1);
    assert.equal(liveFamilyRank('Adithya TV'), 1);
    assert.equal(liveFamilyRank('Chutti TV'), 1);
  });
  check('Jaya family is tier 2', () => {
    assert.equal(liveFamilyRank('Jaya TV'), 2);
    assert.equal(liveFamilyRank('Jaya Max'), 2);
    assert.equal(liveFamilyRank('Jaya Movies'), 2);
  });
  check('other mainstream flagships are tier 3, long tail tier 4', () => {
    assert.equal(liveFamilyRank('Zee Tamil'), 3);
    assert.equal(liveFamilyRank('Kalaignar TV'), 3);
    assert.equal(liveFamilyRank('Colors Tamil'), 3);
    assert.equal(liveFamilyRank('Madurai Vision'), 4);
    assert.equal(liveFamilyRank(''), 4);
  });
  check('family order beats alphabetical order', () => {
    const names = ['Zee Tamil', 'Jaya TV', 'Adithya TV', 'Vijay Takkar', 'Madurai Vision', 'Star Vijay'];
    const ordered = [...names].sort((a, b) => {
      const rank = liveFamilyRank(a) - liveFamilyRank(b);
      return rank || a.localeCompare(b);
    });
    assert.deepEqual(ordered, ['Star Vijay', 'Vijay Takkar', 'Adithya TV', 'Jaya TV', 'Zee Tamil', 'Madurai Vision']);
  });
}

console.log(`\n${passed} passed, 0 failed — live catalog/playback contracts OK.`);
