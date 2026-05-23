-- ============================================================================
-- API KEYS — third-party integration auth
-- ============================================================================
-- Hashed-at-rest keys with per-key permissions, rate limit, expiry, revocation.
-- Plaintext key only returned at creation; only SHA-256 stored.
-- Format: ck_live_<base64url-32>  (32 bytes of entropy = 256 bits)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text          NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  key_prefix    text          NOT NULL CHECK (char_length(key_prefix) BETWEEN 8 AND 32),
  key_hash      text          NOT NULL UNIQUE,
  permissions   text[]        NOT NULL DEFAULT '{}'::text[],
  rate_limit    integer       NOT NULL DEFAULT 1000 CHECK (rate_limit BETWEEN 1 AND 100000),
  expires_at    timestamptz   NOT NULL,
  last_used_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx
  ON public.api_keys (user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx
  ON public.api_keys (key_hash) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS api_keys_expires_at_idx
  ON public.api_keys (expires_at) WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. RLS — owners read/manage own metadata; verification path uses service_role
-- ----------------------------------------------------------------------------
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.api_keys FROM PUBLIC, anon;
GRANT  SELECT, INSERT, UPDATE ON public.api_keys TO authenticated;

DROP POLICY IF EXISTS "api_keys_select_own" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_insert_own" ON public.api_keys;
DROP POLICY IF EXISTS "api_keys_update_own" ON public.api_keys;

CREATE POLICY "api_keys_select_own"
ON public.api_keys FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "api_keys_insert_own"
ON public.api_keys FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Owners may only flip revoked_at / name; never key_hash, user_id, expires_at,
-- permissions, or rate_limit (those would let an attacker who phished a session
-- silently broaden a key's scope).
CREATE POLICY "api_keys_update_own"
ON public.api_keys FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. VERIFICATION RPC — SECURITY DEFINER so middleware can look up by hash
-- without granting raw SELECT on the whole table to anon.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_api_key(p_key_hash text)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  permissions text[],
  rate_limit  integer,
  expires_at  timestamptz,
  revoked_at  timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT id, user_id, permissions, rate_limit, expires_at, revoked_at
  FROM public.api_keys
  WHERE key_hash = p_key_hash
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_api_key(text) FROM public;
GRANT  EXECUTE ON FUNCTION public.verify_api_key(text) TO anon, authenticated, service_role;

-- Bump last_used_at after a successful verify. Best-effort; failures swallowed
-- by the caller so a write outage cannot block reads.
CREATE OR REPLACE FUNCTION public.touch_api_key(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.api_keys SET last_used_at = now() WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.touch_api_key(uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.touch_api_key(uuid) TO anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. ROTATION VIEW — keys older than 90 days, not yet revoked
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.api_keys_due_rotation AS
SELECT id, user_id, name, key_prefix, created_at, expires_at
FROM public.api_keys
WHERE revoked_at IS NULL
  AND created_at < now() - interval '90 days';

REVOKE ALL ON public.api_keys_due_rotation FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.api_keys_due_rotation TO service_role;
