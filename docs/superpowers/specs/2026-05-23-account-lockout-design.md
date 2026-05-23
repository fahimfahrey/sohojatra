# Account Lockout — Design

**Date:** 2026-05-23
**Status:** Approved (autonomous mode)

## Goal

After 5 failed password sign-in attempts within a rolling 15-minute window, lock the targeted account for 30 minutes. Email the user immediately on lockout with an unlock link that clears the lock without waiting out the timer. Mitigate brute-force credential attacks while giving the legitimate owner a path back in.

## Background

Today `signInAction` (`src/app/actions/auth.ts:57`) applies a sliding-window rate limit keyed by `login:<ip>:<email>` at 5 attempts / 15 minutes via `checkRateLimit`. That blocks one attacker IP per email but does not:

- Stop a distributed attempt (different IPs against one account).
- Tell the account owner that someone is hammering their login.
- Survive coordinated low-and-slow attacks below the IP rate limit threshold.

A complementary **account-scoped** lockout closes those gaps. The existing IP rate limit stays as a first line of defense — this design adds a second layer that tracks failures per `user_id`.

Related specs:
- [[2026-05-23-persistent-rate-limiting-design]] — global API rate limit (Upstash).
- [[2026-05-23-password-reset-design]] — separate flow for forgotten password.
- [[2026-05-23-totp-2fa-design]] — 2FA challenge flow; lockout runs before TOTP step.

## Approach

State lives in Postgres. New table `public.account_lockouts` tracks failed-attempt counter, window start, lock-until timestamp, and a hashed single-use unlock token. All mutations happen through `SECURITY DEFINER` RPCs callable by the anon client — matching the pattern established by `verify_api_key` (`src/lib/security/api-key-lookup.ts`). No service-role key on the request path.

Email sent via Resend (new dependency). Falls back to audit-log-only delivery if `RESEND_API_KEY` is unset (dev/local).

### Why Postgres over Redis

- Audit trail: counter resets and lockouts are queryable forensics.
- Durable across Redis evictions/outages — auth failure path must not lose state.
- Volume is tiny (one row per locked user, scrubbed after window).
- RLS pattern already established.

### Why account-scoped, not IP-scoped

Per requirement: "lock account". This intentionally allows an attacker to DoS a legitimate user by repeatedly submitting wrong passwords. Email unlock link is the mitigation — the legitimate owner can restore access in seconds without waiting the 30-minute timer.

## Architecture

```
src/lib/auth/
  lockout.ts           # checkLockout, recordFailedAttempt, recordSuccessfulAttempt, consumeUnlockToken
  lockout-email.ts     # sendLockoutEmail(email, unlockUrl)
src/app/
  actions/auth.ts      # signInAction integrates lockout calls (existing file, modified)
  api/auth/unlock/route.ts  # GET handler for /api/auth/unlock?token=...
SUPABASE_ACCOUNT_LOCKOUT.sql  # table + RPCs + RLS
tests/security/
  account-lockout.test.ts  # unit + integration coverage
```

### Module boundaries

- `lockout.ts` — pure data layer. Knows nothing about HTTP, emails, or audit events. Returns structured results; caller decides what to do.
- `lockout-email.ts` — single side-effect function. Hides Resend (or no-op fallback). Returns `{ delivered: boolean }`.
- `signInAction` — orchestrator. Calls lockout layer, calls email layer on transition into locked state, logs audit events at every branch.
- `route.ts` (unlock) — thin handler. Validates token via RPC, redirects to `/login` with flash.

## Data Model

```sql
CREATE TABLE public.account_lockouts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  failed_attempts int NOT NULL DEFAULT 0,
  window_started_at timestamptz,
  locked_until timestamptz,
  unlock_token_hash text,
  unlock_token_expires_at timestamptz,
  last_attempt_ip text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX account_lockouts_locked_until_idx
  ON public.account_lockouts (locked_until)
  WHERE locked_until IS NOT NULL;
```

RLS: enabled; no policies for anon/authenticated. Access goes exclusively through `SECURITY DEFINER` RPCs.

### RPCs

