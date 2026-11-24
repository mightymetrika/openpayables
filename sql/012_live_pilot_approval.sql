-- Separate, append-only first-payout approval. No TEST obligation can reference it.
CREATE TABLE openpayables.live_pilot_approvals (
  id UUID PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('live','pilot_test')),
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  contributor_id TEXT NOT NULL,
  points BIGINT NOT NULL CHECK (points > 0),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 2500),
  platform_account_id TEXT NOT NULL CHECK (platform_account_id ~ '^acct_[A-Za-z0-9]+$'),
  recipient_account_id TEXT NOT NULL CHECK (recipient_account_id ~ '^acct_[A-Za-z0-9]+$'),
  topup_id TEXT NOT NULL CHECK (topup_id ~ '^tu_[A-Za-z0-9]+$'),
  balance_transaction_id TEXT NOT NULL CHECK (balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'),
  receipt_net_cents BIGINT NOT NULL CHECK (receipt_net_cents >= amount_cents),
  observed_available_cents BIGINT NOT NULL CHECK (observed_available_cents >= amount_cents),
  authorization_reference TEXT NOT NULL CHECK (length(btrim(authorization_reference)) BETWEEN 1 AND 200),
  approved_by TEXT NOT NULL DEFAULT session_user,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, contributor_id) REFERENCES openpayables.project_contributors(project_id, contributor_id),
  UNIQUE (mode, platform_account_id),
  UNIQUE (mode, project_id),
  UNIQUE (mode, platform_account_id, topup_id),
  UNIQUE (mode, platform_account_id, balance_transaction_id),
  CHECK (platform_account_id <> recipient_account_id)
);
CREATE FUNCTION openpayables.guard_live_pilot_insert() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.approved_by <> session_user THEN RAISE EXCEPTION 'Approval identity must match database login'; END IF;
  IF NEW.mode = 'live' THEN
    IF current_database() <> 'openpayables_live' OR session_user <> 'openpayables_live_operator' OR
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolcreaterole OR rolcreatedb)) THEN
      RAISE EXCEPTION 'LIVE approval requires the dedicated LIVE database and authenticated LIVE operator';
    END IF;
  ELSIF current_database() <> 'openpayables_test' THEN
    RAISE EXCEPTION 'Synthetic pilot approval requires the dedicated openpayables_test database';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_pilot_insert_guard BEFORE INSERT ON openpayables.live_pilot_approvals
  FOR EACH ROW EXECUTE FUNCTION openpayables.guard_live_pilot_insert();
CREATE TRIGGER live_pilot_immutable BEFORE UPDATE OR DELETE ON openpayables.live_pilot_approvals
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
REVOKE ALL ON openpayables.live_pilot_approvals FROM PUBLIC;
