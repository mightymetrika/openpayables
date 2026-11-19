# C13 — Operator revenue-pool basis (TEST-only)

**Scope:** This is one additional calculation and an immutable operator attestation for a draft distribution. It is not an accounting system, does not import revenue, and does not enable production settlement.

## Operator flow

An operator who has actual project revenue records outside OpenPayables enters the **gross receipts** for a selected period, **attributable fees**, **approved costs**, **reserves**, and a **published contributor-sharing rate** in integer basis points (2500 = 25%). The operator also records a stable policy-version reference and a receipt-ledger reference. References must point to documentation managed by the operator; OpenPayables does not fetch, check, or store bank/receipt documents.

```
net_cents = gross_receipts_cents - fees_cents - costs_cents - reserves_cents
pool_cents = floor(net_cents * share_basis_points / 10000)
```

Zero or negative pools, overspecified deductions, invalid basis points and fractional cents fail before DB writes. The immutable basis preserves the inputs, result, policy reference, evidence reference, and operator ID for each period. This is a **period-specific policy snapshot**, not a global policy-management subsystem.

```powershell
npm run cli -- distribution create-revenue demo-project nov-2026 10000 300 1200 500 2500 policy-2026-v1 ledger-nov-2026
# Returns a draft period UUID and its attested pool (2000 cents); no funding or obligation exists yet.
npm run cli -- distribution show PERIOD_UUID
# Independently establish eligible TEST funding using the existing fund add or import-topup workflow.
npm run cli -- distribution approve PERIOD_UUID
npm run cli -- distribution show PERIOD_UUID
```

`distribution create` remains available for manually specified **prefunded TEST/pilot pools**, with no revenue basis record; older periods are unchanged. `show` returns `revenueBasis: null` for manual/legacy periods. Operators must not present a manually entered pool as verified revenue. Do not change existing records to force a new label.

**Safety boundaries:** Creation does not record funding and cannot allocate money. Existing project-level funding reservations, Stripe TEST account binding, receipt reversal checks and transfer idempotency remain in control. Operator-supplied revenue is **attested, not externally verified**, and imported Stripe TEST top-ups are evidence only of TEST funds, never business income. OpenPayables is free software and does not hold or route other operators' money. LIVE keys remain disabled. There are no changes to GitHub, BlindStats or RandomPlayables.

**Windows acceptance (2026-11-19, US Pacific):** Migration succeeded against the dedicated OpenPayables database. `npm run check` passed 92 unit tests, ESLint, and TypeScript build. All 40 dedicated PostgreSQL integration tests passed, including two tests creating isolated operator projects, showing the draft basis, rejecting approval without sufficient TEST funding, validating approval after a TEST attestation, checking immutability and project isolation. The combined automated count is **132 passing tests**. `git diff --check` passed; LF-to-CRLF messages were informational. The new CLI command was not separately exercised with a manual real-project smoke run. No transfer or LIVE payment was attempted. C13 is sufficient for the present TEST-mode revenue-pool-basis scope; no C14 financial-accounting expansion is implied.
