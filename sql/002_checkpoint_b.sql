-- Checkpoint B: operator-attested TEST funding, immutable allocation snapshots,
-- and Stripe Connect test transfers. No live payments are enabled.
CREATE TABLE openpayables.funding_events (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  source_reference TEXT NOT NULL CHECK (length(btrim(source_reference)) > 0),
  attested_by TEXT NOT NULL,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, source_reference)
);
CREATE TRIGGER funding_events_immutable BEFORE UPDATE OR DELETE ON openpayables.funding_events
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.distribution_periods (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  label TEXT NOT NULL CHECK (length(btrim(label)) > 0),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  UNIQUE(project_id,label)
);

CREATE TABLE openpayables.distribution_obligations (
  id UUID PRIMARY KEY,
  period_id UUID NOT NULL REFERENCES openpayables.distribution_periods(id),
  project_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  points BIGINT NOT NULL CHECK(points > 0),
  amount_cents BIGINT NOT NULL CHECK(amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK(status IN ('held','ready','submitting','transferred','unknown','reversal_review','reversed')),
  connected_account_id TEXT,
  transfer_id TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(period_id,contributor_id),
  FOREIGN KEY (project_id,contributor_id) REFERENCES openpayables.project_contributors(project_id,contributor_id)
);

-- Zero-cent allocations do not create obligations, but the point snapshot is retained.
CREATE TABLE openpayables.distribution_snapshot (
  period_id UUID NOT NULL REFERENCES openpayables.distribution_periods(id),
  contributor_id TEXT NOT NULL,
  points BIGINT NOT NULL CHECK(points > 0),
  amount_cents BIGINT NOT NULL CHECK(amount_cents >= 0),
  PRIMARY KEY(period_id,contributor_id)
);
CREATE TRIGGER distribution_snapshot_immutable BEFORE UPDATE OR DELETE ON openpayables.distribution_snapshot
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.payment_destinations (
  project_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  stripe_account_id TEXT NOT NULL CHECK(stripe_account_id LIKE 'acct_%'),
  assigned_by TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id,contributor_id),
  FOREIGN KEY (project_id,contributor_id) REFERENCES openpayables.project_contributors(project_id,contributor_id)
);

-- Only one transfer attempt is permitted for an obligation in the MVP.
-- Unknown outcomes are never blindly retried; reconciliation must find the transfer.
CREATE TABLE openpayables.payment_attempts (
  id UUID PRIMARY KEY,
  obligation_id UUID NOT NULL UNIQUE REFERENCES openpayables.distribution_obligations(id),
  provider TEXT NOT NULL DEFAULT 'stripe_test',
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_transfer_id TEXT UNIQUE,
  error_message TEXT
);
CREATE TRIGGER payment_attempts_immutable_guard BEFORE DELETE ON openpayables.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.payment_events (
  id UUID PRIMARY KEY,
  obligation_id UUID NOT NULL REFERENCES openpayables.distribution_obligations(id),
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE ON openpayables.payment_events
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.stripe_webhook_events (
  stripe_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER stripe_webhook_events_immutable BEFORE UPDATE OR DELETE ON openpayables.stripe_webhook_events
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
