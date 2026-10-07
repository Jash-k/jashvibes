# Making the jashvibes Live player play "all types of streams"

**Scope:** `/live` playback — the unified player (`components/player/JashPlayer.js`), its engine
(`components/player/usePlaybackEngine.js`), the Live policy (`lib/player/policy/liveTv.js`) and the
kind detection (`lib/player/kind.js`).
**Method:** read the real code paths, researched the 2026 browser-support facts (sources at the end),
then built and tested a router + capability probe against your real catalogue
(389 channels from `jash-live.m3u`, 42 donor playlists) with 4 simulated browsers.

---

## 1. The short answer

**Don't add "more stream types" to the player — add an engine router.** One stream class → one engine,
chosen per browser from probed capabilities, with an ordered fallback chain and an honest
"this browser can never play it" state. Four engines cover everything the catalogue can contain:

| stream | engine | who has it |
|---|---|---|
| HLS (TS or fMP4), no DRM | **native HLS** | Safari / iOS / iPadOS |
| HLS, no DRM | **Shaka** (already installed) | every MSE browser |
| DASH, with/without ClearKey | **Shaka + EME** | Chrome / Edge / Firefox / iOS 17.1+ |
| raw MPEG-TS, FLV | **mpegts.js** (new, ~35 KB) | every MSE browser, incl. iOS 17.1+ |
| mp4 / webm / mkv files | **native `<video>`** | everywhere (mkv: Chromium) |
| ClearKey on Apple devices | *nothing, honestly* — or the optional tier-3 paths | — |

That's it. There is no library that plays "all types" better than this split, because the blocker is
never the library: it's **the CDM** (Apple has no ClearKey) and **the codec** (HEVC/AC-3 need platform
decoders). A router makes those limits explicit instead of showing a broken tile.

Two facts from your own catalogue, measured, that this fixes:

| browser | playable today (planned) | why not 100% |
|---|---|---|
| Chrome / Edge (Win, HW decode) | **389 / 389 (100%)** | — |
| Firefox (Linux) | **389 / 389 (100%)** | — |
| Safari (macOS) | **297 / 389 (76%)** | 92 rows are ClearKey-encrypted DASH → no ClearKey CDM |
| iPhone (iOS 18) | **297 / 389 (76%)** | same 92 |

The 92 ClearKey channels are **24% of your curated list** (`jash-live.m3u`: `digital.m3u`, `Star.m3u`,
`jtvplus*` feed them). They can never play on an iPhone through EME — that's not a bug to fix, it's a
platform fact to design around (§6 has the three honest options).

---

## 2. What the current player does, and where it breaks

`components/player/usePlaybackEngine.js` has exactly two engines:

```js
const useShaka = needsEngine(url, kind, { allowNativeHls: … });   // kind.js
…
if (useShaka) { …shaka.load(url…) } else { el.src = url; el.load(); }
```

`lib/player/kind.js` classifies by extension only: `.mpd` → dash, `.m3u8`/`/hls/` → hls,
`.ts`/`.mp4`/`.mkv`… → "direct file", everything else → direct. Consequences:

| case | what happens now | what should happen |
|---|---|---|
| **Raw MPEG-TS** — `…/live/user/pass/1234.ts`, `live.ts?channelId=…`, `extension=ts` | kind = `direct` → `el.src = url` → **never plays in any browser** (no browser demuxes bare TS) | mpegts.js: TS → fMP4 → MSE |
| **FLV** | same | mpegts.js |
| **HEVC streams** | server health check marks them dead (`checkChannelWorking`: `proof.codec === 'hevc'` → `ok = false`) and they're filtered out | keep them: Safari/iOS play HEVC natively, Chrome plays it with a hardware decoder, mpegts.js and hls.js ≥1.6 transmux it. Persist the codec and let the **client** decide |
| **ClearKey on Safari/iOS** | Shaka loads, EME rejects the key system → error `6001 REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE` → your recovery maps it to `drop-drm` and retries without keys | retrying without keys on genuinely encrypted content cannot work; say "needs Chrome/Edge/Firefox" instead |
| **AC-3 / E-AC-3 audio** (some DTH feeds) | MSE rejects the codec → `bufferAddCodecError` → rotate source | same failure, but now with a reason the user can act on ("audio codec unsupported on this device") |
| **Manifest-without-extension** (`/mpd/1081`, `mpd.php`) | falls through to `direct` unless the path contains `/mpd/` | already mostly right; the router keeps a `probe` step for it |
| **Mid-session token expiry** (Star family: 30 min) | stall → user taps retry | plan carries `expiresAt`; engine re-resolves the channel *before* expiry |

