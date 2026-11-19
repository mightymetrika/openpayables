-- C10: immutable evidence of authenticated GitHub App user control at one point in time.
-- A verified record must refer to the exact C8 operator-attested project identity link.
-- Never store OAuth user access tokens, refresh tokens or device codes.
-- Composite FK prevents combining one contributor's valid link with another's
-- valid GitHub ID within the same project (even by direct SQL writes).
CREATE UNIQUE INDEX github_identity_links_verified_pair
  ON openpayables.github_identity_links(project_id, github_user_id, contributor_id);

CREATE TABLE openpayables.github_identity_verifications (
  project_id TEXT NOT NULL,
  github_user_id BIGINT NOT NULL CHECK (github_user_id > 0),
  contributor_id TEXT NOT NULL,
  github_login_at_verification TEXT NOT NULL CHECK (length(btrim(github_login_at_verification)) > 0),
  app_id BIGINT NOT NULL CHECK (app_id > 0),
  verification_method TEXT NOT NULL DEFAULT 'github_app_device_flow'
    CHECK (verification_method = 'github_app_device_flow'),
  initiated_by TEXT NOT NULL CHECK (length(btrim(initiated_by)) > 0),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, github_user_id),
  UNIQUE (project_id, contributor_id),
  FOREIGN KEY (project_id, github_user_id, contributor_id)
    REFERENCES openpayables.github_identity_links(project_id, github_user_id, contributor_id)
);
CREATE TRIGGER github_identity_verifications_immutable BEFORE UPDATE OR DELETE
  ON openpayables.github_identity_verifications
  FOR EACH ROW EXECUTE FUNCTION openpayables.prevent_historical_mutation();
