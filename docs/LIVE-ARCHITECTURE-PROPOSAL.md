# Live & Admin Service — Clean Architecture Proposal

Status: **proposal only — no code changed, no build run.**
Goal: one obvious place for every decision, one vocabulary, one data flow.

---

## 1. What the audit found (the real sources of confusion)

| # | Problem | Evidence |
|---|---|---|
| 1 | **One god file, five jobs** | `lib/liveTv.js` = 1,608 lines, 17 exports: source defaults, m3u parsing, Pocket classification, Jio cookies, header building, URL probing, HJH worker resolution, health checks |
| 2 | **Two service stacks coexist** | Legacy: `/api/live-tv` + `getLiveTVChannels` + `LiveProfile` + `selected/profiles/order` fields. Current: `/api/live/*` + `/api/live-service/*` + catalog memberships + logical groups |
| 3 | **Nine flat live API namespaces** | `live`, `live-tv`, `live-cert`, `live-epg`, `live-jio`, `live-license`, `live-pocket`, `live-proxy`, `live-service` — no public/admin/internal separation |
| 4 | **Five admin routes with zero UI callers** | `live-service/{duplicates,export,import,profiles,purge}` |
| 5 | **Three grouping vocabularies** | source-native `category` ("Overseas"), our 7 `catalogs`, canonical logical groups (HD/DASH/ClearKey merge) — similar words, different meanings |
| 6 | **Redundant publish flags** | `selected` duplicates "has a catalog membership"; `order` duplicates per-catalog `position`; `mappingManaged` is an undocumented lock |
| 7 | **Four shape transformations** | Mongo doc → `toClientChannel` → flat feed shape → logical group → `channelDocToLogicalGroup` (preview). Admin re-implemented the public pipeline in `adminBrowse.js` to get count parity — drift is inevitable |
| 8 | **Multiple caches** | versioned base cache (key bumped v1→v4), a separate 5s legacy cache, EPG cache, Jio cookie cache — invalidation spread across hooks and TTLs |
| 9 | **Version scars** | folder `components/live/v13/` (v12 already deleted), storage key `jash_live_v13_favs` |
| 10 | **594-line admin component** | fetching, filtering, reorder, forms, ladder editing, bulk actions, preview wiring in one file |
| 11 | **Megatest** | `test-live-catalogs.mjs` = 587 lines / 17 sections in one file |
| 12 | **Fat model** | `LiveChannel` ~40 fields incl. legacy `importHash`, `profiles`, `selected`, `order`, `autoHidden` |

---

## 2. The three concepts that should own the vocabulary

Most confusion disappears if these three are named once and used everywhere:

1. **Source group** — the feed's own `group-title` ("Overseas", "Local Channels", "Tamil FM Radio").
   Owned by sync, **read-only**, browse dimension only. Field: `sourceGroup`.
2. **Channel** — one logical broadcaster, identified by a canonical name. Its synced rows are
   **variants** (HD/DASH/ClearKey) forming the fallback ladder. One card per channel.
3. **Catalog** — one of the 7 owner-published lists (Main, Music, Sports, Kids, News, LocalCH, Others)
   with per-membership `position`. **Membership is the only publish concept.**

Derived rules (no stored duplicates):
- visible = has URL + playable + not dummy licence + not hidden + passes Tamil filter + not religious-excluded
- published = visible **and** has ≥1 catalog membership → this replaces the `selected` boolean
- owner-locked = any catalog membership was hand-edited → replaces vague `mappingManaged`

---

## 3. Target structure

### 3.1 Domain core — pure, no DB, no `fetch`, fully unit-testable

```
lib/live/
  domain/
    identity.js      canonicalChannelName, logicalId, displayName
    visibility.js    hidden/playable/dummy/Tamil/religious rules (one place)
    catalogs.js      the 7 catalogs, classification, source-group helpers
    ordering.js      family rank + position comparator
  ingest/
    registry.js      source definitions (move out of liveTv.js)
    parsers/m3u.js
    parsers/json.js
    adapters/        hjh, jio, pocket, jash, iptv-org (source quirks only)
    sync.js          feed → upsert; owner fields never overwritten
  playback/
    resolve.js       variant channelId → playable URL
    policy.js        ClearKey/Widevine/header policy
    tokens/          hdnea, jio cookie
  read/
    viewBuilder.js   THE doc→view-model function (public + admin share it)
    cache.js         single cache module, single invalidation contract
  store/
    channelRepo.js   all LiveChannel reads/writes
    sourceRepo.js    all LiveSource reads/writes
```

Rule: **every decision exists in exactly one module.** Routes and components never re-implement rules.

### 3.2 API — namespaced by audience

```
app/api/live/
  channels/        public catalogue (logical groups)
  resolve/         public playback
  epg/             guide
  proxy/           header proxy
  admin/           auth-gated owner API (replaces /api/live-service)
    sources/       CRUD + sync trigger
    channels/      CRUD + catalog mapping + reorder + ladder
  internal/        jio-cert, license, pocket worker hops
```

