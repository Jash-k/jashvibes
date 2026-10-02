# 11.0.0 — unified playback and durable curation

## Requested behaviour

- Home, Vault, ReTro and Stremio catalogue entries use one Watch surface, with entry-specific approved priorities and preserved legacy links.
- Separate provider, episode and resolution controls; current episode survives source/quality switching.
- Hybrid recovery: native/Shaka errors use bounded alternatives; opaque iframe changes are explicit. Manual provider selections do not silently drift.
- Unmatched Home items enter Watch and support local TMDB/IMDb identity matching.
- Live stays dedicated. Explicit same-channel alternative groups, direct/targeted-relay transport and locked manual sources.
- Durable Live manual mapping/unmapping, protected empty lineups and guide overrides, non-destructive health state, source tombstones and unpublished new candidates.
- Lyrics-first Music redesign, independent collection/navigation/queue state, stale-response guards, persistent audio focus, inline errors and position-preserving bitrate changes.

## Correctness and maintainability

- Removed three independent on-demand playback implementations; retained compatibility redirects.
- Corrected grouped player callbacks, native-HLS policy handling, downward gestures, delayed recovery generation checks and watchdog placement.
- Fixed type-aware Vault matching/global quality badges, correct episode history URLs, cross-tab version notifications, Stremio raw-row paging and empty-pin persistence.
- Protected ReTro metadata/removal overrides, retained stream type, seeded registries only once and preserved other sources when a source is withdrawn.
- Fixed key normalization/HTTPS licence handling, source-level headers/filter retention, deep-check metadata propagation, ambiguous EPG prefix handling and owner guide context.
- Failed/empty Home scrape no longer overwrites the previous good catalogue. Related song searches are no longer passed off as a verified album tracklist.
- Player HTTP transport, media focus, Watch priorities, Music presentation/orchestration/attachment and public-destination fetch validation are separate modules.

## Security and operations

- Signed, expiring, realm-specific sessions; old indefinite hashes are retired. Password/epoch rotation revokes sessions; missing viewer configuration fails closed.
- Independent owner gate and owner-only service/data mutations. Cross-origin owner mutations rejected; local viewer favourites remain browser-only.
- Shared public-IP/DNS pinning with redirect validation, sensitive-header stripping, bounded waits, playlist read limits and final-base rewriting.
- Content Security Policy and consistent 7860/PORT handling. Separate scheduler and keepalive controls; Node 22 standalone container.
- Next 16.3.8 and compatible dependency updates. npm audit reports zero known vulnerabilities at verification time.
- Portable source/import checker, deterministic regression suite, browser fixtures and deployment documentation.

## Important limits

Third-party playback/entitlement/DRM, production MongoDB, multiple replicas, browser background restrictions and Docker runtime need deployment acceptance. The remote Worker adapter is not an active relay. Existing choices already deleted by the old logic require backups or manual reapplication. See docs/VERIFICATION.md.
