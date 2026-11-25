# Live TV resolver and fallback repair

## Problems observed on the Render deployment

Read-only API checks found catalogue availability but false-positive playback readiness: Star Vijay Jio resolved without an authorization token; HJH variants used a source reporting HTTP 404; a Sony Vizha variant resolved successfully despite expired authorization. These were resolver observations, not a browser playback test.

## Changes

- `resolveHjhWorkerUrl` now rejects non-success HTTP responses, HTML documents, redirects without Location and redirect-limit exhaustion. Response bodies are cancelled rather than left open. Dead Worker responses no longer silently become successful stream URLs.
- `/api/live/resolve` fails with HTTP 503 and machine-readable `SOURCE_UNAVAILABLE`, `AUTH_EXPIRED` or `AUTH_UNAVAILABLE` codes, plus `retryable: true`, rather than false `ok: true`.
- Missing authorization is enforced only for known protected Jio CDN hosts; unrelated public streams in a Jio-labelled source remain eligible. No global assumption that every stream requires a cookie.
- Channel-specific access resolution is used, retaining scoped-token support. Fresh cookies replace stale token query parameters before readiness checks.
- Expired/near-expiry authorization (30-second minimum) is not reported as ready.
- Resolver errors advance to the next variant automatically. The player now wires its terminal `onFatal` callback to the same finite forward-only source ladder. No wraparound retry loop. If the last variant fails, the user gets a clear error and Retry remains available.
- Existing DRM, token propagation, public access, source browsing and prior Vault changes preserved.

## Validation

Full `npm run verify` and production `npm run build` pass. New normal-verify regression covers missing/expired/fresh authorization, signed URL authorization, public streams, Worker HTTP 404/410/500, HTML response, missing redirect target, redirect loop, valid signed redirects, finite fallback and wrapper wiring. Existing signed-segment/playback contracts also pass.

This is readiness validation, not an assertion that a manifest, every segment or license was successfully played. Browser end-to-end playback from the user's Indian network still needs checking after deployment. No Render settings, MongoDB rows, repository branches or live deployment were modified.

## Deploy

Use this updated source tree for your normal Render deployment (Node 22 recommended). Run the existing project build/start commands, with your existing private environment/database configuration. No new secret is required by this repair. Restart/redeploy so the resolver and player bundle both update.

After deployment, select Star Vijay / Sony Vizha. Unavailable variants should return structured 503 errors and advance to the next source, not sit at a false successful resolution. If every variant lacks working upstream authorization, playback remains unavailable: configure an authorized current feed/session in Admin and re-sync. A dead source may be disabled in Admin without deleting its stored records; these code changes do not destructively remove data or automatically disable an entire source based on one failed channel.

No third-party credentials, DRM keys, or reference-site proxy infrastructure have been copied into this repair. Existing authorization/geo restrictions are not bypassed.
