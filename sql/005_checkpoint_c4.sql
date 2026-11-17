-- C4: Bind each project to one operator-controlled Stripe TEST platform.
-- Never store Stripe credentials; only the provider-returned acct_... identifier.
-- No LIVE credentials or LIVE payouts are supported by this migration.
CREATE TABLE openpayables.project_payment_platforms (
  project_id TEXT PRIMARY KEY REFERENCES openpayables.projects(id),
  provider TEXT NOT NULL DEFAULT 'stripe' CHECK (provider = 'stripe'),
  mode TEXT NOT NULL DEFAULT 'test' CHECK (mode = 'test'),
  stripe_platform_account_id TEXT NOT NULL CHECK (stripe_platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  bound_by TEXT NOT NULL CHECK (length(btrim(bound_by)) > 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing verified TEST receipts already provide authenticated platform evidence.
-- Attested-only projects are deliberately NOT backfilled; an operator must bind
-- them explicitly, and legacy projects with payment attempts need manual review.
INSERT INTO openpayables.project_payment_platforms
  (project_id, provider, mode, stripe_platform_account_id, bound_by)
SELECT f.project_id, 'stripe', 'test', MIN(f.stripe_platform_account_id), 'c4-verified-receipt-backfill'
FROM openpayables.funding_events f
WHERE f.evidence_kind = 'stripe_test_topup'
GROUP BY f.project_id
HAVING COUNT(DISTINCT f.stripe_platform_account_id) = 1;
CREATE TRIGGER project_payment_platforms_immutable
  BEFORE UPDATE OR DELETE ON openpayables.project_payment_platforms
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
