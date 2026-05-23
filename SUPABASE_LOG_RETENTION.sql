-- ============================================================================
-- APPLICATION LOG RETENTION (30 DAYS)
-- ============================================================================
-- Companion to SUPABASE_AUDIT_LOG.sql. The audit_log table is bound by a 1-year
-- legal/compliance window. Application-level diagnostic logs (anything that
-- *isn't* a security or compliance event) get a 30-day window instead, to
-- minimise exposure if a platform log sink is breached.
--
-- Apply this migration if you persist app logs in Postgres (e.g. a
-- `application_log` table). If logs only live in the platform sink (Vercel,
-- Datadog, etc.), configure the same 30-day window there instead.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE (only created if you opt into DB-side app logs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.application_log (
  id          bigserial PRIMARY KEY,
  level       text         NOT NULL CHECK (level IN ('debug','info','warn','error')),
  message     text         NOT NULL,
  context     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_log_created_at_idx
  ON public.application_log (created_at DESC);

CREATE INDEX IF NOT EXISTS application_log_level_created_at_idx
  ON public.application_log (level, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. RLS — service_role only
-- ----------------------------------------------------------------------------
ALTER TABLE public.application_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.application_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.application_log TO service_role;

-- ----------------------------------------------------------------------------
-- 3. RETENTION — 30 days
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.purge_application_log()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.application_log
   WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_application_log() FROM PUBLIC, anon, authenticated;

-- Idempotent schedule: unschedule any prior job, then register a fresh one.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'application_log_purge_daily';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

-- Run nightly at 03:45 UTC (after audit_log purge at 03:30).
SELECT cron.schedule(
  'application_log_purge_daily',
  '45 3 * * *',
  $$SELECT public.purge_application_log();$$
);

-- ----------------------------------------------------------------------------
-- 4. VERIFICATION
-- ----------------------------------------------------------------------------
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'application_log_purge_daily';

SELECT count(*) AS app_log_rows_due_for_purge
FROM   public.application_log
WHERE  created_at < now() - interval '30 days';
