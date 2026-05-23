-- ============================================================================
-- AUDIT LOG TABLE
-- ============================================================================
-- Tamper-evident log of sensitive operations: auth attempts, ride lifecycle,
-- and phone-number access. Used for security incident investigation.
--
-- Writes go through public.log_audit_event (SECURITY DEFINER). The table
-- itself is INSERT-only for authenticated users; SELECT is service_role only.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id            bigserial PRIMARY KEY,
  user_id       uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  action        text          NOT NULL,
  resource_id   text,
  outcome       text          NOT NULL DEFAULT 'success'
                              CHECK (outcome IN ('success', 'failure')),
  ip_address    inet,
  user_agent    text,
  detail        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_id_created_at_idx
  ON public.audit_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_action_created_at_idx
  ON public.audit_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_resource_id_idx
  ON public.audit_log (resource_id)
  WHERE resource_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. RLS — INSERT-only via RPC, SELECT denied for anon/authenticated
-- ----------------------------------------------------------------------------
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_log TO service_role;

-- No SELECT/UPDATE/DELETE policies for non-service_role: deny by default.

-- ----------------------------------------------------------------------------
-- 3. RPC — log_audit_event
-- ----------------------------------------------------------------------------
-- The only way authenticated clients write to audit_log. SECURITY DEFINER so
-- it can bypass the table-level grants. user_id is taken from auth.uid() if
-- the caller doesn't pass one (prevents spoofing another user's id).
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action       text,
  p_resource_id  text          DEFAULT NULL,
  p_outcome      text          DEFAULT 'success',
  p_ip_address   text          DEFAULT NULL,
  p_user_agent   text          DEFAULT NULL,
  p_detail       jsonb         DEFAULT '{}'::jsonb,
  p_user_id      uuid          DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_user   uuid;
  v_ip     inet;
BEGIN
  IF p_action IS NULL OR length(p_action) = 0 THEN
    RAISE EXCEPTION 'action required' USING ERRCODE = '22023';
  END IF;

  IF p_outcome NOT IN ('success', 'failure') THEN
    RAISE EXCEPTION 'invalid outcome' USING ERRCODE = '22023';
  END IF;

  -- Trust auth.uid() over the parameter for authenticated callers.
  -- For unauthenticated events (failed login pre-session) the caller passes
  -- p_user_id explicitly and v_caller will be NULL.
  v_user := COALESCE(v_caller, p_user_id);

  BEGIN
    v_ip := p_ip_address::inet;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  INSERT INTO public.audit_log
    (user_id, action, resource_id, outcome, ip_address, user_agent, detail)
  VALUES
    (v_user, p_action, p_resource_id, p_outcome, v_ip,
     NULLIF(left(p_user_agent, 1024), ''), COALESCE(p_detail, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(text, text, text, text, text, jsonb, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, text, text, jsonb, uuid)
  TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. RETENTION (optional — keep 1 year)
-- ----------------------------------------------------------------------------
-- Schedule via pg_cron in DATA_RETENTION_POLICY routine if used:
--   DELETE FROM public.audit_log WHERE created_at < now() - interval '365 days';
