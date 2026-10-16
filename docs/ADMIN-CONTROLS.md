# Admin controls — order, audit, orphans, bulk, health

The admin panel used to be a set of switches: every control wrote something permanent, nothing
recorded who changed what, and the Home tab listed titles alphabetically — an order the home page
does not use, so the panel could not be read as "what a viewer sees". This is the five-step build
that fixed that, and the rules it follows.

Everything here lives behind `/admin` and `app/api/admin/**`, plus two additions to routes the app
also uses (`/api/music/playlists`, `app/api/live-service/**`). Nothing in the public pages changed.

## 1. The Home tab mirrors the home page

`lib/catalogAdmin.js::listAdminCatalog({ q, filter, page, pageSize, sort, section })`

- **Sort defaults to `home`**: pinned rows first, then the scraped order — the *same comparator the
  viewer's payload is built with* (`applyOverridesToPayload`). If those two ever disagree, the panel
  starts lying about the home page, so `homeComparator` is exported and tested against the contract.
- Other sorts exist for debugging: `az`, `newest`, `edited`, `pinned`.
- **Section** splits Movies (`all` / `movies` / `series`) with counts on the chips.
- **Counts are measured over the whole catalogue** (`total, matched, hidden, pinned, movies, series`)
  plus `view` for what the current search + filter left behind — the numbers no longer change meaning
  as you filter, which was the old bug.
- Each row carries **`#position`** — its home position within its section, computed over the whole
  catalogue, so a search result still says "this is 34th on the home page".
- Rows carry the **decorated** values (title/year/quality after overrides), because the panel must
  show what viewers see. *(A refactor during this work dropped this and was caught by inspection; it
  is now the first thing to check when touching the listing.)*

## 2. Every tab records what it changed, and undo puts it back

`models/AdminAction.js`, `lib/adminAudit.js`, `lib/adminModels.js`, `GET|POST /api/admin/history`

- One append-only collection. Each entry: actor, area, action, one-line summary, target
  (`kind`/`key`/`label`), **`before` and `after` snapshots**, `targetModel`, `reversible`,
  `revertedAt`. Snapshots stay server-side; the History list returns flags only.
- **Recording never breaks the mutation.** If the audit write fails, the change still succeeded:
  `recordAction` logs and returns `{ok:false}`. An audit trail that can veto an edit is worse than
  none.
- **Undo is mechanical**: restore `before`, or delete the document when `before` is `null` (the
  action created it). The per-model key field comes from `UNDO_TARGETS` in `lib/adminModels.js`
  (`CatalogOverride.key`, `VodItem._id`, `LiveSource.sourceId`, `Setting.key`, …), so there is one
  implementation for every tab instead of per-action undo code to rot.
- **A move needs two writes**: re-binding an override from an orphaned key to a live one restores the
  old document *and* removes the new copy, which is what an action's `alsoDelete` carries. Without
  it, undo would look half-done.
- **Irreversible means irreversible.** `catalog.sync`, `catalog.purge`, `live.sync`, `live.purge`,
  `live.import`, `live.sweep`, `live.dryrun`, `catalog.dryrun`, `extras.import`, `music.playlist.import`
  and `catalog.overrides.replace` are recorded with `reversible: false` and a reason; History shows
  *No undo* with that reason instead of a button the server would refuse.
- Coverage is enforced by test: `scripts/test-admin-controls.cjs` fails if any mutation route stops
  recording. The Music tab talks to the app's own playlist endpoint, so it marks its requests
  `x-jash-admin: 1` and only those are recorded — the owner's ordinary imports are not admin actions.

## 3. Orphaned overrides

`lib/catalogOrphans.js`, `GET|POST /api/admin/catalog/orphans`

