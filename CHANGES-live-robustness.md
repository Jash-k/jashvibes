# Live: custom playlist + capability-routed player

Two features in one change, built and verified against this repo's own code.

Everything below was validated in this tree: `npm run check` → **219 modules** (3 new),
`npm run build` → **passes** (Next 16, 55 s), and the new modules were exercised over the
generated `jash-live.m3u` (388 channels) with four simulated browsers.

---

## 1. `jash-live.m3u` — one curated source for the Live section

**.github/workflows/jash-live.yml** rebuilds it every 30 minutes from the
`Sportlive18/Sportlink-wtf` playlist family and commits it when the content changes
(unchanged runs commit nothing, so the repo isn't churned 48× a day).

| section | contents | count |
|---|---|---|
| Bigg Boss 24/7 | Bigg Boss **Tamil** 24/7 (Hotstar HLS) | 1 |
| Tamil | Tamil channels only, minus other-language and non-live entries | 299 |
| Sports | **Star Sports · Sony (Ten/LIV/Sports) · Willow · Cricbuzz · FanCode** only | 88 |

**Wire it up:** Admin → TV Service → Sources → add
`https://raw.githubusercontent.com/Jash-k/jashvibes/main/jash-live.m3u`
(type `m3u`, priority 6, **trustTamil ON**, autoPurge off), then Sync.

**Why it needs `LIVE_SYNC_MINUTES=15`** (env): Star-family CDN tokens expire in 30 minutes and the
upstream files are rewritten every 30 minutes. At the 60-minute default, half the sports rows are
stale before the next sync. One scheduler instance only.

**Tuning** lives in `scripts/live-playlist.config.json` — sources + weights, `sportsFamilies[]`,
`tamilNames[]`, `maxTamil` (0 = no cap), `bigbossVariants`, `requireHttps`, `allowRawTs`,
`nameAliases`, `minChannels`. The builder drops, per run: ~1.6k movie VOD rips that the donor
repos hide under `group-title="Tamil"`, ~800 already-expired tokens, 253 radio groups, 62 `http://`
streams (mixed content on an HTTPS app), and ~1.1k cross-file duplicates.

```bash
npm run live:playlist                       # same command the workflow runs
node scripts/build-live-playlist.mjs --local ../Sportlink-wtf   # build from a local checkout
```

---

## 2. Live player: capability-routed engines

**Problem it fixes:** the engine choice was `needsEngine(url, kind)` — an extension check. That is
right for VOD and wrong for Live TV, which contains three stream classes VOD never has:

| case | before | now |
|---|---|---|
| raw MPEG-TS (`…/live/u/p/1234.ts`, `extension=ts`) | `el.src = url` → **never plays** (no browser demuxes bare TS) | **mpegts.js** transmuxes TS/FLV → fMP4 → MSE |
| HEVC channels | server marked them `broken` and hid them | codec is recorded (`videoCodec`), the **client** decides — Safari/iOS play HEVC, Chrome with a hardware decoder too |
| ClearKey DASH on Safari/iOS | Shaka loads, EME rejects, ladder retries without keys → fails again | honest "needs a browser with a ClearKey CDM" state, no spinner |

### New modules

| file | role |
|---|---|
| `lib/player/capabilities.js` | feature probe (once per session): MSE/**ManagedMediaSource**, native HLS/TS, EME (ClearKey/Widevine/PlayReady/FairPlay), codec table (h264/hevc/av1/aac/ac-3/ec-3/opus), WebCodecs, WebCrypto. No UA sniffing. |
| `lib/player/streamClassifier.js` | row → `{ transport, drm, scheme, needsHeaders, expiresAt }` + `peekManifest()` (reads real `CODECS` out of an HLS master / MPD body) |
| `lib/player/liveEngine.js` | `planLivePlayback(row, caps)` → ordered steps (`native` / `shaka` / `mpegts`, each × `direct`/`headers`/`jio`), or an `unsupported` verdict with an actionable hint |

### Wiring (all additive; VOD paths untouched)

- `components/player/usePlaybackEngine.js` — imports the router; for rows carrying `liveChannel` it
  computes the plan (after awaiting the capability probe), refuses to attach when the browser can
  never play the stream, adds the **mpegts.js branch** (worker MSE, `liveBufferLatencyChasing`,
  destruction in the shared `destroyPlayer`), and **advances the plan before the generic recovery
  ladder** (direct → proxied retry → other engine). The stats overlay now names the engine.
- `lib/player/policy/liveTv.js` — the resolved source carries `liveChannel` so the engine sees the
  row's facts, not just the URL. Already-proxied URLs are planned as same-origin (headers are the
  server's job there).
- `lib/liveTv.js` — the deep check now **records** `proof.codec` (`getLastStreamCodec()`) instead of
  judging it, and the header sanitisation patch is applied (`#EXTVLCOPT` emoji crash + `http-cookie`).
- `lib/liveService.js` / `models/LiveChannel.js` — `videoCodec` is persisted and sent to the client.

### Measured coverage (`jash-live.m3u`, 388 rows)

| browser | playable | first-choice engine |
|---|---|---|
| Chrome/Edge (Win, HW decode) | **388 / 388 (100%)** | shaka |
| Firefox (Linux) | **388 / 388 (100%)** | shaka |
| Safari (macOS) | **298 / 388 (77%)** | native 255, shaka 43 |
| iPhone (iOS 18) | **298 / 388 (77%)** | native 255, shaka 43 |

The missing 90 rows are ClearKey-encrypted DASH. Apple never shipped a ClearKey CDM, so no library can
play them there — the router says so instead of looping. Chrome/Edge/Firefox decrypt them normally.

### Known limits (deliberate)

- **ClearKey on Apple**: unsupported state (badge + hint). Client-side decryption was rejected:
  Safari only got `AudioDecoder` in 26, and a canvas renderer loses PiP/AirPlay.
- **AC-3 / E-AC-3 audio**: missing from MSE almost everywhere; detected and labelled, not transcoded.
- **The optional WebCodecs engine** (`allowWebCodecs`) is implemented as a plan step but not switched
  on in the player — it needs its own clock/buffer work before it earns a place.
- **Subtitles** are unavailable on the mpegts.js path (no text tracks from a transmuxed TS).
- **Tokens**: the plan carries `expiresAt`; a long-lived tab still needs the source re-synced
  (`LIVE_SYNC_MINUTES=15`). Re-resolving before expiry is the remaining follow-up.

---

## Verify

```bash
npm run check        # 219 source modules
npm run build        # production build
npm run live:playlist
```

Harnesses for the router (coverage matrix over any playlist × 4 browser profiles, and codec detection
against live manifests) ship separately in the `live-player-robustness` kit — they run under plain
Node and are not part of the app bundle.
