-- ============================================================================
-- PHONE NUMBER ENCRYPTION (pgcrypto + Supabase Vault)
-- ============================================================================
-- Encrypts contact_phone at the database level. Trigger encrypts plaintext
-- on insert/update, NULLs the plaintext column, and stores ciphertext in a
-- separate bytea column. Decryption is gated behind a SECURITY DEFINER RPC
-- callable only by the `authenticated` role.
--
-- Run sections 1-7 in order in the Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------
-- pgcrypto: pgp_sym_encrypt/decrypt
-- supabase_vault: stores encryption key encrypted at rest
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ----------------------------------------------------------------------------
-- 2. STORE ENCRYPTION KEY IN VAULT
-- ----------------------------------------------------------------------------
-- Run ONCE. Replace the literal below with a strong random key generated
-- out-of-band (e.g. `openssl rand -base64 48`). The key never appears in any
-- table; vault.decrypted_secrets is the only readable view and access is
-- restricted to the postgres / service_role.
--
-- If the secret already exists this is a no-op; updating requires
-- `vault.update_secret(id, new_secret)` against the returned id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'phone_encryption_key'
  ) THEN
    PERFORM vault.create_secret(
      'REPLACE_WITH_STRONG_RANDOM_KEY',
      'phone_encryption_key',
      'Symmetric key for pgp_sym_encrypt on contact_phone columns'
    );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. SCHEMA CHANGES
-- ----------------------------------------------------------------------------
-- Add bytea ciphertext columns alongside the existing text columns.
-- The trigger writes ciphertext here and NULLs the plaintext column.
ALTER TABLE public.ride_requests
  ADD COLUMN IF NOT EXISTS contact_phone_encrypted bytea;

ALTER TABLE public.ride_passengers
  ADD COLUMN IF NOT EXISTS contact_phone_encrypted bytea;

-- ----------------------------------------------------------------------------
-- 4. KEY ACCESSOR (private schema, locked down)
-- ----------------------------------------------------------------------------
-- Wrap vault lookup so the trigger and RPC don't reference vault directly.
-- Lives in a private schema so it cannot be called via the Data API.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.phone_encryption_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'phone_encryption_key'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION private.phone_encryption_key() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. ENCRYPTION TRIGGER
-- ----------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE: if a plaintext contact_phone is supplied, encrypt it
-- into contact_phone_encrypted, then NULL the plaintext column so it is never
-- persisted to disk or returned to bulk SELECTs.
CREATE OR REPLACE FUNCTION private.encrypt_contact_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF NEW.contact_phone IS NULL OR length(NEW.contact_phone) = 0 THEN
    NEW.contact_phone := NULL;
    RETURN NEW;
  END IF;

  v_key := private.phone_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'phone_encryption_key missing from vault';
  END IF;

  NEW.contact_phone_encrypted := extensions.pgp_sym_encrypt(NEW.contact_phone, v_key);
  NEW.contact_phone := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.encrypt_contact_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS encrypt_contact_phone_trg ON public.ride_requests;
CREATE TRIGGER encrypt_contact_phone_trg
  BEFORE INSERT OR UPDATE OF contact_phone ON public.ride_requests
  FOR EACH ROW EXECUTE FUNCTION private.encrypt_contact_phone();

DROP TRIGGER IF EXISTS encrypt_contact_phone_trg ON public.ride_passengers;
CREATE TRIGGER encrypt_contact_phone_trg
  BEFORE INSERT OR UPDATE OF contact_phone ON public.ride_passengers
  FOR EACH ROW EXECUTE FUNCTION private.encrypt_contact_phone();

-- ----------------------------------------------------------------------------
-- 6. BACKFILL EXISTING ROWS
-- ----------------------------------------------------------------------------
-- Encrypt any plaintext values already in the tables, then NULL them out.
DO $$
DECLARE
  v_key text := private.phone_encryption_key();
