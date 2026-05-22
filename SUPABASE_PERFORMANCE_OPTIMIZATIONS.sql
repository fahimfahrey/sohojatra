-- ============================================================================
-- PERFORMANCE OPTIMIZATIONS
-- ============================================================================
-- Run in Supabase SQL Editor. Idempotent: safe to re-run.
--
-- 1. Statement timeouts — prevent runaway queries from exhausting connections
-- 2. search_rides_by_route RPC — geo filter + passenger join in single query
--    Replaces: full-table scan of open rides + separate passenger batch fetch
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STATEMENT TIMEOUTS
-- Applies to every query executed as these roles.
-- Adjust per role: service_role intentionally left unlimited for migrations/jobs.
-- ----------------------------------------------------------------------------
ALTER ROLE authenticated SET statement_timeout = '30s';
ALTER ROLE anon          SET statement_timeout = '30s';

-- ----------------------------------------------------------------------------
-- 2. PGBOUNCER / CONNECTION POOLING
-- Enable via Supabase Dashboard → Settings → Database → Connection Pooling.
-- Use the "Transaction" pooler URL (port 6543) as SUPABASE_DB_URL for any
-- direct-connection workloads (Prisma, pg, etc.).
-- The JS client (PostgREST) uses its own pool — no code change needed there.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3. RPC: search_rides_by_route
-- Single query: bounding-box geo filter on JSONB + LEFT JOIN passengers.
-- Replaces two round-trips:
--   (a) SELECT * FROM ride_requests WHERE status='open'   → JS-filtered
--   (b) SELECT * FROM ride_passengers WHERE ride_id IN (…)
-- SECURITY INVOKER: RLS on both tables is enforced for the calling user.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.search_rides_by_route(
  double precision, double precision, double precision, double precision,
  double precision, text
);

CREATE OR REPLACE FUNCTION public.search_rides_by_route(
  p_start_lat      double precision,
  p_start_lng      double precision,
  p_dest_lat       double precision,
  p_dest_lng       double precision,
  p_radius_degrees double precision,
  p_vehicle_type   text DEFAULT NULL
)
RETURNS TABLE (
  id              uuid,
  creator_id      uuid,
  starting_point  jsonb,
  destination     jsonb,
  seats_available integer,
  total_seats     integer,
  status          text,
  created_at      timestamptz,
  vehicle         text,
  contact_phone   text,
  passenger_ids   uuid[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    rr.id,
    rr.creator_id,
    rr.starting_point,
    rr.destination,
    rr.seats_available,
    rr.total_seats,
    rr.status,
    rr.created_at,
    rr.vehicle,
    rr.contact_phone,
    COALESCE(
      array_agg(rp.user_id) FILTER (WHERE rp.user_id IS NOT NULL),
      ARRAY[]::uuid[]
    ) AS passenger_ids
  FROM public.ride_requests rr
  LEFT JOIN public.ride_passengers rp ON rp.ride_id = rr.id
  WHERE
    rr.status = 'open'
    AND (p_vehicle_type IS NULL OR rr.vehicle = p_vehicle_type)
    AND ABS(
      (rr.starting_point -> 'coordinates' ->> 'lat')::double precision
      - p_start_lat
    ) <= p_radius_degrees
    AND ABS(
      (rr.starting_point -> 'coordinates' ->> 'lng')::double precision
      - p_start_lng
    ) <= p_radius_degrees
    AND ABS(
      (rr.destination -> 'coordinates' ->> 'lat')::double precision
      - p_dest_lat
    ) <= p_radius_degrees
    AND ABS(
      (rr.destination -> 'coordinates' ->> 'lng')::double precision
      - p_dest_lng
    ) <= p_radius_degrees
  GROUP BY rr.id;
$$;

GRANT EXECUTE ON FUNCTION public.search_rides_by_route(
  double precision, double precision, double precision, double precision,
  double precision, text
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. OPTIONAL: INDEXES for geo filter columns
-- If ride volume is high, add generated columns for faster geo filtering.
-- PostGIS alternative: use geography type with ST_DWithin for true geo queries.
-- ----------------------------------------------------------------------------
-- Example generated columns (uncomment when ready):
-- ALTER TABLE public.ride_requests
--   ADD COLUMN IF NOT EXISTS start_lat double precision
--     GENERATED ALWAYS AS ((starting_point -> 'coordinates' ->> 'lat')::double precision) STORED,
--   ADD COLUMN IF NOT EXISTS start_lng double precision
--     GENERATED ALWAYS AS ((starting_point -> 'coordinates' ->> 'lng')::double precision) STORED,
--   ADD COLUMN IF NOT EXISTS dest_lat double precision
--     GENERATED ALWAYS AS ((destination -> 'coordinates' ->> 'lat')::double precision) STORED,
--   ADD COLUMN IF NOT EXISTS dest_lng double precision
--     GENERATED ALWAYS AS ((destination -> 'coordinates' ->> 'lng')::double precision) STORED;
--
-- CREATE INDEX IF NOT EXISTS idx_ride_requests_start_lat ON public.ride_requests (start_lat);
-- CREATE INDEX IF NOT EXISTS idx_ride_requests_start_lng ON public.ride_requests (start_lng);
-- CREATE INDEX IF NOT EXISTS idx_ride_requests_dest_lat  ON public.ride_requests (dest_lat);
-- CREATE INDEX IF NOT EXISTS idx_ride_requests_dest_lng  ON public.ride_requests (dest_lng);
