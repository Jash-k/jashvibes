#!/usr/bin/env node
/**
 * scripts/live/test-ingest-dedup.mjs — split from the former test-live-catalogs.mjs megatest (phase 0).
 * Pure contracts, no database.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-ingest-dedup.mjs
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

const { check, finish } = makeHarness('scripts/live/test-ingest-dedup.mjs');

console.log('7. Tamil FTA source id alignment');
check('registry uses the same id the sync pipeline writes', () => {
  assert.ok(SOURCE_REGISTRY['iptv-org-tamil']);
  assert.equal(SOURCE_REGISTRY['tamil-iptv'], undefined);
});

console.log('8. background grouping planner (no database)');
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
    assert.ok(!ids.includes('g3')); // religious excluded from every catalog
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

finish();