All `SECURITY DEFINER`, owner = `postgres`, granted `EXECUTE` to `anon, authenticated`.

1. `lockout_status(p_email text) returns table(user_id uuid, locked boolean, locked_until timestamptz)`
   Looks up user by email via `auth.users`, returns lock state. Returns empty row set if email unknown (do not leak existence — caller treats both cases identically).

2. `record_failed_attempt(p_email text, p_ip text, p_window_seconds int, p_max_attempts int, p_lock_duration_seconds int, p_unlock_ttl_seconds int) returns table(locked_now boolean, unlock_token text, user_id uuid)`
   Atomic upsert:
   - Find user by email; if not found, return empty row set (silent no-op — caller treats this identically to `locked_now = false, unlock_token = null`).
   - If `window_started_at IS NULL OR now() - window_started_at > p_window_seconds` → reset counter to 1, `window_started_at = now()`.
   - Else increment counter.
   - If `failed_attempts >= p_max_attempts` AND `locked_until IS NULL OR locked_until < now()` → set `locked_until = now() + p_lock_duration_seconds`, generate `unlock_token = encode(gen_random_bytes(32), 'hex')`, store `unlock_token_hash = encode(digest(unlock_token, 'sha256'), 'hex')`, `unlock_token_expires_at = now() + p_unlock_ttl_seconds`, return `locked_now = true` and the plaintext token (only time it leaves Postgres).
   - Else return `locked_now = false`, no token.

3. `record_successful_attempt(p_user_id uuid) returns void`
   Deletes the lockout row (or sets `failed_attempts = 0, window_started_at = NULL, locked_until = NULL, unlock_token_hash = NULL`). Delete is simpler.

4. `consume_unlock_token(p_token text) returns table(user_id uuid, success boolean)`
   Hash input, look up matching row. If found AND `unlock_token_expires_at > now()`: clear lock fields, return `success = true, user_id`. Else return empty / `success = false`. Token is single-use (cleared on success).

Generation uses `pgcrypto`; ensure `CREATE EXTENSION IF NOT EXISTS pgcrypto` in the migration.

## Sign-in Flow

```
signInAction(formData)
  ├─ Zod validate                         (existing)
  ├─ IP rate limit                        (existing — 5/15min per ip+email)
  ├─ lockout_status(email)
  │    locked && locked_until > now()
  │      → audit auth.lockout.blocked_attempt
  │      → return generic error "Too many failed attempts. Check your email to unlock."
  ├─ supabase.auth.signInWithPassword
  │    success:
  │      → record_successful_attempt(user.id)
  │      → existing flow (audit, profile, redirect)
  │    failure:
  │      → record_failed_attempt(email, ip, 900, 5, 1800, 3600)
  │      → if locked_now:
  │           → audit auth.lockout.triggered { user_id, ip }
  │           → sendLockoutEmail(email, unlockUrl)
  │           → return generic error "Too many failed attempts. Check your email to unlock."
  │         else:
  │           → existing failure path (audit + generic error)
```

Constants:
- `WINDOW_SECONDS = 900` (15 min)
- `MAX_ATTEMPTS = 5`
- `LOCK_DURATION_SECONDS = 1800` (30 min)
- `UNLOCK_TTL_SECONDS = 3600` (unlock link valid 1 hour; ≥ lock duration so user has time)

User-facing error stays generic across all locked / wrong-password / locked-but-correct-password branches — never confirms whether the credential was right or whether the account exists.

## Unlock Flow

`GET /api/auth/unlock?token=<hex>`

```
route.ts
  ├─ Parse + length-check token
  ├─ consume_unlock_token(token)
  │    success:
  │      → audit auth.lockout.unlocked { user_id, via: "email_link" }
  │      → 302 → /login?unlocked=1
  │    failure:
  │      → audit auth.lockout.unlock_failed { reason: "invalid_or_expired" }
  │      → 302 → /login?error=unlock_invalid
```

No login session granted by the unlock — user still must submit credentials. The link only clears the lock. This prevents an attacker who phishes the link from getting account access; the worst they can do is unlock the account for the real owner.

