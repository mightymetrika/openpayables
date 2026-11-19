# C11 — Single-command operator project setup (TEST-safe local CLI)

**Status:** Windows automated tests and actual GitHub App operator setup accepted on 2026-11-19 against C10 baseline `b481ed4`; C11 commit/push pending.

## Goal

Give the operator a straightforward first step instead of separately running `project create`, `github source add`, and `github app bind`. This is the **local operator CLI**, not a hosted multi-tenant authorization system. OpenPayables itself remains free, reusable software; each adopting operator owns its own GitHub installation and, separately, its own Stripe funds/account.

## Before setup

- Use an independent, dedicated OpenPayables PostgreSQL database with the C10 migrations applied.
- Have the shared OpenPayables GitHub App installed on **only the chosen public repository** with read-only pull requests/metadata permissions. A self-hosted operator can register their own equivalent App instead.
- Set `OPENPAYABLES_DATABASE_URL`, `OPENPAYABLES_OPERATOR_ID`, `OPENPAYABLES_GITHUB_APP_ID`, and `OPENPAYABLES_GITHUB_APP_PRIVATE_KEY_PATH` in the local environment. Keep the PEM outside the repository; don't paste its contents into any command.
- This version does **not** support private repos, browser-based operator signup, hosted multi-tenancy or automatic App installation. Each contributor will later use separate identity verification.

## One-command setup

```powershell
npm run cli -- project setup my-project "My open-source project" owner/repo
npm run cli -- project setup-status my-project
```

`project setup` first reads the exact public GitHub repository and verifies the installed App's repository scope using existing C9 authentication. **If that check fails, the project isn't created.** On success, a single PostgreSQL transaction creates the project, all four default contribution categories, repository source registration and immutable App installation binding. A failed DB transaction rolls back the entire setup. Repeating the exact same setup is safe; conflicting project names, operators, repositories or installation IDs are rejected. Existing projects with partial or different setup are **not** silently adopted.

The command returns its stable project ID, GitHub numeric repository/App/installation IDs, `createdNow`, and a sample next command. It does not create contributors, verified GitHub identity claims, credits, monetary obligations or Stripe payments. It does not store App credentials or ephemeral installation tokens.

`project setup-status` shows **local** project registration, source/binding metadata, contributor count, candidate count, approved candidate count, and linked/verified identity counts. It does **not** reauthenticate GitHub or imply a transfer is bank-settled.

## Continue with existing commands

```powershell
# Supply a real date for the intended look-back period.
npm run cli -- github sync my-project owner/repo 2026-11-01
npm run cli -- github candidates my-project
# When a contributor has qualifying evidence: create/join, link ID, let
# the contributor verify control via GitHub Device Flow, then approve points.
# Funding and payment paths remain separate and TEST only.
```

For a successful C11 live operator acceptance check, create a **new** unique local project for the already installed public repository `mightymetrika/openpayables`. Do not modify the earlier C7/C9 observation project or create a dummy pull request. An empty candidate queue remains valid.

## Validation and limits

- `npm run check` (unit tests, lint, TypeScript build) and `npm run test:integration` with the **dedicated** `openpayables_test` DB are required before acceptance.
- Integration tests cover atomic creation, idempotence, conflicting operator/name/installation, refusing silent adoption, and independent operator projects using the same repository.
- A trusted environment variable is **not a multi-user login**. The current CLI must not be exposed directly as a network-accessible service for arbitrary operators.
- No bank/payout operations, Stripe account creation, new revenue allocations or LIVE payments occur in C11. Stripe eligibility review is independent and still pending.

## C11 acceptance — 2026-11-19 (US Pacific)

- `npm run db:migrate` completed on `openpayables`; `npm run check` passed **84/84 unit tests**, ESLint, and TypeScript build; `npm run test:integration` passed **33/33 PostgreSQL tests** against the dedicated `openpayables_test` database. Staged whitespace validation passed on all eight intended C11 files.
- A real GitHub App-authenticated `project setup` created isolated local project `openpayables-c11-0ecc34cd` for `mightymetrika/openpayables`, with repo ID `1460710596`, App ID `5825297`, installation ID `183507524`, and `createdNow: true`. The identical second call returned `createdNow: false` and unchanged identities.
- `project setup-status` confirmed repository registration, persisted installation binding, and counts of **zero** contributors, candidates, approvals, linked identities, and verified identities.
- An authenticated GitHub sync for that new project beginning `2026-11-01` returned `authMode: github_app_installation` and **zero** discovered candidates, credits awarded or monetary obligations created. This confirms real installation access and safe empty-case handling, not positive discovery of a merged PR.
- No GitHub PR, Stripe payment, financial record, or LIVE transaction was manufactured for acceptance. Commit/push the staged C11 patch to `development` only once these documentation files are applied.
