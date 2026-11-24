# Vault integration repair

This source tree preserves the earlier local public-access / Stremio-OFF navigation changes and includes the Vault fixes and refreshed 7,517-record feed at `data/vault-snapshot.json`.

## Fixes

- Preserve canonical TMDB title, original release year/type, aliases, source language and metadata evidence through normalization.
- Match canonical/original aliases, Unicode and season/type-specific requests; refuse ambiguous title collisions instead of selecting arbitrary records.
- Search all Vault categories, including unverified titles, when a query is entered. Original release years are searchable alongside source years.
- Bump client summary-cache namespace to v2 so old normalized summaries are not reused.
- Do not hide uncertainty by calling every dubbed/local title verified: 980 records still have unknown/conflicting original-language classification in this snapshot.
- Optional server-side bundled feed avoids depending on an unpublished upstream JSON change. Docker runtime includes the data directory.

## Use the updated JSON

Choose ONE feed mode in your deployment environment, then restart/redeploy the server:

**Included snapshot (immediate, no upstream publication required):**

```env
VAULT_USE_BUNDLED_SNAPSHOT=true
```

This reads `data/vault-snapshot.json` server-side, without network, and overrides `VAULT_SOURCE_URL`. Keep that file when packaging/deploying, including custom standalone deployments. Snapshot mode is frozen until you replace the file and redeploy.

**Live feed:** leave `VAULT_USE_BUNDLED_SNAPSHOT` unset/false. Publish the repaired mv_vault `data/vault.json` to your repository and use its raw HTTPS URL as `VAULT_SOURCE_URL`, or retain the existing default URL if publishing to the same repository. Do not configure a browser-only localhost URL.

The live-production website has NOT changed merely because this archive exists. You must publish/configure the new feed and deploy these JaSH changes. Existing admin metadata overrides still apply; inspect any stale conflicting overrides rather than replacing verified identities blindly. Reload the Vault after deployment; server cache expires normally or resets on process restart. The v2 namespace invalidates old client summary payloads.

## Validation

- Full `npm run verify` passed.
- Catalogue normalization/episode-order/best-available-quality contract passed against the included feed.
- Production `npm run build` passed.
- Bundled-source loader was checked with network fetch explicitly forbidden.

Commands (Node 22 recommended):

```sh
npm ci
npm run verify
node --import ./scripts/alias-register.mjs scripts/verify-vault.mjs data/vault-snapshot.json
npm run build
npm start -- --hostname 0.0.0.0
```

Configure the application's usual authentication/admin/database variables privately as appropriate to your deployment. No live-site deployment, Docker runtime, or browser video playback was performed. No private TMDB keys are included.
