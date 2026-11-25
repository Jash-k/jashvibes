# Live TV redesign and Viduki integration — research-only proposal

## Scope and evidence

No application behaviour or production configuration changed in this research pass. Reviewed public GitHub repository metadata, root files and READMEs for six candidate repositories; fetched six specific playlist feeds; tested 48 bounded stream samples, following one HLS variant and sampling one media segment where available. Additionally checked nine named Tamil-channel entries. Requested five Viduki embed pages and reviewed the published documentation. Raw evidence is in the adjacent JSON reports and the reproducible `probe-sources.py` script.

These are point-in-time, remote-server HTTP tests. They are NOT browser playback certification, proof of distribution rights, exhaustive channel validation, long-term uptime measurements, or an India/Render-network test. A successful segment sample can still contain invalid media; codecs/decode, audio, CORS on every rendition and sustained playback require browser tests. Upstream timestamps reflect what GitHub returned; do not equate repository push activity with stream freshness.

## Findings: GitHub candidates

| Candidate | Feed size observed | Sample | HLS manifest success | Nonempty segment response 200/206 | HTTPS + manifest/segment CORS headers + segment response |
|---|---:|---:|---:|---:|---:|
| iptv-org Tamil | 112 | 8 | 8 | 7 | 7 |
| amazeyourself local, no RTMP | 709 | 8 | 6 | 6 | 5 |
| amazeyourself YuppTV FAST | 256 | 8 | 5 | 5 | 4 |
| amazeyourself Jayam | 56 | 8 | 5 | 4 | 3 |
| Free-TV overall feed, India-tagged sample | 2,193 overall | 8 | 1 | 1 | 1 |
| amazeyourself Distro | 9 | 8 | 1 | 1 | 1 |

Counts are small samples, not whole-feed success percentages. Candidates were spread across each feed; Free-TV sampling was filtered to India/Tamil group labels. Presence of a CORS header is not complete validation of browser CORS behaviour. Final HTTP URL, not only initial playlist URL, determines HTTPS compatibility. The simple probe does not handle all nesting/encryption/format types: failures remain unresolved candidates, not definitive dead-channel claims.

### Recommended first candidates — per-channel admission required

1. **iptv-org Tamil:** https://github.com/iptv-org/iptv
   - Feed: https://iptv-org.github.io/iptv/languages/tam.m3u
   - Best initial baseline in this test, especially Tamil news/music/public streams.
   - Do not assume all 112 channels are playable or authorized for our use.
2. **Tamil local, HTTPS/no-RTMP candidates:** https://github.com/amazeyourself/tamil-local-iptv
   - Feed: https://raw.githubusercontent.com/amazeyourself/tamil-local-iptv/main/channels-nortmp.m3u
   - Useful LocalCH expansion. The repository explicitly warns not all streams work. Some no-RTMP rows still resolve to HTTP, so the filename is not an HTTPS guarantee.
3. **Selected FAST entries:** https://github.com/amazeyourself/m3u
   - Feeds: `https://raw.githubusercontent.com/amazeyourself/m3u/main/yupptvfast.m3u` and `.../jayamott.m3u`.
   - Secondary candidates only. A repo is an index, not an independent broadcaster or guarantee of rights. Admit only vetted channels individually.

Free-TV/IPTV is a useful secondary discovery catalogue, not a whole-feed production import based on this sample. Distro results in this environment do not support promoting the whole feed. FunctionError/PiratesTv returned HTTP 451 from GitHub and santhoshmani1/iptv returned 404, so neither is recommended. No attempt was made to bypass restrictions or acquire protected-stream credentials/keys.

## Named Tamil channel checks

The extra iptv-org sample returned HLS manifests and nonempty HTTP-200 segment samples with CORS headers for:
- News18 Tamil Nadu
- Polimer News
- Polimer TV
- Puthiya Thalaimurai
- Puthiya Thalaimurai Express
- Thanthi One
- Star Vijay UK (396p)