None of this is a criticism of the existing code — it was built for VOD, where the only formats are
files, HLS and DASH. Live TV adds raw TS, ClearKey and short-lived tokens, which is exactly the
3-way split above.

---

## 3. What I built (drop-in, pure, testable)

These modules are installed in this repo (see [CHANGES-live-robustness.md](../CHANGES-live-robustness.md)
for the wiring):

```
lib/player/capabilities.js      ← probe: MSE / ManagedMediaSource / native HLS+TS /
                                  EME (ClearKey, Widevine, PlayReady, FairPlay) /
                                  codec table (h264, hevc, av1, aac, ac-3, ec-3…) /
                                  WebCodecs + WebCrypto. Cached; SSR-safe.
lib/player/streamClassifier.js  ← channel → { transport, drm, scheme, needsHeaders,
                                  expiresAt } + peekManifest(): reads the real
                                  CODECS out of an HLS master / MPD body
lib/player/liveEngine.js        ← planLivePlayback(channel, caps) → ordered steps
                                  [native | shaka | mpegts | webcodecs] × [direct | headers | jio],
                                  or an `unsupported` verdict with an actionable hint
```

The coverage/codec harnesses run under plain Node and ship in the separate
`live-player-robustness` kit (`harness/matrix.mjs`, `harness/peek.mjs`).

Design rules it follows, matching your codebase's philosophy:

- **Pure modules.** No React, no DOM at import time → runnable in Node tests and in the browser, like `lib/player/kind.js`.
- **No new guesses.** Every decision is feature-detection (`MediaSource.isTypeSupported`, `requestMediaKeySystemAccess`, `VideoDecoder.isConfigSupported`) or a parsed manifest — never UA sniffing.
- **Existing engines reused.** Shaka stays the workhorse; native stays the Apple fast path; the only new runtime dependency is `mpegts.js`.

### Evidence from the harness

```
Channels: 389   (jash-live.m3u)
Chrome/Edge (Win, HW decode)   389/389 playable (100%)   shaka:389
Firefox (Linux)                389/389 playable (100%)   shaka:389
Safari (macOS, native HLS)     297/389 playable ( 76%)   native:255  shaka:42
iPhone (iOS 18, MMS)           297/389 playable ( 76%)   native:255  shaka:42
```

Codec detection against **live manifests** (not synthetic inputs):

```
F1 TV                  | dash | dash         | h264 | —    | Chrome yes | Firefox yes
TSN 3                  | dash | dash         | h264 | —    | yes        | yes
TENNIS | EVENTO…      | hls  | hls-master   | h264 | aac  | yes        | yes
My Time Movie Network  | hls  | hls-master   | h264 | aac  | yes        | yes
Star Sports Select 1   | dash | ByteString✗  | —    | —    | ?          | ?     ← the emoji-UA bug, caught independently
Premier League …       | dash | HTTP 403     | —    | —    | ?          | ?     ← datacenter IP blocked, expected
```

Raw-TS routing, including the two cases that break today:

```
Xtream TS (https)  Chrome  → mpegts
Xtream TS (https)  iOS 16  → UNSUPPORTED (no MSE before 17.1)      — correct, honest
Xtream TS (https)  iOS 18  → mpegts                                — ManagedMediaSource (v1.8.0+)
Xtream TS (http)   any     → UNSUPPORTED (mixed content on HTTPS)  — correct
FLV                Chrome  → mpegts
```

