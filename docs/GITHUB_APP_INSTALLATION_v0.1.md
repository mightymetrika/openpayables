# C9 — GitHub App installation authentication (CLI-first)

**Status:** Windows implementation accepted 2026-11-18 (mocked GitHub API, unit and PostgreSQL integration tests); no real GitHub App registration or installation yet. Pending C9 commit/push.
**Starting point:** accepted C8 at `cf57959` on `development`. `main` remains `28a79a4`.

## Why this exists

OpenPayables is reusable, free open-source software. A GitHub App owned by the service operator may be installed by independent GitHub project operators on repositories they select. **Individual contributors do not install the App.** Each independent operator still owns their own Stripe account, balances, and contributor-payment responsibilities. GitHub access and Stripe funding are unrelated credentials.

A hosted OpenPayables deployment could own one GitHub App installation service and keep its private key server-side; independent projects authorize installations through GitHub. A self-hosted OpenPayables operator may instead register its own GitHub App and supply its own key. This C9 implementation is a **trusted local CLI**, not a public multi-tenant web onboarding flow.

## What C9 delivers

1. `github app bind <project-id> <owner/repo>`: for an already registered **public** repository, ask GitHub which installation has access, verify the App ID and permission, request a **short-lived, single-repository token restricted to Pull requests: Read**, verify that token resolves to the expected immutable GitHub repository ID, and save only installation metadata.
2. `github app show <project-id> <owner/repo>`: display binding metadata with no tokens or private key.
3. Existing `github sync ...`: if a binding exists, authenticate through it on **every** scan, recheck the App, installation ID and repository identity, then use the scoped token for the same bounded read-only C7 discovery process. Revocation, suspension, wrong permission, replacement or API failure stops the scan; there is **no fallback** to an unauthenticated public request once an App is bound. Unbound public repositories preserve C7's existing behavior.
4. Database migration `sql/009_checkpoint_c9.sql`: immutable, project-scoped installation binding. The App's private RSA key and ephemeral tokens are never written to the database or responses.

**Not yet included:** private-repository discovery; GitHub App creation/installation via a website; webhook receiver; hosted tenancy or user authentication; contributor-controlled GitHub OAuth claim; any change to contribution points, deterministic allocation, or Stripe payment logic. C8's operator-attested identity links still are not proof of account ownership.

## GitHub App configuration (for a later real API acceptance check)

Register an App under the GitHub account/organization that will operate the GitHub integration. Configure repository permissions `Metadata: Read` (implicit) and `Pull requests: Read`, without code-write permission. Install it on a **selected public test repository**. Under GitHub's App settings, generate an RSA private key and keep the `.pem` file **outside the repository**, backed up securely. Do not post the private key or installation token to chat, add it to Git, or distribute it to contributor accounts.

For the local CLI test, after recording the GitHub App's numeric ID and securely storing its private key:

```powershell
Set-Location "$HOME\Documents\openpayables"
$env:OPENPAYABLES_DATABASE_URL = "postgresql://openpayables:openpayables_local_only@127.0.0.1:5432/openpayables"
$env:OPENPAYABLES_OPERATOR_ID = "local-operator"
$env:OPENPAYABLES_GITHUB_APP_ID = "<numeric GitHub App ID>"
$env:OPENPAYABLES_GITHUB_APP_PRIVATE_KEY_PATH = "<absolute path to private .pem outside repository>"

# Use an existing registered public source, or register a new one first.
npm run cli -- github source add PROJECT_ID OWNER/REPO
npm run cli -- github app bind PROJECT_ID OWNER/REPO
npm run cli -- github app show PROJECT_ID OWNER/REPO
npm run cli -- github sync PROJECT_ID OWNER/REPO 2026-11-01
```

C9 does **not** create an App or ask contributors to install anything. Token creation uses GitHub's REST API, not local Stripe; it does not move money. GitHub App credentials are needed **only** for binding and syncing installed repositories. Standard public discovery continues to work without them.

## Safety and acceptance

- Verify signed RS256 JWT claims; reject malformed, suspended, wrong-App or changed installations.
- Restrict token issuance to the requested GitHub **repository ID** and read-only pull-request permission; verify token expiry and repository identity before scanning.
- Make installation binding unique and immutable per project/repository; repeated matching binds are idempotent and conflicting binds fail.
- Run unit tests, dedicated PostgreSQL integration tests, ESLint and TypeScript build before committing. Test cases use mocked GitHub API responses and a temporary local RSA private key. **These tests do not establish that an actual GitHub App has been registered or installed.**
- Never enable live Stripe payout capability while Stripe's operator-owned business model review remains pending.

### Windows acceptance results — 2026-11-18

- `npm run db:migrate`: successful against dedicated OpenPayables development PostgreSQL.
- `npm run check`: **71/71 unit tests**, ESLint and TypeScript build passed after a test-only, case-insensitive adjustment to the invalid-RSA-key error-message assertion. The prior single failure was capitalization (`valid` versus `Valid`), not authentication behavior.
- `npm run test:integration`: **24/24 passed** against the dedicated PostgreSQL integration test database.
- `git diff --cached --check`: passed with 12 intended C9 files staged. Windows line-ending warnings were informational.
- **External validation not yet performed:** no GitHub App was created/installed and no App-authenticated real GitHub synchronization has been run. Operator GitHub App registration and public-repository install should be tested separately before claiming that pathway is proven against the provider.
- No live Stripe activity, payouts, or app integration occurred.


**Provider documentation:** https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app and https://docs.github.com/en/rest/apps/apps
