#!/usr/bin/env node
/**
 * scripts/live/test-catalog-rules.mjs — split from the former test-live-catalogs.mjs megatest (phase 0).
 * Pure contracts, no database.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-catalog-rules.mjs
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

const { check, finish } = makeHarness('scripts/live/test-catalog-rules.mjs');

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

console.log('4. LocalCH excludes religious; religious excluded everywhere');
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

console.log('17. /live order mirrors Admin reorder inside every fixed catalog');
{
  // Hand-built groups shaped like deduplicateChannels output.
  const group = (id, name, mainPosition, extra = []) => ({
    logicalId: id,
    displayName: name,
    variants: [
      { channelId: `${id}-v1`, catalogs: mainPosition == null ? [...extra] : [{ catalogId: 'main', position: mainPosition }, ...extra] },
    ],
  });
  // Admin put a long-tail channel first in Main, Sun second, Vijay third —
  // the opposite of the family-first ranking.
  const groups = [
    group('vijay', 'Star Vijay', 300),
    group('sun', 'Sun TV', 200),
    group('madurai', 'Madurai Vision', 100, [{ catalogId: 'local', position: 100 }]),
  ];
  check('fixed-catalog order follows stored positions, not family rank', () => {
    const ordered = sortLogicalGroups(groups, 'main').map((g) => g.logicalId);
    assert.deepEqual(ordered, ['madurai', 'sun', 'vijay']);
  });
  check('groupCatalogPosition reads the lowest variant membership position', () => {
    const multi = {
      variants: [
        { catalogs: [{ catalogId: 'main', position: 400 }, { catalogId: 'news', position: 50 }] },
        { catalogs: [{ catalogId: 'main', position: 250 }] },
      ],
    };
    assert.equal(groupCatalogPosition(multi, 'main'), 250);
    assert.equal(groupCatalogPosition(multi, 'news'), 50);
    assert.equal(groupCatalogPosition({ variants: [] }, 'main'), 999999);
  });
  check('other catalogs also follow their own admin positions', () => {
    const localOnly = [
      group('a', 'Vasanth TV', null, [{ catalogId: 'local', position: 300 }]),
      group('b', 'Murasu TV', null, [{ catalogId: 'local', position: 100 }]),
    ];
    assert.deepEqual(sortLogicalGroups(localOnly, 'local').map((g) => g.logicalId), ['b', 'a']);
  });
  check('All Tamil view stays family-first regardless of positions', () => {
    const ordered = sortLogicalGroups(groups, 'all').map((g) => g.logicalId);
    assert.deepEqual(ordered, ['vijay', 'sun', 'madurai']);
  });
  check('equal positions fall back to family rank then name', () => {
    const tied = [
      group('z', 'Zee Tamil', 100),
      group('j', 'Jaya TV', 100),
      group('v2', 'Vijay Takkar', 100),
    ];
    assert.deepEqual(sortLogicalGroups(tied, 'main').map((g) => g.logicalId), ['v2', 'j', 'z']);
  });
}


finish();
