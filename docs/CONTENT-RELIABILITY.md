# Vault, lyrics and Music navigation reliability patch

## Patch baseline
Apply after Vault Lens + full-vinyl (either original or whitespace-clean variant). Earlier Music patches remain required. No data writes or catalogue upstream edits occur.

## Vault classification
Known original-language metadata takes precedence over a contradictory category. `ta`, `tam`, `tamil` map to Tamil originals; other known codes map to dubbed sections. Category still determines the movie/series browsing dimension when present; playback `kind` and episode IDs remain untouched. Missing language uses a known category; missing both stays unclassified. The inspected public catalogue had two known non-Tamil/category conflicts. Metadata itself can be wrong, so this is not a guarantee of perfect curation. Do not classify by the title's alphabet: Tamil films can have English titles.

## Lyrics research and choice — 2026-10-08
Primary: LRCLIB, https://lrclib.net/docs. Its official API is anonymously accessible without a required key, supports plain/synchronized lyrics, and documents matching track signature including duration within two seconds. It requires a client identifier, Retry-After handling, and considerate sequential request spacing. These are implemented per server process, along with bounded caching. Multi-replica deployments have separate queues/caches.

Alternatives reviewed:
- Genius: https://docs.genius.com/ — registered/authenticated API, annotations/song metadata; commercial use requires a licence. Not selected as a keyless synchronized-lyrics replacement.
- Musixmatch: https://docs.musixmatch.com/overview — licensed Pro platform; no verified free full/synchronized endpoint chosen.
- lyrics.ovh documentation probe returned 502; no verified Tamil coverage or stronger identity metadata demonstrated. Not added as an unreliable fallback.

LRCLIB remains the recommended free fit, not a claim of objectively best coverage across all languages. No unauthorized private API or third-party lyric-page scraper was added. Availability of an API is not a blanket licence for downstream commercial use.

Live record metadata probes:
- Namaste / DC included 117, 134, 150, 151, 269 second records.
- Ain't Nobody / DC included 71, 150, 162, 163 second records.
No record is hard-pinned and no lyric text is redistributed in this report. Actual duration/version determines acceptance.

Matching:
- LRCLIB is the only lyrics provider. Saavn is no longer called by this route: it had no default base and was dead unless SAAVN/SAAVN_API was configured, so it is no longer presented as a fallback.
- Acceptance is tiered (match version 5). Strong: title + artist + album agree. Album+duration or artist+duration tiers accept records whose supporting credits differ across providers (composer vs singer, single vs soundtrack). A duration difference beyond tolerance rejects even a strong match, and conflicting M/F vocal versions always reject.
- Retrieval asks both of LRCLIB's questions — the fielded track_name= query and free-text q= — across title variants (vocal-version base, stripped parentheticals, film name). Measured: records such as Vandikkaran Sontha are invisible to the fielded query and found by free text. Retrieval breadth never widens acceptance.
- Every stage owns its time budget (2.5 s each, 9 s total) instead of sharing one deadline, so a slow first stage cannot cut off the stage most likely to succeed.
- Rejections are reported with a reason (not-in-catalogue, identity-rejected, provider-error, missing-metadata), so the stage can say why instead of showing an empty column. A provider outage is retryable and never presented as "this song has no lyrics".
- Successful lookups cache in MongoDB for 90 days and misses for 12 hours, shared by all instances and surviving deploys. Reads fail soft: without a database connection lyrics still resolve, they are simply not cached.
- Lyrics saved by the owner (Admin → Lyrics) are served before any provider is asked, so a song LRCLIB does not carry can be filled in once and then always resolve. Viewers can also paste lyrics for one song on their own device from the lyric stage.
- Wrong lyrics? excludes the current LRCLIB record for the specific song on that device. This is local storage, not a global correction, not a report to LRCLIB. It tries another validated result and does not modify the audio queue.
- Community data can contain wrong text even when metadata matches. No automatic policy can prove semantic correctness. Uncertain matches return unavailable.
- Measured coverage: 36/40 well-known Tamil film songs retrieved across both query modes (~80% with line timing, median 493 ms). The remaining songs are genuinely absent from the provider and are what the paste/owner path exists for.

## Navigation
Music nav links explicitly prefetch the route on supported connections and on intent. Link pending state displays a lightweight shell; app/music/loading.js supplies a Suspense route boundary. Existing page and audio provider are not torn down via hard reload. Catalogue fetches remain client-side and don't gate the route.

No production latency benchmark is claimed. Host cold starts, device CPU, network, and image payloads remain external factors. Browser fixture checks showed the library shell before 2.5-second delayed music APIs at mobile and desktop sizes.

## Verification
- Source/import check: 227 modules, no local import errors.
- Production webpack build: passed.
- scripts/test-content-reliability.cjs: classification, sorting, lyric identity invariants passed.
- scripts/test-lyrics-route.cjs: mocked actual route rejects wrong-duration exact response, selects valid search result, caches, and excludes a rejected ID.
- scripts/test-music-navigation.cjs: Chromium desktop/mobile shell navigation with delayed catalogue fixtures passed. Optional @playwright/test tooling required, and built server on port 7860.
- Live lyric text correctness, deployment-origin response times, and production database were not verified.
