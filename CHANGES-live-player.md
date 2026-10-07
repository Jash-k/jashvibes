# Live: capability-routed playback (native · Shaka · mpegts.js)

The player-side half of the Live work. The **playlist builder lives in its own repo** — this app only
consumes the M3U it publishes as a normal Live source, so nothing here generates or stores channels.

Verified in this tree: `npm run check` → **219 source modules** (3 new), `npm run build` → **passes**
(Next 16), `npm start` + `/api/health` → 200, and the new modules were exercised over a 388-row
Tamil + sports playlist with four simulated browsers. VOD paths are untouched.

---

## 1. The problem

Engine choice was `needsEngine(url, kind)` — an extension check. Correct for VOD, wrong for Live TV,
which contains three stream classes VOD never has:

| case | before | now |
|---|---|---|
| raw MPEG-TS (`…/live/u/p/1234.ts`, `extension=ts`) | `el.src = url` → **never plays** (no browser demuxes bare TS) | **mpegts.js** transmuxes TS/FLV → fMP4 → MSE |
| HEVC channels | server probe marked them `broken` and hid them | the codec is **recorded** (`LiveChannel.videoCodec`) and the **client** decides — Apple plays HEVC natively, Chrome 107+ with a hardware decoder |
| ClearKey DASH on Safari/iOS | Shaka loads, EME rejects the key system, the ladder retries without keys and fails again | an honest "needs a browser with a ClearKey CDM" state — no spinner loop |
| server-proxied retry | only existed for Jio/Pocket | part of every stream's plan (direct → `/api/live-proxy`) |

## 2. New modules

| file | role |
|---|---|
| `lib/player/capabilities.js` | feature probe (once per session): MSE/**ManagedMediaSource**, native HLS/TS, EME (ClearKey/Widevine/PlayReady/FairPlay), codec table (h264/hevc/av1/aac/ac-3/ec-3/opus), WebCodecs, WebCrypto. No UA sniffing; SSR-safe. |
| `lib/player/streamClassifier.js` | row → `{ transport, drm, scheme, needsHeaders, expiresAt }`, plus `peekManifest()` which reads the real `CODECS` out of an HLS master / MPD body |
| `lib/player/liveEngine.js` | `planLivePlayback(row, caps)` → ordered steps (`native` / `shaka` / `mpegts`, each × `direct` / `headers` / `jio`), or an `unsupported` verdict with an actionable hint |

## 3. Wiring (all additive)

- **`components/player/usePlaybackEngine.js`** — for rows that carry `liveChannel` it awaits the
  capability probe, builds the plan, refuses to attach when the browser can never play the stream
  (with `plan.unsupported.reason + hint` in the error UI), adds the **mpegts.js branch** (worker MSE,
  `liveBufferLatencyChasing`, destroyed through the shared `destroyPlayer`), and **advances the plan
  before the generic recovery ladder** (direct → proxied retry → other engine). Stats overlay names
  the engine.
- **`lib/player/policy/liveTv.js`** — the resolved source carries `liveChannel`, so the engine sees the
  row's facts, not just the URL. Already-proxied URLs are planned as same-origin (headers are the
  server's job there).
- **`lib/liveTv.js`** — the deep check **records** `proof.codec` (`getLastStreamCodec()`) instead of
  judging it; non-ASCII header values are sanitised (the `http-user-agent=Virat🐐` crash) and
  `#EXTVLCOPT:http-cookie` is parsed.
- **`lib/liveService.js` / `models/LiveChannel.js`** — `videoCodec` persisted and sent to the client.
- **`package.json`** — adds `mpegts.js@^1.8.2` (the only new runtime dependency; lazily imported).

## 4. Fed by your own playlist repo

Point the Live section at the raw URL your playlist repo publishes:

**Admin → TV Service → Sources → add**

| field | value |
|---|---|
| Label | e.g. `Jash Live` |
| Type | `m3u` |
| URL | `https://raw.githubusercontent.com/<you>/<your-playlist-repo>/main/<file>.m3u` |
| Priority | 6 (after the built-in Tamil defaults 0–5) |
| trustTamil | **on** — the list is already filtered, and off it would drop the English sports feeds |
| autoPurge | off |

Then **Sync** and map channels into your catalogs. Set `LIVE_SYNC_MINUTES=15` on the host: Star-family
CDN tokens expire in ~30 minutes, so the 60-minute default leaves half the sports rows stale between
syncs. One scheduler instance only.

Nothing else changes: any M3U/JSON source works the same way, and the router picks the engine per
browser regardless of which repo produced the file.

## 5. Measured coverage (388-row Tamil + sports playlist)

| browser | playable | first-choice engine |
|---|---|---|
| Chrome/Edge (Win, HW decode) | **388 / 388 (100%)** | shaka |
| Firefox (Linux) | **388 / 388 (100%)** | shaka |
| Safari (macOS) | **298 / 388 (77%)** | native 255, shaka 43 |
| iPhone (iOS 18) | **298 / 388 (77%)** | native 255, shaka 43 |

The missing 90 rows are ClearKey-encrypted DASH. Apple never shipped a ClearKey CDM, so no library —
Shaka, hls.js, dash.js, mpegts.js — can play them on Safari/iOS. Chrome/Edge/Firefox decrypt them
normally, and the router states the limit instead of retrying forever.

## 6. Known limits (deliberate)

- **ClearKey on Apple**: unsupported state with a hint. Client-side decryption was rejected — Safari
  only got `AudioDecoder` in 26, and a canvas renderer loses PiP/AirPlay/background audio.
- **AC-3 / E-AC-3 audio**: absent from MSE almost everywhere; detected and labelled, not transcoded.
- **WebCodecs engine**: implemented as a plan step (`allowWebCodecs`) but not enabled in the player —
  it needs its own clock and buffer work before it earns a place.
- **Subtitles** are unavailable on the mpegts.js path (a transmuxed TS carries no text tracks).
- **Token expiry**: the plan carries `expiresAt`; a long-lived tab still relies on the source re-sync.
  Re-resolving a channel just before its token dies is the remaining follow-up.

## 7. Verify

```bash
npm run check     # 219 source modules parse + local imports resolve
npm run build     # production build
npm start         # then: curl -fsS localhost:7860/api/health
```

**Deploy:** Render/Koyeb → build `npm ci && npm run build`, start `npm start`; Docker →
`docker build -t jashvibes . && docker run --env-file .env.local -p 7860:7860 jashvibes`.
`mpegts.js` is a normal dependency, so both paths pick it up from `package.json` — no extra step.

See [docs/LIVE-PLAYER.md](docs/LIVE-PLAYER.md) for the full research write-up (browser-support facts,
the Apple/ClearKey decision, and sources).