Thanthi TV returned HTTP 403. The local-feed Polimer Channel entry responded over **HTTP**, so do not admit it directly into our HTTPS app on that result alone.

**Star Vijay UK is a separate regional feed, not a validated substitute for Star Vijay India/HD.** Preserve its region/name. This research did not establish a working authorized Sun TV or Sony Vizha feed. Do not promise them or silently relabel another channel. Those need an official/licensed integration or further authorized-source investigation and browser validation.

## Proposed architecture: health-gated, not playlist-count-driven

### 1. Separate discovery from public publication

Maintain distinct entities:
- `LiveSource`: import configuration, credentials reference if legitimately supplied, source-level sync health.
- `LiveVariant`: one channel URL/resolver, source and region, required headers/DRM, supported format.
- `LiveProbe`: timestamped results for URL resolution, auth freshness, manifest, media sample and browser playback.
- `LiveChannel`: canonical channel identity and vetted variants; manual catalogue/language/ordering overrides.

Downloading an M3U only creates candidates. It must not automatically label them playable or make them publicly visible. Sync errors must not erase all last-known-good records, but stale records must lose public eligibility when their health lease expires.

### 2. Explicit health state machine

`discovered -> checking -> candidate-ready -> browser-validated -> degraded -> quarantined`

Suggested admission policy: HTTPS throughout; supported HLS/DASH; successful media manifest/initialization as applicable and nonempty media sample; valid required authorization/license configuration; no login/challenge HTML; plausible media payload/codec; browser test from the actual target environment. Use two consecutive successful checks before first promotion. Require a recent browser success before calling a variant “playback verified.” Mark regional/device validation scope explicitly.

HTTP 404/410: quarantine the variant immediately. Auth expiry: attempt one authorized refresh, then quarantine. 429: honor Retry-After, do not hammer. Timeouts/5xx: short backoff and bounded retry; two failures remove public eligibility. Do not disable an entire source because one channel fails.

### 3. “Working only” public behaviour

- Show a channel only when it has at least one eligible, recently validated variant.
- Recheck readiness on click. Treat runtime failure as evidence and move to the next eligible variant once.
- Last failure: clear unavailable message, no endless spinner or wraparound loop.
- Expose unavailable channels, raw sources, probe failures and manual recheck only in Admin.
- Keep the Admin-driven source dropdown and All Sources; public source choices must contain eligible variants only.
- Keep Tamil-first sorting and featured Star Vijay/Sun TV/Sony Vizha policy, but feature only when genuinely eligible. Never feature a dead placeholder.
- Explain that “working only” means health-gated eligibility; no remote live stream can be guaranteed never to fail between checks.

### 4. Select by measured reliability

Rank by recent browser success, startup time, sustained playback/stall ratio, region correctness and stream freshness. Prefer browser-direct HTTPS HLS with valid CORS when equally reliable. Prefer a proven 720p variant over a failing 1080p variant. Keep regional versions separate. Group HD/SD only after reliable identity matching. Preserve user language, favourites and admin mapping.

### 5. Render/network policy

Use Render for catalogue, validation scheduling, metadata and authorized resolution. Do not blanket-proxy geo-sensitive media through Render: server location can differ from the viewer. If a permitted stream genuinely needs a proxy, use an allowlisted, bandwidth-budgeted service with correct manifest/segment rewriting and redirect/SSRF controls. Browser-direct media avoids Render bandwidth but requires valid CORS and browser-compatible authorization.

Never solve a failed authorized session by importing random leaked cookies/keys. GitHub code licensing does not grant broadcast redistribution rights.

### 6. Suggested check cadence and budgets

- Candidate discovery every 6 hours; changed/new rows checked first.
- Healthy popular variants checked every 5–10 minutes; other admitted variants every 20–30 minutes.
- Expiring authorized sessions checked relative to their expiry, before playback and with one bounded refresh.
- Quarantine backoff 5 minutes, 30 minutes, then 6 hours. Do not poll permanent 404s continuously.
- Sample bytes/range where supported; small fixed concurrency per origin; redact tokens/cookies from health logs.
- Browser smoke matrix: Chrome Android + desktop, actual Indian connection, minimum 30–60 seconds audio/video per flagship; longer soak before claiming sustained reliability. Browser completion still does not ensure future uptime.

