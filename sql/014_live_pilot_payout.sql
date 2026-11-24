-- Append-only provider payout trace, not independent bank confirmation.
CREATE TABLE openpayables.live_pilot_payout_observations (
  approval_id UUID NOT NULL REFERENCES openpayables.live_pilot_attempts(approval_id),
  transfer_id TEXT NOT NULL CHECK (transfer_id ~ '^tr_[A-Za-z0-9]+$'),
  payout_id TEXT NOT NULL CHECK (payout_id ~ '^po_[A-Za-z0-9]+$'),
  destination_payment_id TEXT NOT NULL CHECK (destination_payment_id ~ '^py_[A-Za-z0-9]+$'),
  balance_transaction_id TEXT NOT NULL CHECK (balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'),
  net_cents INTEGER NOT NULL CHECK (net_cents BETWEEN 1 AND 2500),
  payout_cents BIGINT NOT NULL CHECK (payout_cents > 0),
  status TEXT NOT NULL CHECK (status IN ('pending','in_transit','paid','failed','canceled','reversed')),
  observed_by TEXT NOT NULL DEFAULT session_user,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (approval_id, status)
);
CREATE FUNCTION openpayables.guard_live_pilot_payout_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approval openpayables.live_pilot_approvals%ROWTYPE;
BEGIN
  SELECT * INTO STRICT approval FROM openpayables.live_pilot_approvals WHERE id=NEW.approval_id;
  IF approval.mode = 'live' THEN
    IF current_database() <> 'openpayables_live' OR session_user <> 'openpayables_live_operator' OR
       EXISTS (SELECT 1 FROM pg_roles WHERE rolname=session_user AND (rolsuper OR rolcreaterole OR rolcreatedb)) THEN
      RAISE EXCEPTION 'Dedicated LIVE operator database required';
    END IF;
  ELSIF current_database() <> 'openpayables_test' THEN RAISE EXCEPTION 'Dedicated synthetic TEST database required';
  END IF;
  IF NEW.observed_by <> session_user OR NEW.net_cents > approval.amount_cents THEN RAISE EXCEPTION 'Invalid payout observation'; END IF;
  PERFORM pg_advisory_xact_lock(94004, hashtext(NEW.approval_id::text));
  IF NOT EXISTS (SELECT 1 FROM openpayables.live_pilot_transfer_observations WHERE approval_id=NEW.approval_id AND transfer_id=NEW.transfer_id) THEN
    RAISE EXCEPTION 'Verified transfer observation required';
  END IF;
  IF EXISTS (SELECT 1 FROM openpayables.live_pilot_payout_observations WHERE approval_id=NEW.approval_id AND
    (transfer_id,payout_id,destination_payment_id,balance_transaction_id,net_cents,payout_cents) IS DISTINCT FROM
    (NEW.transfer_id,NEW.payout_id,NEW.destination_payment_id,NEW.balance_transaction_id,NEW.net_cents,NEW.payout_cents)) THEN
    RAISE EXCEPTION 'Conflicting payout trace: manual incident review required';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER live_pilot_payout_guard BEFORE INSERT ON openpayables.live_pilot_payout_observations
  FOR EACH ROW EXECUTE FUNCTION openpayables.guard_live_pilot_payout_insert();
CREATE TRIGGER live_pilot_payout_immutable BEFORE UPDATE OR DELETE ON openpayables.live_pilot_payout_observations
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
REVOKE ALL ON openpayables.live_pilot_payout_observations FROM PUBLIC;
