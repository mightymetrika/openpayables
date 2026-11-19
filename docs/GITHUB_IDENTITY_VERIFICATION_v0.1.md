# Checkpoint C10 — contributor-controlled GitHub identity verification

**Status:** Windows/PostgreSQL and real GitHub Device Flow `whoami` accepted 2026-11-19; C10 git commit pending. No live payment capability.
**Starting commit:** `e8afaf3` on `development` (C9 accepted). Keep `main` at `28a79a4`.

## Purpose and limits

C8 links a stable numeric GitHub user ID to a project contributor through an **operator attestation**. That is not proof the contributor controls that account. C10 uses **GitHub App user authorization** via GitHub's OAuth device flow: the GitHub user personally enters a short verification code at `https://github.com/login/device`, and the CLI uses the resulting short-lived user access token to call the authenticated `GET https://api.github.com/user` endpoint. A verified record is written **only when the returned numeric GitHub ID exactly matches the immutable C8 project link**.

Before displaying a device code, the trusted CLI uses the existing RSA key to make a signed `GET /app` request and verifies that the configured Client ID belongs to the **same** GitHub App ID as the project binding. A wrong Client ID fails closed. The CLI stores the numeric user ID, login at verification time, GitHub App ID, method, initiation actor, and timestamp. It never stores a GitHub device code, user access token, refresh token, client secret, or app private key. GitHub login names are not accounting identities; IDs are stable. Repeated verification is idempotent, and a different ID or App is refused. An App installation must already be registered and bound to the project (C9).

**Important limitation:** This is a trusted **local operator CLI**, not authenticated multi-user self-service. The operator selects the target OpenPayables contributor while the contributor controls GitHub authorization. The record proves control of the expected GitHub account **at verification time**; it does not establish legal identity, current authorization after revocation, payment eligibility, beneficial ownership, tax classification, or a permanent relationship between person and account. The `whoami` command can verify that the real GitHub device flow works even before a project has merged PR candidates. This checkpoint does **not** require verified status for C8 historical approvals; later payment policy must establish a suitable verified identity and beneficiary gate before live funds.

## Enable Device Flow (GitHub side)

1. Sign in to GitHub as the owner of the existing **Mightymetrika OpenPayables** GitHub App (App ID `5825297`).
2. Go to the App **General** settings. Under **Identifying and authorizing users**, enable **Device Flow** and save. The initial C9 registration deliberately left it disabled.
3. Copy the **Client ID** from General (this is **not** the numeric App ID). No callback URI, webhooks, or additional permissions are needed for the CLI flow.
4. Keep the GitHub App installed on the selected public repository with **Metadata: Read-only** and **Pull requests: Read-only**. No contributor installs the App. Do not share the App's RSA private key with contributors.

GitHub recommends Device Flow for headless/CLI environments only. Contributors must verify that the authorization screen names the expected App before granting access; never ask them to send passwords, personal access tokens, or authorization codes through chat.

## Commands (PowerShell 5.1)

```powershell
Set-Location "$HOME\Documents\openpayables"
$env:OPENPAYABLES_DATABASE_URL = 'postgresql://openpayables:openpayables_local_only@127.0.0.1:5432/openpayables'
$env:OPENPAYABLES_OPERATOR_ID = 'local-operator'
$env:OPENPAYABLES_GITHUB_APP_ID = '5825297'
$env:OPENPAYABLES_GITHUB_APP_PRIVATE_KEY_PATH = Join-Path $HOME '.openpayables-secrets\github-app.pem'
$env:OPENPAYABLES_GITHUB_APP_CLIENT_ID = 'Iv23YOUR_ACTUAL_CLIENT_ID'  # replace with the Client ID from General

# First, test GitHub authorization without writing to any project database:
npm run cli -- github identity whoami

# For a contributor with C7 discovered evidence, a C8 immutable link,
# project membership and a C9 App binding:
npm run cli -- github identity show PROJECT_ID CONTRIBUTOR_ID
npm run cli -- github identity verify PROJECT_ID CONTRIBUTOR_ID
npm run cli -- github identity show PROJECT_ID CONTRIBUTOR_ID
npm run cli -- github candidates PROJECT_ID
```

When prompted, the **contributor** opens GitHub's official device page in their own browser, enters the temporary code displayed by the CLI, and approves the expected GitHub App. The CLI checks GitHub's `/user` response automatically. A different GitHub account is rejected and cannot be substituted for the existing C8 mapping. The CLI does not display or store the OAuth token. Do not create fake pull requests just to populate the queue. If the project's C7 scan has no candidates, the full persisted `verify` test remains covered by dedicated PostgreSQL integration tests until a real contribution exists.

## C10 acceptance evidence — 2026-11-19 (US Pacific)

- Device Flow was enabled in the existing GitHub App's General settings, while OAuth-on-installation and webhooks remained disabled. The existing App's repository permissions were not expanded.
- `npm run db:migrate` succeeded on the dedicated development PostgreSQL database.
- `npm run check` passed **80 unit tests**, ESLint and TypeScript build; `npm run test:integration` separately passed **28 PostgreSQL integration tests** in the dedicated test database. `git diff --check` and `git diff --cached --check` both passed, with 14 intended C10 files staged.
- Actual GitHub device authorization succeeded through the CLI `github identity whoami`, identifying `mightymetrika` with numeric GitHub user ID `134214097`, `verifiedBy=github_app_device_flow`, and **`stored=false`**. The device code has been redacted; neither private key nor OAuth tokens were exposed or saved.
- The real `whoami` proves that GitHub authorizes the account, **not** that a project-contributor identity record was persisted. Immutable verification of an existing C8 link was tested with synthetic PostgreSQL fixtures; there are no eligible merged-PR candidates from the public C7 scan, so no real project-linked verification was attempted. No extra GitHub PR or Stripe operation was needed.
- No credits, payment obligations or monetary transactions were created by this acceptance test. No live-payments enablement is implied.

## Safety / acceptance boundaries

- The CLI first validates its configured Client ID through `GET /app` using the existing RSA-authenticated App; it never trusts an arbitrary OAuth Client ID. Initial device-code request and token exchange use GitHub's official HTTPS URLs. Poll no more frequently than GitHub's `interval`; respect `slow_down`, expiration, denial, and malformed responses.
- Only GitHub App **user** access tokens (`ghu_`) are accepted for `GET /user`. No personal access token or GitHub installation token is treated as contributor authorization.
- A verified record requires the exact existing (project ID, contributor ID, GitHub numeric ID) mapping plus an App installed/bound to that project. Verify and query are project scoped, deduplicated and immutable.
- Verification **does not award or reverse credits**, change distribution snapshots, create Stripe transfers, or permit live money.
- The `whoami` check authenticates an account but does not establish a project identity claim or create any database evidence.
- App Device Flow is currently a temporary CLI onboarding aid; a production web onboarding workflow should use GitHub's browser authorization flow with PKCE and proper authenticated user sessions. Do not distribute the GitHub App RSA private key to contributors.

References: [GitHub — Generating a user access token for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app); [GitHub — Best practices for GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app).
