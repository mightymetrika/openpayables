-- C13: immutable evidence of the operator's revenue-pool calculation.
-- It records an attestation, NOT verified external revenue or funding.
-- Existing distribution approval and Stripe TEST funding limits remain authoritative.
CREATE TABLE openpayables.distribution_pool_bases (
  period_id UUID PRIMARY KEY REFERENCES openpayables.distribution_periods(id),
  basis_kind TEXT NOT NULL DEFAULT 'operator_attested_revenue'
    CHECK (basis_kind='operator_attested_revenue'),
  policy_reference TEXT NOT NULL CHECK (length(btrim(policy_reference)) > 0),
  receipt_reference TEXT NOT NULL CHECK (length(btrim(receipt_reference)) > 0),
  gross_receipts_cents BIGINT NOT NULL CHECK (gross_receipts_cents >= 0),
  fee_cents BIGINT NOT NULL CHECK (fee_cents >= 0),
  cost_cents BIGINT NOT NULL CHECK (cost_cents >= 0),
  reserve_cents BIGINT NOT NULL CHECK (reserve_cents >= 0),
  contributor_share_bps INTEGER NOT NULL CHECK (contributor_share_bps BETWEEN 1 AND 10000),
  net_cents BIGINT NOT NULL CHECK (net_cents > 0),
  pool_cents BIGINT NOT NULL CHECK (pool_cents > 0),
  attested_by TEXT NOT NULL CHECK (length(btrim(attested_by)) > 0),
  attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (net_cents = gross_receipts_cents - fee_cents - cost_cents - reserve_cents),
  CHECK (pool_cents = trunc(net_cents::numeric * contributor_share_bps / 10000))
);
CREATE TRIGGER distribution_pool_bases_immutable BEFORE UPDATE OR DELETE
  ON openpayables.distribution_pool_bases
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
