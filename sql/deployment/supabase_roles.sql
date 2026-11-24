-- Optional Supabase deployment of OpenPayables; run as the Supabase postgres
-- database administrator, via psql with a TLS-verified connection.
-- Run AFTER the existing OpenPayables migrator. No credentials stored here.
-- These are database logins for one operator's installation, NOT public API roles.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Expected a fresh dedicated Supabase database named postgres';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'openpayables') OR
     (SELECT count(*) FROM openpayables.schema_migrations) <> 13 THEN
    RAISE EXCEPTION 'Run and verify the 13 OpenPayables migrations before provisioning roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('openpayables_operator','openpayables_app_ro')) THEN
    RAISE EXCEPTION 'OpenPayables role already exists; inspect it before re-provisioning';
  END IF;
END $$;

BEGIN;

CREATE ROLE openpayables_operator WITH LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 5;
CREATE ROLE openpayables_app_ro WITH LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 10;

GRANT CONNECT ON DATABASE postgres TO openpayables_operator, openpayables_app_ro;
GRANT USAGE ON SCHEMA openpayables TO openpayables_operator, openpayables_app_ro;

-- Operator uses the existing OpenPayables CLI and application business rules.
-- No schema creation, DDL, TRIGGER privilege, DELETE, or migration-ledger writes.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA openpayables TO openpayables_operator;
REVOKE ALL ON openpayables.schema_migrations, openpayables.live_pilot_approvals, openpayables.live_pilot_attempts, openpayables.live_pilot_transfer_observations FROM openpayables_operator;

-- Browser-facing application server: only the released read API's 15 relations.
-- Column-level grants avoid access to unrelated payment and funding fields.
GRANT SELECT (id, name) ON openpayables.projects TO openpayables_app_ro;
GRANT SELECT (project_id, contributor_id) ON openpayables.project_contributors TO openpayables_app_ro;
GRANT SELECT (id, display_name) ON openpayables.contributors TO openpayables_app_ro;
GRANT SELECT (id, project_id, contributor_id, category_code, event_type,
  points_delta, source, source_id, reason, approved_at)
  ON openpayables.credit_events TO openpayables_app_ro;
GRANT SELECT (project_id, github_repo_id, candidate_key, kind, github_user_id,
  github_login, pull_number, title, source_url, merged_at)
  ON openpayables.github_candidates TO openpayables_app_ro;
GRANT SELECT (project_id, github_repo_id, candidate_key)
  ON openpayables.github_candidate_approvals TO openpayables_app_ro;
GRANT SELECT (project_id, github_repo_id, full_name)
  ON openpayables.github_sources TO openpayables_app_ro;
GRANT SELECT (project_id, github_user_id, contributor_id)
  ON openpayables.github_identity_links TO openpayables_app_ro;
GRANT SELECT (project_id, github_user_id, contributor_id, verified_at)
  ON openpayables.github_identity_verifications TO openpayables_app_ro;
GRANT SELECT (id, project_id, title, status, opened_at)
  ON openpayables.proposals TO openpayables_app_ro;
GRANT SELECT (proposal_id, contributor_id, weight)
  ON openpayables.proposal_weights TO openpayables_app_ro;
GRANT SELECT (proposal_id, contributor_id, choice)
  ON openpayables.ballots TO openpayables_app_ro;
GRANT SELECT (period_id, contributor_id, points, amount_cents)
  ON openpayables.distribution_snapshot TO openpayables_app_ro;
GRANT SELECT (id, project_id, label, approved_at, status)
  ON openpayables.distribution_periods TO openpayables_app_ro;
GRANT SELECT (period_id, contributor_id, status)
  ON openpayables.distribution_obligations TO openpayables_app_ro;

ALTER ROLE openpayables_operator SET statement_timeout = '15s';
ALTER ROLE openpayables_app_ro SET default_transaction_read_only = on;
ALTER ROLE openpayables_app_ro SET statement_timeout = '10s';

COMMIT;

-- psql prompts twice per role. Enter NEW distinct passwords, not the admin one.
-- Each password is SCRAM-hashed by PostgreSQL, never placed in source files.
SET password_encryption = 'scram-sha-256';
\password openpayables_operator
\password openpayables_app_ro
