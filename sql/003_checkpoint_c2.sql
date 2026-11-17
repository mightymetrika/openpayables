-- Checkpoint C2: provider-verified Stripe TEST top-up receipt attribution.
-- Existing operator attestations remain distinct. NO live payment capability.
ALTER TABLE openpayables.funding_events
  ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'attested_test',
  ADD COLUMN stripe_platform_account_id TEXT,
  ADD COLUMN stripe_topup_id TEXT,
  ADD COLUMN stripe_balance_transaction_id TEXT,
  ADD COLUMN verified_at TIMESTAMPTZ,
  ADD CONSTRAINT funding_evidence_kind_check CHECK (
    (evidence_kind = 'attested_test'
      AND stripe_platform_account_id IS NULL
      AND stripe_topup_id IS NULL
      AND stripe_balance_transaction_id IS NULL
      AND verified_at IS NULL)
    OR
    (evidence_kind = 'stripe_test_topup'
      AND stripe_platform_account_id ~ '^acct_[A-Za-z0-9]+$'
      AND stripe_topup_id ~ '^tu_[A-Za-z0-9]+$'
      AND stripe_balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'
      AND verified_at IS NOT NULL)
  );

-- A provider receipt can be attributed to at most ONE OpenPayables project.
CREATE UNIQUE INDEX funding_unique_stripe_test_topup
  ON openpayables.funding_events(stripe_platform_account_id, stripe_topup_id)
  WHERE evidence_kind = 'stripe_test_topup';
