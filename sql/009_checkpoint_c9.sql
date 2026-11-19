-- C9: explicit, immutable per-project GitHub App installation binding.
-- The GitHub App private key and short-lived installation access tokens are NEVER persisted.
CREATE TABLE openpayables.github_app_source_bindings (
  project_id TEXT NOT NULL,
  github_repo_id BIGINT NOT NULL,
  app_id BIGINT NOT NULL CHECK (app_id > 0),
  installation_id BIGINT NOT NULL CHECK (installation_id > 0),
  bound_by TEXT NOT NULL CHECK (length(btrim(bound_by)) > 0),
  bound_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_repo_id),
  FOREIGN KEY (project_id, github_repo_id)
    REFERENCES openpayables.github_sources(project_id, github_repo_id)
);
CREATE TRIGGER github_app_source_bindings_immutable BEFORE UPDATE OR DELETE
  ON openpayables.github_app_source_bindings
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
