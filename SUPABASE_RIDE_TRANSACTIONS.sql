-- ============================================================================
-- ATOMIC RIDE OPERATIONS (transactional RPCs)
-- ============================================================================
-- Wraps multi-step ride mutations in single Postgres transactions. A Postgres
-- function body is itself an atomic statement: any RAISE EXCEPTION rolls back
-- every prior write inside the function.
--
-- Replaces the previous client-side "insert ride; then insert passenger"
-- sequences in src/app/actions/rides.ts where a failure on the second step
-- left orphaned rows.
--
-- All RPCs are SECURITY DEFINER and call auth.uid() to identify the caller.
-- RLS is bypassed inside the function, so the auth/ownership checks here are
-- the authorization boundary.
--
-- Concurrency: join/leave take FOR UPDATE on the ride_requests row to
-- serialize concurrent joiners and avoid TOCTOU oversubscription.
--
-- Run in Supabase SQL Editor. Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. create_ride_with_passenger
-- Inserts a ride and registers the creator as the first passenger atomically.
-- If the passenger insert fails, the ride insert rolls back.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ride_with_passenger(
  p_starting_point jsonb,
  p_destination    jsonb,
  p_total_seats    integer,
  p_vehicle        text,
  p_contact_phone  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_ride_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_total_seats < 2 OR p_total_seats > 5 THEN
    RAISE EXCEPTION 'total_seats out of range' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ride_requests (
    creator_id,
    starting_point,
    destination,
    seats_available,
    total_seats,
    vehicle,
    status,
    contact_phone
  ) VALUES (
    v_caller,
    p_starting_point,
    p_destination,
    p_total_seats - 1,
    p_total_seats,
    p_vehicle,
    'open',
    p_contact_phone
  )
  RETURNING id INTO v_ride_id;

  INSERT INTO public.ride_passengers (ride_id, user_id, contact_phone)
  VALUES (v_ride_id, v_caller, p_contact_phone);

  RETURN v_ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_ride_with_passenger(jsonb, jsonb, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_ride_with_passenger(jsonb, jsonb, integer, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. join_ride_atomic
-- Locks the ride row, validates state, inserts passenger, decrements seats,
-- flips status to 'full' when the last seat is taken. All in one transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_ride_atomic(
  p_ride_id       uuid,
  p_contact_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          uuid := auth.uid();
  v_creator         uuid;
  v_status          text;
  v_seats_available integer;
  v_new_seats       integer;
  v_new_status      text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT creator_id, status, seats_available
  INTO v_creator, v_status, v_seats_available
  FROM public.ride_requests
  WHERE id = p_ride_id
  FOR UPDATE;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'ride not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'ride is no longer available' USING ERRCODE = '22023';
  END IF;

  IF v_creator = v_caller THEN
    RAISE EXCEPTION 'cannot join own ride' USING ERRCODE = '22023';
  END IF;

  IF v_seats_available <= 0 THEN
    RAISE EXCEPTION 'no seats available' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ride_passengers
    WHERE ride_id = p_ride_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'already a passenger' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.ride_passengers (ride_id, user_id, contact_phone)
  VALUES (p_ride_id, v_caller, p_contact_phone);

  v_new_seats  := v_seats_available - 1;
  v_new_status := CASE WHEN v_new_seats <= 0 THEN 'full' ELSE 'open' END;

  UPDATE public.ride_requests
  SET seats_available = v_new_seats,
      status          = v_new_status
  WHERE id = p_ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_ride_atomic(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_ride_atomic(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. leave_ride_atomic
-- Passenger leaves a ride: deletes their row and restores one seat / reopens
-- the ride atomically. No-op for ride creators (cancel as creator is a single
-- UPDATE handled inline).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_ride_atomic(p_ride_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller          uuid := auth.uid();
  v_status          text;
  v_seats_available integer;
  v_total_seats     integer;
  v_deleted         integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT status, seats_available, total_seats
  INTO v_status, v_seats_available, v_total_seats
  FROM public.ride_requests
  WHERE id = p_ride_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'ride not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'cannot leave this ride' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.ride_passengers
  WHERE ride_id = p_ride_id AND user_id = v_caller;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RAISE EXCEPTION 'not a passenger' USING ERRCODE = '42501';
  END IF;

  UPDATE public.ride_requests
  SET seats_available = LEAST(v_seats_available + 1, v_total_seats),
      status          = 'open'
  WHERE id = p_ride_id;
END;
$$;

REVOKE ALL ON FUNCTION public.leave_ride_atomic(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_ride_atomic(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. VERIFICATION
-- ----------------------------------------------------------------------------
-- a) Force passenger insert to fail (e.g. by dropping the FK temporarily in a
--    transaction) and confirm the ride insert rolls back:
--    BEGIN;
--      SELECT create_ride_with_passenger(...);  -- raises
--    ROLLBACK;
--    SELECT count(*) FROM ride_requests WHERE creator_id = '<uid>';  -- unchanged
--
-- b) Concurrent join test (two psql sessions, same ride with 1 seat):
--    session A: BEGIN; SELECT join_ride_atomic('<ride>', '+880...');
--    session B: BEGIN; SELECT join_ride_atomic('<ride>', '+880...');  -- waits
--    session A: COMMIT;
--    session B: -- fails with 'no seats available' instead of oversubscribing
