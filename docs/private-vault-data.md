# Option A — private `mv_vault`, read with a server-side token

Decision note for making the catalogue repo private while the app keeps reading a
JSON file from it. Written against the current code: `lib/vault.js:39` fetches
`https://raw.githubusercontent.com/Jash-k/mv_vault/main/data/vault.json` with no
credentials, and `proxy.js` gates only `/api/*` and `/admin`.

## The one thing to understand first

**A token cannot be added to the URL you use today.** Probed live: requesting
`raw.githubusercontent.com/Jash-k/mv_vault/main/data/vault.json` with an
`Authorization: Bearer <anything>` header still answers **404**, and a private
file with no token also answers **404** — raw hosts public blobs and does not
authenticate. So the *path* stays valid, but the **route to it must change** from
`raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>` to GitHub's API:

```
GET https://api.github.com/repos/Jash-k/mv_vault/contents/data/vault.json
Authorization: Bearer <token>
Accept: application/vnd.github.raw
X-GitHub-Api-Version: 2022-11-28
If-None-Match: <etag from the previous response>
```

Measured against the current file (7.76 MB): raw media type returns the full body
with `Content-Type: application/vnd.github.raw`; `If-None-Match` returns **304 with
0 bytes**; the default JSON media type returns `content: ""` / `encoding: "none"`
for files over 1 MB, so `Accept: application/vnd.github.raw` is required, not
optional. Unknown paths and unauthorised private reads both answer 404, which
matters for error handling: a bad token looks exactly like a missing file.

## The credential

- **Fine-grained PAT**, scoped to `mv_vault` only, permission **Contents:
  Read-only**, with an expiry. Nothing else — no write, no other repos.
- Store it server-side as an env var (suggest `GITHUB_VAULT_TOKEN`) on Render. It
  never reaches the browser: the fetch lives in `lib/vault.js`, which is imported
  only by route handlers (`app/api/vault/route.js`, `app/api/vault/match/route.js`,
  `app/api/admin/vault/route.js`) — no client component sits in that chain.
- Rotation is an operational cost: an expired token is a 404 and the Vault 502s.
  A GitHub App with an installation token removes the expiry (tokens are minted
  server-side from a private key) but adds setup. Start with the PAT.
- Leak impact is bounded: read access to one private repo, revocable in one click.

## Code changes (small and contained)

1. `lib/vault.js` — replace the constant + anonymous fetch with an authenticated
   fetch that sends the four headers above, keeps `cache: 'no-store'` and the 15 s
   timeout, and stores the last `ETag` in the module cache so the 30-minute
   revalidation is a **304 instead of 7.8 MB**. Keep the anonymous raw fetch as the
   fallback when no token is configured, so a public repo and local dev still work.
2. `scripts/verify-vault.mjs` — its default source is the same raw URL; it needs
   the token or a local file path.
3. Error reporting — today any failure becomes `502 "The vault is unavailable"`.
   With a token, 401/403 (bad/expired credential) must be distinguishable from 404
   (gone) in logs, or a rotation failure looks like a scraper outage.
4. **Recommended before flipping the switch:** keep the last-known-good raw
   catalogue in MongoDB. `loadVault` fails closed by design, so with a stale token
   the Vault is down until someone rotates it — but the data does not change more
   than a few times a day, so serving the last snapshot turns a token problem from
   an outage into a "data is N hours old" notice. The database is already there for
   the override layer.

Unchanged: the DB override layer, the memory cache, `?force=1`, and the
fail-closed rule that hidden rows can never leak through a fallback.

## What privacy this actually buys

| Gets | Does not get |
|---|---|
| `data/vault.json` is no longer world-readable | The app still serves the merged catalogue to anyone with the app password — including embed and source URLs |
| Scraper internals (`research/`, source IDs, overrides, scripts) become private | `mv_scrapper` (moviesda.json), `old_Tamil` (VOD m3u) and third-party playlists stay public and keep being fetched anonymously |
| The data's public surface becomes a token instead of a URL | Repo *members* can still read everything; Actions logs stay visible to them |

If the goal is hiding the *method* while the *data* stays public, a separate public
"distribution" repo holding only `data/vault.json` achieves that for free and needs
no token. If the goal is hiding the *data*, this option works, and option B (below)
does it more cheaply.

## The bill — this is the decisive number

GitHub Actions is **unlimited and free on public repositories** and **metered on
private ones**: 2,000 minutes/month on Free, 3,000 on Pro/Team, then roughly
$0.008/min for Linux.

This repo's own budgets:

| Workflow | Budget | Per month at cap |
|---|---|---|
| `az-archive` | 300 min/day | ~9,000 |
| `new-releases` | 4 × 25 min/day | ~3,000 |
| `enrich` | 2 × 45 min/day | ~2,700 |
| `isaidub` | 45 min/day | ~1,350 |
| **Total** | | **~16,050 min** (~$112/month) |

Even at a third of those caps that is ~5,000 min → **~$27/month**, and it is
billed regardless of whether the app is used. The workflows themselves need no
changes for a private repo — they use `contents: write` and `git push` — only the
*reader* breaks, and only the bill changes.

## When to choose A

Choose it if you specifically want the repository private while keeping the
file-in-git workflow, and you accept a modest monthly Actions bill. Then:

1. Create the fine-grained PAT (read-only Contents on `mv_vault`).
2. Add `GITHUB_VAULT_TOKEN` on Render; add the Mongo last-known-good.
3. Patch `lib/vault.js` + `scripts/verify-vault.mjs`; distinguish auth errors.
4. Flip the repo to private **after** the app is deployed with the token, so there
   is no window where the live app 404s.
5. Decide whether to trim the scrape budgets, or keep the scraper repo public and
   private only what holds the data — the cheaper variant of this option.
