-- IMP-149 (handbook ME-02): the web, sync, worker and scheduler processes
-- connect as "memoria_app", which may read and write rows but not change the
-- schema; only the migration Job connects as the owner.
--
-- The cluster creates the role before the first release with this migration
-- (infra platform/databases). Where it does not exist (development, the small
-- self-host set-up) nothing happens. Created later? Run
-- `pnpm db:grant-runtime-role`, which re-runs this file. Safe to run twice.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memoria_app') THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO memoria_app', current_database());
    GRANT USAGE ON SCHEMA public TO memoria_app;
    REVOKE CREATE ON SCHEMA public FROM memoria_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO memoria_app;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO memoria_app;
    -- Tables and sequences the owner creates in later migrations.
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO memoria_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO memoria_app;
    -- The migration history is the owner's; the app only reads it (doctor).
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE INSERT, UPDATE, DELETE ON public._prisma_migrations FROM memoria_app;
    END IF;
  END IF;
END
$$;
