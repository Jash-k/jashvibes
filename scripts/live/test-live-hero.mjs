#!/usr/bin/env node
/**
 * scripts/live/test-live-hero.mjs — contracts for the owner-controlled live
 * homepage hero and the forceProxy relay flag. Pure, no database.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-live-hero.mjs
 */
import assert from 'node:assert/strict';
import { buildLiveHeroSlide, liveHeroHref, liveHeroResponse, LIVE_HERO_NONE } from '@/lib/live/hero';
import { needsProxyForVariant } from '@/lib/live/playback/policy.js';
import { createLiveTvPolicy } from '@/lib/player/policy/liveTv';
import { toFlatChannel } from '@/lib/live/read/viewBuilder.js';
import { makeHarness } from './harness.mjs';

const { check, finish } = makeHarness('scripts/live/test-live-hero.mjs');

console.log('1. Live hero slide contract');
check('deep link has the /live?channel= shape', () => {
  assert.equal(liveHeroHref('manual-abc123'), '/live?channel=manual-abc123');
  assert.equal(liveHeroHref('a/b?x'), '/live?channel=a%2Fb%3Fx');
});

check('null / hidden / id-less channels never produce a slide', () => {
  assert.equal(buildLiveHeroSlide(null), null);
  assert.equal(buildLiveHeroSlide({ name: 'x' }), null);
  assert.equal(buildLiveHeroSlide({ channelId: 'manual-1', hidden: true }), null);
});

check('slide carries the RailFocus fields and a live deep link', () => {
  const slide = buildLiveHeroSlide({
    channelId: 'manual-bb1', name: 'Bigg Boss Tamil 24/7',
    logo: 'https://img.example/poster.jpg', hidden: false,
  });
  assert.equal(slide.live, true);
  assert.equal(slide.type, 'live');
  assert.equal(slide.title, 'Bigg Boss Tamil 24/7');
  assert.equal(slide.href, '/live?channel=manual-bb1');
  assert.equal(slide.posterUrl, 'https://img.example/poster.jpg');
  assert.equal(slide.backdropUrl, 'https://img.example/poster.jpg');
  assert.ok(slide.chips.includes('LIVE'));
});

check('custom name/logo win over the synced originals', () => {
  const slide = buildLiveHeroSlide({
    channelId: 'manual-bb2', name: 'Old name', customName: 'BB Hero',
    logo: 'https://img.example/old.jpg', customLogo: 'https://img.example/new.jpg',
  });
  assert.equal(slide.title, 'BB Hero');
  assert.equal(slide.posterUrl, 'https://img.example/new.jpg');
});

check('response helper reports inactive vs active payloads', () => {
  assert.deepEqual(liveHeroResponse(null), LIVE_HERO_NONE);
  const payload = liveHeroResponse({ channelId: 'manual-bb1', name: 'BB', logo: 'l', forceProxy: true });
  assert.equal(payload.active, true);
  assert.equal(payload.channelId, 'manual-bb1');
  assert.equal(payload.forceProxy, true);
  assert.equal(payload.slide.href, '/live?channel=manual-bb1');
});

console.log('2. forceProxy relay policy');
check('flagged manual variant is proxied even with no headers/registry rule', () => {
  const variant = { channelId: 'manual-bb1', sourceId: 'manual', url: 'https://newcdn.tamils.click/live1channel/index.m3u8', forceProxy: true };
  assert.equal(needsProxyForVariant(variant), true);
});

check('unflagged plain public variant still plays direct', () => {
  const variant = { channelId: 'manual-x', sourceId: 'manual', url: 'https://newcdn.tamils.click/live1channel/index.m3u8' };
  assert.equal(needsProxyForVariant(variant), false);
});

check('geo-sensitive hosts are never proxied, flag or no flag', () => {
  const variant = { channelId: 'jio-1', sourceId: 'jiotv', url: 'https://jiotv.com/live/index.mpd', forceProxy: true };
  assert.equal(needsProxyForVariant(variant), false);
});

{
  const origin = 'http://localhost:3000';
  const fetchImpl = async (url) => { throw new Error(`unexpected fetch: ${url}`); };
  const shakaCtx = { shaka: { net: { NetworkingEngine: { RequestType: { MANIFEST: 0, SEGMENT: 1, LICENSE: 2 } } } } };
  const segment = 'https://newcdn.tamils.click/live1channel/tracks-v1a1/2026/10/28/12/00/00-10300.png';

  const proxied = await createLiveTvPolicy(
    { id: 'manual-bb1', channelId: 'manual-bb1', sourceId: 'manual', url: 'https://newcdn.tamils.click/live1channel/index.m3u8', headers: {}, forceProxy: true },
    { origin, fetchImpl },
  ).resolve({});
  const req1 = { uris: [segment], headers: {} };
  proxied.http.requestFilter(1, req1, shakaCtx);

  const direct = await createLiveTvPolicy(
    { id: 'manual-bb2', channelId: 'manual-bb2', sourceId: 'manual', url: 'https://newcdn.tamils.click/live2channel/index.m3u8', headers: {} },
    { origin, fetchImpl },
  ).resolve({});
  const req2 = { uris: [segment], headers: {} };
  direct.http.requestFilter(1, req2, shakaCtx);

  check('client live policy rewrites segment URLs through the relay only when flagged', () => {
    assert.ok(req1.uris[0].startsWith('/api/live-proxy?u='), `expected relay URL, got ${req1.uris[0]}`);
    assert.ok(req1.uris[0].includes(encodeURIComponent(segment)));
    assert.equal(req2.uris[0], segment);
  });
}

console.log('3. Read pipeline propagation');
check('toFlatChannel exposes forceProxy to logical-group variants', () => {
  const flat = toFlatChannel({ channelId: 'manual-bb1', url: 'https://x/index.m3u8', forceProxy: true });
  assert.equal(flat.forceProxy, true);
  assert.equal(toFlatChannel({ channelId: 'manual-bb2', url: 'https://x/index.m3u8' }).forceProxy, false);
});

finish();
