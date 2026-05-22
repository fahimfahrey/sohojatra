-- ============================================================================
-- DATA RETENTION & SOFT DELETE POLICY
-- ============================================================================
-- Implements data-minimization retention windows:
--   * Completed rides:  purged 90 days after status->completed
--   * Cancelled rides:  purged 30 days after status->cancelled
--   * Deleted users:    purged 30 days after deletion_requested_at
--
-- Soft delete flags (`deleted_at`, `deletion_requested_at`) make the data
-- invisible to the app immediately while preserving a recovery window before
-- the nightly hard-delete job runs.
--
-- Run sections 1-7 in order in the Supabase SQL Editor. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 2. SOFT DELETE COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz;

ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz,
  ADD COLUMN IF NOT EXISTS status_changed_at     timestamptz;

ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS deleted_at            timestamptz;

-- Backfill status_changed_at from updated_at so existing rows have a baseline.
UPDATE public.ride_requests
SET    status_changed_at = COALESCE(updated_at, created_at)
WHERE  status_changed_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. INDEXES (retention sweep performance)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_rides_status_changed
  ON public.ride_requests (status, status_changed_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rides_deleted_at
  ON public.ride_requests (deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_deletion_requested
  ON public.users (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. TRIGGER: track ride status transitions
-- ----------------------------------------------------------------------------
-- Stamps `status_changed_at` whenever `status` changes so the retention sweep
-- can measure age-in-status without scanning history tables.
CREATE OR REPLACE FUNCTION public.tg_stamp_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ride_status_changed ON public.ride_requests;
CREATE TRIGGER trg_ride_status_changed
BEFORE UPDATE OF status ON public.ride_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_status_changed_at();

-- ----------------------------------------------------------------------------
-- 5. RETENTION FUNCTIONS
-- ----------------------------------------------------------------------------
-- All functions run as SECURITY DEFINER so the cron job (postgres role) can
-- invoke them under a fixed search_path. Never grant EXECUTE to anon/authn.

-- 5a. Hard-delete completed rides > 90 days old
CREATE OR REPLACE FUNCTION public.purge_completed_rides()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH del AS (
    DELETE FROM public.ride_requests
    WHERE status = 'completed'
      AND status_changed_at < now() - interval '90 days'
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

-- 5b. Hard-delete cancelled rides > 30 days old
CREATE OR REPLACE FUNCTION public.purge_cancelled_rides()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH del AS (
    DELETE FROM public.ride_requests
    WHERE status = 'cancelled'
      AND status_changed_at < now() - interval '30 days'
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

-- 5c. Hard-delete users whose deletion was requested > 30 days ago.
--     Cascades through ride_passengers/notifications via FK ON DELETE CASCADE
--     (verify FK definitions; add CASCADE if missing).
CREATE OR REPLACE FUNCTION public.purge_deleted_users()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid;
  v_count   integer := 0;
BEGIN
  FOR v_user_id IN
    SELECT id
    FROM public.users
    WHERE deletion_requested_at IS NOT NULL
      AND deletion_requested_at < now() - interval '30 days'
  LOOP
    -- Null PII on rides the user created but cannot delete (others joined)
    UPDATE public.ride_requests
       SET contact_phone           = NULL,
           contact_phone_encrypted = NULL
     WHERE creator_id = v_user_id;

    -- Remove passenger rows
    DELETE FROM public.ride_passengers WHERE user_id = v_user_id;

    -- Remove notifications
    DELETE FROM public.notifications   WHERE user_id = v_user_id;

    -- Remove app profile
    DELETE FROM public.users           WHERE id = v_user_id;

    -- Remove auth identity (Supabase auth schema)
    DELETE FROM auth.users             WHERE id = v_user_id;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- 5d. Combined nightly sweep
CREATE OR REPLACE FUNCTION public.run_retention_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_completed integer;
  v_cancelled integer;
  v_users     integer;
BEGIN
  v_completed := public.purge_completed_rides();
  v_cancelled := public.purge_cancelled_rides();
  v_users     := public.purge_deleted_users();

  RETURN jsonb_build_object(
    'ran_at',             now(),
    'completed_purged',   v_completed,
    'cancelled_purged',   v_cancelled,
    'users_purged',       v_users
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_completed_rides()  FROM public;
REVOKE EXECUTE ON FUNCTION public.purge_cancelled_rides()  FROM public;
REVOKE EXECUTE ON FUNCTION public.purge_deleted_users()    FROM public;
REVOKE EXECUTE ON FUNCTION public.run_retention_sweep()    FROM public;

-- ----------------------------------------------------------------------------
-- 6. USER-FACING SOFT DELETE RPC
-- ----------------------------------------------------------------------------
-- Authenticated users mark their own account for deletion. A 30-day grace
-- period elapses before purge_deleted_users() removes the record.
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requested_at timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.users
     SET deletion_requested_at = v_requested_at,
         updated_at            = v_requested_at
   WHERE id = auth.uid()
     AND deletion_requested_at IS NULL;

  RETURN v_requested_at;
END;
$$;

-- Allow users to cancel their pending deletion within the grace window.
CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.users
     SET deletion_requested_at = NULL,
         updated_at            = now()
   WHERE id = auth.uid()
     AND deletion_requested_at IS NOT NULL;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_account_deletion() FROM public;
REVOKE EXECUTE ON FUNCTION public.cancel_account_deletion()  FROM public;
GRANT  EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.cancel_account_deletion()  TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. RLS — hide soft-deleted rows from the app
-- ----------------------------------------------------------------------------
-- Update the visibility policies from SUPABASE_RLS_POLICIES.sql so any row
-- with deleted_at / deletion_requested_at is invisible to authenticated
-- clients. Service role still sees everything (needed for the sweep).

DROP POLICY IF EXISTS "users_select_own"        ON public.users;
CREATE POLICY "users_select_own"
ON public.users FOR SELECT TO authenticated
USING (auth.uid() = id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "rides_select_visible"    ON public.ride_requests;
CREATE POLICY "rides_select_visible"
ON public.ride_requests FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    status = 'open'
    OR creator_id = auth.uid()
    OR public.is_ride_passenger(id, auth.uid())
  )
);

DROP POLICY IF EXISTS "passengers_select_relevant" ON public.ride_passengers;
CREATE POLICY "passengers_select_relevant"
ON public.ride_passengers FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND (
    user_id = auth.uid()
    OR public.is_ride_creator(ride_id, auth.uid())
  )
);

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid() AND deleted_at IS NULL);

-- ----------------------------------------------------------------------------
-- 8. SCHEDULE — pg_cron nightly at 03:15 UTC
-- ----------------------------------------------------------------------------
-- Unschedule any prior version to keep this idempotent.
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'retention_sweep_nightly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'retention_sweep_nightly',
  '15 3 * * *',
  $$SELECT public.run_retention_sweep();$$
);

-- ----------------------------------------------------------------------------
-- 9. VERIFICATION
-- ----------------------------------------------------------------------------
-- Confirm columns exist
SELECT table_name, column_name
FROM   information_schema.columns
WHERE  table_schema = 'public'
  AND  column_name IN ('deleted_at','deletion_requested_at','status_changed_at')
ORDER  BY table_name, column_name;

-- Confirm cron job is registered
SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'retention_sweep_nightly';

-- Dry-run preview (counts only, no delete)
SELECT
  (SELECT count(*) FROM public.ride_requests
     WHERE status = 'completed'
       AND status_changed_at < now() - interval '90 days') AS completed_due,
  (SELECT count(*) FROM public.ride_requests
     WHERE status = 'cancelled'
       AND status_changed_at < now() - interval '30 days') AS cancelled_due,
  (SELECT count(*) FROM public.users
     WHERE deletion_requested_at < now() - interval '30 days') AS users_due;
