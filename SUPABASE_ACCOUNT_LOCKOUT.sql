-- Account lockout: rolling-window failed-attempt counter + unlock token.
-- See docs/superpowers/specs/2026-05-23-account-lockout-design.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.account_lockouts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_attempts int NOT NULL DEFAULT 0,
  window_started_at timestamptz,
  locked_until timestamptz,
  unlock_token_hash text,
  unlock_token_expires_at timestamptz,
  last_attempt_ip text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_lockouts_locked_until_idx
  ON public.account_lockouts (locked_until)
  WHERE locked_until IS NOT NULL;

ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;

-- RPC 1: lockout_status
CREATE OR REPLACE FUNCTION public.lockout_status(p_email text)
RETURNS TABLE(user_id uuid, locked boolean, locked_until timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT al.user_id,
           (al.locked_until IS NOT NULL AND al.locked_until > now()) AS locked,
           al.locked_until
    FROM public.account_lockouts al
    WHERE al.user_id = v_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_user_id, false, NULL::timestamptz;
  END IF;
END;
$$;

-- RPC 2: record_failed_attempt
CREATE OR REPLACE FUNCTION public.record_failed_attempt(
  p_email text,
  p_ip text,
  p_window_seconds int,
  p_max_attempts int,
  p_lock_duration_seconds int,
  p_unlock_ttl_seconds int
)
RETURNS TABLE(locked_now boolean, unlock_token text, user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_token text;
  v_locked_now boolean := false;
  v_attempts int;
  v_window_started timestamptz;
  v_currently_locked boolean;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(p_email) LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.account_lockouts (user_id, failed_attempts, window_started_at, last_attempt_ip, updated_at)
  VALUES (v_user_id, 1, now(), p_ip, now())
  ON CONFLICT (user_id) DO UPDATE
  SET failed_attempts = CASE
        WHEN public.account_lockouts.window_started_at IS NULL
          OR now() - public.account_lockouts.window_started_at > make_interval(secs => p_window_seconds)
          THEN 1
        ELSE public.account_lockouts.failed_attempts + 1
      END,
      window_started_at = CASE
        WHEN public.account_lockouts.window_started_at IS NULL
          OR now() - public.account_lockouts.window_started_at > make_interval(secs => p_window_seconds)
          THEN now()
        ELSE public.account_lockouts.window_started_at
      END,
      last_attempt_ip = p_ip,
      updated_at = now()
  RETURNING failed_attempts, window_started_at,
            (locked_until IS NOT NULL AND locked_until > now())
    INTO v_attempts, v_window_started, v_currently_locked;

  IF v_attempts >= p_max_attempts AND NOT v_currently_locked THEN
    v_token := encode(gen_random_bytes(32), 'hex');
    UPDATE public.account_lockouts
    SET locked_until = now() + make_interval(secs => p_lock_duration_seconds),
        unlock_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        unlock_token_expires_at = now() + make_interval(secs => p_unlock_ttl_seconds),
        updated_at = now()
    WHERE account_lockouts.user_id = v_user_id;
    v_locked_now := true;
  END IF;

  RETURN QUERY SELECT v_locked_now, v_token, v_user_id;
END;
$$;

-- RPC 3: record_successful_attempt
CREATE OR REPLACE FUNCTION public.record_successful_attempt(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM public.account_lockouts WHERE user_id = p_user_id;
$$;

-- RPC 4: consume_unlock_token
CREATE OR REPLACE FUNCTION public.consume_unlock_token(p_token text)
RETURNS TABLE(user_id uuid, success boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hash text;
  v_user_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) <> 64 THEN
    RETURN QUERY SELECT NULL::uuid, false;
    RETURN;
  END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  UPDATE public.account_lockouts
  SET locked_until = NULL,
      failed_attempts = 0,
      window_started_at = NULL,
      unlock_token_hash = NULL,
      unlock_token_expires_at = NULL,
      updated_at = now()
  WHERE unlock_token_hash = v_hash
    AND unlock_token_expires_at > now()
  RETURNING account_lockouts.user_id INTO v_user_id;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, false;
  ELSE
    RETURN QUERY SELECT v_user_id, true;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.lockout_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_failed_attempt(text, text, int, int, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_successful_attempt(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_unlock_token(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lockout_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_failed_attempt(text, text, int, int, int, int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_successful_attempt(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_unlock_token(text) TO anon, authenticated;

-- Daily cleanup of stale unlocked rows.
SELECT cron.schedule(
  'account_lockouts_cleanup',
  '15 3 * * *',
  $$DELETE FROM public.account_lockouts
    WHERE locked_until IS NULL
      AND updated_at < now() - interval '7 days'$$
);
