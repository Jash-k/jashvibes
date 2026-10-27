/**
 * scripts/live/test-v2-feed.mjs — pure contracts for the V2 fast source.
 * No network, no DB: feed normalization, owner category order, token attach,
 * reference-HTML parsing and the Shaka fast profile.
 *   node --import ./scripts/alias-register.mjs scripts/live/test-v2-feed.mjs
 */
import assert from 'node:assert/strict';
import {
  V2_SOURCE_ID,
  detectFormat,
  isJioHost,
  normalizeV2Rows,
  orderedCategories,
  groupV2Channels,
  appendHdnea,
  parsePlugxHtml,
  V2_FAST_PROFILE,
} from '@/lib/live/v2/feed';

let passed = 0;
const ok = (cond, label) => { assert.ok(cond, label); passed += 1; };

// ---- normalization -------------------------------------------------------
const rows = [
  { id: 143, name: 'CNBC TV18 Prime', category: 'English', url: 'https://jiotvmblive.cdn.jio.com/bpk-tv/X/WDVLive/index.mpd', keyId: 'ABC', key: 'DEF', logo: 'https://img/l.png' },
  { id: '500', name: 'Star Vijay HD', category: 'Tamil', url: 'https://jiotvpllive.cdn.jio.com/bpk-tv/Y/HLSPartner/index.m3u8', keyId: 'aa', key: 'bb' },
  { id: 143, name: 'duplicate', category: 'English', url: 'https://jiotvmblive.cdn.jio.com/dup.mpd' }, // deduped
  { id: 999, name: 'no url', category: 'News' }, // dropped
];
const records = normalizeV2Rows(rows);
assert.equal(records.length, 2, 'duplicate id dropped and url-less row dropped');
ok(records[0].v2Id === `${V2_SOURCE_ID}:143`, 'stable v2 id namespacing');
ok(records[0].format === 'dash' && records[1].format === 'hls', 'format detection from URL');
ok(records[1].keyId === 'aa' && records[1].key === 'bb', 'clearkey pair preserved');
ok(normalizeV2Rows(null).length === 0, 'null/garbage input never throws');

// ---- category order: Tamil, Sports, Kids, English first, then A–Z --------
const ordered = orderedCategories([
  { category: 'Zulu' }, { category: 'English' }, { category: 'Tamil' },
  { category: 'Kids' }, { category: 'Movies' }, { category: 'Sports' },
]);
assert.deepEqual(ordered, ['Tamil', 'Sports', 'Kids', 'English', 'Movies', 'Zulu']);
passed += 1;

// ---- grouping -------------------------------------------------------------
const groups = groupV2Channels(records);
assert.deepEqual(groups.map((g) => g.name), ['Tamil', 'English'], 'owner head order puts Tamil first; English follows in the A–Z remainder');
ok(groups[0].channels[0].name === 'Star Vijay HD', 'channels inside a group sort A–Z');
ok(groups[0].count === 1 && groups[1].count === 1, 'group counts');

// ---- token attach ----------------------------------------------------------
const token = '__hdnea__=st=1~exp=2~acl=/*~hmac=abc';
ok(appendHdnea('https://jiotvmblive.cdn.jio.com/a/index.mpd', token).includes('?' + token), 'token appended to Jio manifest');
ok(appendHdnea('https://jiotvmblive.cdn.jio.com/a/index.mpd?x=1', token).includes('&' + token), 'token joined with & when query exists');
ok(appendHdnea('https://other.example.com/a.mpd', token) === 'https://other.example.com/a.mpd', 'non-Jio hosts untouched');
ok(appendHdnea('https://jiotvmblive.cdn.jio.com/a.mpd?' + token, token).includes(token) &&
   appendHdnea('https://jiotvmblive.cdn.jio.com/a.mpd?' + token, token).split(token).length === 2, 'never double-append');
ok(appendHdnea('https://jiotvmblive.cdn.jio.com/a.mpd', '') === 'https://jiotvmblive.cdn.jio.com/a.mpd', 'empty token is a no-op');
ok(isJioHost('https://d1g8wgjurz8via.cloudfront.net/x.mpd') && isJioHost('https://times-ott-live.akamaized.net/y.mpd'), 'CDN aliases count as Jio-family hosts');

// ---- reference HTML parsing -----------------------------------------------
const fixture = `
  <script>self.__push=($R[14]={id:"1132",name:"Star Plus HD",group:"Entertainment",logo:"https://jiotv.catchup.cdn.jio.com/x.png",
  user_agent:"Premium Plugx",type:"dash",mpd_url:"https://jiotvmblive.cdn.jio.com/bpk-tv/Star_Plus_HD_MOB/WDVLive/index.mpd",
  headers:$R[15]={cookie:"__hdnea__=st=1793102946~exp=1793124546~acl=/*~hmac=df9cdfb241fcd6052701aad30a7ddc78b3ac2f43a704cd2761ade587891dcbaa"},
  expires_in:null,clearkey:"c6255706bca250079aeaf1fc4474d1b9:eab6217aac6f1feec103120e6218eb43"})
  $R[17]={id:"2020",name:"Tango One",group:"Movies",logo:"",user_agent:"x",type:"dash",
  mpd_url:"https://mumt03.tangotv.in/live/index.mpd",headers:{cookie:""},expires_in:null,clearkey:"11111111111111111111111111111111:22222222222222222222222222222222"}
  garbage without a record {id:"oops"}
  </script>`;
const parsed = parsePlugxHtml(fixture);
ok(parsed.token === '__hdnea__=st=1793102946~exp=1793124546~acl=/*~hmac=df9cdfb241fcd6052701aad30a7ddc78b3ac2f43a704cd2761ade587891dcbaa', 'shared token extracted');
ok(parsed.tokenExpiry === 1793124546 * 1000, 'token expiry parsed to ms');
ok(parsed.keyMap['1132']?.keyId === 'c6255706bca250079aeaf1fc4474d1b9', 'key rotation map keyed by feed id');
ok(parsed.keyMap['2020']?.key === '22222222222222222222222222222222', 'second key parsed');
ok(parsed.extras.length === 2, 'both records surfaced as extras');
const tango = parsed.extras.find((e) => e.id === '2020');
ok(tango.format === 'dash' && tango.category === 'Movies' && tango.logo === '', 'extra record fully normalized');
ok(parsePlugxHtml('nothing here').token === '' && parsePlugxHtml('').extras.length === 0, 'empty/foreign HTML degrades gracefully');

// ---- fast profile ----------------------------------------------------------
ok(V2_FAST_PROFILE.streaming.bufferingGoal === 16, 'PlugX startup buffering goal ported');
ok(V2_FAST_PROFILE.abr.defaultBandwidthEstimate === 500_000, 'conservative mobile ABR seed ported');
ok(V2_FAST_PROFILE.streaming.retryParameters.maxAttempts === 6 && V2_FAST_PROFILE.streaming.retryParameters.timeout === 30_000, 'bounded retry ladder');
ok(detectFormat('https://x/a.m3u8?token=z') === 'hls' && detectFormat('https://x/a.mpd') === 'dash', 'detectFormat handles query strings');

console.log(`V2 feed contracts: ${passed} assertions passed.`);
