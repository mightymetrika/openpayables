-- C5: read-only Stripe TEST connected-account bank payout observations.
-- Payouts can combine funds from multiple Stripe transfers. Never use this
-- account-level record to mark a specific OpenPayables obligation settled.
CREATE TABLE openpayables.connected_payouts (
  project_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  stripe_payout_id TEXT NOT NULL CHECK (stripe_payout_id ~ '^po_[A-Za-z0-9]+$'),
  stripe_platform_account_id TEXT NOT NULL CHECK (stripe_platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  connected_account_id TEXT NOT NULL CHECK (connected_account_id ~ '^acct_[A-Za-z0-9]+$'),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL CHECK (currency ~ '^[a-z]{3}$'),
  payout_destination_id TEXT,
  created_unix BIGINT NOT NULL CHECK (created_unix >= 0),
  current_status TEXT NOT NULL CHECK (current_status IN ('pending','in_transit','paid','failed','canceled')),
  arrival_unix BIGINT,
  failure_code TEXT,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, contributor_id, stripe_payout_id),
  FOREIGN KEY (project_id,contributor_id)
    REFERENCES openpayables.project_contributors(project_id,contributor_id)
);

CREATE TABLE openpayables.connected_payout_observations (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  stripe_payout_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_transit','paid','failed','canceled')),
  arrival_unix BIGINT,
  failure_code TEXT,
  observed_by TEXT NOT NULL CHECK (length(btrim(observed_by)) > 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,contributor_id,stripe_payout_id)
    REFERENCES openpayables.connected_payouts(project_id,contributor_id,stripe_payout_id)
);
CREATE INDEX connected_payout_observations_history ON openpayables.connected_payout_observations
  (project_id,contributor_id,stripe_payout_id,observed_at);
CREATE TRIGGER connected_payout_observations_immutable
  BEFORE UPDATE OR DELETE ON openpayables.connected_payout_observations
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
