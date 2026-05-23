# Phone OTP Verification — Design

**Date:** 2026-05-23
**Status:** Approved (autonomous mode)

## Goal

Verify that phone numbers shown to passengers belong to a real device the user controls. Today any string passing the `phoneSchema` regex is encrypted and disclosed to ride co-participants — fake numbers, typos, and harassment via wrong-number disclosure are unmitigated. SMS OTP verification closes that gap and adds a `phone_verified_at` timestamp that gates disclosure.

## Background

**Existing phone handling (see `SUPABASE_PHONE_ENCRYPTION.sql`):**

- Phone stored per-ride on `ride_requests.contact_phone_encrypted` (bytea) and `ride_passengers.contact_phone_encrypted` (bytea), encrypted at write time by a `BEFORE INSERT/UPDATE` trigger using a Vault-managed pgcrypto key. Plaintext columns kept but NULL'd by the trigger.
- Disclosure is gated by RPC `public.get_ride_creator_phone(p_ride_id uuid)` — `SECURITY DEFINER`, checks caller is an active passenger on the ride and is not the creator.
- Validation lives in `src/lib/validation/schemas.ts` as `phoneSchema = /^\+?[0-9]{10,15}$/`. Same schema is used inside `createRideSchema` and `joinRideSchema`.
- UI consumer: `src/components/layout/FloatingCallButton.tsx` calls `getCreatorPhoneAction` and opens `tel:` URLs. There is no profile page today; the only places a phone is captured are the ride-create and ride-join forms.
- Rate limiting infra: `src/lib/rate-limit/server.ts` exposes `consumeRateLimit(key, max, windowMs)` and `checkRateLimit` backed by Upstash Redis with in-memory fallback.
- Audit infra: `src/lib/audit.ts` exposes `logAuditEvent` with an `AuditAction` string union; events feed the `audit_log` table.
- Target market is Bangladesh — `BD_BOUNDS` in `schemas.ts` restricts ride coordinates to BD; phone numbers in the wild here are predominantly `+880` mobile.

**Why phone moves from per-ride to per-user.** Verification is a property of the human, not the trip. Forcing re-verification every ride is hostile UX and wastes SMS budget. Per-ride contact_phone is retained as a derived copy populated from the verified user phone on insert; it is no longer user input.

## Approach

Three pieces:

1. **Twilio Verify** as the OTP provider. Twilio handles code generation, SMS delivery, retry windows, per-code attempt limits, and SMS-pumping fraud detection. Rolling our own would re-implement these and still need the same SMS sender. AWS SNS lacks a Verify equivalent; MessageBird/Vonage are weaker in BD. Twilio Verify Service is region-aware and has known BD throughput.
2. **Schema migration** to add `phone_encrypted`, `phone_country_code`, `phone_verified_at`, `phone_hash` to `public.users`, with the same Vault-backed pgcrypto trigger pattern already used on `ride_requests`. Per-ride `contact_phone[_encrypted]` columns stay (back-compat for in-flight rides) but become server-populated, not user input.
3. **Two server actions** — `requestPhoneOtpAction(phone, countryCode)` and `verifyPhoneOtpAction(code)` — plus ephemeral state in Redis (10-minute TTL) holding the Twilio `verificationSid` and the candidate phone. The verify action, on Twilio `approved`, writes plaintext into `users.phone_encrypted` via the existing trigger pattern and stamps `phone_verified_at = now()`.

Disclosure RPC `get_ride_creator_phone` is updated to read from `users.phone_encrypted` (falling back to the legacy per-ride ciphertext for rides created before the migration) and return NULL unless `users.phone_verified_at IS NOT NULL` and within the configured freshness window (default 6 months). Ride create/join actions reject when the caller has no verified phone.

## Architecture

