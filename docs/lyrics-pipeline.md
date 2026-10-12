# Lyrics pipeline

One provider, three guarantees. The lyrics stage must come up for the library,
and where it genuinely cannot, it must say so and let someone fix it once.

## Order of operations

```
song metadata ─→ owner/viewer-saved lyrics (database first, then this device)
              ─→ MongoDB lookup cache   (hit: 90 days   miss: 12 hours)
              ─→ LRCLIB retrieval ladder
                   1. /api/get        exact title+artist+album+duration signature
                   2. /api/search     fielded   track_name= across title variants
                   3. /api/search     free text q= across title variants
                   4. /api/search     free text "title + artist"
              ─→ tiered acceptance (match version 5)
              ─→ cache the outcome, then answer
```

Nothing else is ever called. `lib/musicSources.js` lists exactly one wired
source; the adapter slot stays in the code so a second provider can be added
later without a redesign.

## Why each piece exists

- **Retrieval ladder.** LRCLIB's fielded `track_name=` query is near-exact and
  its `q=` query is not: "Vandikkaran Sontha" returns zero rows fielded and six
  free-text, and the record is real. Title variants (vocal-version base, stripped
  parentheticals, film name) exist because catalogue metadata carries
  `(From "Film")` suffixes and `– Male` markers that break the fielded query.
  Breadth here never widens what is accepted.
- **Tiered acceptance.** `lib/lyricsMatch.js` decides, and only it decides:
  - `strong` — title + artist + album all agree;
  - `album-duration` — title + album + duration (credits differ across providers);
  - `artist-duration` — title + artist + duration (single vs soundtrack album);
  - `vocal-alias` — an explicit M/F version alias with album and duration.
  A duration far outside tolerance rejects even a strong match (a remix album can
  repeat a title and artist), and conflicting M/F versions always reject: a real
  bug showed male and female cuts sharing a duration to the second.
- **Budgets.** Each stage gets 2.5 s and the request 9 s in total, so the free-text
  stage cannot be starved by a slow exact lookup. A spent budget returns a
  reason, not a 503.
- **Persistence.** `models/LyricsCache.js` (TTL index) caches hits for 90 days and
  misses for 12 hours, shared across instances and surviving deploys. Reads and
  writes fail soft: a database outage degrades to uncached lookups, never to an
  empty stage.
- **Saved lyrics.** `models/LyricsOverride.js` holds lyrics the owner saved
  (Admin → Lyrics, served before any provider) and the lyric screen can save a
  viewer's own text for one song on that device. This is the floor under the
  provider's hard coverage limit — LRCLIB does not carry everything, and no
  amount of matching can conjure text that was never uploaded.

## Measured behaviour

- 40 well-known Tamil film songs (80s–2020s): 35 found by fielded search, 32 by
  free text, **36 by their union**, 80% with line timing, median latency 493 ms.
- The four remaining songs are absent from the provider in both query modes.
- The songs that used to fail *despite being present* (Vandikkaran Sontha,
  Sundari Neeyum, Uyirin Uyire, Raja Raja Chozhan) now resolve and carry timing.

## Client

`components/music/MusicEngine.jsx` starts the lookup as soon as a track is
selected — it no longer waits for the song-detail request, because a failed
detail call used to silence the stage even though lyrics come from a different
provider. When detail arrives, the signature changes and the controller
refreshes with album/id.

`components/music/CanvasLyrics.jsx` renders the three real states: found (with
the karaoke highlight when timing exists), not-found (with the reason plus
"Try again" and "Paste lyrics"), and unavailable (retryable provider failure,
never confused with "no lyrics").

## Verification

`node scripts/test-lyrics-pipeline.cjs` covers album-less matching, tiering,
rejection reasons, the M/F rules, retrieval variants, ranking, cache-key
stability, single-source wiring, the ladder, the store's fail-soft reads, the
admin gate and the screen's recovery actions.

## Operating notes

- Admin → Lyrics shows saved lyrics and the songs LRCLIB had nothing for, so
  gaps can be filled from a list rather than reported one at a time.
- Timed text (`[mm:ss.xx]`) keeps the karaoke highlight; plain text drops the
  stage to a static read.
- Changing the acceptance rules requires bumping `LYRICS_MATCH_VERSION`: the
  cache key embeds it, so old decisions expire instead of being replayed.
