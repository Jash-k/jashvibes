import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildClearKeys,
  buildPocketProxyUrl,
  createLiveTvPolicy,
  isPocketChannel,
  resolveJioAccess,
  restorePocketProxyUri,
} from '../lib/player/policy/liveTv.js';
import {
  buildDrmConfig,
  createDirectPolicy,
  createStreamPolicy,
  getDashDefaultKeyIds,
} from '../lib/player/policy/stream.js';

const hex = (value) => Buffer.from(value, 'hex');
const KID = '000102030405060708090a0b0c0d0e0f';
const KEY = '0f11120207090a0d008e0f1212020008';
const JIO_URL = 'https://jiotvmblive.cdn.jio.com/bps_live/feed/master.m3u8';
const LIVE_URL = 'https://d3qepbxk4p0vqt.cloudfront.net/hin/news/master.m3u8';

const VALID_TOKEN = '__hdnea__=st=1700000000~exp=9999999999~acl=/*~hmac=deadbeefdeadbeefdeadbeefdeadbeef';

function fetchJson(payload, { ok = true } = {}) {
  return async () => ({ ok, status: ok ? 200 : 500, json: async () => payload, text: async () => JSON.stringify(payload) });
}

function fetchText(text, { ok = true } = {}) {
  return async () => ({ ok, status: ok ? 200 : 404, text: async () => text, json: async () => ({}) });
}

// --------------------------------------------------------------------- ClearKey

test('ClearKey records are parsed from every shape the app has stored', () => {
  assert.deepEqual(buildClearKeys({ licenseKey: `${KID}:${KEY}` }), { [KID]: KEY });
  assert.deepEqual(buildClearKeys({ keyId: KID, key: KEY }), { [KID]: KEY });
  assert.deepEqual(buildClearKeys({ keyId: '00010203-0405-0607-0809-0a0b0c0d0e0f', key: KEY }), { [KID]: KEY });
  assert.deepEqual(buildClearKeys({ licenseKey: 'https://license.example/widevine' }), {}, 'a URL is not a ClearKey pair');
  assert.deepEqual(buildClearKeys({}), {});
});

test('base64url key material is decoded, and non-16-byte junk is dropped', async () => {
  const kidB64 = hex(KID).toString('base64url');
  const keyB64 = hex(KEY).toString('base64url');

  const fromJson = await buildDrmConfig(
    { licenseKey: JSON.stringify({ keys: [{ kid: kidB64, k: keyB64 }] }), url: 'https://a/x.mp4' },
    { expandDashKids: false },
  );
  assert.deepEqual(fromJson, { clearKeys: { [KID]: KEY } });

  const dashed = await buildDrmConfig({ keyId: `00010203-0405-0607-0809-0a0b0c0d0e0f`, key: KEY, url: 'https://a/x.mp4' }, { expandDashKids: false });
  assert.deepEqual(dashed, { clearKeys: { [KID]: KEY } });

  // 15 bytes is not a ClearKey — feeding it to the CDM produces a confusing 6008.
  const junk = await buildDrmConfig({ licenseKey: JSON.stringify({ keys: [{ kid: 'ERITRqxzDIM', k: 'DxESAgcJCg0ADg8SEgIA' }] }), url: 'https://a/x.mp4' }, { expandDashKids: false });
  assert.deepEqual(junk, {});

  const widevine = await buildDrmConfig({ licenseKey: 'https://lic.example/wv', url: 'https://a/x.mp4' }, { expandDashKids: false });
  assert.deepEqual(widevine, { servers: { 'com.widevine.alpha': 'https://lic.example/wv' } });

  const none = await buildDrmConfig({ url: 'https://a/x.mp4' });
  assert.deepEqual(none, {});
});

test('DASH default_KID values inherit the one key we do have', async () => {
  const manifest = '<MPD><ContentProtection cenc:default_KID="11111111-1111-1111-1111-111111111111" /><ContentProtection cenc:default_KID="22222222-2222-2222-2222-222222222222" /></MPD>';
  const ids = await getDashDefaultKeyIds('https://a/x.mpd', { fetchImpl: fetchText(manifest) });
  assert.deepEqual(ids, ['11111111111111111111111111111111', '22222222222222222222222222222222']);
  assert.deepEqual(await getDashDefaultKeyIds('https://a/x.m3u8', { fetchImpl: fetchText(manifest) }), [], 'non-MPD URLs are not fetched');
  assert.deepEqual(await getDashDefaultKeyIds('https://a/x.mpd', { fetchImpl: fetchText('nope', { ok: false }) }), [], 'a failed fetch is not fatal');

  const expanded = await buildDrmConfig(
    { licenseKey: `${KID}:${KEY}`, url: 'https://a/x.mpd' },
    { fetchImpl: fetchText('<MPD cenc:default_KID="33333333333333333333333333333333"></MPD>') },
  );
  assert.deepEqual(Object.keys(expanded.clearKeys).sort(), [KID, '33333333333333333333333333333333']);
  assert.equal(expanded.clearKeys['33333333333333333333333333333333'], KEY);
});

// ------------------------------------------------------------------- stream policy

