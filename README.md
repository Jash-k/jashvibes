# JaSH ViBeS — Fixed Canvas Music

Tamil-first browsing, a unified on-demand Watch page, curated Live TV and a lyrics-first Music workspace. Refactored from version 10.9.0, commit `9554091fd88e01cd5bfc157d1b85f14650b0524f`.

## Quick start

Use **Node 22 LTS** (minimum supported by dependencies: 20.9).

```bash
cp .env.example .env.local
# Fill PASS, ADMIN_PASS, DB and your metadata/provider configuration.
npm ci
npm run build
npm start
```

The server binds `0.0.0.0` on `PORT` (default **7860**). For development: `npm run dev -- --port 7860`.

**This is a source distribution.** Dependencies and generated builds are deliberately not included. A working MongoDB database, viewer/owner passwords and upstream configuration are required for a full deployment. No credentials are included.

## Behaviour

| Entry point | Auto source order |
|---|---|
| Home / Vault | Vault → Stremio → Direct MP4 → Mirchi |
| ReTro | Item's Aha/Eros streams → Vault → Stremio → Direct MP4 → Mirchi |
| Stremio | Stremio → Vault → Direct MP4 → Mirchi |

All on-demand cards open **Watch**. Season/episode identity, resolution and source are separate controls. Unidentified Home titles open Watch and can be matched there. Legacy Vault/ReTro/Stremio player links are redirected rather than removed.

- Cross-origin iframe `load` is **not video playback verification**. Iframe failure requires **Try next source** or the provider menu; there is no blind timeout-based provider switch.
- Auto native/Shaka errors try bounded alternatives, then advance. An explicitly selected provider stays selected until you choose another.
- Live TV remains on `/live`. Explicit same-channel alternative groups can recover in Auto; there is no movie-provider fallback or fuzzy channel-name switching.
- **Manual Live map/unmap choices are authoritative.** Sync registers new candidates as unmapped. Health does not delete catalogue memberships. Empty catalogues stay empty; database failure is reported instead of masquerading as raw Jio fallback.
- Music uses a fixed viewport on desktop and mobile: New / Tracks / Albums / Artists / Playlists, a desktop library/player split, a mobile library sheet, persistent transport, Bloom/Cinema/Noir lyrics, queue and settings overlays. Only library/lyrics panels scroll; no page scrolling. Browsing does not replace the queue. Music yields audio focus to Watch/Live; exhausted same-track recovery offers Retry/Skip.

See [approved behaviour](docs/BEHAVIOUR.md), [architecture](docs/ARCHITECTURE.md) and [changes](CHANGELOG.md).

## Deploy

### Node service (Render / Koyeb / VPS)

- Build command: `npm ci && npm run build`
- Start command: `npm start`
- Add configuration through the platform's secret/environment settings; do not commit `.env.local`.
- Health endpoint: `/api/health`. Database/source health is a separate concern.
- Use `PORT` supplied by your host, or 7860. Set `SITE_URL` to the HTTPS public origin when available.

### Docker / Hugging Face Spaces

```bash
docker build -t jashvibes .
docker run --env-file .env.local -p 7860:7860 jashvibes
```

The image uses Node 22, Next standalone output and explicit `HOSTNAME=0.0.0.0` / `PORT=7860`. Secrets are injected **at runtime**. The same source can use ordinary `npm start`; a standalone launch must set `PORT` explicitly.

Do not expose MongoDB directly to browsers. Use a persistent managed database; a container filesystem is not the mapping store. Multiple app replicas can each run the in-process scheduler; use a single scheduler instance or `LIVE_SYNC_MINUTES=0` on the others.

## Database upkeep

```bash
npm run db:audit                                  # read-only: duplicates, dead channels, unused indexes
npm run db:clean                                  # safe tier — duplicates, channels whose source is gone, counters, indexes
npm run db:clean -- --all                         # + the app's own unused / broken / not-seen / hidden rules
npm run db:clean -- --drop media                  # + drop a named legacy or unknown collection
```

Dry by default: the audit changes nothing and every write mode prints its plan first. Favourites,
manual channel maps, guide overrides, catalogue overrides and manual title matches are never
removed, and VOD items are only ever reported — `/api/vod` still lists them. Uses the same
`DB` → `DB_URI` → `MONGODB_URI` chain as the app, so it runs from your machine or a host shell.
See [database maintenance](docs/DATABASE-MAINTENANCE.md).

## Upgrade from 10.9

1. **Back up MongoDB** and exported Live configuration first.
2. Preserve your database URI and existing source settings. Deploy this source with a fresh install/build; don't copy an old `.next` directory.
3. Viewer and owner tokens now contain signed expiry timestamps. **Sign in again** after upgrading; old indefinite hash tokens are not accepted.
4. Live source deletion uses tombstones so defaults do not resurrect. Ordinary refresh/sync does not reset memberships. User-managed/unmapped rows are protected from automatic purging.
5. Reapply any choices already erased by the old auto-mapping/health code, or restore them from your backup. Their old intent cannot be inferred reliably from erased records.
6. Check owner source configuration, run sync, then publish new Live channels manually. Use **Alternative group** only for the identical channel across providers.
7. Validate your actual source headers, licensed media/DRM and deployment region/device. A build or metadata response is not proof of playback.

ReTro source deletion removes that source's streams while retaining shared titles. Manual metadata and removed-title overrides survive subsequent sync. Disabled/empty source registries are authoritative.

## Verify a deployment

```bash
npm run check   # parse every source module and validate local imports
npm run build   # production build (Next 16, webpack)
npm start       # binds 0.0.0.0:$PORT (default 7860)
curl -fsS http://localhost:7860/api/health   # unauthenticated, used as the platform health check
```

This distribution ships **no CI and no test suite** — it is the deploy bundle. A green build and a healthy
`/api/health` do not prove playback: production-DB persistence, real DRM, geo-restricted providers and the
Docker runtime need your own acceptance checks against the running deployment. See
[verification scope](docs/VERIFICATION.md).

## Sources and limitations

The app retains Vault, configured Stremio addons, Moviesda direct-file discovery, Mirchi, ReTro M3U/JSON sources, Live source feeds and Saavn/LRCLIB music integration. Third-party availability, URL expiry, supported codecs and entitlement are outside the app's control. Configure a working `SAAVN_API` / `SAAVN_MIRRORS`: the old public Render default was observed returning 404. Album detail failures are no longer hidden by presenting unrelated search songs as the requested album.

The remote Worker adapter is **not an active shipped stream relay**. Direct playback and the authenticated server relay are the supported transport paths. Proxies validate/pin public DNS destinations, validate redirect hops, bound header/idle waits and retain the correct playlist base. They do not provide access rights, defeat DRM or solve every codec/region restriction.

Use only providers, streams and credentials you are authorized to access. This project does not distribute media, DRM credentials or production secrets.

## Fixed Canvas Music release

See [Music layout and verification](docs/MUSIC-CANVAS.md). Configure your real DB, viewer/owner passwords and upstream services using `.env.example` before deployment. Run `npm ci`, `npm run check`, `npm run build`, then `npm start`. This source ZIP does not include node_modules or a generated build.
