import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSubtitleTrack,
  inferSubtitleMeta,
  looksLikeSubtitleFile,
  releaseSubtitleTrack,
  shiftVttCues,
  srtToVtt,
  subtitleStyleToCss,
  toWebVttText,
} from '../lib/player/subtitles.js';

const SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  '<i>Hello</i> world',
  '',
  '2',
  '00:00:05,500 --> 00:00:08,250',
  'Bye {\\an8}there',
].join('\r\n');

test('SRT becomes WebVTT, styling noise is stripped', () => {
  const vtt = srtToVtt(SRT);
  assert.match(vtt, /^WEBVTT\n\n/);
  assert.match(vtt, /00:00:01\.000 --> 00:00:04\.000\nHello world/);
  assert.match(vtt, /00:00:05\.500 --> 00:00:08\.250\nBye there/);
  assert.doesNotMatch(vtt, /<i>|\\an8/);
});

test('BOM, missing blank lines and glued index lines all survive', () => {
  assert.match(srtToVtt(`\uFEFF${SRT}`), /^WEBVTT/);

  const cramped = ['1', '00:00:01,000 --> 00:00:02,000', 'first', '2', '00:00:03,000 --> 00:00:04,000', 'second'].join('\n');
  const converted = srtToVtt(cramped);
  assert.match(converted, /00:00:01\.000 --> 00:00:02\.000\nfirst/);
  assert.match(converted, /00:00:03\.000 --> 00:00:04\.000\nsecond/);
  assert.doesNotMatch(converted, /first\n2/, 'cue text must not swallow the next cue index');

  const glued = '1 00:00:01,000 --> 00:00:02,000\nhi';
  assert.match(srtToVtt(glued), /00:00:01\.000 --> 00:00:02\.000\nhi/);
});

test('an already-VTT payload is passed through with a header', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello';
  assert.equal(srtToVtt(vtt), vtt);
  assert.match(srtToVtt('  \n'), /^WEBVTT\n\n$/);
  assert.equal(toWebVttText('sub.vtt', SRT), srtToVtt(SRT));
});

test('subtitle delay shifts cue timings, in both directions, never below zero', () => {
  const vtt = srtToVtt(SRT);

  const later = shiftVttCues(vtt, 1500);
  assert.match(later, /00:00:02\.500 --> 00:00:05\.500/);
  assert.match(later, /00:00:07\.000 --> 00:00:09\.750/);
  assert.match(later, /Hello world/, 'cue text untouched');

  const earlier = shiftVttCues(vtt, -2000);
  assert.match(earlier, /00:00:00\.000 --> 00:00:02\.000/, 'clamped at zero');
  assert.match(earlier, /00:00:03\.500 --> 00:00:06\.250/);

  assert.equal(shiftVttCues(vtt, 0), vtt, 'a zero delay must not rewrite the file');
  assert.equal(shiftVttCues('', 500), '');
});

test('shifting shifted text drifts, which is why the engine re-shifts the source', () => {
  const vtt = srtToVtt(SRT);
  const once = shiftVttCues(vtt, 500);
  // 1.000 → 1.500 → 1.001 ms: chained shifts lose the original precision.
  assert.notEqual(shiftVttCues(once, -499), vtt);
  // Re-deriving from the source is deterministic, so repeated nudges cannot drift.
  assert.equal(shiftVttCues(vtt, 500), once);
  assert.equal(shiftVttCues(vtt, 500), once);
});

test('filename parsing for the import drop zone', () => {
  assert.equal(looksLikeSubtitleFile('movie.en.srt'), true);
  assert.equal(looksLikeSubtitleFile('movie.ssa'), true);
  assert.equal(looksLikeSubtitleFile('movie.mp4'), false);
  // 'forced' is a packaging word, not a track name — it must not become the label.
  assert.deepEqual(inferSubtitleMeta('Movie.en.forced.srt'), { label: 'Movie', lang: 'en' });
  assert.equal(inferSubtitleMeta('Spanish.subs').lang, 'en', 'an unknown language falls back to en');
  assert.equal(inferSubtitleMeta('Movie.jp.subs').label, 'Movie');
});

test('a file with no usable cues is refused with a message, never a throw', () => {
  const track = createSubtitleTrack({ name: 'broken.srt' }, 'this is not a subtitle file');
  assert.equal(track.ok, false);
  assert.match(track.reason, /broken\.srt/);

  const good = createSubtitleTrack({ name: 'Movie.en.srt' }, SRT);
  assert.equal(good.ok, true);
  assert.equal(good.lang, 'en');
  assert.equal(good.label, 'Movie');
  assert.match(good.vtt, /^WEBVTT/);
  assert.match(good.url, /^blob:/, 'the cue blob is what the player element is handed');
  assert.doesNotThrow(() => releaseSubtitleTrack(good));
  assert.doesNotThrow(() => releaseSubtitleTrack(null));
});

test('subtitle styling becomes ::cue CSS the chrome injects', () => {
  const css = subtitleStyleToCss({ scale: 1.4, background: 0.5, outline: false, y: 4 });
  assert.match(css, /font-size: 140%/);
  assert.match(css, /rgba\(0,0,0,0\.50\)/);
  assert.match(css, /translateY\(4vh\)/);
  assert.doesNotMatch(css, /text-shadow/);
  assert.doesNotMatch(subtitleStyleToCss({ background: 0 }), /background/, 'no box when the user turned it off');
});
