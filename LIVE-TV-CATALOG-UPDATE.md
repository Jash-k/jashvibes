# Live TV Manual Catalog Update

Date: 2026-08-13

## What changed

This update replaces automatic/raw-category publication with a normalized, manually managed Live TV catalog.

The only public catalog definitions are:

| ID | Label |
|---|---|
| `main` | `MainCH` |
| `music` | `Music` |
| `local` | `LocalCH` |
| `sports` | `Sports` |
| `kids` | `Kids` |
| `others` | `Others` |

A channel can be mapped to multiple catalogs. Every membership stores an independent numeric position. Source categories are retained for administrator filtering but are never exposed as public catalog definitions.

## Deployment

1. Back up the current application and database.
2. Replace the application source with this package.
3. Keep the existing server-side environment variables/secrets. Do not copy secrets into the source tree.
4. Install exact dependencies and build:

   ```bash
   npm ci
   npm run build
   ```

5. Deploy/start the application normally.
6. Open `/live`, unlock **Live Service**, synchronize the required sources, choose a source, and click **Load source channels**.
7. Map only the required channels with the six catalog chips and configure their order in **Catalog order**.
8. Check **Main preview**, then close the service panel to refresh the public list.

Mongoose creates the new catalog fields/indexes through the existing application startup behavior; no destructive migration script is required. Existing source candidates remain in the database but are not published until manually mapped. Version-1 backup imports preserve explicitly selected channels by restoring them into `MainCH`; version-2 exports retain every membership and position.

## Publication and fallback rules

- Source sync imports or updates candidates and never automatically maps them.
- The main page requests only `/api/live-tv?playable=1` and does not merge raw source or Pocket catalogs.
- Once any canonical mapping exists, the API returns only mapped, selected, visible, playable, profile-compatible database channels.
- Before the first mapping exists, Jio Tamil is the only initial raw fallback.
- If catalog storage is unavailable, the API fails closed instead of guessing that the database is unconfigured and leaking a raw fallback.
- Auto-purge removes stale unmapped candidates only; current candidates and mapped channels are protected.

## Validation completed

- `npm run build` — passed with Next.js 15.5.19.
- Catalog helper assertions — passed (fixed IDs/labels, normalization, per-catalog sorting, positions, and counts).
- Production smoke test — `/live` HTTP 200 and `/api/health` HTTP 200.
- Service API authentication smoke test — unauthenticated `/api/live-service/channels` returned HTTP 401.
- Fail-closed smoke test without a configured test database — `/api/live-tv?playable=1` returned HTTP 503 with no channels and the six canonical catalog definitions.
- `git diff --check` — passed.
