# Scripts and tests — what each one is for

Nothing in `scripts/` ships to the browser or runs in production. The app does not
import any of it; a script is either a **check** (run it, read the exit code) or a
**tool** (run it when a specific job needs doing). This file exists so the folder
can be judged instead of guessed at.

## Checks — run these before a deploy

| Script | What it proves |
|---|---|
| `check-source.cjs` | Every `@/…` and relative import in 279 modules resolves, and every named import exists in the module it comes from. This is `npm run check`; a typo'd import otherwise surfaces only at runtime. |
| `test-lyrics-pipeline.cjs` | The lyric pipeline contract: album-less matching, the five acceptance tiers including `catalogue-suffix` (decorations stripped from this app's title only, never M/F, Live, Instrumental or language markers; artist/album agreement and a matching length still required), rejection reasons, M/F vocal rules, retrieval variants, ranking, cache-key stability, one wired source, retrieve-once and the store's fail-soft reads — then the record list: the measured question order (`track_name` alone, the artist only when that page yields nothing acceptable, one free-text question only when both are empty — a refusal is never retried), the merged and never-narrowed list, the same lookup filling the list and the match, a busy provider answered from memory with a retry symbol, a failure remembered nowhere, the post-outage miss ignored, the rows that only mark a choice, the dropdown that lists the same records by title and marks, a tick that saves it through the admin store and audits it, no lyric text ever accepted from the browser, one word of chrome in the header, no printed wording anywhere else, and a list that renders inside the panel on every screen size. |
| `test-lyrics-controller.cjs` | The retry/cancel state machine in `lib/lyricsController.js`: superseded requests never publish, a failed refresh never erases good lyrics, retry delays are honoured. |
| `test-vault-admin.cjs` | Vault Admin: catalogue/language conflict rules, metadata and playback staying separate, overlay visibility, custom items, auth wiring, optimistic-revision checks. |
| `test-player-runtime.cjs` | The transport readout: live/unknown lengths suppressed, elapsed measured from the seek window, phone vs desktop forms. |
| `test-loading-system.cjs` | The loading/switching contract: the splash minimum and slow phase, one rail/dock host across route changes, the content-only crossfade, the ~180 ms CSS delay that hides a fast fallback, per-section skeleton geometry, and exactly one pending indicator. |
| `test-music-pocket.cjs` | Music focus mode: the wake lock (requested in the click, released on exit, re-taken on return, refused/unsupported reported honestly), the per-view blur map, the Artwork/Lyrics toggle layered above the touch guard, all four exits, the removed mobile exit button, the absence of the old pocket/listening prototype, the rule that the **Lyrics view renders no artwork** (so it has no blur rule left either), the rule that **focus never resizes the sleeve** (no focus rule may touch `.mc-now-art`, and every unlocked disc size must still exist), and the rule that a **desktop is never rearranged by playback** (only a phone takes the screen over, `focus=1` is written by the expand glyph or the Lyrics button, and a bare `/music` opens the plain screen). |
| `test-nav-order.cjs` | Desktop rail and mobile dock order, labels, active routes — the shared-nav contract. |
| `test-performance-cache.cjs` | Session cache read/write/expiry and scroll restore. |
| `test-extras-registry.cjs` | Extras validation: URL rules (no javascript:, no localhost/private hosts, no credentials in URLs), ordering, duplicates, version conflicts. |
| `test-extras-covers.cjs` | Extras cover handling. |
| `test-admin-controls.cjs` | The admin panel's control room: home order/pins/sections and home positions, undo routing and its refusal reasons, orphan detection and re-bind suggestions (including that suggestions never cross movie/series), the bulk planner's no-op and pin-preservation rules, duplicate grouping, the dry-run diff and its orphan forecast — plus the standing rule that **every** mutation route records an action and every destructive path declares itself irreversible. |

One command for all of them: `npm run verify` (added by the cleanup) — it stops on
the first failure and prints which check failed.

## Browser tests — opt-in, need Playwright

These drive a real browser and therefore need `npx playwright install chromium`
first. They are **not** part of `npm run verify`, because the dependency is ~300 MB
and a deploy does not need it. Run them when you touch the screen they cover.

| Script | What it covers |
|---|---|
| `test-live-browser.cjs`, `test-live-guide-browser.cjs`, `test-live-startup.cjs` | Live TV: channel playback, EPG guide, first-load autoplay |
| `test-music-browser.cjs`, `test-music-continuity-browser.cjs`, `test-music-focus-browser.cjs`, `test-music-native-nav-browser.cjs` | Music: shelf, continuous playback, lyrics focus, native navigation |
| `test-lyrics-flow-browser.cjs` | The lyric stage end to end |
| `test-watch-clarity-browser.cjs` | Watch page source/quality clarity |
| `test-performance-browser.cjs` | Perceived performance of the heavy rails |

## Tools — run when the job exists

| Script | Purpose | Touch level |
|---|---|---|
| `verify-vault.mjs [path\|url]` | Validates a `vault.json`: every movie normalises to the legacy field set, series group into ordered episodes with no embed lost, player opens on the earliest 1080p episode. Defaults to the live upstream catalogue. | read-only |
| `live-doctor.mjs <url>` | Parses one live source and classifies every channel (transport, DRM, headers) so a dead feed can be diagnosed without opening the app. | read-only |
| `db-maintenance.cjs` | Mongo index/hygiene audit behind `lib/dbMaintenance.cjs`: audits counters, prints what it would drop, and only drops the known low-value index set. See `docs/DATABASE-MAINTENANCE.md`. | **writes** — audit first |
| `alias-loader.mjs` + `alias-register.mjs` | Lets plain Node run app modules that use the `@/` path alias (used by `live-doctor.mjs`). Not a test. | none |
| `make-manifest.cjs [--release name]` | Regenerates `RELEASE-MANIFEST.json` (sha256 + bytes for every shipped file, plus the module count). `--check` reports drift instead of writing. The manifest used to be hand-edited and had started listing deleted routes. | **writes** — the manifest only |
| `start.cjs` | The production launcher used by `npm run start` (binds `0.0.0.0`, honours `PORT`). | runtime |

## Why the folder is worth keeping

`check-source` + the seven contract tests are the only thing standing between a
refactor and a silent break in lyrics, Vault, the player or navigation — they run in
under five seconds with no dependencies. The browser suites are the only
end-to-end evidence for the three screens that are hardest to eyeball. The tools are
the difference between "the live feed is broken" and knowing which codec or header
failed. Total weight: ~120 KB.

Deleted in the cleanup, because they asserted behaviour that no longer exists or
could never run: `test-content-reliability.cjs`, `test-lyrics-route.cjs`,
`test-lyrics-reliability.cjs`, `test-lyrics-vocal-versions.cjs`,
`test-spotify-lyrics.cjs` (all pre-v5 lyric rules — superseded by
`test-lyrics-pipeline.cjs`), and `test-live-compatibility.mjs` (a copy of another
repo's fixture, which could not resolve the app's `@/` alias).
