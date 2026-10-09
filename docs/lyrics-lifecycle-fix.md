# Lyrics lifecycle reliability patch

Base: `4f8936ede6b14dc3a9735502b305b374581b896c` (`lyrics fix`).
This is an incremental patch over the already-applied Spotify lyrics and performance fixes, not a cumulative update.

## Root causes and changes

- CanvasLyrics and MusicEngine both initiated lookups. Song-detail loading independently reset/aborted them. CanvasLyrics is now display-only; one engine-owned controller handles automatic requests, refresh and retries.
- Loading/old-track states were rendered as no-match. State is now scoped to song identity AND lookup metadata/exclusions during render, before effects run. Song details settle before automatic lookup; detail requests have a 12-second timeout and can fall back to available summary metadata after failure.
- Metadata changes on the same song ID now invalidate the lookup signature. Spotify metadata handling and conservative title/album/artist/duration checks remain intact.
- Duplicate clicks share in-flight work. Track changes cancel requests and retry timers; late responses cannot commit. Successful results are retained in a bounded one-hour in-memory cache. Refresh keeps good text; rejection invalidates the selection instead.
- Transient failures receive at most two automatic retries (three attempts total). Retry-After is honored; waits longer than 60 seconds end in a retry-later state instead of holding the UI indefinitely. Refresh cannot bypass an active retry wait.
- Server network errors, timeouts, malformed responses, 429/503 and expired queue entries are no longer cached as missing lyrics. Complete no-match lookups retain a 60-second cache; successful lookups retain a one-hour cache. Queue admission/waiting is bounded and expired queued work is skipped.
- Default API reports retryable errors with HTTP 503 and Retry-After. Forced source and picker responses expose retryable/retryAfter without changing their existing response format. Configured track-ID fallback is still attempted if LRCLIB fails.

## Research and Pookara

LRCLIB documentation: https://lrclib.net/docs — sequential requests, 200–500 ms spacing, Retry-After, 404 versus 429/503, and the two-second duration tolerance. The existing 220 ms sequential throttle is retained.

A live title/album search for Pookara/Citizen returned exact-title plain and synced records, including 6450583 (380 seconds) and 9103586 (381 seconds). Other records use Pookara Pookara and different durations. An adjacent live query returned 503: provider trouble is not evidence that lyrics do not exist. No song IDs or lyrics are hardcoded into application code. Tests use synthetic text with representative metadata.

## Verification completed

- Production build; source check (253 modules); git diff whitespace check.
- Existing lyrics-route and Spotify metadata tests.
- New controller tests: delayed readiness, dedupe, A→B→C late responses, back/cache, retained refresh, changed metadata, unmount, automatic recovery, bounded failures, cooldown cancellation.
- New route tests: Pookara metadata, provider cooldown, recovery without poisoned negative cache, true no-match caching, forced-source and picker error signaling.
- Production Chromium browser tests at 1440px and 390px: delayed metadata → 503 → automatic success, no false unavailable state, no panel-remount refetch, continued audio through Music → Home → Music.
- Existing desktop/mobile audio-continuity tests.

Browser tests use mocked API responses and a generated silent WAV. They do not prove that every production/provider track will return lyrics, nor exercise an actual Spotify import or every legacy source-picker interaction. Rapid multi-track races are covered at controller level, not full browser level. No deployment, production DB writes or GitHub push performed.

## Apply

From the updated repository at the base above (back up any local edits first):

```sh
git apply --check jashvibes-lyrics-lifecycle.patch
git apply jashvibes-lyrics-lifecycle.patch
npm ci
npm run check
node scripts/test-lyrics-controller.cjs
node scripts/test-lyrics-reliability.cjs
node scripts/test-lyrics-route.cjs
node scripts/test-spotify-lyrics.cjs
npm run build
```

Deploy/restart through your usual process. Do not reapply the earlier Spotify patch. No playlist reimport or database migration is needed. Existing browser-restored lyric text is deliberately revalidated on a full reload; in-session back navigation reuses successful results.
