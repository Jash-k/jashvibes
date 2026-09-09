# /stremio redesign · six ideas

**Picked: idea 1, Catalog Shelf — built in v8.11.0.** Ideas 2-6 were not built.

Delivered as images, one per idea, each with the desktop (rail shown) and the mobile mock side by side.
Source of truth: `stremio-redesign.html` in this folder — `stremio-redesign.html#idea-3` renders only idea 3,
which is how the PNGs were produced (headless Chrome, 2× scale). Catalog names and loaded counts in the mocks
are illustrative: they show what a manifest + skip paging look like, not your addon's real contents.

| # | name | file | organizing idea | main risk |
|---|------|------|-----------------|-----------|
| 1 | Catalog Shelf | `stremio-idea-1-shelf.png` | one tab ruler of catalogs across the top; one catalog on screen, its filters inline, `+` opens the picker | you never see two catalogs at once |
| 2 | Source Deck | `stremio-idea-2-deck.png` | each pinned catalog is a vertical lane with its own header, list and load-more; unpinned lanes do not fetch | ~230 px per lane at 3-across; per-lane error states |
| 3 | Lens | `stremio-idea-3-lens.png` | persistent filter drawer beside a full canvas; a read-only line prints the exact request | the drawer is always in the way |
| 4 | Manifest Index | `stremio-idea-4-index.png` | the whole manifest as a ledger (id, type, declared extras, pinned?) driving the pane beside it | settings-like surface at the front of an entertainment page |
| 5 | Source Spine | `stremio-idea-5-spine.png` | pinned catalogs become a second, thinner rail; nothing else on the page but the grid | two-letter tiles are cryptic for a week |
| 6 | One Feed | `stremio-idea-6-feed.png` | all pinned catalogs merged into one grid, each card tagged with its source; one load pulls 25 | merge order can only be right per source |

Fixed in all six: the 7-tile `RailNav` (+ `MobileDock` below `lg`), cards pointing at
`/stremio-watch/{type}/{id}?source=catalog`, embed providers kept as a compact line, one request per user
action, no Mongo writes for browsing state, no invented totals ("25 loaded · more", never "of N"),
no control nested in a control, and a day-mode pass before it ships.

`app/stremio/page.js` was rewritten, `lib/stremioShelf.js` added, `tests/stremio-shelf.test.js` added (31 tests).
Ideas 2-6 stay as mocks; their code was never written, so nothing needs un-building.
