# Parthu Parthu M: guarded vocal-version matching

Base: `3e52caa69eddb3af01d65ea4581e18f4274fc807` (`lyrics delay`), freshly fetched from https://github.com/Jash-k/jashvibes.
This incremental patch preserves the already-applied lyrics lifecycle/retry fix. It is not a cumulative patch.

## Why this song failed

The playback catalogue and lyrics catalogue use different metadata:

| Field | JioSaavn | LRCLIB |
|---|---|---|
| Title | Parthu Parthu M | Parthu Parthu / Parthu Parthu (Male) |
| Album | Nee Varuvaai Enaa | Nee Varuvaai Ena (Original Motion Picture Soundtrack) |
| Credits | Includes composer, lyricist, actors and Vaikudavaasan | S. P. Balasubrahmanyam |
| Duration | 4:32 | 272 seconds |

Searching LRCLIB for the full `Parthu Parthu M` title returned no records in the live check. Even when candidates were retrieved, the previous matcher rejected the title and album differences. This is a metadata issue distinct from the earlier loading/request race.

## Fix and safeguards

- Parse M/F, (M)/(F), Male/Female and Male/Female Vocals suffixes as vocal-version hints, separate from the original title.
- Search the base title when a vocal suffix is present, but retain the version in the acceptance rules.
- Accept an alias only when both records name the same vocal version, at least one spells out Male/Female, the base titles agree, the film agrees, and duration is within the existing two-second limit.
- Allow repeated *word-final* Latin vowels in the album spelling (Enaa/Ena) only in this vocal-version path with duration evidence. No general fuzzy title/album matching or consonant substitutions.
- Do not infer vocalist identity or gender from the supplied cast/composer credits. No singer aliases are hardcoded.
- Do not silently strip M/F and accept an unlabelled version: the female records have the SAME duration here.
- Prefer exact-title matches over accepted aliases; use stable record-ID ordering only as the final tie-break.
- Bump matcher/cache version to 4. No title, artist or lyric-record IDs are hardcoded in application code.

## Live result

Using the user's title and artist list, with the catalogue album and duration:

- Exact LRCLIB get: 404.
- Base-title search with original album spelling: 200, no acceptable result.
- Base-title search without album filter: 200, selected **13119036**, `Parthu Parthu (Male)`, `S. P. Balasubrahmanyam`, **272 seconds**, plain and synced lyrics both present.

The linked 10753038 record does contain lyrics, but is unlabelled. The fix deliberately chooses the explicitly male record instead of pinning that ID. A later live verification first received 503 and then succeeded after respecting the provider cooldown, confirming the earlier retry/error distinction remains useful.

Sources checked:
- https://lrclib.net/api/get/10753038
- https://lrclib.net/api/search?track_name=Parthu%20Parthu
- https://www.jiosaavn.com/song/parthu-parthu-m/Og8jaS1bAn4
- https://gaana.com/song/parthu-parthu-m

## Verification

Passed:
- New vocal-version matcher and route tests (synthetic lyric text with representative catalogue metadata).
- Male/female separation at equal duration, unlabelled-result rejection, missing/conflicting album, missing/wrong duration, remix rejection, all supported version spellings, stable ordering, retrieval fallback, source picker/forced source and rejected IDs.
- Existing Spotify/Vandikkaran, route/wrong-duration, Pookara/provider reliability and lyrics-controller regressions.
- Source check: 253 modules.
- Production build.
- Live server-route lookup of this song, including a transient 503 followed by success.

No UI/playback code changed. Browser/audio tests were not rerun for this metadata-only patch; the previous lifecycle patch's browser tests remain available. No production playback inspection, deployment, GitHub push, or database writes were performed. Provider records and availability can change; this does not guarantee lyrics for every catalogue variant.

## Apply

From the repository at the base above, back up local edits, then:

```sh
git apply --check jashvibes-lyrics-vocal-version.patch
git apply jashvibes-lyrics-vocal-version.patch
npm ci
node scripts/test-lyrics-vocal-versions.cjs
node scripts/test-lyrics-route.cjs
node scripts/test-spotify-lyrics.cjs
node scripts/test-lyrics-reliability.cjs
node scripts/test-lyrics-controller.cjs
npm run check
npm run build
```

Deploy/restart normally, then reload the app. No reimport or database migration is needed. Do not reapply the previous lyrics patches.
