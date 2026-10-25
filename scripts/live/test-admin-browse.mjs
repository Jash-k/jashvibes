#!/usr/bin/env node
/**
 * scripts/live/test-admin-browse.mjs — split from the former test-live-catalogs.mjs megatest (phase 0).
 * Pure contracts, no database.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-admin-browse.mjs
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

const { check, finish } = makeHarness('scripts/live/test-admin-browse.mjs');

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
  check('admin summary and the shared view builder are count-identical on the same rows', () => {
    const view = buildCatalogueView(rows, { tamilOnly: true });
    // Every fixed catalog: admin chip count === /live card count from the builder.
    for (const catalog of view.catalogs) {
      assert.equal(summary.catalogs[catalog.id], catalog.count, `parity broke on ${catalog.id}`);
    }
    assert.equal(summary.total, view.total);
    assert.equal(summary.unmapped, view.unmapped);
    assert.equal(summary.religious, view.religious);
    // Builder outputs logical groups, never raw stored rows: ten stored rows,
    // five survive the visibility filter, three merge into one Star Vijay card.
    assert.equal(view.totalVariants, 5);
    assert.equal(view.visibleLogical.length, 2);
  });
  check('view builder primitives: doc mapping, visibility rule, groups and counts', () => {
    const flat = toFlatChannel({ name: 'Sun TV', url: 'https://e.test/sun.m3u8', catalogs: [{ catalogId: 'main' }] });
    assert.equal(flat.playable, true); // missing field defaults to playable
    assert.deepEqual(flat.catalogIds, ['main']);
    assert.equal(isVisibleFlatChannel(flat), true);
    assert.equal(isVisibleFlatChannel({ ...flat, hidden: true }), false);
    assert.equal(isVisibleFlatChannel({ ...flat, playable: false }), false);
    const groups = buildLogicalGroups([
      flat,
      toFlatChannel({ channelId: 'sun2', name: 'Sun TV HD', url: 'https://e.test/sun2.m3u8', catalogs: [{ catalogId: 'main' }] }),
    ]);
    assert.equal(groups.length, 1); // merged into one logical card
    assert.deepEqual(catalogIdsForGroup(groups[0]), ['main']);
    const counts = Object.fromEntries(countCatalogs(groups).map((entry) => [entry.id, entry.count]));
    assert.equal(counts.main, 1);
  });
}

console.log('16. source-native group browse (feed group-title, read-only)');
{
  const rows = [
    { channelId: 'p1', category: 'Local Channels' },
    { channelId: 'p2', category: 'Local Channels' },
    { channelId: 'p3', category: 'Overseas' },
    { channelId: 'p4' }, // missing category defaults to Live
    { channelId: 'p5', category: '   ' },
    { channelId: 'p6', category: 'Tamil FM Radio' },
  ];
  const groups = summarizeSourceGroups(rows);
  check('"all" leads with the total row count', () => {
    assert.equal(groups[0].id, 'all');
    assert.equal(groups[0].count, 6);
  });
  check('distinct feed groups counted as stored rows, biggest first then A–Z', () => {
    const rest = groups.slice(1);
    assert.deepEqual(rest.map((g) => g.id), ['Live', 'Local Channels', 'Overseas', 'Tamil FM Radio']);
    assert.deepEqual(rest.map((g) => g.count), [2, 2, 1, 1]);
  });
  check('blank/missing categories fold into "Live", never throw', () => {
    const live = groups.find((g) => g.id === 'Live');
    assert.equal(live.count, 2);
    assert.deepEqual(summarizeSourceGroups([]), [{ id: 'all', label: 'All source groups', count: 0 }]);
  });
}

finish();
