# Architecture

## Surfaces

`/watch/[type]/[tmdbId]` is the sole on-demand playback surface. The dynamic parameter name is retained for URL compatibility; Vault/ReTro/Stremio references are namespaced by the `type` segment rather than coerced into numeric TMDB IDs.

- `lib/watch/policy.js`: pure entry priorities, source descriptors, resolution parsing, identity/link construction.
- `hooks/useWatch.js`: cancellation/generation-owned title context and bounded provider selection. Provider selection, episode and quality are independent.
- `/api/watch/source`: per-provider discovery; the browser advances providers only according to the policy. Vault and ReTro references are read through their existing data endpoints.
- `components/player/JashPlayer.js`: video chrome, correctly wired grouped source/episode callbacks and exposed manifest quality API.
- `components/player/usePlaybackEngine.js`: native/Shaka attachment, recovery, progress and generation checks.
- `lib/player/policy/*`: direct, licensed VOD and Live source transport/DRM behaviour. Key material is validated, not blindly hex-stripped.

## Music

- `MusicProvider.jsx`: persistent track/queue orchestration and independently keyed library/lyrics data. It is mounted inside the unlocked root so leaving `/music` does not destroy audio, and locking the app does.
- `useAudioPlayback.js`: attachment, cancellation, bounded initial readiness and same-track position retention.
- `MusicShell.jsx`, `CanvasLibrary.jsx`, `CanvasLyrics.jsx`, `CanvasBits.jsx`: fixed viewport presentation, bounded panel scrolling, five library categories, lyrics follow, and accessible queue/settings overlays. Route CSS lives in `music-canvas.css`.
- Library facets have independently stored responses and generation guards; empty successful responses remain empty rather than being replaced by home summaries.
- `mediaFocus.js`: one owner across music/video/opaque frames. Browser background-playback restrictions still apply.

## Live persistence

MongoDB owns catalogue memberships and ordering, not browser caches or feed sync. `mappingManaged` protects explicit unmaps from purge; `epgOverride` uses `null` for no override and `''` for an intentional no-guide choice. Source metadata keeps `sourceTvgId` separate. `logicalChannelId` is an explicit owner-defined same-channel group, never inferred from a loose title.

Source sync updates upstream fields and preserves the channel's stable existing identity where unambiguous. Health only updates availability/counters. Source tombstones prevent default-source resurrection. Signed owner authentication is required for service mutations; per-channel UI queues, idempotent membership operations and Mongoose optimistic concurrency prevent silent lost edits.

## Security and deployment

Viewer/owner sessions use realm-specific HMAC signatures with issued/expiry times and revocation epochs. Legacy indefinite tokens are rejected. Missing viewer configuration fails closed. The owner page has its own realm instead of demanding the theatre password first.

`lib/server/safeFetch.js` resolves and validates every redirect destination, pins the approved address to the actual socket, blocks private/reserved addresses and strips sensitive cross-origin redirect headers. Header and idle timeouts are separate so a long media stream is not cut off by a total-download timer. Bounded text reads protect playlist rewriting; rewritten relative HLS URLs use the final upstream base.

Next 16 is pinned and built with webpack for existing engine compatibility. Node 22 is the recommended deployment runtime; the container uses standalone output and explicit port 7860. In-process caches/jobs are not durable configuration stores; the MongoDB and source acceptance checks remain deployment responsibilities.