test('createStreamPolicy resolves a VOD record into a declarative source', async () => {
  const policy = createStreamPolicy({
    url: 'https://cdn.example.com/movie.mp4',
    format: 'direct',
    licenseKey: `${KID}:${KEY}`,
    referer: 'https://retrox.example/',
    headers: { 'X-Test': '1', Cookie: 'stale=yes', 'User-Agent': 'forbidden-in-browser' },
  });
  assert.equal(policy.name, 'vod-stream');
  assert.equal(policy.loadTimeoutMs, 25_000);
  assert.equal(policy.hasRecovery(), false);

  const source = await policy.resolve({});
  assert.equal(source.url, 'https://cdn.example.com/movie.mp4');
  assert.equal(source.kind, 'direct');
  assert.equal(source.live, false);
  assert.equal(source.hasDrm, true);
  assert.deepEqual(source.drm, { clearKeys: { [KID]: KEY } });
  assert.equal(typeof source.http.requestFilter, 'function');

  const request = { headers: {} };
  source.http.requestFilter(1, request);
  assert.equal(request.headers.Referer, 'https://retrox.example/');
  assert.equal(request.headers['X-Test'], '1');
  assert.equal(request.headers.Cookie, undefined, 'a stored Cookie header must never win');
  assert.equal(request.headers['User-Agent'], undefined, 'a stored User-Agent is browser-forbidden and is ignored');
});

test('createDirectPolicy covers Stremio/Mirchi/sports files and refuses empty URLs', async () => {
  const policy = createDirectPolicy('https://a/movie.720p.mkv', { streamType: 'video', label: 'Mirror A' });
  const source = await policy.resolve({});
  assert.equal(source.kind, 'direct');
  assert.deepEqual(source.drm, {});
  assert.equal(source.hasDrm, false);
  assert.deepEqual(source.http, {}, 'no header injection for plain files');
  assert.equal(source.meta.label, 'Mirror A');

  const empty = createDirectPolicy('');
  await assert.rejects(empty.resolve({}), (error) => {
    assert.equal(error.retriable, false);
    assert.match(error.message, /No playable URL/);
    return true;
  });

  const live = createDirectPolicy('https://a/master.m3u8', { live: true });
  assert.equal((await live.resolve({})).live, true);
});

// ------------------------------------------------------------------ live TV bits

test('Pocket channels proxy through the server and restore their real URI', () => {
  assert.equal(isPocketChannel({ sourceId: 'pocket-tamil' }), true);
  assert.equal(isPocketChannel({ source: 'Pocket Tamil' }), true);
  assert.equal(isPocketChannel({ source: 'JioTV' }), false);

  const uri = 'https://content.jio.com/a/b.m3u8?token=x';
  const proxied = buildPocketProxyUrl(uri, { userAgent: 'UA', referer: 'https://ref/', cookie: 'ck=1' });
  assert.match(proxied, /^\/api\/live-pocket\/proxy\?u=/);
  assert.equal(new URL(proxied, 'http://localhost').searchParams.get('u'), uri);
  assert.equal(new URL(proxied, 'http://localhost').searchParams.get('ref'), 'https://ref/');
  assert.equal(restorePocketProxyUri(proxied, 'http://localhost'), uri);
  assert.equal(restorePocketProxyUri(uri, 'http://localhost'), uri, 'foreign URLs are returned untouched');
});

test('the Jio token resolution order is: local override, channel-scoped token, API, stale', async () => {
  const viaApi = await resolveJioAccess({ url: JIO_URL }, { fetchImpl: fetchJson({ cookie: VALID_TOKEN, playbackUrl: JIO_URL, scoped: true }) });
  assert.equal(viaApi.source, 'api');
  assert.equal(viaApi.cookie, VALID_TOKEN);
  assert.equal(viaApi.scoped, true);

  const stale = await resolveJioAccess({ url: JIO_URL }, { fetchImpl: fetchJson({}, { ok: false }) });
  assert.equal(stale.source, 'stale-channel');
  assert.equal(stale.cookie, '');

  const broken = await resolveJioAccess({ url: JIO_URL }, { fetchImpl: null });
  assert.equal(broken.cookie, '');

  // A scoped channel cookie (acl pinned to this channel) is used without a fetch.
  const scopedToken = '__hdnea__=st=1700000000~exp=9999999999~acl=/bpk-tv/*~hmac=deadbeef';
  const direct = await resolveJioAccess({ url: JIO_URL, cookie: scopedToken }, { fetchImpl: () => { throw new Error('should not fetch'); } });
  assert.equal(direct.source, 'channel');
  assert.equal(direct.scoped, true);
});

