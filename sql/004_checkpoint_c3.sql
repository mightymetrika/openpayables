-- C3: retain immutable evidence when previously verified TEST receipts change.
-- A flagged receipt cannot fund new periods or payment attempts. An existing
-- approved obligation is never rewritten; resolving shortfalls needs review.
-- LIVE payment processing remains disabled.
CREATE TABLE openpayables.funding_receipt_alerts (
  funding_event_id UUID PRIMARY KEY REFERENCES openpayables.funding_events(id),
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  observed_status TEXT NOT NULL CHECK(length(btrim(observed_status)) > 0),
  reason TEXT NOT NULL CHECK(length(btrim(reason)) > 0),
  identified_by TEXT NOT NULL CHECK(length(btrim(identified_by)) > 0),
  identified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER funding_receipt_alerts_immutable
  BEFORE UPDATE OR DELETE ON openpayables.funding_receipt_alerts
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
