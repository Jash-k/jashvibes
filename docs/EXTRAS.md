# Extras: managed website collection

## Routes and flow
- `/extras`: searchable cards for enabled websites; uses the existing desktop rail and shared mobile dock.
- Click a card: `/extras?site=<id>` opens that entire website in one iframe inside the app.
- `/admin?tab=extras`: protected existing admin control room, with add/edit/remove, visibility, order, cover image URL and three illustrated card styles.
- `/embed-browser?...`: redirects old website bookmarks into Extras. Legacy environment IDs are preserved through edits.
- Existing `/api/embed-sites` clients keep receiving `sites`, `primary`, `enabled`, `id`, `label` and `url`.

## Persistence
A single `Setting` document with key `extras_sites_v1` holds `{version, sites}`. GET requests never seed or write it. While no document exists, valid HTTPS sites from existing EMBED/ELABEL/EMBEDS and supported aliases are shown read-only. The first successful admin mutation imports that list into the settings document. Subsequently, MongoDB is authoritative. Removing the final entry leaves an explicit empty list; environment sites do not reappear. When a configured database is unavailable, the API fails closed (503) rather than resurrecting hidden or removed websites. A database-free deployment can display valid environment sites but cannot save admin edits.

Writes use the existing signed admin session and cross-origin mutation guard. Optimistic version checks reject stale edits with 409 and the UI reloads the latest registry. No credentials, cookies or provider headers are stored in a site row. The registry is bounded to 100 sites. Duplicates are rejected by normalized URL.

## Viewer and security
- Only public HTTPS URLs without embedded credentials. Obvious local/private hosts and self-embedding are rejected.
- The server does **not** fetch or proxy site URLs or image URLs. Images load directly in the browser with no referrer and fall back to an illustration on failure.
- Sandbox: scripts, same-origin for the external site's own operation, forms and presentation. New-tab popups are blocked unless an admin opts a trusted site in. App top-navigation is never granted.
- The iframe sends at most the app origin for cross-origin requests via `strict-origin-when-cross-origin`, not a forged provider referrer.
- No stripping frame headers, spoofing source domains, DRM changes or bypass of provider restrictions.
- The viewer has Back to Extras, Reload (configured starting page), Expand/Restore and Open site. Leaving the viewer unmounts the iframe.
- Browsers do not reliably expose cross-origin frame failures. An onLoad event is not claimed to prove website playback. A visible external-open fallback remains available.
- The internal website cannot be restyled, read, ad-stripped or playback-tracked by this app.
- Preview embed in the form opens a read-only URL viewer in another tab, without adding a database record. Unsaved popup configuration is not used by that preview; saved-site viewing applies its stored policy.

## Deployment / use
1. Apply the Extras-only patch or copy the included changed files to the matching app version. Do not overwrite unrelated custom changes without review.
2. Run `npm ci`, `npm run check`, `node scripts/test-extras-registry.cjs`, `npm run build`.
3. Deploy using the existing Render procedure. Existing DB and ADMIN_PASS settings are used. No new package dependency or secret is required.
4. Unlock Admin → Extras → Add website. Example: Name `Arivumani`, URL `https://arivumani.net/`. No example/sample websites are preinstalled into the database.
5. Check the actual site from the deployed app and target devices. Provider framing/playback permission is independent of a successful app build.

No production deployment or database mutation was performed during implementation. Live/Jio and earlier music/vault/player changes were not edited by this feature.

## Validation performed
- All project source modules parsed and local imports resolved with `npm run check`.
- Production `next build --webpack` completed.
- Pure registry tests: URL/boolean validation, duplicates, version conflicts, add/edit/remove, ordering, legacy IDs, empty list.
- Real local API and Chromium UI tests against a disposable MongoDB: theatre-only 401, cross-origin 403, stale-version 409, unsafe-URL 400; all CRUD controls; hide/enable and order; zero-site persistence; admin edits surviving reload.
- Viewer controls and iframe sandbox, iframe unloading, legacy-route redirect, mobile navigation, mobile form, dark/light theme and page overflow checked.
- Third-party frame contents were intercepted with a small local fixture in UI tests, so these tests make no claim that Arivumani or every external player permits embedding or plays in the deployed environment.