---

## 4. Integration: three patch points in `usePlaybackEngine.js`

**(a) Replace the boolean engine choice with the plan** (around the current
`const useShaka = needsEngine(...)`):

```js
import { probeCapabilities, canUseMse } from '@/lib/player/capabilities';
import { planLivePlayback, ENGINE, PROXY } from '@/lib/player/liveEngine';

// once per session, before the first load
const caps = await probeCapabilities();

const plan = planLivePlayback(source.liveChannel, caps, {
  allowNativeHls: allowNativeHlsRef.current,
  allowMpegts: true,
  streamProxyUrl: source.liveChannel?.streamProxy,
});
if (plan.unsupported) return showUnsupported(plan.unsupported);   // honest UI, no spinner

const step = plan.steps[triedStepIndex];   // advance this on each failure
```

**(b) Add the mpegts engine branch** (new sibling of the Shaka branch):

```js
if (step.engine === ENGINE.MPEGTS) {
  const mpegts = await import('mpegts.js');
  const player = mpegts.createPlayer(
    { type: 'mse', isLive: true, url: step.url || url },
    { enableWorker: true, enableStashBuffer: false, liveBufferLatencyChasing: true, lazyLoad: false },
  );
  player.attachMediaElement(el);
  player.on(mpegts.Events.ERROR, (type, detail) => failureRef.current?.(mapMpegtsError(type, detail), 'engine'));
  mpegtsRef.current = player;               // destroy on teardown: player.destroy()
  player.load();
  await player.play().catch(() => {});      // autoplay policy: surface the tap-to-play overlay
}
```

`el.src` must never be used for `step.engine === MPEGTS`; the element is fed via MSE.

**(c) Let the client decide on codecs, not the server health check.**
`checkChannelWorking()` currently kills HEVC rows. Keep the probe (it already sniffs PMT stream types)
but **store** what it found instead of judging:

```js
const proof = await verifyStreamDeliversVideo(uri, …);
if (!proof.ok) ok = false;              // dead = no media bytes
else channel.videoCodec = proof.codec;  // 'h264' | 'hevc' | 'mpeg2' — persist on LiveChannel
```

The router then applies `codecVerdict(caps, { video: channel.videoCodec })`, so an HEVC channel is
shown as playable on Safari/HEVC-capable Chrome and as "needs a different device" elsewhere — instead
of being invisible to everyone.

**Also worth doing while you're in there:**

- `lib/player/errors.js` maps `6001 REQUESTED_KEY_SYSTEM_CONFIG_UNAVAILABLE` to `drop-drm`. For a row
  with `keyId`/`key`, dropping DRM is guaranteed to fail again — route that case to the
  `switch-device` message from the plan instead.
- Add the plan to the stats overlay (`engine: plan.steps[i].engine`) so a bug report says which engine
  was attempted, not just "shaka/native".

---

## 5. Robustness, beyond "it plays"

These are the differences between "plays when you tap it" and "plays for three hours":

1. **Token rotation (the big one for these sources).** Star-family URLs die every ~30 min; your
   playlist regenerates every 30 min; a viewer who leaves the app open will hit a dead URL.
   `classifyStream()` already extracts `expiresAt` from `exp=`/`Expires=` in the URL or cookie.
   Use it: at `expiresAt − 90 s`, re-fetch the channel row (`/api/live-tv?source=all` or the specific
   source), swap the URL, keep `currentTime` continuity where possible. Do **not** just retry the same URL.
2. **Proxy escalation is part of the plan, not an afterthought.** Direct → `/api/live-proxy`
   (or `/api/live-jio`) after `401/403/451` *or* a stall with zero seconds buffered. Browsers cannot
   set `User-Agent`/`Referer`/`Cookie`, and several of these CDNs 403 the direct attempt from a
   browser origin. Your policy already does this for Jio/Pocket; the router makes it explicit for
   every source (`steps[].proxy`).
