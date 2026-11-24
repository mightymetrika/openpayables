# First-payout pilot: LIVE read-only payer and recipient inspection

**Version:** `0.2.0-alpha.4` **candidate only**. Not a release or authorization to move money.
**Scope:** A single US legal project operator inspects its **own** LIVE Stripe account and, optionally, one prospective US contributor. NO LIVE transfer, top-up creation, bank payout, webhook registration, or PostgreSQL mutation.

## Why this boundary is necessary

`0.2.0-alpha.3` has production-quality TEST controls, but its `project_payment_platforms.mode`, funding evidence kinds, payment idempotency keys, audit labels, webhook and payout tracing are deliberately **test-only**. Changing a Stripe key from `sk_test_` to `sk_live_` on the existing CLI would be incorrect and unsafe. This first slice establishes a read-only LIVE identity and available-balance check while we implement a distinct, audited LIVE financial execution path. Do not use TEST obligations, synthetic receipts, or the hosted OpenPayables **development** Supabase database for real money.

## Read-only operator workflow

1. Create a **restricted READ-ONLY** LIVE Stripe API key (prefix `rk_live_`) using Stripe Dashboard. Allow only account retrieval, balance inspection and, if needed, connected account / top-up retrieval. Never share the key in chat, source files, `.env` or log output.
2. Run from a trusted operator computer using an environment variable or secret manager. Require the **exact expected** LIVE platform account ID (from authenticated account inspection) and `OPENPAYABLES_LIVE_READ_ONLY_CONFIRM=YES_READ_ONLY`.
3. For development with no connected contributor, omit optional flags. The output reports the account identity, active transfers capability and available USD **LIVE** balance, and returns `safeToExecuteTransfer:false` unconditionally. **No Stripe write request is issued.**
4. After a real contributor consents and completes hosted verification, optionally add `--recipient acct_...` to inspect the named recipient's transfers and payout readiness. An apparent ready flag is *not* a release of the legal/tax/provider payment gate.
5. After a separately authorized real top-up is complete, optionally add `--topup tu_...` to **read** succeeded USD receipt evidence. No amount is added to project funding or approved for distribution by this command.

### PowerShell 5.1 — local, operator-held secrets

```powershell
# This first candidate can be compiled and tested WITHOUT any real API credentials.
# Only run the inspection once a separately approved restricted READ key is available.
# Do NOT put the key literal in your PowerShell history.
$env:OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID = 'acct_YOUR_VERIFIED_LIVE_PLATFORM'
$env:OPENPAYABLES_LIVE_READ_ONLY_CONFIRM = 'YES_READ_ONLY'
$secure = Read-Host 'Stripe LIVE restricted READ key' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:OPENPAYABLES_STRIPE_LIVE_READ_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    npm run live:readiness
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Item Env:OPENPAYABLES_STRIPE_LIVE_READ_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:OPENPAYABLES_LIVE_EXPECTED_PLATFORM_ACCOUNT_ID -ErrorAction SilentlyContinue
    Remove-Item Env:OPENPAYABLES_LIVE_READ_ONLY_CONFIRM -ErrorAction SilentlyContinue
    $secure = $null
}
```

The source code **does not create Stripe API keys**, and this check does not validate the Stripe Connect top-up permission for an individual transaction. A zero available balance is a legitimate result, not evidence of failure. Any business approval, funds-ownership, recipient eligibility, tax/compliance review and idempotent payment reconciliation remain separate mandatory gates.

## Next and only remaining implementation path toward first payout

1. Build a **mode-separated** LIVE financial ledger, verified funding import and project binding that cannot mingle with TEST records; enforce non-spoofable operator authorization in a trusted runtime and explicit transfer approvals/caps.
2. Add one idempotent LIVE transfer attempt per frozen funded obligation, a reconciliation-only path for unknown outcomes, authenticated webhooks, and provable bank-payout trace. Validate everything in a non-LIVE environment before deployment.
3. After Connect platform approval, recipient consent/eligibility and legal/tax checks, conduct exactly **one small LIVE payment** using operator-owned funds, and reconcile its bank payout. No public SaaS/admin UI, subscription collection, or changes to BlindStats are part of this pilot.