```
src/lib/
  twilio.ts                       # thin fetch wrapper: startVerification(), checkVerification()
  phone/
    server.ts                     # validateE164(), hashPhone(), verifyStateStore (Redis)
    constants.ts                  # FRESHNESS_WINDOW_MS, OTP_TTL_MS, rate-limit constants

src/app/actions/
  phone.ts                        # requestPhoneOtpAction, verifyPhoneOtpAction, removePhoneAction

src/components/profile/
  PhoneVerificationCard.tsx       # entry point: status, change/verify CTAs
  PhoneRequestForm.tsx            # E.164 + country dropdown
  PhoneOtpForm.tsx                # 6-digit code entry

src/app/dashboard/profile/
  page.tsx                        # profile page hosting PhoneVerificationCard
```

**Server action surface** (all `"use server"`, CSRF-validated via `validateCsrfToken`, rate-limited):

- `requestPhoneOtpAction(input: { phone: string; countryCode: string })` →
  `ActionResult<{ expiresAt: string }>`. Validates E.164, applies rate limits, calls Twilio Verify start, stores `{phoneE164, countryCode, twilioSid, createdAt}` in Redis at `otpv:<userId>` with 10-minute TTL, audits `phone.verify.start`.
- `verifyPhoneOtpAction(input: { code: string })` →
  `ActionResult<{ phoneMasked: string; verifiedAt: string }>`. Loads Redis state for caller, calls Twilio Verify check, on `approved` writes `users.phone_encrypted` + `phone_verified_at` + `phone_hash` + `phone_country_code`, audits `phone.verify.success`. On `pending` (wrong code, but session still alive), audits `phone.verify.failure` and leaves Redis state intact so the user can retry within the 10-minute TTL. On Twilio max-attempts-reached or session expired, audits `phone.verify.failure` and deletes Redis state so the user must request a fresh code. Redis state is also deleted on `approved`.
- `removePhoneAction()` → `ActionResult<void>`. Clears all four columns, audits `phone.remove`. Active rides retain their per-ride snapshot (back-compat) until completed.

**RPC change** — `public.get_ride_creator_phone(p_ride_id)` (existing SECURITY DEFINER function) gains:

```
SELECT phone_encrypted, phone_verified_at
INTO v_cipher, v_verified_at
FROM public.users WHERE id = v_creator;

IF v_verified_at IS NULL
   OR v_verified_at < now() - interval '6 months' THEN
  -- fall through to legacy per-ride lookup
END IF;
```

