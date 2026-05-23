-- ============================================================================
-- TOTP TWO-FACTOR AUTHENTICATION (RFC 6238)
-- ============================================================================
-- Optional second factor for password sign-in and for sensitive operations
-- (ride create, ride join). Secret material is encrypted with pgcrypto using
-- a key stored in Supabase Vault. Verification happens entirely inside a
-- SECURITY DEFINER RPC: the plaintext secret never crosses the Postgres
-- boundary at verify time. The plaintext secret leaves the database only
-- once, during enrollment, when the otpauth:// URI is built by the app.
--
-- Companion app code:
--   src/app/actions/totp.ts           server actions
--   src/lib/totp.ts                   secret/URI/recovery-code helpers
--   src/lib/auth/totp-cookies.ts      HMAC cookie signer
--   src/lib/auth/require-fresh-totp.ts step-up gate
--   src/lib/supabase/middleware.ts    /2fa/challenge redirect branch
--
-- Run top-to-bottom in the Supabase SQL Editor. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto      WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ----------------------------------------------------------------------------
-- 2. VAULT SECRET — totp_encryption_key
-- ----------------------------------------------------------------------------
-- Generate out-of-band: `openssl rand -base64 48`. Updates require
-- vault.update_secret(id, new_value).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'totp_encryption_key'
  ) THEN
    PERFORM vault.create_secret(
      'REPLACE_WITH_STRONG_RANDOM_KEY',
      'totp_encryption_key',
      'Symmetric key for pgp_sym_encrypt on TOTP shared secrets'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. SCHEMA — users columns + recovery-codes table
-- ----------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS totp_secret_encrypted         bytea,
  ADD COLUMN IF NOT EXISTS totp_secret_pending_encrypted bytea,
  ADD COLUMN IF NOT EXISTS totp_enabled                  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_enabled_at               timestamptz,
  ADD COLUMN IF NOT EXISTS totp_last_verified_at         timestamptz;

CREATE TABLE IF NOT EXISTS public.user_totp_recovery_codes (
  user_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  code_hash  text        NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code_hash)
);

ALTER TABLE public.user_totp_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_totp_recovery_codes FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON public.user_totp_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.user_totp_recovery_codes TO service_role;
-- No SELECT/INSERT/UPDATE/DELETE policies for non-service_role.
-- All access flows through SECURITY DEFINER RPCs in section 5.

-- ----------------------------------------------------------------------------
-- 4. PRIVATE HELPERS
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.totp_encryption_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'totp_encryption_key'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.totp_encryption_key() FROM PUBLIC, anon, authenticated;

-- RFC 6238 dynamic-truncation HOTP value. Pure function over (secret, counter).
-- Returns a 6-digit integer (0..999_999).
CREATE OR REPLACE FUNCTION private.totp_compute(p_secret bytea, p_counter bigint)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_hmac    bytea;
  v_offset  int;
  v_value   bigint;
BEGIN
  -- int8send returns the 8-byte big-endian wire encoding of a bigint
  v_hmac := extensions.hmac(int8send(p_counter), p_secret, 'sha1');
  v_offset := (get_byte(v_hmac, 19) & 15);
  v_value :=
    ((get_byte(v_hmac, v_offset)     & 127)::bigint << 24) |
    ( get_byte(v_hmac, v_offset + 1)        ::bigint << 16) |
    ( get_byte(v_hmac, v_offset + 2)        ::bigint <<  8) |
      get_byte(v_hmac, v_offset + 3)        ::bigint;
  RETURN (v_value % 1000000)::integer;
END;
$$;

REVOKE ALL ON FUNCTION private.totp_compute(bytea, bigint) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. PUBLIC RPCs — enrollment, verify, recovery, disable
-- ----------------------------------------------------------------------------
-- Secrets travel app→DB as lowercase hex (40 chars for a 20-byte secret).
-- This keeps the SQL surface tiny — no base32 decoder needed. The base32
-- form is built app-side for the otpauth URI only.

