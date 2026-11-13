# Source-first Live TV patch — 13 November 2026

## Status
Implemented locally against commit `447b8f7b747356c7fff3116a9fe318edb5a282c4`. **Not pushed to GitHub or deployed to Render. Real Jio playback is not yet verified. No replacement Jio provider has been installed.**

## What changed
- Dropdown uses enabled, non-deleted `LiveSource` records from Admin, including custom labels and sources that currently contain zero channels.
- Disabled/deleted source rows do not contribute to the public catalog. Database errors are no longer converted into a misleading empty channel list.
- Cards are source-specific. All Sources shows separate source-labelled cards, not a cross-provider ladder. Multiple encodes from the same source may remain as stream variants.
- Source switching resets search/category and tunes a channel from the chosen source; selecting an empty source clears the player. In-player browsing/zapping uses the filtered list.
- Default view is All channels, not Main. Star Vijay, Sun TV and Sony Vizha sort first when available, then other Tamil channels, then remaining channels alphabetically. No channel is invented if absent from a source.
- Existing hidden/playability/religious visibility rules remain; this does not publish deliberately hidden rows. Existing admin catalog mappings are not migrated or overwritten.
- Old favorite IDs still work; new favorites identify source-specific cards.
- Mobile dropdown has its own row so navigation controls remain accessible.
- V2 remains a separate explicit mode; its enrichment/provider architecture was not replaced.

## Jio fixes
1. `normalizeJioCookie` previously could not extract a token from `https://…?__hdnea__=…` because it only matched cookie-header boundaries. It now parses URL query fields explicitly.
2. Policy accepts a valid token already supplied in the stream URL; an expired separate cookie cannot mask a valid URL token. A fresh supplied token does not require an unrelated global sweep before starting playback.
3. Player now uses the resolve response's current keys, headers, source identity and format, rather than retaining stale catalog snapshot fields.
4. Resolve completion from an unmounted/replaced player is invalidated.
5. Removed fuzzy substring/first-word channel substitution from the resolve API. Exact channel/group resolution fails truthfully rather than selecting a different channel.

These fix reproducible application bugs, **not** every upstream outage, expired entitlement, CORS restriction, regional limitation or codec/DRM incompatibility.

## GitHub/source research
- Inspected `JioTV-Go/jiotv_go` source, README and playback handlers. It implements account-based OTP authentication, M3U output, playback URL resolution and manifest/segment handling. It is a candidate self-hosted integration for an account you are authorized to use, not a verified working public playlist for this deployment. See https://github.com/JioTV-Go/jiotv_go.
- Search also surfaced `pranabeshsingh/jiotv`, describing an account-authenticated self-hosted server. It was not installed or playback-tested: https://github.com/pranabeshsingh/jiotv.
- `andromyth/jiotv-android` explicitly describes incomplete resolver/proxy work and is not a drop-in proven browser source: https://github.com/andromyth/jiotv-android.
- Rechecked existing Jio JSON (1,173 rows), HJH playlist (1,193 EXTINF entries) and iptv-org Tamil FTA (118 entries): all returned HTTP 200. **Feed reachability only**, not playable-channel verification.
- Earlier checks showed Binge returning partial cookie-source errors and the V2 reference endpoint redirecting to `/blocked`. Simply adding more copies of overlapping Jio feeds does not remove these dependencies.
- No shared account credentials, DRM keys or token harvests were added. No protection bypass was implemented.

## Deployment checks
`https://jashvibes-o3pw.onrender.com/api/health` returned 200. Its Live catalog/resolve endpoints returned 401 without a viewer session. Production DB, enabled source configuration and actual failure responses were therefore not inspectable. The deployed health version alone does not identify a Git commit.

## Verification
- `npm run verify`: passed, including new `scripts/live/test-source-browse.mjs`.
- `npm run build`: passed.
- `git diff --check`: passed.
- Chromium fixture checks at 1440×900 and 390×844: passed source options, custom labels, featured Tamil order, isolated source resolution, empty-source behavior, no page errors and no horizontal document overflow.
- Fixture tests deliberately return a media error. They verify UI/control flow, **not video playback**.

Optional browser regression:
1. Install Playwright/Chromium in your test environment.
2. Start a LOCAL built server on port 7860 with `PASS=local-validation-only`, a separate test owner password, and `LIVE_SYNC_MINUTES=0`. Do not use these test credentials in production.
3. Run `node scripts/test-live-source-browser.cjs`. `PLAYWRIGHT_MODULE` can point to an external Playwright installation. `LIVE_TEST_ARTIFACTS` optionally captures screenshots.

## Rollout / next evidence
Back up/export Live source and mapping configuration. Deploy this source through the normal Git/Render flow, sync enabled sources in Admin, and test one named failing channel on the actual device. Roll back through the previous deployment if necessary; this patch contains no schema migration.

To finish verifying Jio: provide the exact selected source, channel, browser/device and error text (or a redacted Network response). Do not send passwords, account OTPs, session cookies, stream tokens or database URIs. Decide whether to connect an authorized account-backed self-hosted source or continue troubleshooting an existing provider you are authorized to use.
