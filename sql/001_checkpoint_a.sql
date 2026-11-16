-- OpenPayables Checkpoint A. Use a dedicated development PostgreSQL database.
CREATE SCHEMA IF NOT EXISTS openpayables;

CREATE TABLE openpayables.projects (
  id TEXT PRIMARY KEY CHECK (length(btrim(id)) > 0),
  name TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE openpayables.contributors (
  id TEXT PRIMARY KEY CHECK (length(btrim(id)) > 0),
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE openpayables.project_contributors (
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  contributor_id TEXT NOT NULL REFERENCES openpayables.contributors(id),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, contributor_id)
);

CREATE TABLE openpayables.categories (
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  code TEXT NOT NULL CHECK (length(btrim(code)) > 0),
  description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, code)
);

CREATE TABLE openpayables.credit_events (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  category_code TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('award', 'reversal')),
  size TEXT CHECK (size IN ('small', 'medium', 'large')),
  points_delta INTEGER NOT NULL CHECK (points_delta <> 0),
  source TEXT NOT NULL CHECK (length(btrim(source)) > 0),
  source_id TEXT NOT NULL CHECK (length(btrim(source_id)) > 0),
  role TEXT NOT NULL CHECK (length(btrim(role)) > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  approved_by TEXT NOT NULL CHECK (length(btrim(approved_by)) > 0),
  reversal_of UUID UNIQUE REFERENCES openpayables.credit_events(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, contributor_id) REFERENCES openpayables.project_contributors(project_id, contributor_id),
  FOREIGN KEY (project_id, category_code) REFERENCES openpayables.categories(project_id, code),
  UNIQUE (project_id, source, source_id, role, contributor_id, event_type),
  CHECK (
    (event_type = 'award' AND points_delta > 0 AND size IS NOT NULL AND reversal_of IS NULL)
    OR (event_type = 'reversal' AND points_delta < 0 AND size IS NULL AND reversal_of IS NOT NULL)
  )
);
CREATE INDEX credit_events_project_contributor ON openpayables.credit_events (project_id, contributor_id);

CREATE TABLE openpayables.proposals (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  title TEXT NOT NULL CHECK (length(btrim(title)) > 0),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_by TEXT,
  closed_at TIMESTAMPTZ
);

CREATE TABLE openpayables.proposal_weights (
  proposal_id UUID NOT NULL REFERENCES openpayables.proposals(id),
  contributor_id TEXT NOT NULL REFERENCES openpayables.contributors(id),
  weight INTEGER NOT NULL CHECK (weight > 0),
  PRIMARY KEY (proposal_id, contributor_id)
);

CREATE TABLE openpayables.ballots (
  proposal_id UUID NOT NULL,
  contributor_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('yes', 'no', 'abstain')),
  cast_by TEXT NOT NULL,
  cast_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, contributor_id),
  FOREIGN KEY (proposal_id, contributor_id)
    REFERENCES openpayables.proposal_weights(proposal_id, contributor_id)
);

-- Credit and vote histories cannot be silently edited. Reversals are separate events.
CREATE FUNCTION openpayables.prevent_historical_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'OpenPayables historical records are immutable';
END; $$;

CREATE TRIGGER credit_events_immutable BEFORE UPDATE OR DELETE ON openpayables.credit_events
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
CREATE TRIGGER proposal_weights_immutable BEFORE UPDATE OR DELETE ON openpayables.proposal_weights
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
CREATE TRIGGER ballots_immutable BEFORE UPDATE OR DELETE ON openpayables.ballots
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