Order: prefer `users.phone_encrypted` when verified-and-fresh; else legacy `ride_requests.contact_phone_encrypted`; else legacy `ride_passengers.contact_phone_encrypted` (creator's row); else NULL. Caller-side identifies a NULL response as "phone unavailable, ask creator to verify" rather than "no phone" — UI distinguishes via a second RPC return field `reason text` (`'unverified' | 'stale' | 'missing' | null`).

## Data Flow

**Request:**
```
User submits phone in PhoneRequestForm
  → requestPhoneOtpAction
     → CSRF check
     → checkRateLimit otp:send:user:<uid>      (3 / hour)
     → checkRateLimit otp:send:phone:<hash>    (5 / day)
     → phoneE164Schema parse
     → twilio.startVerification(phoneE164)     → twilioSid
     → redis.set otpv:<uid> ... EX 600
     → logAuditEvent phone.verify.start
     → return { expiresAt }
```

**Verify:**
```
User enters 6-digit code in PhoneOtpForm
  → verifyPhoneOtpAction
     → CSRF check
     → checkRateLimit otp:verify:user:<uid>    (5 / 15min)
     → state = redis.get otpv:<uid>
     → if !state → error "no pending verification"
     → twilio.checkVerification(state.phoneE164, code)
     → if status='approved':
          BEGIN
            UPDATE users SET
              phone           = state.phoneE164,          -- trigger encrypts
              phone_country_code = state.countryCode,
              phone_hash      = hmac(state.phoneE164, pepper),
              phone_verified_at = now()
            WHERE id = uid;
          COMMIT;
          redis.del otpv:<uid>
          logAuditEvent phone.verify.success
        else:
          logAuditEvent phone.verify.failure
          (Redis state kept until TTL — user can retry within window)
```

**Disclosure (unchanged surface, new gate):**
```
Passenger taps Call Creator
  → getCreatorPhoneAction(rideId)
     → supabase.rpc('get_ride_creator_phone', { p_ride_id })
     → returns text|null + reason
  → UI shows tel: link OR "Creator has not verified their phone" toast
```

## Database Changes

```sql
-- 1. Columns on users
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone                text,            -- plaintext input, NULL'd by trigger
  ADD COLUMN IF NOT EXISTS phone_encrypted      bytea,
  ADD COLUMN IF NOT EXISTS phone_country_code   text,
  ADD COLUMN IF NOT EXISTS phone_hash           text,
  ADD COLUMN IF NOT EXISTS phone_verified_at    timestamptz;

CREATE INDEX IF NOT EXISTS users_phone_hash_idx ON public.users(phone_hash);

-- 2. Reuse existing private.encrypt_contact_phone pattern, adapted for users.phone
CREATE OR REPLACE FUNCTION private.encrypt_user_phone() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_key text;
BEGIN
  IF NEW.phone IS NULL OR length(NEW.phone) = 0 THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;
  v_key := private.phone_encryption_key();
  IF v_key IS NULL THEN RAISE EXCEPTION 'phone_encryption_key missing from vault'; END IF;
  NEW.phone_encrypted := extensions.pgp_sym_encrypt(NEW.phone, v_key);
  NEW.phone := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS encrypt_user_phone_trg ON public.users;
CREATE TRIGGER encrypt_user_phone_trg
  BEFORE INSERT OR UPDATE OF phone ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.encrypt_user_phone();

-- 3. Phone hash pepper (separate vault secret)
-- Add via vault.create_secret('phone_hash_pepper', '<openssl rand -base64 48>') one-off
-- Hash computed server-side using crypto.subtle.HMAC SHA-256 — DB does not see plaintext after trigger.

-- 4. Updated get_ride_creator_phone — see Architecture section. Return type becomes
--    TABLE(phone text, reason text). Existing single-text callers updated.
```

No drop of `ride_requests.contact_phone_encrypted` / `ride_passengers.contact_phone_encrypted` in this change. They remain as fallback for grandfather rides until the next cleanup pass.

## Configuration

New env vars (server-only):
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_VERIFY_SERVICE_SID`
- `PHONE_VERIFICATION_FRESHNESS_DAYS` — default `180`

New Vault secret (one-off):
- `phone_hash_pepper` — HMAC pepper for `phone_hash`. Generated via `openssl rand -base64 48`.

Twilio test mode: when `NODE_ENV !== 'production'` and `TWILIO_ACCOUNT_SID` starts with `AC` followed by the Twilio test SID prefix, the client uses test credentials. Magic phone `+15005550006` accepts code `123456` without sending SMS. Used by integration tests and local dev.

## Rate Limits

Layered on existing `consumeRateLimit`:

| Key | Limit | Window | Purpose |
|---|---|---|---|
| `otp:send:user:<uid>` | 3 | 1 hour | Bounds per-user SMS spend |
| `otp:send:phone:<phone_hash>` | 5 | 24 hours | Prevents abuse via same target number across accounts |
| `otp:verify:user:<uid>` | 5 | 15 minutes | Bounds brute-force on code |
| `otp:remove:user:<uid>` | 3 | 1 hour | Bounds churn |

Limits exceeded → `ActionResult { success: false, error: "Too many attempts. Try again later." }` + `logAuditEvent phone.verify.rate_limited`.

## Error Handling

- **Twilio transient errors (5xx, fetch fail):** server action returns generic error; Redis state untouched (request action) or preserved (verify action). User retries; rate limits catch loops.
- **Twilio 429 / max-attempts-reached on a code:** treated as terminal failure for that Redis state; delete state and surface "Code expired, request a new one."
- **Redis unavailable:** `requestPhoneOtpAction` aborts with `"Verification temporarily unavailable"` — no fallback, because storing the Twilio sid in memory is not viable across serverless instances. Audit `phone.verify.failure` with `reason: 'state_unavailable'`.
- **DB write failure after Twilio approved:** rare but possible. Audit `phone.verify.success` only after the UPDATE commits. If commit fails, the user re-verifies; Twilio Verify is idempotent within its own window.
- **Phone already verified on another account:** no UNIQUE constraint on `phone_hash` (would race with the trigger and complicate the reassignment flow). Instead, `verifyPhoneOtpAction` runs inside a single transaction: `SELECT id FROM users WHERE phone_hash = $1 AND id <> auth.uid() FOR UPDATE`, sets `phone_verified_at = NULL` on any matches, then writes the new row's columns. Audits `phone.reassignment` on the loser. Phones are physical-device proof; whoever holds the SIM wins.
- **Phone removed mid-ride:** disclosure RPC falls through to the legacy per-ride snapshot, so already-shared numbers stay reachable until the ride completes.

## Backfill / Migration

- Existing users: `phone_verified_at = NULL` for all. No SMS storm — verification is voluntary, but ride create/join will start to require it (see Rollout).
- Existing in-flight rides keep their per-ride `contact_phone_encrypted`. `get_ride_creator_phone` falls back to those when the creator hasn't verified on the user record.
- No SMS goes out at migration time.

## Rollout

1. **Phase 1 — opt-in:** Ship schema, RPC update (with fallback), profile page, server actions. `phoneSchema` removed from `createRideSchema`/`joinRideSchema`; ride create/join uses verified user phone if present, otherwise allows submission with `contact_phone = NULL` (button hidden for that ride). UI nudges unverified users with a banner.
2. **Phase 2 — required (1-2 weeks later, no DB change):** Block ride create/join when caller has no `phone_verified_at`. Toggle is a single env flag `PHONE_VERIFICATION_REQUIRED=true`.

## Testing

Unit (vitest):
- `validateE164` accepts BD-format numbers, rejects letters / short / >15 digits.
- `hashPhone` deterministic, depends on pepper.
- `twilio.ts` wrappers fail-closed on non-2xx, parse Twilio error payloads.

Integration (vitest with mocked fetch):
- `requestPhoneOtpAction` — happy path, CSRF rejection, rate limit, Twilio 5xx.
- `verifyPhoneOtpAction` — approved path writes encrypted phone + verified_at, denied path leaves state, expired/missing state errors cleanly.
- Phone-hash collision: second user reassigning revokes first user's `phone_verified_at`.

Security (`tests/security`):
- `get_ride_creator_phone` returns NULL with `reason='unverified'` when creator's `phone_verified_at IS NULL`.
- Stale verification (>180 days) returns `reason='stale'`.
- Non-passenger callers continue to be rejected (existing test extended).

Manual:
- Twilio test phone `+15005550006` with code `123456` end-to-end in local dev.
- Real phone in staging against a sandbox Verify Service.

## Audit Events

Extend `AuditAction` union in `src/lib/audit.ts`:

```
| "phone.verify.start"
| "phone.verify.success"
| "phone.verify.failure"
| "phone.verify.rate_limited"
| "phone.remove"
| "phone.reassignment"
```

Detail payload includes `phoneCountryCode` and a 4-digit phone suffix only — never the full number.

## Out of Scope

- Voice-call OTP fallback (Twilio supports it; defer until SMS deliverability data justifies the cost).
- WhatsApp OTP channel.
- Carrier lookup / SIM-swap detection beyond what Twilio Verify provides by default.
- Removing legacy per-ride `contact_phone[_encrypted]` columns — separate cleanup spec after Phase 2 is stable.
- Email-based ownership proof as an alternative to SMS.

## Open Questions

None blocking. Twilio test-mode SID detection in `src/lib/twilio.ts` and copy for the profile UI strings are implementation-time decisions, not design decisions.
