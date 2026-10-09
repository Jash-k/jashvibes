# Imported Spotify lyrics fix

Base repository: https://github.com/Jash-k/jashvibes
Base commit: 75cb831b145b873810daf9b3e4b6c7fdb5a1d66b (performance tweak).

## Verified example
LRCLIB record https://lrclib.net/tracks/36408300 is Vandikkaran Sontha,
album Managara Kaval, duration 299 seconds, with plain Tamil and synchronized lyrics.
A live invocation of the patched route using a Spotify-style title/album and
S.P.Balasubrahmanyam / S. P. Sailaja metadata returned record 36408300 and both formats.
The first live attempt encountered upstream availability trouble; provider 429/503
cooldowns are still honored. This patch cannot guarantee upstream availability.

## Fix
- Preserve original Spotify metadata when retrieving/caching the playback detail.
- Resolve `(From "Film")` and HTML-encoded quotation marks in titles/album labels.
- Infer a film album when it is absent or merely repeats the track title; retain
  genuinely conflicting album metadata rather than silently replacing it.
- Normalize soundtrack suffixes and full artist names with differently spaced initials.
- Add bounded title-only retrieval if album-filtered search misses a result. All
  candidates still pass exact normalized title, album, artist/duration guards.
- Keep the two-second duration guard, rejected-ID exclusions, rate-limit cooldown,
  request cancellation and existing lookup deadline. No song-specific hardcoded ID.
- Bump lyric matching version to 3 to invalidate obsolete client lyric matches.

No playlist database changes or reimport required. Existing imports retain their
stored Spotify metadata. Reload the app after deploying, then replay/retry lyrics.
A different playback version or genuinely conflicting metadata can still be rejected.

## Apply
From a clean copy of the base commit:

```bash
git apply --check /path/to/jashvibes-spotify-lyrics.patch
git apply /path/to/jashvibes-spotify-lyrics.patch
npm ci
node scripts/test-lyrics-route.cjs
node scripts/test-spotify-lyrics.cjs
npm run check
npm run build
```

Tests passed: production build; source/import check (252 modules); existing wrong-version
and excluded-ID tests; new imported-title, film/entity cleanup, artist initials, retrieval
fallback, conflicting album and duration tests. No lyric database or real song lyrics
are bundled in the patch. Not deployed/pushed; no production DB writes.
