# Public viewing + Stremio master OFF

## Changes

- Viewer shell starts unlocked; no public password screen or saved viewer token is needed.
- Viewer GET/HEAD API requests pass the shared firewall; existing rate limits remain. POST and other mutation authorization is not opened. Service/cron handlers retain their own checks.
- `/admin` and admin APIs still use the independent ADMIN_PASS authentication and origin checks. Keep ADMIN_PASS configured and private. Do not remove owner credentials.
- Admin → Stremio now has a master ON/OFF switch, stored as `stremio_source_enabled` in Mongo. Its default is OFF, including when the setting does not exist or cannot be read.
- Optional environment `STREMIO_ENABLED=false` is an emergency hard-off override. It disables the ON button until the override is removed and the app restarted.
- Stremio core manifest/catalog/meta/stream helpers check the master gate before cache access/upstream requests. Registry warming and admin upstream health checks are also gated.
- Watch source order and source menu omit Stremio while disabled; server enforcement remains authoritative. Existing tabs may need a reload to reflect the updated menu.
- Existing addon records are preserved, not deleted. Direct MP4, Vault/Retro and Mirchi remain separate sources.

## Deployment

Replace the existing source with this bundle and rebuild/redeploy the Next.js app. No Mongo migration is required. This bundle has not been pushed or deployed for you.

For immediate hard-off on the next deployment, set:

```
STREMIO_ENABLED=false
```

Keep `ADMIN_PASS`. Existing PASS/SPACE_PASSWORD/APP_PASSWORD values no longer gate public viewing; they are not automatically erased because some legacy service integrations may still use viewer tokens. Audit/remove unused integrations separately. Public access exposes viewing APIs and can increase upstream traffic and hosting costs; keep rate limiting and monitor abuse.

If old Stremio menus/pages/bookmarks remain, they may display empty/error states; they cannot override the guarded server helpers. This change does not revoke previously shared direct media URLs, stop an already-running stream, delete remote channels, unban a channel, or disable an independent Telegram deployment. Remove unused addon credentials from the host separately if desired.

## Validation

- `npm run build`: passed.
- `npm run verify`: passed (existing suite).
- `node --import ./scripts/alias-register.mjs scripts/test-public-stremio-off.mjs`: passed. Covers disabled Stremio helper calls with zero fetches, public GETs, protected mutations and admin denial without auth.
- No live Mongo/admin-browser test, production deployment or Telegram channel action was performed.