test('live policies: one config for every surface, and both forks agree', async () => {
  const jio = createLiveTvPolicy({ name: 'News', url: JIO_URL, clearKey: '' });
  assert.equal(jio.name, 'live-tv');
  assert.equal(jio.live, true);
  assert.equal(jio.needsMuxjs, true, 'raw-TS feeds need window.muxjs for Shaka');
  assert.equal(jio.loadTimeoutMs, 30_000);
  assert.equal(jio.playerConfig.streaming.bufferingGoal, 10, 'the main page and the service preview must not drift');
  assert.equal(jio.playerConfig.manifest.defaultPresentationDelay, 5);
  assert.equal(jio.playerConfig.streaming.lowLatencyMode, true);
  assert.equal(jio.playerConfig.abr.switchInterval, 1);

  const plain = createLiveTvPolicy({ name: 'News 24x7', url: LIVE_URL });
  assert.equal(plain.loadTimeoutMs, 20_000);
  const source = await plain.resolve({});
  assert.equal(source.live, true);
  assert.equal(source.kind, 'auto');
  assert.equal(source.allowNativeHls, true);
  assert.deepEqual(source.drm, {});
  assert.equal(source.meta.jio, false);
  assert.equal(source.meta.channel, 'News 24x7');
  assert.equal(typeof source.http.requestFilter, 'function');
  assert.equal(typeof source.http.responseFilter, 'function');
});

test('a Jio channel with no usable token fails with the refresh action, not a spinner', async () => {
  const policy = createLiveTvPolicy({ name: 'X', url: JIO_URL }, { fetchImpl: fetchJson({}, { ok: false }) });
  await assert.rejects(policy.resolve({}), (error) => {
    assert.equal(error.kind, 'drm');
    assert.equal(error.action, 'refresh-token');
    assert.match(error.message, /Live Service/);
    return true;
  });
});

test('the Jio token is appended to the manifest URL, or proxied once recovery runs', async () => {
  const fetchImpl = fetchJson({ cookie: VALID_TOKEN, playbackUrl: JIO_URL, scoped: false });
  const policy = createLiveTvPolicy({ name: 'X', url: JIO_URL }, { fetchImpl });

  const first = await policy.resolve({});
  assert.match(first.url, /__hdnea__=st=/, 'direct playback carries the token on the URL');
  assert.doesNotMatch(first.url, /^\/api\/live-jio/);

  const request = { headers: {}, uris: [JIO_URL] };
  first.http.requestFilter(1, request, { url: JIO_URL, kind: 'hls' });
  assert.match(request.uris[0], /__hdnea__=st=/, 'every segment needs the token too (Stream4Liv)');
  assert.equal(request.headers.Referer, undefined, 'the browser cannot set Referer for Jio hosts');

  const recovery = await policy.recover({ error: { code: 1001 } });
  assert.equal(recovery.retry, 'reload');
  assert.match(recovery.message, /secure route/);
  assert.equal(policy.hasRecovery(), false, 'one trick, then we stop lying about recovering');

  const second = await policy.resolve({ force: true });
  assert.match(second.url, /^\/api\/live-jio\?u=/, 'after recovery the manifest rides the server proxy');
  const proxied = { headers: {}, uris: [JIO_URL] };
  second.http.requestFilter(1, proxied, { url: JIO_URL, kind: 'hls' });
  assert.match(proxied.uris[0], /^\/api\/live-jio\?u=/);
  const response = { uri: second.url, headers: new Map(), body: null, data: null };
  second.http.responseFilter(1, response);
  assert.equal(response.uri.startsWith('http'), true, 'the response filter must restore the real URI for relative resolution');
});

test('Pocket channels try direct playback first, then the proxy', async () => {
  const channel = { name: 'Sun News', url: LIVE_URL, sourceId: 'pocket-tamil', referer: 'https://ref/' };
  const policy = createLiveTvPolicy(channel);
  const source = await policy.resolve({});
  assert.equal(source.meta.pocket, true);
  assert.equal(policy.hasRecovery(), true);

  const request = { headers: {}, uris: [LIVE_URL] };
  source.http.requestFilter(1, request, { url: LIVE_URL, kind: 'hls' });
  assert.equal(request.uris[0], LIVE_URL, 'direct first');
  assert.equal(request.headers.Referer, 'https://ref/');

  const step = await policy.recover({ error: { code: 1002 } });
  assert.match(step.message, /Pocket proxy/);

  const after = await policy.resolve({});
  const proxied = { headers: {}, uris: [LIVE_URL] };
  after.http.requestFilter(1, proxied, { url: LIVE_URL, kind: 'hls' });
  assert.match(proxied.uris[0], /^\/api\/live-pocket\/proxy\?u=/);
  assert.equal(proxied.headers.Referer, undefined, 'the proxy sets Referer server-side');
  assert.equal(proxied.headers['User-Agent'], undefined);
  assert.equal(await policy.recover({ error: {} }), null, 'and then there is nothing left to try');
  assert.equal(policy.hasRecovery(), false);
});

test('non-live channels keep their stored headers but never a stale Cookie', async () => {
  const policy = createLiveTvPolicy({
    name: 'Geo News',
    url: LIVE_URL,
    headers: { Cookie: 'old=1', Origin: 'https://geo.tv', 'X-Extra': 'v' },
  });
  const source = await policy.resolve({});
  const request = { headers: {}, uris: [LIVE_URL] };
  source.http.requestFilter(1, request, { url: LIVE_URL, kind: 'hls' });
  assert.equal(request.headers.Cookie, undefined);
  assert.equal(request.headers.Origin, 'https://geo.tv');
  assert.equal(request.headers['X-Extra'], 'v');
});