## Viduki: exact integration proposal

Documentation: https://www.viduki.net/#api

Viduki is an **iframe embed provider**, not a JSON catalogue or promised direct MP4/HLS API. Its documentation says it aggregates third-party embeds and does not host video files. Do not scrape it into mv_vault, mark its whole catalogue available, or promise Tamil audio.

Documented shapes:

```
https://www.viduki.net/1/movie/{tmdbOrImdbId}?color=e01621
https://www.viduki.net/1/tv/{tmdbOrImdbId}/{season}/{episode}?color=e01621
```

Modes 1/2/3/4 are documented as Multi Server / Multi Language / Multi Embeds / Premium Embeds. The site says no API key or registration is needed. The marketing label “Premium” should not be interpreted as a separate proven service guarantee.

HTTP checks of all four movie modes for ID 550 and mode-1 TV 1396/1/1 returned HTML 200 with no X-Frame-Options or CSP response header observed. This establishes endpoint reachability and absence of those response-header blocks in this test only—not content availability, playback, ads/popups, nested-frame compatibility or language support.

### Fit into current JaSH code

Current `lib/providers/embedProviders.js` enables Mirchi only in its default/valid provider list. Add a `viduki` provider adapter there, not only an arbitrary URL in UI. Expose a configurable mode, default 1. Add it as a selectable movie/episode source after the existing preferred sources, initially opt-in until testing completes; preserve last-selected source/watch state. Do not replace the working Vault/TamilOTT/Mirchi path by default.

- Validate positive numeric TMDB or syntactically valid IMDb IDs; use actual TV series ID plus explicit season/episode, never the local dub release year as identity.
- No original ID means Viduki is unavailable for that record; never guess from the local title alone.
- Sandbox/restrict iframe capabilities after testing. Do not blindly grant top-navigation/popups; preserve fullscreen, autoplay permission, PiP only if supported. Add a clear third-party-source disclosure.
- Verify both `event.origin === 'https://www.viduki.net'` AND `event.source === iframe.contentWindow`, schema, active media ID and finite numeric bounds before accepting messages.
- Documented failure event: `viduki:all-servers-failed`, with status/stage/media. Use a finite one-way mode fallback only on validated events/user action. The docs specifically describe mode-1 failure events; do not assume all modes emit identical telemetry.
- Documented progress event: `MEDIA_DATA`. Store only validated progress for the current title/episode in our existing watch store. Do not trust third-party titles/posters as our catalogue authority or copy the whole message into local storage.
- Modes are four configurations of one provider, not four independent reliability sources. An iframe load event/HTTP 200 is not proof a movie is playable; a timeout alone can mean autoplay or user interaction is required.
- Our current broad frame-src policy permits HTTPS generally; evaluate tightening it rather than broadening it. Actual nested-frame origins, redirects, permissions and production behaviour still need testing.
- Playback rights, privacy and terms must be checked before enabling a third-party provider publicly.

## Implementation order if approved

1. Establish the health-gated source/variant model and non-destructive migration.
2. Import selected iptv-org/local candidates into staging, then validate on target browsers/network. Keep existing mappings/favourites.
3. Publish only admitted variants; add Admin quarantine/recheck/status views and finite player fallback.
4. Add telemetry and repeated checks; compare source outcomes before retiring old feeds.
5. Add Viduki as a separately configurable embed provider, with exact-ID/episode URL tests, trusted-message validation and watch-progress mapping.
6. Test on Render and the user's actual device/network before claiming sources work in the deployed app.

Recommendation: approve the health-gated redesign, not a promise to import every repository row as working. This research offers promising candidates, not an unverified replacement feed list.
