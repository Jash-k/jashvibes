# Custom Live compatibility patch

## Scope
Apply after the earlier reliability and verified-only Vault patches. Existing
Jio token resolution, direct/proxy request filter and buffering configuration
are preserved. No database reset, catalogue remap or dependency changes.

Changes:
- GitHub file-view URLs import their raw content.
- Piped percent-encoded headers, EXTHTTP and Kodi manifest/stream headers
  normalize without splitting encoded ampersands. DASH/HLS manifest hints
  work for extensionless URLs. JSON multiple supplied ClearKeys remain intact.
- Custom headers serialize to the existing authenticated server relay; browser
  requests no longer carry source headers to the app itself. All Shaka URI
  candidates use the relay without double wrapping; redirected MPD bases and
  refreshed manifests remain upstream-relative.
- Media cookies/authorization are not copied to unrelated origins or licence/
  timing requests. Relay rejects malformed/oversized header payloads and avoids
  error logging of stream URLs, credentials or licence bodies.
- Custom streams use conservative 20-second buffer goal, 3-second rebuffer goal,
  4-second ABR interval and no forced low-latency mode. This trades latency for
  stability; it is not a measured optimum for every network.
- Supplied ClearKey pairs/JSON are normalized; licence URLs respect their DRM
  type. No guessed key IDs, MPD ID expansion, decryption or DRM conversion.
- Required custom-stream DRM is never removed by recovery. Shaka 6000/6001
  on declared ClearKey yields a non-retrying compatibility explanation, based
  on the actual engine failure rather than a user-agent guess.
- Refresh notices active-channel header/format/licence changes.

## Deployment
1. `git apply --check jashvibes-live-custom-compatibility.patch`
2. `git apply jashvibes-live-custom-compatibility.patch`
3. `npm ci --include=dev && npm run build`
4. Deploy; in Live Service resync BOTH owner playlist sources, then refresh Live.
   This updates imported fields without changing manual catalog memberships.
5. Test the same working/failing channel on Chrome/Android and desktop Chrome
   or Firefox. Send exact channel name, player error number, device/browser and
   approximate time if it still fails. Compare a known working Jio channel.

Owner sources:
- https://raw.githubusercontent.com/Jash-k/live_play/main/jash-live.m3u
- https://raw.githubusercontent.com/Jash-k/live_play/main/star-sports.m3u

## Evidence (2026-10-08)
- Current lists: 6 / 67 entries, DASH+ClearKey, source User-Agent/Referer headers.
- Eight selected manifests: HTTP 200, DASH, H264/AAC, CORS *, supplied KID matches.
- Four channels (Star Sports 1 HD, Star Sports 1 Tamil Digital, Star Vijay,
  Star Vijay Digital): one initialization and one video-segment prefix each
  returned HTTP 206 and MP4 bytes. Not decrypted or decoded.
- 64 parser/policy/header/proxy/DRM/Jio checks including private owner inventory
  and exact pre-patch Jio URL/config/segment-filter comparisons passed.
- Production browser fixture test: 390px and 1440px, actual Shaka loads own
  unencrypted DASH manifest and segments through intercepted relay, advances
  currentTime beyond 3 seconds, no page errors. This validates browser routing,
  not real upstream DRM, Render egress, server relay sockets or Apple playback.
- 229 source modules, prior 16 content-reliability checks, production build pass.

## Limits and recommendations
These encrypted lists are NOT universal browser streams. Safari lacks ClearKey
support; Apple users need an authorized compatible rendition/DRM arrangement.
A native player or player-library swap cannot fix unavailable keys/DRM.
Widevine/PlayReady/FairPlay additionally need authorized licence-server access
and platform-specific configuration; parsing a URL is not full integration.
Raw TS/FLV and arbitrary codecs are not newly supported by this patch. The
unused liveEngine.js is not wired in as a claimed universal player solution.

Render free tier sleeps after idle time and has outbound-bandwidth limits.
Proxy-first remains necessary for declared source headers; moving media to
an independently verified authorized relay or compatible CORS-enabled source
may reduce Render bandwidth, but must not be assumed to bypass region/access
restrictions. Singapore deployment and exact failing channel names were not
available for end-to-end verification. No remote relay is provisioned here.

At 2 Mbps, one viewing hour relays about 0.9 GB before overhead; at 5 Mbps,
about 2.25 GB. Check your current Render allowance. A larger buffer cannot
repair denied/missing segments, expired keys or an exhausted hosting quota.

Research:
- https://github.com/shaka-project/shaka-player (DRM/browser support matrix)
- https://shaka-player-demo.appspot.com/docs/api/tutorial-network-and-buffering-config.html
- https://shaka-player-demo.appspot.com/docs/api/tutorial-config.html
- https://render.com/docs/faq (idle sleep and outbound-bandwidth billing)

## Reproducible tests
`node --import ./scripts/alias-register.mjs scripts/test-live-compatibility.mjs`
Optional private inventory paths can follow; contents are never logged.
Optional browser test requires Playwright + Chromium and your own ffmpeg DASH
fixture directory with manifest.mpd and segments:
`LIVE_FIXTURE_DIR=/path/to/fixture node scripts/test-live-browser.cjs`
Run a production app on port 7860 first. No owner keys belong in fixtures/logs.
