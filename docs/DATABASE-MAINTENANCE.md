# Database maintenance

The app only ever deletes a row when you ask it to, so a database that has survived a few
versions collects three kinds of quiet mess:

* **rows duplicating a key that is supposed to be single** — the catalogue cache
  (`tamilmv_scrapes`) and the manual poster matches (`title_matches`) are both written with
  `upsert`, and an upsert is not atomic against a concurrent one;
* **live channels nothing can show** — their source no longer exists, or they were never
  published to a catalogue;
* **indexes that cost writes without serving a query**, plus old collections from earlier
  versions that no code reads any more.

None of it raises an error. It shows up as a database that only grows, and as an admin panel
that slowly stops matching reality.

`scripts/db-maintenance.cjs` is the pass that clears it. It is **dry by default**: the audit
reads, prints what it would do, and changes nothing until you ask for a tier.

## Running it

```bash
npm run db:audit                                  # read-only report — always safe
npm run db:clean                                  # safe tier
npm run db:clean -- --all                         # + the app's own unused-channel rules
npm run db:clean -- --drop media                  # + drop one named legacy/unknown collection
npm run db:clean -- --drop-indexes                # + drop the known low-value indexes
```

Flags: `--days=N` (staleness window, default 30) · `--json` · `--uri=<uri>` · `--help`.

It uses the same connection chain as the app — `DB` → `DB_URI` → `MONGODB_URI` — so anywhere
the app can connect, the tool can too: your machine, a VPS shell, or the **Shell** tab of the
Render service (the dependencies are already installed there).

**Take a backup first if the database holds anything you would miss:**

```bash
mongodump --uri "$DB" --out ./backup-$(date +%F)
```

## The tiers

| Tier | Command | What it removes or repairs |
|---|---|---|
| audit | `db:audit` | nothing — report only |
| safe | `db:clean` | duplicate cache/match rows (keeping the freshest), channels whose source **does not exist at all**, the denormalised counters on `livesources`, the indexes the app relies on |
| all | `db:clean -- --all` | everything above, plus channels belonging to a **deleted** source, and channels that are *unused*, *broken*, *not seen in N days*, or *hidden* **while published in no catalogue** |
| explicit | `--drop <name>` / `--drop-indexes` | one named collection (a legacy or unknown one), or the known low-value indexes |

`--drop` and `--drop-indexes` are separate commands on purpose: asking to drop one collection
never quietly runs the other tiers alongside it.

## What is never touched

| Protected | Why |
|---|---|
| Channels that are **favourited**, **manually mapped**, or carry a **guide override** | They encode a decision you made. This pass protects them in *every* mode — stricter than the in-app purge, whose `broken` and `hidden` modes can delete a starred channel. |
| Channels **published in a catalogue** | They are what `/live` shows. |
| `catalogoverrides` rows | Renames, pins and hides that cannot be regenerated. Reported, never removed. |
| `title_matches` rows, other than exact duplicate keys | Manual poster matches — a duplicate row is noise, a lone row is your work. |
| `voditems` — **all of them** | See below. |
| `stremiopins` | They self-prune when you next save the Stremio shelf. |
| `settings`, `liveprofiles`, `stremioaddons`, `vodsources`, `musicplaylists` | Configuration. Reported, never touched. |

**VOD items are reported and never deleted**, and this is deliberate rather than cautious:
`/api/vod` filters on `hidden` alone, so an item with an empty `sources` array is *still listed*
on `/classics`. Deleting those would remove content you can see. The audit counts them —
`no source`, `no streams`, `unmatched` — so you can decide, one by one, in the admin panel.

## Reading the report

```
INVENTORY      every collection with its size and last write. Anything not read by the app is
               called out as `unknown`; anything the app no longer reads as `legacy`.
DUPLICATES     groups of rows sharing a key that should be single — the freshest is kept.
LIVE CHANNELS  how many are published, how many are protected, and the four rules above.
SOURCE         denormalised counters that drifted from the rows they summarise, with the
COUNTERS       exact numbers: `channelCount 999 → 14`.
VOD ITEMS      counts for your attention. Nothing is deleted.
INDEXES        what the app needs and does not have, and what nothing has used.
PLAN           every action with its tier, so `--safe` and `--all` are never a surprise.
```

A tidy database ends with `nothing to do — the database is already tidy`.

## Notes

* **Usage counts are evidence, not proof.** `$indexStats` resets when `mongod` restarts, so an
  index can read "0 ops" while still being useful. Only the known low-value set —
  `livechannels.selected_1`, `favorite_1`, `hidden_1` and the unused `musicplaylists` text
  index — is ever dropped, and their ops are printed next to them.
* **`media` is a legacy collection.** It is the v10 catalogue (`sources[]` with embedded
  streams). Its only readers are `/api/stream`, `/api/resolve` and `/api/seed`, and **no client
  code calls any of them** any more. Confirm your own tooling does not either, then
  `--drop media`.
* **Deleting channels settles its own books.** Any run that removes channels recomputes the
  `livesources` counters in the same pass, so the next audit does not ask for a repair.
* **Idempotent.** Running it twice removes nothing the second time.
* The rules mirror `app/api/live-service/purge/route.js` (the app's own purge) and
  `recalcSourceCounts()` in `lib/liveService.js`; where this pass is stricter, the report says so.
