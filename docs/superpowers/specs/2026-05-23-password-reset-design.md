# Password Reset — Design

**Date:** 2026-05-23
**Status:** Approved (autonomous mode)

## Goal

Allow a user who forgot their password to regain access by proving control of their account email. Today the only path to a password change is `supabase.auth.signInWithPassword` then settings — a forgotten password is a dead end. Login UI already links to "Forgot password?" implicitly through the `Sign in` page; that link goes nowhere because the flow does not exist.

## Background

**Existing auth (see `src/app/actions/auth.ts`, `src/app/auth/callback/route.ts`):**

- Auth provider is Supabase. Sign-in, sign-up, OAuth, sign-out, and email confirmation all go through `@supabase/ssr` server clients. Custom email/password storage does not exist — passwords live in Supabase Auth (`auth.users`).
- Server-action pattern: each action is `"use server"`, takes `_prev` + `FormData`, returns `ActionResult` (`{ success, error? } | { success: true, data? }`). Rate limit via `checkRateLimit(key, max, windowMs)` from `src/lib/rate-limit/server.ts`. Audit via `logAuditEvent` from `src/lib/audit.ts`. CSRF wrapper at `src/lib/security/csrf.ts`.
- Email confirmation flow already uses `auth/callback` exchange-code route. Same callback can carry a `type=recovery` recovery token via PKCE.
- Validation schemas in `src/lib/validation/schemas.ts`: `emailSchema`, `passwordSchema` (`min(8).max(128)`) — reusable as-is.
- Site URL: `process.env.NEXT_PUBLIC_SITE_URL`.
- Audit `AuditAction` union already includes `auth.signin`, `auth.signup`, `auth.signout`, `auth.signin.oauth`, `auth.callback`. Extend with `auth.reset.request`, `auth.reset.confirm`, `auth.reset.rate_limited`.

**Why not a custom `reset_tokens` table.** User's initial sketch proposed a custom table holding hashed tokens with 30-minute TTL plus two new API routes. That would duplicate functionality Supabase Auth already implements (`auth.users.recovery_token`, `recovery_sent_at`, server-side TTL, single-use semantics, secure hashing), and require building a parallel email-send pipeline. More code, more surface area, two sources of truth for "is this user trying to reset?" — and the password write would still need `supabase.auth.admin.updateUserById`, which requires the service role key being exposed to a route. Native flow is strictly safer and shorter.

## Approach

Use Supabase's built-in recovery flow. Two server actions plus one extension to the existing callback route:

1. **`requestPasswordResetAction(formData)`** — calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: <site>/auth/callback?next=/reset-password })`. Always returns success (do not leak whether the email exists). Rate-limited per IP and per email-hash. Audited.
2. **`auth/callback` route** — already exchanges code for session. After exchange, if Supabase returns `type=recovery` (or the `next` is `/reset-password`), the user lands on `/reset-password` with a valid session that is allowed to call `updateUser({ password })` exactly once.
3. **`confirmPasswordResetAction(formData)`** — runs inside the recovery session. Validates `passwordSchema`, calls `supabase.auth.updateUser({ password })`, audits, signs the user out of every other session via `supabase.auth.signOut({ scope: 'others' })`, then redirects to `/login`.

The recovery session itself is Supabase's TTL'd token (1 hour default, server-enforced). No custom token table, no parallel email pipeline, no service role key in route handlers.

## Architecture

```
src/app/(auth)/forgot-password/
  page.tsx                          # email entry form
src/app/(auth)/reset-password/
  page.tsx                          # new-password form, requires recovery session
src/components/auth/
  ForgotPasswordForm.tsx            # client form bound to requestPasswordResetAction
  ResetPasswordForm.tsx             # client form bound to confirmPasswordResetAction
src/app/actions/
  auth.ts                           # add requestPasswordResetAction, confirmPasswordResetAction
src/app/auth/callback/
  route.ts                          # extend to honor next=/reset-password when type=recovery
src/components/auth/LoginForm.tsx   # add "Forgot password?" link
```

**Server action surface:**

- `requestPasswordResetAction(_prev, formData)` → `ActionResult`. Parses `emailSchema`. Rate-limited `reset:req:ip:<ip>` (3/hour) and `reset:req:email:<sha256(lower(email))>` (3/hour). Calls `supabase.auth.resetPasswordForEmail`. **Always returns `{ success: true }`** regardless of whether the email is registered — prevents account enumeration. Audits `auth.reset.request` with outcome `success` or `failure` (rate-limited / invalid input) but never reveals existence to the caller.
- `confirmPasswordResetAction(_prev, formData)` → `ActionResult`. Requires an active session (the recovery session created by callback). Parses `passwordSchema`. Rate-limited `reset:confirm:user:<uid>` (5/15min). Calls `supabase.auth.updateUser({ password })`. On success: `supabase.auth.signOut({ scope: 'others' })`, audit `auth.reset.confirm` success, redirect `/login?reset=ok`. On failure: audit, return generic error.

**Callback extension** — `src/app/auth/callback/route.ts` already calls `exchangeCodeForSession` and redirects to `safeNext`. The recovery link Supabase emails sets `?next=/reset-password`; existing `safeNext` check already accepts that path. No code change needed in the callback itself — just confirm `/reset-password` is reachable and is a no-auth-required page that reads the session.

## Data Flow

**Request:**
```
User visits /forgot-password, enters email
  → requestPasswordResetAction
     → CSRF check
     → emailSchema.parse
     → checkRateLimit reset:req:ip:<ip>     (3 / hour)
     → checkRateLimit reset:req:email:<h>   (3 / hour)
     → supabase.auth.resetPasswordForEmail(
         email,
         { redirectTo: `${SITE_URL}/auth/callback?next=/reset-password` }
       )
     → logAuditEvent auth.reset.request (success regardless of existence)
     → return { success: true }              -- always
  → UI shows "If that email is registered, we sent a reset link."
