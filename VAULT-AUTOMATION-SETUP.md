# JaSH Admin → Vault Automation — setup and token guide

## What this incremental patch adds

Admin → Vault now contains:
- **Fetch New Titles** → `hourly-new-entries.yml` (default 10 minutes, maximum 15).
- **Refresh Releases & Episodes** → `new-releases.yml` (default 25 minutes, maximum 30).
- **Refresh Dubbed Content** → `isaidub.yml` (default 25 minutes, maximum 30).
- **Enrich Metadata** → `enrich.yml` (default 20 minutes, maximum 30).
- **Advanced → Historical Recovery** → `historic.yml` (default 60 minutes, maximum 90, plus a separate 10-minute metadata budget).
- Recent GitHub run statuses/links and **Reload Vault Feed**.

These buttons request external GitHub Actions jobs. JaSH does not scrape inside its web request. A 202/accepted dispatch is not scraping completion. Recent runs include scheduled and other manual jobs; the UI deliberately does not guess which run ID belongs to a 204 dispatch acknowledgement.

The server uses a fixed workflow allowlist, owner session/cross-origin checks, bounded inputs, active-writer checks and a shared MongoDB-backed two-minute trigger cooldown. Historical dispatch requires confirmation. Events are recorded in the existing admin audit log as irreversible operations. GitHub's existing shared writer concurrency remains the final serialization mechanism; a direct GitHub/API request can race the web UI's active-run check but cannot bypass that workflow concurrency.

## 1. Publish the Vault workflows first

The **mv_vault** repository must contain the latest repaired code/JSON and the workflow files above. In particular, upload/commit the separately delivered `mv_vault-hourly-updated.zip` contents before expecting Fetch New Titles to work.

Put the workflow YAML files under `.github/workflows/` on the repository's **default branch**. The target branch must exist and contain compatible dispatch inputs. Enable GitHub Actions on the repository. Preserve each file's `workflow_dispatch` trigger and `permissions: contents: write` for the data-publishing job.

The JaSH token requests the workflow. The workflow uses its own GitHub-provided `GITHUB_TOKEN` to publish data. These are different credentials.

GitHub repository Settings → Actions → General: confirm Actions execution is permitted and your organization's workflow-permission policy permits the workflow's declared data writes. Branch protection may block automated pushes; a successful dispatch does not override branch rules. Do not disable protections indiscriminately—use a dedicated feed branch or an approved publishing policy if appropriate.

TMDB keys, if used for enrichment, belong in **mv_vault → Settings → Secrets and variables → Actions → Repository secrets** as `TMDB_KEYS` or `TMDB_API_KEY`. They are not the JaSH Actions token. Hourly discovery does not require TMDB credentials.

## 2. Generate a fine-grained GitHub token

Do this on GitHub while logged into an account that has permission to run workflows in the target repository:

1. Open https://github.com/settings/personal-access-tokens/new . Alternatively: profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Give it a recognizable name, for example **JaSH Vault Automation**.
3. Choose a short practical expiry, e.g. 30 or 90 days. Record when rotation is due. Do not select never-expire merely for convenience.
4. **Resource owner:** choose the user/organization that owns `mv_vault`. The token creator must already have the required repository access; a token cannot grant new account access.
5. **Repository access → Only select repositories → mv_vault**. Do not grant access to every repository.
6. **Repository permissions → Actions → Read and write**. Metadata read access is included/required by GitHub.
7. No Contents write, Workflows write, Administration, Secrets or organization-wide permissions are needed merely to dispatch and inspect these runs. Do not confuse the separate Workflows permission (editing workflow files) with Actions write (dispatching them).
8. Generate the token and copy it once directly into the Render environment variable described below. **Never paste it into chat, a browser source file, `.env.example`, GitHub code, a patch or a screenshot.**
9. If the resource owner is an organization, its policy may require token approval or block PATs. A pending token cannot perform the requested operations until an owner approves it. Follow the organization's policy; a GitHub App is an alternative for managed deployments, but is not implemented by this patch.

Official references:
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event
- https://docs.github.com/en/rest/overview/permissions-required-for-fine-grained-personal-access-tokens

A fine-grained token commonly starts with `github_pat_`; use the actual value shown by GitHub, not a made-up value or the example text.

## 3. Add server environment variables in Render

Render Dashboard → your **JaSH web service** → **Environment → Add environment variable**:

```env
VAULT_ACTIONS_TOKEN=<paste the actual generated token privately in Render>
VAULT_ACTIONS_REPOSITORY=Jash-k/mv_vault
VAULT_ACTIONS_BRANCH=main
VAULT_USE_BUNDLED_SNAPSHOT=false
VAULT_SOURCE_URL=https://raw.githubusercontent.com/Jash-k/mv_vault/main/data/vault.json
```

Replace `Jash-k/mv_vault` and `main` if your repository/branch differs. The repository field is `owner/repo`, **not a URL** and not a `.git` URL. Set the raw feed URL to the SAME publishing repository/branch, otherwise buttons may update one feed while JaSH reads another.

