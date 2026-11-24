-- One durable attempt per approval, with append-only Stripe observations.
CREATE TABLE openpayables.live_pilot_attempts (
  approval_id UUID PRIMARY KEY REFERENCES openpayables.live_pilot_approvals(id),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (idempotency_key = 'openpayables-pilot-' || approval_id::text),
  execution_reference TEXT NOT NULL CHECK (length(btrim(execution_reference)) BETWEEN 1 AND 200),
  attempted_by TEXT NOT NULL DEFAULT session_user,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE openpayables.live_pilot_transfer_observations (
  approval_id UUID NOT NULL REFERENCES openpayables.live_pilot_attempts(approval_id),
  transfer_id TEXT NOT NULL CHECK (transfer_id ~ '^tr_[A-Za-z0-9]+$'),
  amount_reversed_cents INTEGER NOT NULL CHECK (amount_reversed_cents BETWEEN 0 AND 2500),
  observed_by TEXT NOT NULL DEFAULT session_user,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, amount_reversed_cents)
);
CREATE FUNCTION openpayables.guard_live_pilot_transfer_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE approval openpayables.live_pilot_approvals%ROWTYPE;
BEGIN
  SELECT * INTO STRICT approval FROM openpayables.live_pilot_approvals WHERE id=NEW.approval_id;
  IF approval.mode = 'live' THEN
    IF current_database() <> 'openpayables_live' OR session_user <> 'openpayables_live_operator' OR
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolcreaterole OR rolcreatedb)) THEN
      RAISE EXCEPTION 'Dedicated LIVE operator database required';
    END IF;
  ELSIF current_database() <> 'openpayables_test' THEN
    RAISE EXCEPTION 'Dedicated synthetic TEST database required';
  END IF;
  IF TG_TABLE_NAME = 'live_pilot_attempts' THEN
    IF NEW.attempted_by <> session_user THEN RAISE EXCEPTION 'Attempt identity mismatch'; END IF;
  ELSE
    IF NEW.observed_by <> session_user OR NEW.amount_reversed_cents > approval.amount_cents THEN
      RAISE EXCEPTION 'Invalid transfer observation';
    END IF;
    -- Serialize concurrent observations. Never silently accept a different transfer ID.
    PERFORM pg_advisory_xact_lock(94003, hashtext(NEW.approval_id::text));
    IF EXISTS (SELECT 1 FROM openpayables.live_pilot_transfer_observations
      WHERE approval_id=NEW.approval_id AND transfer_id<>NEW.transfer_id) THEN
      RAISE EXCEPTION 'Conflicting transfer IDs: manual incident review required';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_pilot_attempt_guard BEFORE INSERT ON openpayables.live_pilot_attempts
  FOR EACH ROW EXECUTE FUNCTION openpayables.guard_live_pilot_transfer_insert();
CREATE TRIGGER live_pilot_observation_guard BEFORE INSERT ON openpayables.live_pilot_transfer_observations
  FOR EACH ROW EXECUTE FUNCTION openpayables.guard_live_pilot_transfer_insert();
CREATE TRIGGER live_pilot_attempt_immutable BEFORE UPDATE OR DELETE ON openpayables.live_pilot_attempts
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
CREATE TRIGGER live_pilot_observation_immutable BEFORE UPDATE OR DELETE ON openpayables.live_pilot_transfer_observations
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
REVOKE ALL ON openpayables.live_pilot_attempts, openpayables.live_pilot_transfer_observations FROM PUBLIC;
