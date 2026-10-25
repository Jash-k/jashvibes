#!/usr/bin/env node
/**
 * scripts/live/test-playback-contracts.mjs — split from the former test-live-catalogs.mjs megatest (phase 0).
 * Pure contracts, no database.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-playback-contracts.mjs
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
import { summarizeLiveCatalogue, summarizeSourceGroups } from '@/lib/live/adminBrowse';
import { buildCatalogueView, buildLogicalGroups, catalogIdsForGroup, countCatalogs, isVisibleFlatChannel, toFlatChannel } from '@/lib/live/read/viewBuilder.js';
import { liveFamilyRank } from '@/lib/live/catalogRules';
import { sortLogicalGroups, groupCatalogPosition } from '@/lib/live/catalogOrder';
import http from 'node:http';
import { makeHarness } from './harness.mjs';
import { ch, doc } from './fixtures.mjs';

const { check, finish } = makeHarness('scripts/live/test-playback-contracts.mjs');

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

finish();