An override is keyed by `type + lowercased RAW scraped title`. That is the right key (it survives a
re-scrape) but it is not immortal: when the forum renames a release the key changes and the
correction, pin or hide **silently stops applying**. The Home tab now reports those, shows what each
one was doing (hidden / pinned / corrected / note) and offers the closest live rows, each with the
reason it was suggested: same raw title, same title + year, same words apart from a spelling
(`Gray`/`Grey`), prefix relationship, or year+type only. Type is never crossed. Nothing is applied
automatically — a wrong auto-rebind writes your correction onto the wrong film.

Re-bind moves the whole intent onto the new key (and is undoable). "Forget it" deletes the stale
override (also undoable).

## 4. Bulk edits, duplicate merge, backup

`lib/catalogBulk.js`, `app/api/admin/catalog/{bulk,duplicates,overrides/export,overrides/import}`,
`components/admin/{BulkBar,DuplicatePanel,OverrideTransfer}.js`

- **Bulk edit is two-step by design.** Pick an action (`hide`, `restore`, `pin`, `unpin`,
  `set-quality`, `retag`, `forget`), press *Preview*, read every row that would change with its
  before → after and every row skipped because it is already in that state, then apply. Preview and
  apply are the same planner on the same rows, so the list you approve is the change that runs.
- Rows that would not change are **not written**, and no-op detection uses the row's own state when
  there is no override yet — so "hide everything in this view" does not create forty empty documents.
- Restoring the last interesting field **deletes** the override rather than storing empty strings.
- Each changed row gets **its own history entry**, so undoing one row does not undo forty.
- **Select this view** resolves the current search + filter + section into keys server-side, so it
  never means "the 25 rows on this page".
- **Ordering is mirror-only, by decision.** There is no rank field and no drag reorder: the panel
  shows the order viewers get, pinned rows are the only thing that moves a title, and a re-scrape
  decides the rest. (Rank-based drag was in the original plan and was explicitly dropped — it would
  contradict "mirror the home page".)
- **Duplicates**: grouped by normalised parsed title + type, allowing a year either way for a
  re-release. Each group suggests a winner (matched TMDB id → visible → quality tier → pinned) and
  says why. Merging hides the losers (one entry each) and carries any title/year/quality correction
  from a loser onto the winner, so a merge cannot lose your fix. Nothing is deleted.
- **Backup**: download the whole override set as JSON; import it back in `merge` mode (adds/updates,
  undoable row by row) or `replace` mode (wipes first, irreversible, and says so in the dialog).

## 5. Health and dry runs

`GET /api/admin/health`, `POST /api/admin/catalog/sync {mode:'dry'}`, `POST /api/admin/tv/dry-run`

- The Health tab shows one card per subsystem — database state and latency, catalogue cache age and
  whether a sync is due, override/orphan/duplicate counts, vault, lyrics, live sources and channel
  health, music match rate, Stremio, Extras, history, and which release manifest the tree matches.
  Every section reports its own failure instead of blanking the page; every number is read from the
  thing itself or from the audit trail, never estimated.
- **Dry runs write nothing.** The catalogue dry run scrapes with TMDB matching and posters disabled,
  diffs it against the cache (added / removed / changed titles), and — the part worth having —
  reports **which overrides this sync would orphan**, reusing the step-3 key logic. The live dry run
  parses every enabled source and compares it with what is stored, re-linking by name/tvg-id the way
  a real sync does, and lists the channels that carry your own catalog placement, EPG override or
  favourite and would not come back.

## Tests

`scripts/test-admin-controls.cjs` (in `npm run verify`) imports the real modules with their database
imports stubbed, so the pure logic is exercised — home ordering and pin behaviour, section filtering,
undo routing and refusal reasons, orphan suggestions and their reasons, the bulk planner's no-op and
pin-preservation rules, duplicate grouping, the dry-run diff and orphan forecast — and then asserts
statically that every mutation route records, that destructive paths declare themselves, and that
History and Health are reachable.

**Not verified live here:** the sandbox has no MongoDB, so the write paths are exercised by the unit
tests and by the build, not by clicking through against a real database. The first real check is
making one change per tab on your machine and reading the History tab.