```

**Confirm:**
```
User clicks link in email
  → GET /auth/callback?code=...&next=/reset-password
     → exchangeCodeForSession → recovery session cookie set
     → redirect /reset-password
  → User enters new password, submits
  → confirmPasswordResetAction
     → CSRF check
     → requireUser() (must have recovery session)
     → passwordSchema.parse
     → checkRateLimit reset:confirm:user:<uid>  (5 / 15min)
     → supabase.auth.updateUser({ password })
     → supabase.auth.signOut({ scope: 'others' })
     → logAuditEvent auth.reset.confirm success
     → redirect /login?reset=ok
```

## Database Changes

**None.** Supabase Auth schema (`auth.users.recovery_token`, `auth.users.recovery_sent_at`) handles token storage, hashing, and TTL. No app-schema tables touched.

## Configuration

No new env vars beyond what's already required. Supabase project must have:
- Email template "Reset Password" enabled (default on).
- Site URL configured to match `NEXT_PUBLIC_SITE_URL` so callback links resolve.
- Redirect URL allowlist includes `${SITE_URL}/auth/callback`.

If SMTP is not configured in Supabase, recovery emails go through Supabase's shared sender (rate-capped, dev-only). Production should configure custom SMTP in Supabase dashboard before this ships — flagged in rollout.

## Rate Limits

| Key | Limit | Window | Purpose |
|---|---|---|---|
| `reset:req:ip:<ip>` | 3 | 1 hour | Bound per-source spam |
| `reset:req:email:<sha256>` | 3 | 24 hours | Bound per-target spam (same email across IPs) |
| `reset:confirm:user:<uid>` | 5 | 15 minutes | Bound brute-force on recovery session |

Limits exceeded on request → still return `{ success: true }` to the caller (enumeration resistance) but audit `auth.reset.rate_limited` and **do not** call Supabase. Limits exceeded on confirm → `{ success: false, error: "Too many attempts. Try again later." }`.

## Error Handling

- **Invalid email shape:** generic success response (enumeration resistance). Audit `auth.reset.request` failure with `reason: 'invalid_input'`.
- **Supabase `resetPasswordForEmail` errors (non-2xx):** generic success response. Audit failure with `reason: 'supabase_error'`. Do not surface to user.
- **`confirmPasswordResetAction` called without recovery session:** `requireUser()` throws, caught and returned as `{ success: false, error: "Reset link expired. Request a new one." }`. Audit `auth.reset.confirm` failure `reason: 'no_session'`.
- **`updateUser` fails:** generic error to user, audit `reason: 'update_failed'`.
- **Recovery session reuse after success:** Supabase invalidates the recovery token on first `updateUser` call. A second attempt yields a fresh-login requirement; UI handles by redirecting to `/login`.
- **Sign-out other sessions fails:** non-blocking. Audit warning. Password is already changed.

## Account Enumeration Resistance

Critical: `requestPasswordResetAction` must produce identical observable behavior whether the email exists or not.

- Same response shape and HTTP timing characteristics (no DB lookup before calling Supabase; Supabase itself does the existence check internally and silently no-ops on misses).
- Same UI message: "If an account exists for that address, we've sent a reset link."
- Same rate-limit counters apply regardless of existence — an attacker cannot probe by watching `429`s on real vs. fake emails.

## Testing

Unit (vitest):
- `emailSchema` / `passwordSchema` reuse — covered by existing tests.

Integration (vitest with mocked Supabase client):
- `requestPasswordResetAction` — happy path, CSRF rejection, rate limit (both keys), Supabase 5xx — all return `{ success: true }`. Audit events distinguishable in mock.
- `confirmPasswordResetAction` — happy path updates password and signs out other sessions; missing session returns generic expired error; rate limit returns specific error.
- Enumeration test: invocation with registered email vs. random email produces byte-identical `ActionResult`.

Security (`tests/security`):
- `requestPasswordResetAction` cannot be used as an oracle for account existence (assert identical return + identical audit-event shape modulo `outcome`).
- `confirmPasswordResetAction` rejects requests without a Supabase session.
- Audit log records every reset request and confirm.

Manual (staging):
- End-to-end with a real email against a Supabase project that has custom SMTP configured. Verify link expiry (default 1 hour) by waiting past TTL.

## Audit Events

Extend `AuditAction` union in `src/lib/audit.ts`:

```
| "auth.reset.request"
| "auth.reset.confirm"
| "auth.reset.rate_limited"
```

Detail payload for `auth.reset.request` includes a SHA-256 hash of the lowercased email (for joining to `auth.reset.rate_limited` events) — never the plaintext address.

## Rollout

1. Ship server actions + pages behind a feature flag `PASSWORD_RESET_ENABLED` (default true in dev, false in prod).
2. Verify Supabase custom SMTP is configured in prod.
3. Flip flag in prod. Add "Forgot password?" link to `LoginForm.tsx`.

No data migration. Rollback = flip flag off and unhide the link.

## Out of Scope

- SMS-based password reset (project uses Twilio Verify for phone-OTP per `2026-05-23-phone-otp-verification-design.md`; reusing it for password reset is a separate spec).
- Security questions / knowledge-based recovery.
- Custom `reset_tokens` table — explicitly rejected, see Background.
- Forcing password rotation on time-based schedules.
- Multi-factor enforcement at reset time (separate spec).

## Open Questions

None blocking. Email-template copy and `/reset-password` page styling are implementation-time decisions.
