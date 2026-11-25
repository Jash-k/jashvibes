# Live TV health-gated redesign + Viduki

## Status

Implemented and validated locally. Nothing has been pushed, no production database was accessed for writes, and the Render website has not been deployed. Both repositories and earlier uncommitted Vault/public-access/Stremio-OFF fixes remain intact. mv_vault is not changed by this Live/Viduki implementation.

## Priority channels

Public All Tamil ordering and initial selection prioritize:
1. Vijay TV / Star Vijay India
2. Sun TV
3. Sony Vizha
4. Other channels

Admin’s explicit order within a fixed catalogue remains authoritative. Regional versions such as Star Vijay UK are distinct and do not occupy the Vijay India flagship slot. Featured ordering does not create a working stream.

**There is still no newly established authorized, browser-verified Vijay India/Sun TV/Sony Vizha source in this environment.** The redesign prevents those channels from being falsely advertised as working. They need a valid source/session and actual playback confirmation on the target device/network. Remote tests passed media-signature samples for News18 Tamil Nadu, Polimer News, Puthiya Thalaimurai and Star Vijay UK; this is not India/Render/browser certification. Evidence: `reports/live-health-real-probes.json`.

## IMPORTANT deployment/migration effect

**Legacy rows start unvalidated and will not be public immediately after deployment. An empty public Live TV page is possible until the owner validates streams in Admin.** This is deliberate fail-closed admission, not data loss. No migration deletes channels, favourites or mappings. A source import is only discovery.

1. Deploy the latest jashvibes tree with existing private Render/MongoDB configuration (Node 22 recommended).
2. Open Admin → TV → Sources; sync the existing Tamil FTA source and the new `Tamil Local (candidates)` source if desired. Existing source controls/enabled settings remain respected.
3. In Admin → Channels, start with Vijay, Sun TV and Sony Vizha. Use source/health/search filters. Admin rows prioritize these flagships when not explicitly sorting a fixed catalogue.
4. Open Preview. This uses the real player with owner-authenticated `preview=1` resolution, even when the candidate is not public.
5. Check manifest/media to get diagnostics. This never pretends a successful import was video playback.
6. Personally watch at least 30 seconds of correct channel audio/video. Only then press **I watched 30s audio/video — publish** and confirm. This is an explicit trusted owner attestation, not automatic playback measurement. If the stream does not play, do not confirm it.
7. Use Quarantine for a bad stream. It stays in Admin; automated sweeps do not undo explicit owner quarantine. Reconfirm in Preview to republish.
8. Repeat for other channels. Existing catalogue assignments and source isolation are preserved.

A valid stream still can fail later. “Working only” means health-leased eligibility, never an uptime guarantee.

## Health behaviour

- Schema stores playbackHealth separately from source import status and catalogue mapping.
- Public catalogue and homepage live hero require a current healthy lease, compatible unchanged playback configuration and current required authorization.
- Public resolve enforces the same admission gate; knowing an unvalidated channel ID is not a bypass.
- Config fingerprint changes invalidate eligibility. Rotating hdnea/hdntl/hdnts query tokens are excluded from identity, while keys/headers/format/stream path changes invalidate it. Fingerprint is a change detector, not a security signature.
- Admin’s publication attestation lasts at most 24 hours; active publication leases are 30 minutes and renewed by successful checks within the attestation window. Reconfirm browser playback daily. Turning off the checker does not disable the gate; leases expire.
- Two successful server media checks alone do NOT establish browser playback or automatically publish a channel.
- Background sweep every five minutes, up to 24 due rows per pass, three workers, priority allowance for the three flagships and oldest checks for other rows. First check starts after 30 seconds of process uptime. This is bounded sampling, not a promise that a large candidate backlog is fully checked every five minutes.
- Plain HTTPS HLS: SSRF-safe/pinned-DNS fetch, HTTPS redirects only, bounded manifest parsing, up to three manifest hops, one media sample, TS/fMP4 signature check, no HTML/login response accepted as video. Per-probe timeout nine seconds and bounded document/sample handling. No full-channel download.
- DASH/encrypted/custom-header/proxy streams require browser evidence rather than a fabricated server media pass. Existing browser attestation can renew their lease within its 24-hour window if readiness still passes. This is not an automated new DASH playback test. Known expired/missing Jio authorization still fails closed.
- Existing channel-scoped authorized Jio refresh is used before checking; refresh failure does not invent authorization. Cookie/token values are not placed in health diagnostics.
- Failed probes quarantine eligibility. General failures retry after ten minutes; working candidates after five. Explicit owner quarantine is excluded from automatic sweeps. Fine-grained 429 Retry-After handling and historical uptime/stall analytics are not implemented in this version.
- Slow probes condition updates on the row's previous updatedAt, avoiding overwriting a newer edit, attestation or sync.
- Public catalogue refreshes while the page is visible about once per minute. Server cache is short-lived; playback resolve rechecks admission.
- Existing player forward-only fallback handles resolve/fatal playback errors without endless wraparound loops.
- V2 raw-feed mode is now owner-only Preview so it cannot bypass public admission. Public users do not see its toggle.