CREATE OR REPLACE FUNCTION public.set_pending_totp_secret(p_secret_hex text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_key    text;
  v_secret bytea;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_secret_hex IS NULL OR p_secret_hex !~ '^[0-9a-f]+$' THEN
    RAISE EXCEPTION 'invalid secret' USING ERRCODE = '22023';
  END IF;

  -- 16..32 bytes (RFC 4226 minimum is 16, recommended 20)
  IF length(p_secret_hex) < 32 OR length(p_secret_hex) > 64 THEN
    RAISE EXCEPTION 'invalid secret length' USING ERRCODE = '22023';
  END IF;

  v_key := private.totp_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'totp_encryption_key missing from vault';
  END IF;

  v_secret := decode(p_secret_hex, 'hex');

  UPDATE public.users
  SET totp_secret_pending_encrypted = extensions.pgp_sym_encrypt_bytea(v_secret, v_key)
  WHERE id = v_uid;
END;
$$;

REVOKE ALL    ON FUNCTION public.set_pending_totp_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_pending_totp_secret(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.verify_totp_code(p_code text, p_use_pending boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_key       text;
  v_cipher    bytea;
  v_secret    bytea;
  v_counter   bigint;
  v_code_int  integer;
  v_window    int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN
    PERFORM public.log_audit_event(
      'auth.totp.verify', NULL, 'failure', NULL, NULL,
      jsonb_build_object('reason', 'invalid_input',
                         'kind', CASE WHEN p_use_pending THEN 'enroll' ELSE 'challenge' END),
      v_uid);
    RETURN false;
  END IF;
  v_code_int := p_code::integer;

  v_key := private.totp_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'totp_encryption_key missing from vault';
  END IF;

  IF p_use_pending THEN
    SELECT totp_secret_pending_encrypted INTO v_cipher
    FROM public.users WHERE id = v_uid;
  ELSE
    SELECT totp_secret_encrypted INTO v_cipher
    FROM public.users WHERE id = v_uid;
  END IF;

  IF v_cipher IS NULL THEN
    PERFORM public.log_audit_event(
      'auth.totp.verify', NULL, 'failure', NULL, NULL,
      jsonb_build_object('reason',
        CASE WHEN p_use_pending THEN 'no_pending_secret' ELSE 'no_active_secret' END,
        'kind', CASE WHEN p_use_pending THEN 'enroll' ELSE 'challenge' END),
      v_uid);
    RETURN false;
  END IF;

  v_secret  := extensions.pgp_sym_decrypt_bytea(v_cipher, v_key);
  v_counter := floor(extract(epoch FROM now()) / 30)::bigint;

  -- Current step + one step in each direction (~±30s tolerance)
  FOR v_window IN -1..1 LOOP
    IF private.totp_compute(v_secret, v_counter + v_window) = v_code_int THEN
      IF p_use_pending THEN
        UPDATE public.users
        SET totp_secret_encrypted         = v_cipher,
            totp_secret_pending_encrypted = NULL,
            totp_enabled                  = true,
            totp_enabled_at               = COALESCE(totp_enabled_at, now()),
            totp_last_verified_at         = now()
        WHERE id = v_uid;
      ELSE
        UPDATE public.users
        SET totp_last_verified_at = now()
        WHERE id = v_uid;
      END IF;
      RETURN true;
    END IF;
  END LOOP;

  PERFORM public.log_audit_event(
    'auth.totp.verify', NULL, 'failure', NULL, NULL,
    jsonb_build_object('reason', 'invalid_code',
                       'kind', CASE WHEN p_use_pending THEN 'enroll' ELSE 'challenge' END),
    v_uid);
  RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION public.verify_totp_code(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_totp_code(text, boolean) TO authenticated;


CREATE OR REPLACE FUNCTION public.set_totp_recovery_codes(p_hashes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_h   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_hashes IS NULL OR array_length(p_hashes, 1) IS NULL THEN
    RAISE EXCEPTION 'no codes provided' USING ERRCODE = '22023';
  END IF;

  IF array_length(p_hashes, 1) > 20 THEN
    RAISE EXCEPTION 'too many codes' USING ERRCODE = '22023';
  END IF;

  FOREACH v_h IN ARRAY p_hashes LOOP
    IF v_h !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'invalid hash' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM public.user_totp_recovery_codes WHERE user_id = v_uid;

  INSERT INTO public.user_totp_recovery_codes (user_id, code_hash)
  SELECT v_uid, unnest(p_hashes);
END;
$$;

REVOKE ALL    ON FUNCTION public.set_totp_recovery_codes(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_totp_recovery_codes(text[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.consume_totp_recovery_code(p_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    PERFORM public.log_audit_event(
      'auth.totp.recovery_use', NULL, 'failure', NULL, NULL,
      jsonb_build_object('reason', 'invalid_input'), v_uid);
    RETURN false;
  END IF;

  UPDATE public.user_totp_recovery_codes
  SET used_at = now()
  WHERE user_id = v_uid
    AND code_hash = p_hash
    AND used_at IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    PERFORM public.log_audit_event(
      'auth.totp.recovery_use', NULL, 'failure', NULL, NULL,
      jsonb_build_object('reason', 'no_match_or_used'), v_uid);
    RETURN false;
  END IF;

  UPDATE public.users SET totp_last_verified_at = now() WHERE id = v_uid;
  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.consume_totp_recovery_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_totp_recovery_code(text) TO authenticated;


CREATE OR REPLACE FUNCTION public.disable_totp()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE public.users
  SET totp_secret_encrypted         = NULL,
      totp_secret_pending_encrypted = NULL,
      totp_enabled                  = false,
      totp_enabled_at               = NULL,
      totp_last_verified_at         = NULL
  WHERE id = v_uid;

  DELETE FROM public.user_totp_recovery_codes WHERE user_id = v_uid;
END;
$$;

REVOKE ALL    ON FUNCTION public.disable_totp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disable_totp() TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. ADMIN — out-of-band recovery (operator-only)
-- ----------------------------------------------------------------------------
-- Service-role only. Called from a support runbook after manual identity
-- verification (see SECURITY.md). Clears every TOTP artifact for a user so
-- they can re-enroll with a fresh authenticator. No UI surface.
CREATE OR REPLACE FUNCTION public.admin_disable_totp(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.users
  SET totp_secret_encrypted         = NULL,
      totp_secret_pending_encrypted = NULL,
      totp_enabled                  = false,
      totp_enabled_at               = NULL,
      totp_last_verified_at         = NULL
  WHERE id = p_user_id;

  DELETE FROM public.user_totp_recovery_codes WHERE user_id = p_user_id;

  PERFORM public.log_audit_event(
    'auth.totp.disable', p_user_id::text, 'success', NULL, NULL,
    jsonb_build_object('reason', 'admin_recovery'), p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_disable_totp(uuid) FROM PUBLIC, anon, authenticated;
-- service_role bypasses the GRANT requirement, but be explicit:
GRANT EXECUTE ON FUNCTION public.admin_disable_totp(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. VERIFICATION
-- ----------------------------------------------------------------------------
-- a) Vault secret present:
--    SELECT name FROM vault.secrets WHERE name = 'totp_encryption_key';
--
-- b) Compute a known vector (RFC 6238 §B test vector — SHA1, secret = "12345678901234567890"):
--    SELECT private.totp_compute(convert_to('12345678901234567890', 'UTF8'),
--                                 59 / 30);   -- expect 287082
--
-- c) End-to-end (as an authenticated user via PostgREST):
--    SELECT public.set_pending_totp_secret('<hex>');
--    SELECT public.verify_totp_code('<code from app>', true);  -- promotes pending
--    SELECT public.verify_totp_code('<later code>', false);    -- active path
--
-- d) Recovery code single-use:
--    SELECT public.set_totp_recovery_codes(ARRAY['<sha256-hex>', ...]);
--    SELECT public.consume_totp_recovery_code('<sha256-hex>');  -- true
--    SELECT public.consume_totp_recovery_code('<same hash>');   -- false
