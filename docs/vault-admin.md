# Vault Admin

Open `/admin?tab=vault` with the existing theatre and Admin sessions. Uses the
existing `ADMIN_PASS` and MongoDB `DB` / `DB_URI` / `MONGODB_URI` configuration.
TMDB credentials stay server-side using the app's existing TMDB env variables.
No GitHub credential is needed. No secrets are included in this patch.

## Tools
- Search local/original title, year, Vault ID or TMDB/IMDb ID; paginate 40 rows.
- Filter existing four catalogues, Unverified review rows, inferred, hidden or
  overridden items. No new public catalogue is created.
- Edit local title/dub year separately from original title/year and language.
- Remap catalogues with language and playback-kind conflict validation.
- Search TMDB or preview a movie/TV ID; apply selected metadata to the form,
  then explicitly save. The owner must verify identity; search is not proof.
- Choose inferred (≈ badge) or owner-verified provenance; provide reason and
  evidence. Unknown language stays empty rather than invented.
- Create items with HTTPS playback entries. Series entries need season/episode.
- Edit playback JSON using a separate confirmed save; ordinary metadata editing
  never changes episodes/links or converts playback kind.
- Hide/Restore is reversible. Reset removes ALL overrides, including playback,
  while preserving hidden state. Custom items cannot reset to scraper data.

## Persistence
One `VaultOverride` MongoDB document per stable Vault ID stores sparse patches,
custom items, visibility, private owner note and optimistic revision. Scraper
updates supply untouched fields; owner patches survive them. Stale saves return
409 and require reopening the editor. Scraped JSON is never written from Admin.
Orphan overlays are retained and reported as a count; no automatic reassignment.

Public Vault reads and match API consume merged data. Only upstream raw JSON
is memory cached; MongoDB overlays are read every time. Public API responses are
no-store. DB failures fail closed instead of revealing hidden rows. Consequently
Vault now requires a working MongoDB connection even for public browsing.
Admin mutations clear this browser's catalogue session cache. Other open browser
sessions may display an earlier list until refresh/Sync now; hiding cannot revoke
an already-known external player URL.

## Deployment and validation
Apply the incremental patch to the retained latest app source (after the previous
inferred-card badge changes). Run npm ci, npm run check, node
scripts/test-vault-admin.cjs, then npm run build. Configure MongoDB, ADMIN_PASS
and TMDB on the server. No production DB changes/deployment performed here.

Production build and source check pass. Pure contract tests cover validation,
metadata/playback separation, overlay visibility, custom items, auth wiring and
revision-check wiring. Actual MongoDB CAS/auth-session behavior and browser UI
still require a staging smoke test: create, remap, hide, restore, reset and race
two saves, then confirm public Vault and matching API behavior. Dependency audit
reported 7 existing vulnerabilities (2 moderate, 5 high); no dependency versions
were changed by this feature.