Login page (existing) gains two flash variants for `?unlocked=1` and `?error=unlock_invalid`. UI changes are minor toast notifications; full mockups not required.

## Email

`lockout-email.ts`:

```ts
export async function sendLockoutEmail(email: string, unlockUrl: string): Promise<{ delivered: boolean }>
```

- Reads `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS` (e.g. `security@sohojatra.app`).
- If either env var missing: log a warning, audit-log `auth.lockout.email_skipped`, return `{ delivered: false }`. Sign-in still returns the generic locked message — user must wait 30 min.
- Subject: `Your Sohojatra account was temporarily locked`
- Body: plain text + minimal HTML, includes IP last seen, time of lockout, unlock URL, and the explicit "if this was you, please reset your password" guidance with a link to `/auth/forgot-password`.
- 5-second timeout on the Resend HTTP call; failure is non-fatal (logged + audited).

Adding Resend introduces a new dependency. Bundle size is small (HTTP client only). Lives behind the email helper so the rest of the codebase has no Resend coupling.

## Audit Events

| action | outcome | when |
|---|---|---|
| `auth.lockout.blocked_attempt` | failure | sign-in tried while account locked |
| `auth.lockout.triggered` | success | 5th failure flipped account to locked |
| `auth.lockout.email_sent` | success | Resend accepted the message |
| `auth.lockout.email_skipped` | failure | env var missing or Resend errored |
| `auth.lockout.unlocked` | success | unlock token consumed |
| `auth.lockout.unlock_failed` | failure | bad/expired token |

All include `user_id` when known; never include the unlock token plaintext.

## Error Handling

- RPC errors → captured via `captureError`, sign-in falls back to current behavior (generic invalid-credential message). Lockout state not updated on RPC failure (open-fail keeps real users unblocked; IP rate limit still bites attackers).
- Email send failure → logged + audited, user response unchanged. They will need to wait the 30 min or contact support.
- Race condition (two concurrent failures hitting the 5th attempt simultaneously) → RPC runs in a single statement; row-level lock via `INSERT ... ON CONFLICT DO UPDATE` serializes. Only one of the racers gets `locked_now = true`, so only one email is sent.

## Configuration

New env vars:
- `RESEND_API_KEY` — required in production for email delivery.
- `EMAIL_FROM_ADDRESS` — required in production. Defaults to `noreply@sohojatra.local` in dev (logged-only).
- `NEXT_PUBLIC_SITE_URL` — already exists; used to build the unlock URL.

Add both to `scripts/validate-config.mjs` as production-required, dev-optional. Existing graceful-degradation pattern (commit 1786a64) applies.

## Testing

`tests/security/account-lockout.test.ts`:

- 4 failures, then correct password → success, lockout row cleared.
- 5 failures in <15 min → 6th attempt blocked with generic error even with correct password.
- 5 failures spread over 16+ min → no lockout (window resets).
- Lockout email called exactly once when transitioning into locked state (not on subsequent blocked attempts).
- `consume_unlock_token` clears lock; second use of same token returns `success = false`.
- Expired unlock token rejected.
- Unknown email never creates a lockout row.
- 10 parallel failed attempts against same account → single `lockout.triggered` audit event, single email.
- Resend env vars missing → audit logs `email_skipped`, no exception thrown.

Existing `tests/security/rate-limit.test.ts` and `tests/security/csrf.test.ts` must remain green.

## Cleanup / Migration

- New file `SUPABASE_ACCOUNT_LOCKOUT.sql` for the table + RPCs.
- No data migration — table starts empty.
- Add a Supabase cron (existing pattern in `SUPABASE_DATA_RETENTION.sql`) to delete rows where `locked_until IS NULL AND updated_at < now() - interval '7 days'` to keep the table small. Daily run.

## Out of Scope

- SMS or push notification on lockout (email only).
- Self-service unlock without email access (support handles those).
- Per-tenant configurable thresholds — constants are global.
- CAPTCHA on the login form — separate spec if/when needed.
- Lockout for OAuth sign-in (`signInWithGoogleAction`) — Google handles its own brute-force protections; we never see the password.
- Admin dashboard to view/release lockouts — operators can run a manual SQL update for now.
