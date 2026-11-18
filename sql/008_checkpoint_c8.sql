-- C8: operator-attested GitHub-to-contributor mapping and one approved award per candidate.
-- These records are append-only. A GitHub login alone does not prove account ownership.
CREATE TABLE openpayables.github_identity_links (
  project_id TEXT NOT NULL,
  github_user_id BIGINT NOT NULL CHECK (github_user_id > 0),
  contributor_id TEXT NOT NULL,
  linked_by TEXT NOT NULL CHECK (length(btrim(linked_by)) > 0),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_user_id),
  UNIQUE (project_id, contributor_id),
  FOREIGN KEY (project_id, contributor_id)
    REFERENCES openpayables.project_contributors(project_id, contributor_id)
);
CREATE TRIGGER github_identity_links_immutable BEFORE UPDATE OR DELETE ON openpayables.github_identity_links
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.github_candidate_approvals (
  project_id TEXT NOT NULL,
  github_repo_id BIGINT NOT NULL,
  candidate_key TEXT NOT NULL,
  contributor_id TEXT NOT NULL,
  award_size TEXT NOT NULL CHECK (award_size IN ('small','medium','large')),
  approval_reason TEXT NOT NULL CHECK (length(btrim(approval_reason)) > 0),
  approved_by TEXT NOT NULL CHECK (length(btrim(approved_by)) > 0),
  credit_event_id UUID NOT NULL UNIQUE REFERENCES openpayables.credit_events(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_repo_id, candidate_key),
  FOREIGN KEY (project_id, github_repo_id, candidate_key)
    REFERENCES openpayables.github_candidates(project_id, github_repo_id, candidate_key),
  FOREIGN KEY (project_id, contributor_id)
    REFERENCES openpayables.project_contributors(project_id, contributor_id)
);
CREATE TRIGGER github_candidate_approvals_immutable BEFORE UPDATE OR DELETE ON openpayables.github_candidate_approvals
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