## Sources

Added the researched no-RTMP local playlist as candidate discovery, not a guaranteed working bundle. Existing iptv-org Tamil discovery remains available. Did not blindly import additional FAST/Distro feeds as “working.” Upstream authorizations, rights and source suitability must be reviewed. No third-party DRM keys or credentials were added by this implementation.

The local playlist may still contain HTTP URLs; strict probe rejects those. An HTTPS playlist file does not make its media HTTPS. Existing auto-purge now protects browser-confirmed rows in addition to existing mapping/favourite protections; default Tamil FTA source definitions no longer enable auto-purge for new seeded rows. Previously saved owner source settings are not silently overwritten.

## Viduki

- Registered as a movie/TV episode iframe provider after Mirchi in the normal watch source chain; selectable manually.
- Exact positive TMDB IDs or valid IMDb IDs only. TV URL uses actual series ID, season and episode. No identity guessed from local dubbing titles, no synthetic mv_vault records.
- `/api/watch/source?provider=viduki&type=movie&tmdbId=550`
- `/api/watch/source?provider=viduki&type=series&tmdbId=1396&season=2&episode=3`
- `VIDUKI_MODE=1` default. Optional 2/3/4 select documented alternate configurations. No API key required by their documentation. Modes are one provider, not independent availability guarantees.
- Validated mode-1 `viduki:all-servers-failed` events can advance the finite source ladder. Origin, exact iframe window, event source/type/status/stage and active media identity/episode are checked. Modes 2–4 are not assumed to emit mode-1 telemetry.
- Existing iframe sandbox/popup controls remain; no automatic top-navigation or popup permissions added. Third-party source/language caveat is shown. An iframe load is not called verified playback.
- **Watch-history persistence was already removed by prior app policy. It stays removed.** The provider does not reintroduce Continue Watching or blindly store Viduki MEDIA_DATA messages. Progress integration proposed in the research document was intentionally not implemented because the current app explicitly disables that feature.
- The adapter’s URLs and HTTP responses were tested. Actual Viduki playback, ads, browser restrictions and Tamil audio coverage remain unverified. Review third-party terms/rights before public use.

## Validation

- Full `npm run verify` passes, including new health-admission/media-probe and Viduki identity/message tests.
- Production `npm run build` passes.
- Local production-server HTTP smoke checks: movie/episode Viduki candidates 200, missing identity 422, unauthenticated health admin and V2 routes 401.
- Existing regressions for public access, Stremio-OFF behaviour, source isolation, token propagation, native player and Vault matching still pass.
- No authenticated MongoDB integration migration, browser end-to-end playback, real Render deployment or target-device certification was run.

Logs: `reports/live-redesign-{verify,build}.log`, `reports/live-redesign-http-tests.json`. No ZIP was generated, retaining your repo-only workspace preference.
