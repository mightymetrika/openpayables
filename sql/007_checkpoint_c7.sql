-- Checkpoint C7: public GitHub evidence intake only. No credits, obligations, or money created.
CREATE TABLE openpayables.github_sources (
  project_id TEXT NOT NULL REFERENCES openpayables.projects(id),
  github_repo_id BIGINT NOT NULL CHECK (github_repo_id > 0),
  full_name TEXT NOT NULL CHECK (length(btrim(full_name)) > 2),
  registered_by TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_repo_id),
  UNIQUE (project_id, full_name)
);
CREATE TRIGGER github_sources_immutable BEFORE UPDATE OR DELETE ON openpayables.github_sources
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();

CREATE TABLE openpayables.github_candidates (
  project_id TEXT NOT NULL,
  github_repo_id BIGINT NOT NULL,
  candidate_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pr_author', 'pr_reviewer')),
  pull_id BIGINT NOT NULL CHECK (pull_id > 0),
  pull_number INTEGER NOT NULL CHECK (pull_number > 0),
  github_user_id BIGINT NOT NULL CHECK (github_user_id > 0),
  github_login TEXT NOT NULL,
  title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  merged_at TIMESTAMPTZ NOT NULL,
  review_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(review_ids) = 'array'),
  last_review_at TIMESTAMPTZ,
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_repo_id, candidate_key),
  FOREIGN KEY (project_id, github_repo_id)
    REFERENCES openpayables.github_sources(project_id, github_repo_id)
);
CREATE TRIGGER github_candidates_immutable BEFORE UPDATE OR DELETE ON openpayables.github_candidates
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
CREATE INDEX github_candidates_by_project ON openpayables.github_candidates (project_id, discovered_at, candidate_key);