BEGIN
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'phone_encryption_key missing from vault';
  END IF;

  UPDATE public.ride_requests
  SET contact_phone_encrypted = extensions.pgp_sym_encrypt(contact_phone, v_key),
      contact_phone = NULL
  WHERE contact_phone IS NOT NULL AND contact_phone_encrypted IS NULL;

  UPDATE public.ride_passengers
  SET contact_phone_encrypted = extensions.pgp_sym_encrypt(contact_phone, v_key),
      contact_phone = NULL
  WHERE contact_phone IS NOT NULL AND contact_phone_encrypted IS NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 7. DECRYPTION RPC (called from getCreatorPhoneAction only)
-- ----------------------------------------------------------------------------
-- Returns the decrypted phone for a given ride only when:
--   * caller is authenticated
--   * caller is an active (non-completed/non-cancelled) passenger
--   * caller is NOT the ride creator (creators don't need their own number)
-- Prefers ride_requests.contact_phone_encrypted, falls back to the creator's
-- ride_passengers row.
--
-- Lives in `public` so PostgREST can expose it as an RPC, but every privilege
-- path runs through these checks — RLS is bypassed by SECURITY DEFINER, so
-- the checks here are the authorization boundary.
CREATE OR REPLACE FUNCTION public.get_ride_creator_phone(p_ride_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_creator uuid;
  v_status text;
  v_cipher bytea;
  v_key text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT creator_id, status, contact_phone_encrypted
  INTO v_creator, v_status, v_cipher
  FROM public.ride_requests
  WHERE id = p_ride_id;

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'ride not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_creator = v_caller THEN
    RAISE EXCEPTION 'not available for ride creators' USING ERRCODE = '42501';
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'ride is no longer active' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ride_passengers
    WHERE ride_id = p_ride_id AND user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  IF v_cipher IS NULL THEN
    SELECT contact_phone_encrypted INTO v_cipher
    FROM public.ride_passengers
    WHERE ride_id = p_ride_id AND user_id = v_creator
    LIMIT 1;
  END IF;

  IF v_cipher IS NULL THEN
    RETURN NULL;
  END IF;

  v_key := private.phone_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'phone_encryption_key missing from vault';
  END IF;

  RETURN extensions.pgp_sym_decrypt(v_cipher, v_key);
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_creator_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_creator_phone(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. VERIFICATION
-- ----------------------------------------------------------------------------
-- a) Plaintext is never persisted:
--    SELECT id, contact_phone, contact_phone_encrypted
--    FROM public.ride_requests
--    WHERE contact_phone IS NOT NULL;          -- expect 0 rows
--
-- b) Ciphertext is opaque:
--    SELECT encode(contact_phone_encrypted, 'hex') FROM public.ride_requests LIMIT 1;
--
-- c) RPC works for a permitted caller (run as authenticated user via PostgREST):
--    select * from get_ride_creator_phone('<some-ride-uuid>');
--
-- d) Round-trip in psql as superuser:
--    INSERT INTO public.ride_requests (creator_id, starting_point, destination,
--      seats_available, total_seats, vehicle, status, contact_phone)
--    VALUES (auth.uid(), '{}'::jsonb, '{}'::jsonb, 1, 2, 'car', 'open', '+8801711000000')
--    RETURNING contact_phone, contact_phone_encrypted;
--    -- contact_phone should be NULL, contact_phone_encrypted should be non-null bytea
--
-- ----------------------------------------------------------------------------
-- 9. OPTIONAL HARDENING (after app code is migrated)
-- ----------------------------------------------------------------------------
-- Once no app code reads `contact_phone` (text) anymore, you can permanently
-- drop the plaintext columns:
--
--   ALTER TABLE public.ride_requests   DROP COLUMN contact_phone;
--   ALTER TABLE public.ride_passengers DROP COLUMN contact_phone;
--
-- Until then the trigger keeps them NULL on every write, so they cannot
-- accumulate plaintext.
