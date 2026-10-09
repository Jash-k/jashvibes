# Performance-only patch

## Exact baseline
Repository: https://github.com/Jash-k/jashvibes
Commit: `d8b09350a5e182faec94e136c1d90f372bb1da3d` (`nav re arrange`).
Fetched on 2026-10-09. This incremental patch excludes earlier navigation-order,
artwork, Extras redesign, player repairs and selected-channel-guide changes already
present in that commit. Remote-only legacy Music files are retained.

## Changes
- Shared non-blocking Next Link pending feedback, intent-based route prefetch and
  main-section loading boundaries. No blanket API/player prefetch.
- Memory-first session cache, coalesced storage writes, pagehide flush, TTL checks
  and cache invalidation on authentication failure.
- Keep successful Home/Live/Extras/Music content during refresh failures; restore
  browsing preferences for Extras, Vault and Music. Valid expanded Home sessions
  are retained until cache expiry rather than collapsed by a page-one refresh.
- Stremio uses client navigation, restores a bounded shelf, reads manifest/pins
  concurrently, and invalidates old shelf requests when the source/manifest
  changes. Explicit addon refresh bypasses registry/manifest TTLs. Entry reads
  never write pins; user pin mutations are serialized.
- Vault `?view=summary` strips playback embeds/page URLs, retaining exact quality
  coverage, counts and series metadata. Full and `?id=` APIs remain compatible
  with watch playback. Forced summary refresh is not browser-cached.
- Music engine loads on first Music visit, then remains mounted across routes.
  Preserve useMusic compatibility for the legacy MusicCurtains component.
  Split lyrics/pocket mode chunks, defer search calculations, throttle off-route
  progress renders. Memoize Vault cards and open-sheet filter counts.
- Keep the Home hero transformation inside its existing timeout budget.

## Verification on the patched checkout
- Production build passed; source/import checks passed (252 modules).
- Navigation labels/icons/order preserved; Stremio full-document reload removed.
- Cache tests passed: immediate memory reads, coalesced writes, pagehide flush,
  expiry and invalidation.
- All 7,350 local Vault records retained exact quality coverage/counts. Uncompressed
  JSON: 5,230,613 → 3,055,581 bytes (42% smaller). This is not a live latency metric.
- Browser fixtures, 1440px and 390px: preference restoration without artificial
  save delays, retained Extras/Stremio content on refresh failure, source-change
  invalidation, no document reload, no automatic pin writes, Music shell entry.
- Audio fixture, both sizes: the same audio element continues playing through
  Music → Home → Music (served silent WAV, no external provider).
- Existing active-channel guide browser regression passed at both sizes.
- Existing Extras covers/registry tests passed. No JS errors in browser fixtures.
- Forward application and reverse application are checked on a clean baseline;
  applied files are compared byte-for-byte to the tested source.

## Apply
Use a clean checkout of the baseline commit. Do not apply this over the already
modified local workspace or combine it with the earlier cumulative patch.

```bash
git rev-parse HEAD
# Expected: d8b09350a5e182faec94e136c1d90f372bb1da3d
git apply --check /path/to/jashvibes-performance.patch
git apply /path/to/jashvibes-performance.patch
npm ci
npm run check
node scripts/test-nav-order.cjs
node scripts/test-performance-cache.cjs
npm run build
```

For optional full-data measurement:
`VAULT_DATA_PATH=/path/to/mv_vault/data/vault.json node scripts/test-performance-cache.cjs`

Browser tests need Playwright/Chromium, a production build and a local server:
`PASS=local-guide-test DB= LIVE_SYNC_MINUTES=0 KEEPALIVE=0 PORT=3000 npm start`.
Run `scripts/test-performance-browser.cjs`, `scripts/test-music-continuity-browser.cjs`
and `scripts/test-live-guide-browser.cjs` with Node. Set PLAYWRIGHT_PATH to an
isolated Playwright module if needed. Fixtures intercept API/media traffic;
no production DB or provider requests are required.

Not pushed or deployed. Test real-provider playback and hosting cold-start behavior
after deployment; neither is covered by the fixture tests.
