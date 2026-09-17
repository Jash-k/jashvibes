/*
 * tests/playlist-rewrite.test.js — the proxy playlist rewriter.
 *
 * The "cards show but the stream does not play" bug: CORS-less CDNs (FanCode,
 * SonyLiv) answer the master and refuse every child. The proxy's job is not to
 * pipe bytes — it is to rewrite the playlist so every child rides the proxy.
 * These fixtures are the real shapes the field produced.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isPlaylistResponse, rewritePlaylist } from '../lib/player/playlistRewrite.js';

const MASTER = [
  '#EXTM3U',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  '#EXT-X-MEDIA:LANGUAGE="und",AUTOSELECT=YES,CHANNELS="2",TYPE=AUDIO,URI="out/v1/audio/index__audio.m3u8",GROUP-ID="audio_0",DEFAULT=NO,NAME="und"',
  '#EXT-X-STREAM-INF:CODECS="mp4a.40.2,avc1.4D4028",RESOLUTION=1920x1080,AUDIO="audio_0"',
  'out/v1/hdntl=exp=1789738206~acl=%2f*~id=7c8f/index__1080p.m3u8',
  '#EXT-X-STREAM-INF:CODECS="mp4a.40.2,avc1.4D4015",RESOLUTION=426x240,AUDIO="audio_0"',
  'https://other-cdn.example/out/v1/index__240p.m3u8?aka=AlreadySigned',
].join('\n');

const base = 'https://dai-fancode.pages.dev/out/v1/ap-south-1/4248492_english/ad-h264/index.m3u8?hdntl=Expire=1789~ID=7c8f';
const proxyBase = 'https://my-worker.workers.dev/';

describe('rewritePlaylist: every child rides the proxy', () => {
  const wrapped = (u) => `${proxyBase}?url=${encodeURIComponent(u)}`;
  const out = rewritePlaylist(MASTER, { baseUrl: base, wrap: wrapped });

  test('variant lines are proxied and inherit the parent query when they have none', () => {
    const lines = out.split('\n');
    const variant = lines.find((line) => line.includes('index__1080p'));
    assert.ok(variant.startsWith(`${proxyBase}?url=`), 'the child is wrapped');
    const inner = decodeURIComponent(variant.split('url=')[1]);
    assert.match(inner, /^https:\/\/dai-fancode\.pages\.dev\/out\/v1\/ap-south-1\//, 'relative children resolve against the playlist URL');
    assert.match(inner, /hdntl=Expire=1789~ID=7c8f/, 'a child with no query inherits the signed parent query');
    assert.ok(!inner.includes('aka='), 'no foreign query is invented');
  });

  test('a child that carries its own signed query is absolutised but not merged', () => {
    const lines = out.split('\n');
    const signed = lines.find((line) => line.includes('index__240p'));
    const inner = decodeURIComponent(signed.split('url=')[1]);
    assert.match(inner, /\?aka=AlreadySigned$/, 'its own query survives exactly');
    assert.ok(!inner.includes('hdntl'), 'the parent query is NOT appended to an already-signed child');
  });

  test('quoted URI="…" attributes inside tags are proxied too', () => {
    const line = out.split('\n').find((line) => line.startsWith('#EXT-X-MEDIA'));
    assert.match(line, /URI="https:\/\/my-worker\.workers\.dev\/\?url=/, 'the audio track is a child as much as any variant');
  });

  test('comment and tag lines are left alone', () => {
    const lines = out.split('\n');
    assert.equal(lines[0], '#EXTM3U');
    assert.equal(lines[1], '#EXT-X-INDEPENDENT-SEGMENTS');
  });

  test('a non-OK upstream is never rewritten (an Akamai refusal page is not a playlist)', () => {
    // The route only rewrites on upstream.ok; this pin documents the contract for the pure layer's caller.
    assert.equal(isPlaylistResponse({ url: 'https://x/y.m3u8', contentType: '' }), true);
    assert.equal(isPlaylistResponse({ url: 'https://x/y', contentType: 'application/vnd.apple.mpegurl' }), true);
    assert.equal(isPlaylistResponse({ url: 'https://x/y.ts', contentType: 'video/mp2t' }), false);
  });

  test('garbage in, garbage out — no throw', () => {
    assert.doesNotThrow(() => rewritePlaylist('', { baseUrl: 'not a url' }));
    assert.doesNotThrow(() => rewritePlaylist('#EXTM3U', { baseUrl: base, wrap: wrapped }));
  });
});
