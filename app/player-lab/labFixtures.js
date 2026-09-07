/**
 * Player-lab fixtures.
 *
 * A deliberately small catalogue that touches every branch of the unified
 * player: plain file, container the browser cannot play natively, VOD HLS,
 * live HLS, DASH with selectable audio/subtitle tracks, a DRM-configured
 * stream and a fake "Jio" channel whose only purpose is to fail (so the error
 * mapping and the recovery ladder are visible without a live feed).
 *
 * Nothing here is fetched at build time; the URLs are only requested when a
 * card's Play button is pressed.
 */

export const LAB_FIXTURES = [
  {
    id: 'mp4',
    name: 'MP4 · plain file',
    expect: 'No engine: <video> plays it. Seek bars, PiP and resume must all work.',
    source: {
      url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
      label: '720p · 1 MB',
      sizeBytes: 1_048_576,
    },
  },
  {
    id: 'mkv',
    name: 'MKV · container the browser may refuse',
    expect: 'Either plays natively or lands on the error card saying "Matroska" — never a black rectangle.',
    source: {
      url: 'https://test-videos.co.uk/vids/sintel/mkv/h264/1080/Sintel_1080_10s_5MB.mkv',
      label: '1080p 5MB',
    },
    warn: true,
  },
  {
    id: 'hls-vod',
    name: 'HLS · VOD (Mux test stream)',
    expect: 'Shaka on Chromium/Firefox, native <video> on Safari. Quality menu lists real variants.',
    source: { url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: '5 variants' },
  },
  {
    id: 'hls-live',
    name: 'HLS · live edge',
    expect: 'LIVE badge instead of a timeline when the seek range is short; "Back to live" when it is DVR.',
    source: { url: 'https://test-streams.mux.dev/pts_shift/master.m3u8', label: 'Live' },
    live: true,
  },
  {
    id: 'dash-multi',
    name: 'DASH · multi-audio + subtitles (Sintel)',
    expect: 'Audio and subtitle menus list every track. Drop an .srt/.vtt file on the player to test the delay + shading controls.',
    source: { url: 'https://storage.googleapis.com/shaka-demo-assets/sintel/dash.mpd', label: '16 langs' },
  },
  {
    id: 'clearkey',
    name: 'DASH · ClearKey (bad key on purpose)',
    expect: 'Shaka rejects the key → error card offers "Play without DRM" and the retry ladder drops the keys.',
    source: { url: 'https://storage.googleapis.com/shaka-demo-assets/sintel/dash.mpd', label: 'ClearKey' },
    // Shaped like a ReTro stream record: `licenseKey` is the "kid:key" pair the
    // catalogue stores, deliberately wrong so the DRM path is exercised.
    drm: { licenseKey: '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef' },
  },
  {
    id: 'jio-missing-token',
    name: 'Live policy · Jio channel with no token',
    expect: 'Fails during resolve() with action "refresh-token", not a generic playback error.',
    source: { url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: 'Fake Jio' },
    channel: {
      id: 'lab-jio',
      name: 'Lab Jio Channel',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      cookie: '',
    },
    livePolicy: true,
    live: true,
  },
  {
    id: 'dead-host',
    name: 'Unreachable host',
    expect: 'Network error → auto-retry ladder runs once, then a retriable error card with Copy URL.',
    source: { url: 'https://127.0.0.1:9/nope.mp4', label: 'Refused' },
  },
];

/** Fixtures that are also usable as a "lineup" (rotate-source) test. */
export const LAB_LINEUP = [
  { url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4', label: 'Mirror A · 720p' },
  { url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', label: 'Mirror B · Google sample' },
  { url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: 'Mirror C · HLS' },
];