**Never prefix VAULT_ACTIONS_TOKEN with NEXT_PUBLIC_.** It is server-only. The UI receives only a configured boolean and safe repository/run metadata, not the token.

Keep existing private `ADMIN_PASS`, MongoDB and other app variables. This panel uses your existing owner login and Settings collection for a cross-instance cooldown; no new database service is needed. Without working MongoDB/owner authentication, mutations fail closed.

Save variables and restart/redeploy the service. The token must be available at server runtime. Do not add it as a GitHub public Actions variable or commit it to either repository.

### Bundled mode warning

With `VAULT_USE_BUNDLED_SNAPSHOT=true`, triggers can still update the remote repository, but your deployed bundled catalogue stays frozen. The panel warns and disables live-feed reload. Switch to live-feed mode and redeploy if you want workflow updates to appear automatically.

This patch does not provide authenticated fetching of a private raw catalogue. The feed must be reachable by the current Vault loader, or private-feed authentication must be implemented separately. The dispatch token's private-repository access does not automatically authenticate the raw feed request.

## 4. Apply the incremental JaSH patch

This patch is for the **previously delivered latest JaSH source/ZIP**, containing the Live/JioTV+/Viduki/Vault repairs. It is not the earlier cumulative patch against clean commit 447b8f7.

Back up or commit your current work first. In that matching JaSH working directory:

```sh
git apply --check /path/to/jashvibes-vault-automation.patch
git apply /path/to/jashvibes-vault-automation.patch
npm ci
npm run verify
npm run build
```

If `--check` reports conflicts, stop: do not force the patch over a different source version. Inspect/merge the listed files or use the matching latest source package first. If `package.json` conflicts because you added another verify test, keep all existing tests and append the automation test rather than replacing your scripts.

Commit/push the applied JaSH changes to the repository that Render deploys, or use your normal deployment method. Saving the patch on your computer alone does not change Render.

## 5. First use

1. Log into JaSH Admin as owner; open **Vault**.
2. The Vault Automation panel should show the configured repository and branch, not “Configure token.”
3. Click **Fetch New Titles**, review the ten-minute budget and confirm. This workflow may commit/push `mv_vault` data.
4. Expect “GitHub accepted the dispatch request,” then inspect **recent runs** / **View GitHub run**. It can take time to appear, queue behind another writer, or fail before publishing.
5. Status is polled every 20 seconds while the panel is visible. Triggers are disabled during local cooldown and when an active writer is visible. Server checks remain authoritative across tabs/instances.
6. A newly observed successful run attempts a live-feed reload on the serving JaSH process, clears this browser's session caches, and refreshes Admin's catalogue view. You can also use **Reload Vault Feed** manually.
7. Already-completed runs found on the initial page load do not trigger an automatic reload; use the manual button if needed.

Feed reload does not redeploy JaSH or clear every worker/browser/CDN globally. Other JaSH workers expire their normal memory cache; GitHub raw/CDN propagation may also take time. A successful workflow can legitimately find no additions. Inspect its log/commit to distinguish no changes from a broken source. Historical workflow metadata time is additional to its crawl budget.

## Troubleshooting

- **No token configured:** check exact server variable name and redeploy/restart.
- **Token invalid/expired:** create a replacement scoped token, update Render, restart, revoke the old token.
- **Denied/403:** check Actions read/write, selected repository, resource owner, organization approval, API limits and repository policy.
- **404 / workflow not found:** confirm owner/repo and filenames, workflow on the default branch, token repository access. Private resources may deliberately appear as 404.
- **422:** branch or inputs do not match the shipped workflow. Publish the latest mv_vault files before retrying.
- **Workflow disabled:** enable it in GitHub Actions; the panel does not silently enable repository workflows.
- **Writer busy / cooldown:** wait. The UI does not offer a bypass. A rejected/ambiguous dispatch also consumes cooldown to reduce accidental duplicate runs.
- **Request timed out:** check GitHub Actions before retrying. A network timeout can happen AFTER GitHub accepted a run; it is unsafe to assume nothing started.
- **Accepted but run fails pushing JSON:** examine GitHub job logs, workflow write permissions and branch protection. Increasing PAT permissions will not fix the workflow's own publishing permissions.
- **New JSON but old JaSH titles:** verify live-feed mode and raw URL, then reload/wait for cache propagation.
- **MongoDB unavailable:** owner verification/cooldown/audit may be affected; restore the existing DB before trying mutations.

## Validation / limits

Full JaSH verification and production build passed. New mocked GitHub tests cover workflow allowlisting, budgets, confirmation, status filtering, active-run rejection, dispatch payloads, no invented run IDs and sanitized upstream errors. Owner-auth/cross-origin checks use the app's existing guard. No real PAT was supplied or stored, no real dispatch was sent, and no Render deployment was performed. Authenticated end-to-end UI dispatch and MongoDB cooldown concurrency still need validation in your configured environment.
