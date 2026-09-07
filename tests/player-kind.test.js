import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bufferedRatio,
  clampToSeekWindow,
  derivePlaybackModel,
  detectKind,
  elapsedInWindow,
  isDirectFileUrl,
  isDirectPlayerSource,
  mimeTypeFor,
  needsEngine,
  progressRatio,
  readSeekWindow,
} from '../lib/player/kind.js';

/** Minimal stand-in for the parts of HTMLMediaElement these helpers touch. */
function fakeElement({ seekable = [], duration = NaN, currentTime = 0, buffered = [] } = {}) {
  const ranges = (list) => ({
    length: list.length,
    start: (i) => list[i][0],
    end: (i) => list[i][1],
  });
  return { seekable: ranges(seekable), buffered: ranges(buffered), duration, currentTime };
}

test('detectKind: manifest URLs win over hints, and hints cover extensionless feeds', () => {
  assert.equal(detectKind('https://cdn.example.com/a/index.m3u8?token=xyz'), 'hls');
  assert.equal(detectKind('https://cdn.example.com/manifest.mpd'), 'dash');
  assert.equal(detectKind('https://cdn.example.com/movie.mp4'), 'direct');
  assert.equal(detectKind('https://cdn.example.com/live/feed'), 'direct');
  assert.equal(detectKind('https://cdn.example.com/live/feed', { streamType: 'hls' }), 'hls');
  // A Stremio URL can carry both a .mp4 extension and a live hint — the file
  // extension must not be trusted over an explicit manifest path.
  assert.equal(detectKind('https://cdn.example.com/master.m3u8/out.mp4'), 'hls');
  assert.equal(detectKind('whatever', { streamType: 'embed' }), 'embed');
});

test('isDirectPlayerSource: iframe providers are rejected, manifests and files pass', () => {
  assert.equal(isDirectPlayerSource('https://vidsrc.to/embed/movie/tt123', 'embed'), false);
  assert.equal(isDirectPlayerSource('https://a/x.mpd', ''), true);
  assert.equal(isDirectPlayerSource('https://a/x.mp4', 'direct'), true);
});

test('isDirectFileUrl + mimeTypeFor', () => {
  assert.equal(isDirectFileUrl('https://a/b/movie.mkv?x=1'), true);
  assert.equal(isDirectFileUrl('https://a/b/movie.txt'), false);
  assert.equal(isDirectFileUrl('https://a/b/segment-00012.ts'), true);
  assert.equal(mimeTypeFor('hls'), 'application/x-mpegurl');
  assert.equal(mimeTypeFor('dash'), 'application/dash+xml');
  assert.equal(mimeTypeFor('direct'), undefined);
});

test('needsEngine: DASH always, HLS only without native playback, files never', () => {
  assert.equal(needsEngine('https://a/x.mpd'), true);
  // In Node there is no document, so native HLS is unavailable → engine needed.
  assert.equal(needsEngine('https://a/x.m3u8', 'hls'), true);
  assert.equal(needsEngine('https://a/x.m3u8', 'hls', { allowNativeHls: false }), true);
  assert.equal(needsEngine('https://a/x.mp4', 'direct'), false);
});

test('readSeekWindow: seekable wins, finite duration is the fallback, Infinity is no window', () => {
  assert.deepEqual(readSeekWindow(fakeElement({ seekable: [[10, 60]] })), { start: 10, end: 60 });
  assert.deepEqual(readSeekWindow(fakeElement({ duration: 300 })), { start: 0, end: 300 });
  assert.equal(readSeekWindow(fakeElement({ duration: Infinity })), null);
  assert.equal(readSeekWindow(null), null);
  // Multiple ranges (a DVR window with a gap): first start to last end.
  assert.deepEqual(readSeekWindow(fakeElement({ seekable: [[100, 200], [210, 400]] })), { start: 100, end: 400 });
});

test('clampToSeekWindow keeps every seek inside the playable window', () => {
  const el = fakeElement({ seekable: [[0, 100]], duration: 100 });
  assert.equal(clampToSeekWindow(el, 42), 42);
  assert.equal(clampToSeekWindow(el, -5), 0);
  assert.equal(clampToSeekWindow(el, 99.9), 99.75, 'leaves 0.25 s so the element never seeks past the end');
  assert.equal(clampToSeekWindow(fakeElement({ seekable: [[1000, 1100]] }), 5), 1000);
  assert.equal(clampToSeekWindow(null, 5), null);
  assert.equal(clampToSeekWindow(el, NaN), null);
});

test('derivePlaybackModel: live-ness comes from the element, not a page flag', () => {
  const vod = fakeElement({ duration: 300, currentTime: 60 });
  const vodModel = derivePlaybackModel(vod);
  assert.equal(vodModel.live, false);
  assert.equal(vodModel.canSeek, true);
  assert.equal(vodModel.dvrSeconds, 0);

  // Infinity duration → live, even when the manifest advertises 24 h.
  const live = fakeElement({ duration: Infinity, seekable: [[1000, 1030]] });
  const liveModel = derivePlaybackModel(live);
  assert.equal(liveModel.live, true);
  assert.equal(liveModel.dvrSeconds, 30);
  assert.equal(liveModel.canSeek, false, 'a 30 s window is not worth a scrubber');

  const dvr = fakeElement({ duration: Infinity, seekable: [[1000, 4600]] });
  const dvrModel = derivePlaybackModel(dvr);
  assert.equal(dvrModel.live, true);
  assert.equal(dvrModel.dvrSeconds, 3600);
  assert.equal(dvrModel.canSeek, true);

  // A "live" channel whose manifest has a real duration is treated as VOD.
  const mislabelled = fakeElement({ duration: 7200, seekable: [[0, 7200]] });
  assert.equal(derivePlaybackModel(mislabelled).live, false);
});

test('window-relative clock helpers', () => {
  const el = fakeElement({ seekable: [[1000, 2000]], currentTime: 1250, buffered: [[1000, 1500]] });
  assert.equal(elapsedInWindow(el), 250);
  assert.equal(progressRatio(el), 0.25);
  assert.equal(bufferedRatio(el), 0.5);
  assert.equal(elapsedInWindow(fakeElement({ duration: Infinity })), 0);
  assert.equal(progressRatio(fakeElement({ duration: Infinity })), 0);
});
