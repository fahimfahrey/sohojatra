-- ============================================================================
-- SUPABASE ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Run in Supabase SQL Editor (Dashboard → SQL Editor → New query → paste → Run).
-- Idempotent: safe to re-run.
-- Tables: users, ride_requests, ride_passengers, notifications
-- Effect: anon role has no policies → fully denied. Authenticated role gets
-- least-privilege access per policy. service_role bypasses RLS (server actions
-- using SERVICE_ROLE_KEY still work). Soft-deleted rows (deleted_at IS NOT NULL)
-- are hidden from SELECT/UPDATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ride_passengers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners (defense-in-depth; service_role still bypasses)
ALTER TABLE public.users            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ride_requests    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ride_passengers  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications    FORCE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER bypasses RLS inside the function, which prevents infinite
-- recursion when ride_passengers policies need to check ride_passengers.

CREATE OR REPLACE FUNCTION public.is_ride_creator(p_ride_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ride_requests
    WHERE id = p_ride_id AND creator_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_ride_passenger(p_ride_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ride_passengers
    WHERE ride_id = p_ride_id AND user_id = p_user_id
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_ride_creator(uuid, uuid)   FROM public;
REVOKE EXECUTE ON FUNCTION public.is_ride_passenger(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.is_ride_creator(uuid, uuid)   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.is_ride_passenger(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. USERS — only own profile
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "users_select_own"  ON public.users;
DROP POLICY IF EXISTS "users_insert_own"  ON public.users;
DROP POLICY IF EXISTS "users_update_own"  ON public.users;
DROP POLICY IF EXISTS "users_delete_own"  ON public.users;

CREATE POLICY "users_select_own"
ON public.users FOR SELECT
TO authenticated
USING (auth.uid() = id AND deleted_at IS NULL);

CREATE POLICY "users_insert_own"
ON public.users FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "users_update_own"
ON public.users FOR UPDATE
TO authenticated
USING      (auth.uid() = id AND deleted_at IS NULL)
WITH CHECK (auth.uid() = id);

CREATE POLICY "users_delete_own"
ON public.users FOR DELETE
TO authenticated
USING (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- 4. RIDE_REQUESTS — open rides OR own (created/joined)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "rides_select_visible" ON public.ride_requests;
DROP POLICY IF EXISTS "rides_insert_own"     ON public.ride_requests;
DROP POLICY IF EXISTS "rides_update_own"     ON public.ride_requests;
DROP POLICY IF EXISTS "rides_delete_own"     ON public.ride_requests;

CREATE POLICY "rides_select_visible"
ON public.ride_requests FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    status = 'open'
    OR creator_id = auth.uid()
    OR public.is_ride_passenger(id, auth.uid())
  )
);

CREATE POLICY "rides_insert_own"
ON public.ride_requests FOR INSERT
TO authenticated
WITH CHECK (creator_id = auth.uid());

CREATE POLICY "rides_update_own"
ON public.ride_requests FOR UPDATE
TO authenticated
USING      (deleted_at IS NULL AND (creator_id = auth.uid() OR public.is_ride_passenger(id, auth.uid())))
WITH CHECK (creator_id = auth.uid() OR public.is_ride_passenger(id, auth.uid()));
-- NOTE: passengers can update because joining decrements seats_available.
-- Tighten by moving seat-decrement to a SECURITY DEFINER RPC and restricting
-- UPDATE to creator only.

CREATE POLICY "rides_delete_own"
ON public.ride_requests FOR DELETE
TO authenticated
USING (creator_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5. RIDE_PASSENGERS — own records (creator may view all on their ride)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "passengers_select_relevant" ON public.ride_passengers;
DROP POLICY IF EXISTS "passengers_insert_self"     ON public.ride_passengers;
DROP POLICY IF EXISTS "passengers_delete_self_or_creator" ON public.ride_passengers;

CREATE POLICY "passengers_select_relevant"
ON public.ride_passengers FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    user_id = auth.uid()
    OR public.is_ride_creator(ride_id, auth.uid())
  )
);

CREATE POLICY "passengers_insert_self"
ON public.ride_passengers FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "passengers_delete_self_or_creator"
ON public.ride_passengers FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_ride_creator(ride_id, auth.uid())
);

-- ----------------------------------------------------------------------------
-- 6. NOTIFICATIONS — only own
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_participant" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;

CREATE POLICY "notifications_select_own"
ON public.notifications FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND deleted_at IS NULL);

-- Insert: sender must be the recipient OR a participant of the referenced ride.
-- Service role bypasses RLS, so server-side fan-out still works.
CREATE POLICY "notifications_insert_participant"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  OR (
    ride_id IS NOT NULL
    AND (
      public.is_ride_creator(ride_id, auth.uid())
      OR public.is_ride_passenger(ride_id, auth.uid())
    )
  )
);

CREATE POLICY "notifications_update_own"
ON public.notifications FOR UPDATE
TO authenticated
USING      (user_id = auth.uid() AND deleted_at IS NULL)
WITH CHECK (user_id = auth.uid());

CREATE POLICY "notifications_delete_own"
ON public.notifications FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 7. VERIFICATION
-- ----------------------------------------------------------------------------
-- Confirm RLS enabled on all four tables
SELECT tablename, rowsecurity, forcerowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users','ride_requests','ride_passengers','notifications');

-- List all policies
SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users','ride_requests','ride_passengers','notifications')
ORDER BY tablename, policyname;