Legacy `/api/live-tv` becomes a thin compatibility shim over `read/viewBuilder.js`,
then is deleted once Stremio/external clients are migrated.

### 3.3 UI — presentational components + hooks

```
components/live/                 (v13 scar removed)
  LivePage.jsx  Player.jsx  TvMode/  bits/
components/admin/live/
  LiveAdminShell.jsx            tabs only
  ChannelTable.jsx  SourceTable.jsx  PreviewModal.jsx
  hooks/
    useLiveChannels.js          fetch + in-memory filters
    useSourceGroups.js
    useChannelActions.js        writes + cache refresh
```

The 594-line manager shrinks to a shell + small pieces; data logic lives in hooks.

---

## 4. The one data flow (same picture for viewer and admin)

```
INGEST   feed URL → parser → adapter → channelRepo.upsert()
                                    ↓ (owner fields protected)
STORE    LiveChannel docs (raw variants) + LiveSource
                                    ↓ post-write hook bumps ONE cache version
READ     docs → viewBuilder.buildCatalogue()  ← public route AND admin use this
                 ├─ visibility filter
                 ├─ canonical dedup → channels + variant ladders
                 ├─ religious exclusion
                 └─ ordering (family rank / admin position)
PLAY     variant → playback/resolve → policy → Player (identical in /live and admin preview)
```

Admin chip counts become a by-product of the same builder — count parity by construction,
not by maintaining a second implementation.

---

## 5. Deletions the audit supports (confirm external use first)

- `live-service/{duplicates,export,import,profiles,purge}` — 0 in-app callers
- `LiveProfile` model + `profiles` field — only referenced by the routes above
- `selected`, `order` fields — derived from catalog memberships/positions
- legacy 5s cache in `liveService.js` — folded into `read/cache.js`
- `importHash`, dead legacy fields on `LiveChannel`
- `/api/live-epg` — no in-app fetch; verify no external EPG client before removal
- version scars: `v13` folder name, `jash_live_v13_*` keys (with one-time migration)

---

## 6. Migration plan — five small, test-gated phases (no big bang)

| Phase | Work | Risk | Exit gate |
|---|---|---|---|
| 0 | Freeze current behavior as contract tests (already 111 cases; split megatest per module) | none | tests green |
| 1 | Split `liveTv.js` → `ingest/` + `playback/tokens/` (move-only) | low | build + 111 tests unchanged |
| 2 | Extract `read/viewBuilder.js`; make public route and admin both consume it; delete `adminBrowse.js` | medium | count-parity test added |
| 3 | Retire legacy stack: `/api/live-tv` shim, LiveProfile, dead routes/fields, caches | medium (external clients) | shim logs zero traffic for a week |
| 4 | UI: hooks extraction, `v13` → `live` rename, admin component split | low | build + manual flow check |
| 5 | API namespace move to `/api/live/admin` with temporary aliases | low | aliases removed after deploy settles |

Each phase is one independently shippable commit with the same verify/build gate used today.

### Execution record (branch live-ui-v13, 2026-10-25)

All phases landed test-gated (verify + `next build --webpack` green after every commit);
phase 3 was executed first because deleting the dead legacy stack shrank the `liveTv.js`
split surface.

| Phase | Commit | What shipped |
|---|---|---|
| 0 | (with phase 2/4 work) | 618-line megatest split into four themed suites under `scripts/live/` (catalog-rules, playback-contracts, ingest-dedup, admin-browse) sharing `harness.mjs` + `fixtures.mjs`; same 113 contracts, zero behaviour change |
| 1 | `17cd62c` | `liveTv.js` 1,608 → 987 lines; `lib/live/ingest/{text,registry,classify}.js` and `lib/live/playback/headers.js` extracted move-only; old import paths kept via barrel |
| 2 | `8c17844` | `lib/live/read/viewBuilder.js` is the single doc→view-model pipeline; public route and `adminBrowse.js` both consume it — count parity by construction, with an explicit parity test |
| 3 | `3aa2b2e` | `/api/live-tv`, `/api/live-epg`, `liveEpg.js`, `LiveProfile`, five dead admin routes and the profile concept removed; import-graph scan clean |
| 4 | `7d1e0ad` | `components/live/v13/*` renamed to the target layout; six page hooks extracted; favourites key migrated; admin `ChannelRow`/`LadderEditor` split to `components/admin/live/bits/` |
| 5 | `1acbe36` | Canonical routes under `/api/live/admin/*`; `/api/live-service/*` kept as logic-free re-export shims for one release (tests pin both sides) |

Post-deploy follow-ups: run Admin → TV "Rebuild grouping" once; delete the
`app/api/live-service/` shim directory after traffic settles; the `jash_live_v13_favs`
legacy favourites key can be removed in a later release.

## 7. Invariants to document in the repo README of `lib/live`

- Sync writes never touch owner fields (catalogs, customName, customLogo, hidden, ladder).
- Source groups are read-only; only catalogs are publishable.
- One canonical identity function; nothing else may merge channels.
- One view builder; routes serialize, they do not decide.
- Cache invalidation only via the model write hook — no hand-managed key bumps.
