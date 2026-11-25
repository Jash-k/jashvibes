# Latest cumulative patch — JioTV+ / HJH

## Patch scope

`jashvibes-latest.patch` is cumulative against repository commit `447b8f7` (full base SHA is in the accompanying patch manifest). It includes the earlier uncommitted public-access/Stremio-OFF, Vault matching/category/snapshot, Live health-gating/fallback and Viduki changes, plus this source update. It is NOT an incremental patch for a working tree that already has those edits.

Apply to a clean checkout of the matching base, or inspect/merge carefully if your branch differs. Never reset or overwrite your only copy of local changes.

```sh
git status --short
# Back up/commit local work first; use a separate clean worktree if necessary.
git apply --check /path/to/jashvibes-latest.patch
git apply /path/to/jashvibes-latest.patch
npm ci
npm run verify
npm run build
```

Deploy through your normal Render process. No repository was pushed or live service/database mutated here. Secrets are not supplied by this patch. If using the delivered Vault snapshot, set `VAULT_USE_BUNDLED_SNAPSHOT=true` as documented previously.

## Requested source checks

### JioTV+

- URL: https://jiobkl.ytzinadabaad.workers.dev/
- HTTP 200; parsed 1,209 entries using our app parser.
- Entries include Star Vijay HD, Star Vijay, Sun TV HD, Sony Vizha HD.
- HD entries had stream authorization and DRM configuration supplied by the playlist at check time. This is not proof of a valid license or playback rights.
- All four tested Jio manifests returned HTTP 451 from this server. This establishes server-side restriction, not successful playback, and does not establish the exact geo/policy cause. An Indian browser/ISP test is still needed.
- Raw playlist, tokens and DRM values were not saved into the patch/reports. Runtime uses the configured playlist.

### HJH / TiviMate

- URL: https://hjh-545.pages.dev/
- HTTP 404 at this check; remains the existing `hjh-jio` source definition.
- No false “working” flag and no bypass of the validation gate. It will remain unavailable unless upstream recovers and it is validated. No replacement content is disguised as this source.

Evidence: `reports/jio-plus-source-check.json`.

## JioTV+ implementation

- New `jiotv-plus` default source plus matching playback registry definition. Existing source enable/disable/deletion controls are preserved.
- Refresh URLs, cookies and key configuration from the same playlist, matching the exact host/path rendition. Do not silently substitute UK, SD or another channel.
- In-memory two-minute cache with concurrent-request coalescing; explicit recovery can force refresh. No downloaded playlist/token file is committed.
- Source-specific server resolution and health refresh avoid replacing playlist-scoped credentials with a shared global token sweep.
- Player recovery retries the source resolver once, then stops rather than escalating protected Jio media through Render's proxy or looping indefinitely. Refreshed key configuration is applied when rebuilding playback policy.
- Manifest/segment media remains browser-direct; authorization is propagated through existing playback policy. This does not bypass upstream geo/auth restrictions.
- Earlier health gate stays on. Refreshing authorization does not count as a browser playback test or automatically publish an unvalidated channel.

## Enable after deployment

1. Admin → TV → Sources: confirm `JioTV+` appears and sync it. Default-source onboarding is non-destructive; if the source was previously deliberately deleted, restore/add it explicitly rather than expecting tombstones to be overridden.
2. Search/Preview **Star Vijay HD**, **Sun TV HD**, **Sony Vizha HD**, in that priority order, from your normal Indian connection.
3. Only after personally watching correct audio/video for at least 30 seconds, confirm publication. Strict health-gating means candidates remain Admin-only until confirmed.
4. HJH should show its 404 rather than “working.” Retest only when it recovers.

Neither TiviMate compatibility nor a successful playlist download guarantees web-browser DASH/DRM playback.

## Validation

Full `npm run verify` and production build passed, including added tests for registration, exact-rendition matching, cache renewal, source-specific token use and bounded recovery. The cumulative patch is checked for clean application to its stated base. Browser playback, licensed-session validity and Render deployment remain unverified.
