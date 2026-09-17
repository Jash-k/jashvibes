import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSourceList,
  fmtClock,
  fmtSize,
  fmtTime,
  heightFromLabel,
  parseUrlSourceLabel,
  warnForSource,
} from '../lib/player/labels.js';

test('time formatting is stable across the surfaces', () => {
  assert.equal(fmtTime(0), '0:00');
  assert.equal(fmtTime(9.4), '0:09');
  assert.equal(fmtTime(75), '1:15');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(-5), '0:00', 'a negative DVR offset must not print -0:05');
  assert.equal(fmtTime(NaN), '0:00');
  assert.equal(fmtTime(undefined), '0:00');
  assert.equal(fmtClock(75), '00:01:15');
  assert.equal(fmtClock(NaN), '—');
});

test('sizes are readable before a 12 GB remux is committed to', () => {
  assert.equal(fmtSize(0), '');
  assert.equal(fmtSize(-1), '');
  assert.equal(fmtSize(512), '512 B');
  assert.equal(fmtSize(1500), '1.5 KB');
  assert.equal(fmtSize(2.9 * 1024 * 1024 * 1024), '2.9 GB');
  assert.equal(fmtSize(10 * 1024 * 1024), '10 MB');
});

test('release names embedded in Telegram/Stremio URLs are decoded for display', () => {
  assert.equal(parseUrlSourceLabel('https://x/Thalaivan.1080p.WEBRip.x264.2.9GB.ESub.mkv'), '1080p 2.9GB');
  assert.equal(parseUrlSourceLabel('https://x/Movie%20Name.2160p.HDR.mkv'), '2160p', 'literal height is kept; only 4K/UHD become “4K”');
  assert.equal(parseUrlSourceLabel('https://x/movie.720p.x264.mkv'), '720p');
  assert.equal(parseUrlSourceLabel('https://x/Show.S01E02.1080p.600MB.mkv'), '1080p 600MB');
  assert.equal(parseUrlSourceLabel('https://x/Movie.x265.4K.12.5GB.mkv'), '4K 12.5GB');
  assert.equal(parseUrlSourceLabel('https://x/movie.mp4'), '', 'no label invented from nothing');
  assert.equal(heightFromLabel('1080p'), 1080);
  assert.equal(heightFromLabel('4K'), 2160);
  assert.equal(heightFromLabel('UHD HDR'), 2160);
  assert.equal(heightFromLabel(''), 0);
});

test('the source picker never shows a bare URL when a label exists', () => {
  const list = buildSourceList({
    urls: ['https://a/first.mp4', 'https://b/Movie.720p.x264.1.2GB.mkv', ''],
    streams: [{ url: 'https://a/first.mp4', title: 'NF', quality: '1080p', name: 'WEB-DL' }],
  });
  assert.equal(list.length, 2, 'empty urls are dropped');
  assert.equal(list[0].label, 'NF • WEB-DL • 1080p', 'meta pieces are joined in the resolver’s own order');
  assert.equal(list[1].label, '720p 1.2GB', 'falls back to the release name in the URL, not “264.1.2GB”');
  assert.equal(list[1].index, 1);

  const unnamed = buildSourceList({ urls: ['https://a/bbbb'] });
  assert.equal(unnamed[0].label, 'Source 1');

  const custom = buildSourceList({
    urls: ['https://a/bbbb'],
    labelFor: (url, index) => (index === 0 ? 'Mirror A' : ''),
  });
  assert.equal(custom[0].label, 'Mirror A');
});

test('codec warnings fire before playback is chosen, not after it fails', () => {
  const hevc = warnForSource({ label: 'Movie 2024 x265 10-bit' });
  assert.equal(hevc.risky, true);
  assert.deepEqual(hevc.tags, ['HEVC']);
  assert.match(hevc.notes[0], /may not decode/);

  assert.deepEqual(warnForSource({ url: 'https://a/movie.mp4' }).tags, []);
  assert.equal(warnForSource({ label: 'h264 aac' }).risky, false);
  assert.deepEqual(warnForSource({ title: 'DTS-HD MA 7.1 Atmos' }).tags, ['DTS/TrueHD']);
  assert.deepEqual(warnForSource({ name: 'DDP 5.1 track' }).tags, ['E-AC3']);
  assert.deepEqual(warnForSource({ url: 'https://a/movie.mkv' }).tags, ['Matroska']);
  assert.deepEqual(
    warnForSource({ label: '1080p HEVC', title: 'x265 remux', name: 'movie.mkv' }).tags.sort(),
    ['HEVC', 'Matroska'],
    'multiple hits are all reported',
  );
});
