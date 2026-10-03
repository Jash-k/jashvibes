# Verification scope

> **Note for the deploy bundle.** The test suite named below is not part of this distribution (removed with
> CI). What remains verifiable inside the bundle is `npm run check`, `npm run build` and `/api/health`. This
> section is kept as the record of what was executed against the code, including what it does **not** prove.

## Executed against this refactor

| Check | Result / scope |
|---|---|
| Production build | Passed, Next 16.3.8 / webpack; scheduled upstream jobs disabled during build |
| Source/import check | 205 JS/JSX/MJS modules parsed; no unresolved local imports |
| Deterministic regression suite | 43 passed / 0 failed; actual pure modules and isolated source/API functions with injected model/network mocks |
| Production browser flows | 13 passed / 0 failed, Chromium, built production HTTP server; desktop plus a mobile viewport |
| Production HTTP smoke | 7 passed: health, unsigned denial, signed viewer login, approved providers, viewer mutation denial, private proxy denial, DB-missing lineup failure |
| Dependency audit | 0 known vulnerabilities reported by npm audit at verification time |

Browser tests cover exact Vault Watch context; independent Episode/Resolution; manual-provider lock; explicit iframe Next without episode drift; unidentified-card matching; Music album/tab/search rendering; queue independence; mobile lyrics; navigation persistence; dedicated Live mode; bitrate position retention; and stale album-response protection.

## What those results do not mean

- Browser catalogue APIs are fulfilled with deterministic fixtures. A synthetic iframe is not a working third-party video; the generated WAV tone is not real music or a DRM test.
- Unit model mocks exercise desired-state logic, not MongoDB's actual storage/transactions. Real map/unmap persistence across your production restart still needs the acceptance checks below.
- Node CLI/standalone startup is smoke-checked; the Dockerfile is provided but a Docker image/runtime was not executed in this sandbox.
- No private production DB, licence request, entitlement token feed or copyrighted media was fetched/played for verification.
- Upstream endpoints can fail, expire, require headers or restrict regions/devices. The old public music mirror returned 404 during metadata checks; a working owner-configured mirror is needed.
- Native / file seeking, PiP, fullscreen, TV remote input and OS lock-screen playback vary by device. Iframe playback/progress cannot be inferred from document load.

## Deployment acceptance checklist

1. Back up MongoDB and Live exports. Configure DB, PASS, ADMIN_PASS and metadata/provider values; confirm owner and viewer separation.
2. Map A, unmap B, refresh and restart. Run source sync, health sweep and another restart. Memberships/positions must not drift.
3. Unmap every channel. The saved lineup stays empty. Simulate DB failure: show failure, not raw feed replacement.
4. Set a custom guide binding and an explicit empty one; source sync preserves both.
5. Use an explicit same-channel group across two sources; Auto can recover inside it, while a manual source stays selected on failure.
6. Test a known movie and series from each entry context. Confirm ordered alternatives, real codec support, DRM, headers and episode identity.
7. Test Music with a working mirror. Confirm actual album tracks, plain/synced/error lyrics states, delayed responses, quality position retention and background/audio focus.
8. Check your Docker/hosting port, HTTPS cookies, cold start, EPG refresh, scheduler ownership and memory/bandwidth use.
9. Reapply previously erased curation only from known backups/user intent; the refactor does not fabricate a recovery history.

Tests and fixture source are included for reruns. Test-generated browser reports, installed browsers, node_modules, .next and production secrets are excluded from the ZIP.