3. **Stall watchdog per engine.** Shaka emits `buffering`; mpegts.js emits `StatisticsInfo`/`ERROR`.
   Treat "no `timeupdate` for 12 s while `readyState >= 2`" as a stall → one in-place reload, then next step.
4. **Live buffer tuning.** `streaming.bufferingGoal` 20 s is a VOD value; for live use ~4–6 s with
   `rebufferingGoal: 1`, `lowLatencyMode: false`. For mpegts.js: `liveBufferLatencyChasing: true`,
   `enableStashBuffer: false`. Don't turn on low-latency HLS — these are re-streams; chasing the edge
   causes rebuffer storms.
5. **ABR without cliffs.** These feeds are single-bitrate (ClearKey DASH is one variant); Shaka's ABR
   only matters for the multi-variant HLS rows. Keep `enableAdaptiveBitrate` on but set
   `restrictions.maxHeight` from the user's quality preference so a phone doesn't try 1080p on 4G.
6. **Unsupported ≠ error.** Render `plan.unsupported.reason` with its `hint` (e.g. "ClearKey needs a
   different browser — open on Chrome or use the relay") plus a one-tap "Copy stream URL" for VLC.
   A dead tile with a spinner is the worst outcome; a wrong-but-explained tile is fine.
7. **Retry budget.** At most one proxy retry per engine, one engine change per load, and a global
   cooldown so a flapping CDN doesn't loop. You already have `lib/player/recovery.js` — feed it the
   plan's step index instead of its current kind-based heuristics.

---

## 6. The Apple/ClearKey problem — three honest options

92 of 389 curated channels (24%) are ClearKey `cenc` DASH. Chrome/Edge/Firefox decrypt them in EME;
Safari/iOS never will. Options, in the order I'd consider them:

| option | cost | verdict |
|---|---|---|
| **Tag them and hide on Apple** (badge: "plays on Android/desktop") | 1 hour | ✅ recommend first. It's honest, zero risk, and matches the catalogue reality |
| **Server-side decrypt + remux** (`ffmpeg -cenc_decryption_key <k> -i in.mpd -c copy -f hls out.m3u8`), per-request, on your host | 1–2 days + a relay route; **remux is cheap-ish but this is a *transmux + decrypt* per viewer** — on a 2 vCPU Render instance expect a handful of concurrent streams before it hurts, and it's the kind of traffic that gets a host to email you | ⚠️ only if Apple support is a hard requirement, and only for a private/self-hosted deployment |
| **Client-side decrypt** (fetch segments, AES-CTR with WebCrypto using the keys you already have, feed `VideoDecoder`, render to canvas) | 1–2 weeks, and on iOS ≤ 18 there is **no `AudioDecoder`** (Safari only added it in 26), so audio would need a WASM path; you also lose PiP/AirPlay/background playback because it's canvas, not a `<video>` element | ❌ don't. The engineering cost buys a worse player |

The research note that decides it: ClearKey is a debugging key system, and Safari's EME never shipped
it (Shaka's own support matrix lists ClearKey as unsupported on Safari). Nothing you install changes
that — the CDM is the browser's.

---

## 7. The codecs that still bite (and what would fix them)

| codec | who can't decode | mitigation available today | verdict |
|---|---|---|---|
| **HEVC/H.265** | Firefox; Chrome on Windows/Linux *without* a hardware decoder | Safari/Apple: native. Chrome+HW: MSE works. mpegts.js and hls.js ≥ 1.6 transmux HEVC-in-TS. For the rest: `hevc.js` patches MSE and transcodes HEVC→H.264 client-side with WASM+WebCodecs (~real CPU on the client, drain on laptops) | ⚠️ route per capability; keep the WASM transcoder as an opt-in "force play" for desktop users who want it |
| **AC-3 / E-AC-3 audio** | essentially every browser's MSE (Edge and Safari can via the OS) | `@mediabunny/ac3` (WASM AC-3/E-AC-3 decoder) can decode it for a WebCodecs pipeline; a full WebCodecs live pipeline is the only client-side fix | ⚠️ rare in your list; detect and label, don't build a pipeline for it yet |
| **mpeg2video** | all browsers; mpegts.js explicitly doesn't support it | `libmedia` (WASM FFmpeg decoders, incl. mpeg2/AC-3/VVC) if a source ever needs it | ❌ not worth it for this catalogue |
| **AV1** | Safari (mostly) | Chrome/Firefox decode it; mpegts.js transmuxes AV1-in-TS | ✅ already fine via capability probe |

If you want *one* library that "plays everything" including odd containers and codecs, the 2026 answer
is a WebCodecs pipeline (`libmedia` for breadth incl. WASM codecs, or `mediabunny` for a lean TS
toolkit) — but both require you to write the clock, the ABR, the buffering and the UI chrome that
Shaka already gives you. For a live-TV grid, that's a rewrite for the last 5% of streams. The router
gets you the first 95% with the engines you already ship.

---

## 8. Verifying on a real device

```bash
# 1. Coverage table, any playlist, 4 browser profiles
node harness/matrix.mjs ../jash-live-playlist/jash-live.m3u

# 2. Codec detection against live manifests (needs network; CDNs may 403 a datacenter IP)
node harness/peek.mjs
```

What I could **not** verify here: actual playback. This sandbox has no browser and its IP is blocked by
most of these CDNs (403/475), so the codec and engine *decisions* are tested, not the pixels. The
per-device checks that matter: (a) a raw-TS channel on desktop Chrome, (b) a ClearKey DASH channel on
Chrome *and* iPhone (expect the honest unsupported state), (c) an HEVC channel on an iPhone, (d) one
Star-family channel held open for 40 minutes to watch token rotation.

---

## Sources

- Shaka Player support matrix (Safari: no ClearKey; iOS < 17.1 native-only, ≥ 17.1 MSE) — https://github.com/shaka-project/shaka-player
- Shaka DRM tutorials (ClearKey config, EME secure-context rule) — https://shaka-player-demo.appspot.com/docs/api/tutorial-drm-config.html
- mpegts.js (TS/FLV → fMP4, H.264/H.265/AV1, AAC/MP3/Opus/AC-3/E-AC-3, worker MSE, iOS 17.1+ ManagedMediaSource) — https://github.com/xqq/mpegts.js
- hls.js v1.6.0 release notes (H.265/HEVC in MPEG-2 TS, AES-256-CTR, ManagedMediaSource since 1.5) — https://github.com/video-dev/hls.js/releases/tag/v1.6.0
- Chrome/Chromium HEVC (107+, hardware-only on Windows/Linux; WebCodecs + MSE + ClearKey) — https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding
- HEVC in browsers, 2026 — https://www.testmuai.com/learning-hub/hevc-compatible-browsers/
- WebCodecs support (Chrome 94+, Firefox 130+, Safari 16.4 video-only → 26.0 full) — https://www.testmuai.com/learning-hub/webcodecs-browser-support/
- AC-3/E-AC-3 in MSE (Chromium issue 41253735; Edge can via the OS) — https://github.com/cjw1115/enable-chromium-ac3-ec3-system-decoding
- `@mediabunny/ac3` WASM AC-3/E-AC-3 coder — https://mediabunny.dev/guide/extensions/ac3
- Mediabunny (pure-TS media toolkit, HLS/MP4/MKV/TS read) — https://github.com/Vanilagy/mediabunny
- libmedia (TS + WASM decoders incl. mpeg2/AC-3/VVC, HLS/DASH input) — https://github.com/zhaohappy/libmedia
- hevc.js (WASM HEVC → H.264 client-side transcoder, Shaka/hls.js/dash.js plugins) — https://github.com/lid-labs/hevc.js
