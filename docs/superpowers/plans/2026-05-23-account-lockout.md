# Account Lockout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock a user account for 30 minutes after 5 failed sign-in attempts within 15 minutes, email the owner an unlock link, and clear the lock when the link is consumed.

**Architecture:** Postgres-backed state via `SECURITY DEFINER` RPCs callable by the anon client. Sign-in checks lockout before bcrypt and records every outcome. Email via Resend, with a no-op fallback when env vars are missing. Unlock route is a thin handler that consumes a single-use token.

**Tech Stack:** Next.js 16 server actions, Supabase Postgres (`pgcrypto`), `@supabase/ssr` client, Vitest, Resend HTTP API, existing `logAuditEvent` / `captureError` plumbing.

**Spec:** `docs/superpowers/specs/2026-05-23-account-lockout-design.md`

---

## File Structure

**Create:**
- `SUPABASE_ACCOUNT_LOCKOUT.sql` — table, indexes, RPCs, cron, grants.
- `src/lib/auth/lockout.ts` — typed wrappers around the four RPCs.
- `src/lib/auth/lockout-email.ts` — Resend sender + fallback.
- `src/lib/auth/lockout-constants.ts` — shared constants (window/threshold/durations).
- `src/app/api/auth/unlock/route.ts` — GET handler for `/api/auth/unlock`.
- `tests/security/account-lockout.test.ts` — unit + integration coverage.

**Modify:**
- `src/app/actions/auth.ts` — wire lockout into `signInAction`.
- `scripts/validate-config.mjs` — register new env vars (production-required).
- `package.json` — add `resend` dependency.

---

## Task 1: SQL migration — table, RPCs, RLS, cron

**Files:**
- Create: `SUPABASE_ACCOUNT_LOCKOUT.sql`

This task is SQL-only. There is no Vitest harness for raw migrations in this repo; verification is done by running the migration against a local Supabase project and exercising the RPCs from `psql`. The next task adds the TS test harness that will exercise these RPCs end-to-end.

- [ ] **Step 1: Create the migration file with table, indexes, RPCs, grants, and cron**

Write `SUPABASE_ACCOUNT_LOCKOUT.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Run the SQL file against the project's Postgres instance (Supabase Studio SQL editor, `supabase db push`, or `psql`). Expected: no errors; `\dt public.account_lockouts` lists the table; `\df public.lockout_status` lists the function.

- [ ] **Step 3: Smoke-test the RPCs from psql**

```sql
-- Replace with a real auth.users email
SELECT * FROM public.lockout_status('alice@example.com');
-- Expect: one row, locked = false, locked_until = NULL.

SELECT * FROM public.record_failed_attempt('alice@example.com', '127.0.0.1', 900, 5, 1800, 3600);
-- Repeat 5 times. On the 5th call, expect: locked_now = true, unlock_token = <64-char hex>.

SELECT * FROM public.lockout_status('alice@example.com');
-- Expect: locked = true, locked_until ~30 min in the future.
```

- [ ] **Step 4: Commit**

```bash
git add SUPABASE_ACCOUNT_LOCKOUT.sql
git commit -m "feat(db): add account_lockouts table and RPCs"
```

---

## Task 2: Shared constants module

**Files:**
- Create: `src/lib/auth/lockout-constants.ts`

- [ ] **Step 1: Create the constants file**

```ts
export const LOCKOUT_WINDOW_SECONDS = 900;
export const LOCKOUT_MAX_ATTEMPTS = 5;
export const LOCKOUT_DURATION_SECONDS = 1800;
export const LOCKOUT_UNLOCK_TTL_SECONDS = 3600;
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/auth/lockout-constants.ts
git commit -m "feat(auth): add lockout constants"
```

---

## Task 3: Lockout data layer — failing test first

**Files:**
- Create: `tests/security/account-lockout.test.ts`
- Create: `src/lib/auth/lockout.ts` (next task)

These tests stub the Supabase client and assert the data layer composes the RPC calls correctly. The real RPC behavior was verified in Task 1.

- [ ] **Step 1: Write the failing tests**

Create `tests/security/account-lockout.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
const createClientMock = vi.fn(async () => ({ rpc: rpcMock }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import {
  checkLockout,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  consumeUnlockToken,
} from "@/lib/auth/lockout";

beforeEach(() => {
  rpcMock.mockReset();
  createClientMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("checkLockout", () => {
  it("returns locked=false when RPC returns no rows", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await checkLockout("unknown@example.com");
    expect(rpcMock).toHaveBeenCalledWith("lockout_status", {
      p_email: "unknown@example.com",
    });
    expect(result).toEqual({ locked: false });
  });

  it("returns locked=true with timestamp when RPC reports lock", async () => {
    const lockedUntil = "2026-05-23T12:00:00.000Z";
    rpcMock.mockResolvedValueOnce({
      data: [{ user_id: "u1", locked: true, locked_until: lockedUntil }],
      error: null,
    });
    const result = await checkLockout("alice@example.com");
    expect(result).toEqual({
      locked: true,
      userId: "u1",
      lockedUntil,
    });
  });

  it("treats RPC errors as locked=false (open-fail)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await checkLockout("alice@example.com");
    expect(result).toEqual({ locked: false });
  });
});

describe("recordFailedAttempt", () => {
  it("forwards constants and returns no-token result", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ locked_now: false, unlock_token: null, user_id: "u1" }],
      error: null,
    });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(rpcMock).toHaveBeenCalledWith("record_failed_attempt", {
      p_email: "alice@example.com",
      p_ip: "1.2.3.4",
      p_window_seconds: 900,
      p_max_attempts: 5,
      p_lock_duration_seconds: 1800,
      p_unlock_ttl_seconds: 3600,
    });
    expect(result).toEqual({ lockedNow: false, userId: "u1" });
  });

  it("returns unlock token on transition to locked", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ locked_now: true, unlock_token: "abc123", user_id: "u1" }],
      error: null,
    });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(result).toEqual({
      lockedNow: true,
      userId: "u1",
      unlockToken: "abc123",
    });
  });

  it("returns lockedNow=false when RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(result).toEqual({ lockedNow: false });
  });

  it("returns lockedNow=false when email not found (empty data)", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await recordFailedAttempt("ghost@example.com", "1.2.3.4");
    expect(result).toEqual({ lockedNow: false });
  });
});

describe("recordSuccessfulAttempt", () => {
  it("calls RPC with user id and swallows errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await recordSuccessfulAttempt("u1");
    expect(rpcMock).toHaveBeenCalledWith("record_successful_attempt", {
      p_user_id: "u1",
    });
  });
});

describe("consumeUnlockToken", () => {
  it("returns success=false on empty data", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await consumeUnlockToken("abc");
    expect(result).toEqual({ success: false });
  });

  it("returns success=true with user id on valid token", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ user_id: "u1", success: true }],
      error: null,
    });
    const result = await consumeUnlockToken("abc");
    expect(result).toEqual({ success: true, userId: "u1" });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/lockout'`.

---

## Task 4: Lockout data layer — implementation

**Files:**
- Create: `src/lib/auth/lockout.ts`

- [ ] **Step 1: Implement the module**

```ts
import { createClient } from "@/lib/supabase/server";
import {
  LOCKOUT_DURATION_SECONDS,
  LOCKOUT_MAX_ATTEMPTS,
  LOCKOUT_UNLOCK_TTL_SECONDS,
  LOCKOUT_WINDOW_SECONDS,
} from "@/lib/auth/lockout-constants";

export type LockoutStatus =
  | { locked: false }
  | { locked: true; userId: string; lockedUntil: string };

export type FailedAttemptResult =
  | { lockedNow: false }
  | { lockedNow: true; userId: string; unlockToken: string };

export type UnlockResult =
  | { success: false }
  | { success: true; userId: string };

export async function checkLockout(email: string): Promise<LockoutStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lockout_status", {
    p_email: email,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { locked: false };
  }
  const row = data[0] as {
    user_id: string;
    locked: boolean;
    locked_until: string | null;
  };
  if (!row.locked || !row.locked_until) {
    return { locked: false };
  }
  return { locked: true, userId: row.user_id, lockedUntil: row.locked_until };
}

export async function recordFailedAttempt(
  email: string,
  ip: string,
): Promise<FailedAttemptResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_failed_attempt", {
    p_email: email,
    p_ip: ip,
    p_window_seconds: LOCKOUT_WINDOW_SECONDS,
    p_max_attempts: LOCKOUT_MAX_ATTEMPTS,
    p_lock_duration_seconds: LOCKOUT_DURATION_SECONDS,
    p_unlock_ttl_seconds: LOCKOUT_UNLOCK_TTL_SECONDS,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { lockedNow: false };
  }
  const row = data[0] as {
    locked_now: boolean;
    unlock_token: string | null;
    user_id: string;
  };
  if (!row.locked_now || !row.unlock_token) {
    return { lockedNow: false };
  }
  return {
    lockedNow: true,
    userId: row.user_id,
    unlockToken: row.unlock_token,
  };
}

export async function recordSuccessfulAttempt(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("record_successful_attempt", { p_user_id: userId });
}

export async function consumeUnlockToken(token: string): Promise<UnlockResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_unlock_token", {
    p_token: token,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { success: false };
  }
  const row = data[0] as { user_id: string | null; success: boolean };
  if (!row.success || !row.user_id) {
    return { success: false };
  }
  return { success: true, userId: row.user_id };
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: PASS (all suites green).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/lockout.ts src/lib/auth/lockout-constants.ts tests/security/account-lockout.test.ts
git commit -m "feat(auth): add lockout data layer with RPC wrappers"
```

---

## Task 5: Email helper — failing test first

**Files:**
- Modify: `tests/security/account-lockout.test.ts`
- Create: `src/lib/auth/lockout-email.ts` (next task)

- [ ] **Step 1: Add a new describe block to the existing test file**

Append at the bottom of `tests/security/account-lockout.test.ts`:

```ts
describe("sendLockoutEmail", () => {
  const fetchMock = vi.fn();
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("returns delivered=false when RESEND_API_KEY is missing", async () => {
    delete process.env.RESEND_API_KEY;
    process.env.EMAIL_FROM_ADDRESS = "security@example.com";
    const { sendLockoutEmail } = await import("@/lib/auth/lockout-email");
    const result = await sendLockoutEmail(
      "alice@example.com",
      "https://example.com/unlock?token=abc",
    );
    expect(result).toEqual({ delivered: false, reason: "missing_env" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns delivered=true when Resend responds 200", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM_ADDRESS = "security@example.com";
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }),
    );
    const { sendLockoutEmail } = await import("@/lib/auth/lockout-email");
    const result = await sendLockoutEmail(
      "alice@example.com",
      "https://example.com/unlock?token=abc",
    );
    expect(result).toEqual({ delivered: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer re_test",
        "Content-Type": "application/json",
      }),
    });
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual(["alice@example.com"]);
    expect(body.from).toBe("security@example.com");
    expect(body.subject).toMatch(/locked/i);
    expect(body.html).toContain("https://example.com/unlock?token=abc");
  });

  it("returns delivered=false when Resend responds non-2xx", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM_ADDRESS = "security@example.com";
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const { sendLockoutEmail } = await import("@/lib/auth/lockout-email");
    const result = await sendLockoutEmail(
      "alice@example.com",
      "https://example.com/unlock?token=abc",
    );
    expect(result).toEqual({ delivered: false, reason: "send_failed" });
  });

  it("returns delivered=false on fetch throw", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM_ADDRESS = "security@example.com";
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const { sendLockoutEmail } = await import("@/lib/auth/lockout-email");
    const result = await sendLockoutEmail(
      "alice@example.com",
      "https://example.com/unlock?token=abc",
    );
    expect(result).toEqual({ delivered: false, reason: "send_failed" });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/auth/lockout-email'`.

---

## Task 6: Email helper — implementation

**Files:**
- Create: `src/lib/auth/lockout-email.ts`

- [ ] **Step 1: Implement the helper**

```ts
export type SendLockoutEmailResult =
  | { delivered: true }
  | { delivered: false; reason: "missing_env" | "send_failed" };

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 5000;

export async function sendLockoutEmail(
  email: string,
  unlockUrl: string,
): Promise<SendLockoutEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;

  if (!apiKey || !fromAddress) {
    return { delivered: false, reason: "missing_env" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        from: fromAddress,
        to: [email],
        subject: "Your Sohojatra account was temporarily locked",
        text: lockoutText(unlockUrl),
        html: lockoutHtml(unlockUrl),
      }),
    });
    if (!response.ok) {
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch {
    return { delivered: false, reason: "send_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function lockoutText(unlockUrl: string): string {
  return [
    "We detected 5 failed sign-in attempts on your Sohojatra account.",
    "Your account has been temporarily locked for 30 minutes as a precaution.",
    "",
    "If this was you, please reset your password:",
    "https://sohojatra.app/auth/forgot-password",
    "",
    "If you want to unlock your account now, use this link (valid for 1 hour):",
    unlockUrl,
    "",
    "If you did not try to sign in, change your password immediately.",
  ].join("\n");
}

function lockoutHtml(unlockUrl: string): string {
  return `
    <p>We detected 5 failed sign-in attempts on your Sohojatra account.</p>
    <p>Your account has been temporarily locked for 30 minutes as a precaution.</p>
    <p>If this was you, please <a href="https://sohojatra.app/auth/forgot-password">reset your password</a>.</p>
    <p>If you want to unlock your account now, use this link (valid for 1 hour):</p>
    <p><a href="${unlockUrl}">${unlockUrl}</a></p>
    <p>If you did not try to sign in, change your password immediately.</p>
  `.trim();
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: PASS (all suites including `sendLockoutEmail` green).

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/lockout-email.ts tests/security/account-lockout.test.ts
git commit -m "feat(auth): add lockout email helper with Resend"
```

---

## Task 7: Wire lockout into `signInAction` — failing integration test first

**Files:**
- Modify: `tests/security/account-lockout.test.ts`
- Modify: `src/app/actions/auth.ts` (next task)

- [ ] **Step 1: Add integration test for signInAction**

Append to `tests/security/account-lockout.test.ts`. Place at top of file alongside existing `rpcMock` setup — these tests need additional mocks for the Supabase auth client and headers.

```ts
// Add near the top, before existing imports of lockout helpers:
const signInWithPasswordMock = vi.fn();
const fromMock = vi.fn(() => ({
  select: vi.fn(() => ({
    eq: vi.fn(() => ({
      maybeSingle: vi.fn(async () => ({ data: { id: "u1" } })),
    })),
  })),
  upsert: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
    auth: { signInWithPassword: signInWithPasswordMock },
    from: fromMock,
  })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name === "x-forwarded-for" ? "9.9.9.9" : null,
  })),
  cookies: vi.fn(async () => ({ delete: vi.fn() })),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const logAuditEventMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  logAuditEvent: logAuditEventMock,
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("@/lib/rate-limit/server", () => ({
  checkRateLimit: vi.fn(async () => true),
}));

const sendLockoutEmailMock = vi.fn(async () => ({ delivered: true }));
vi.mock("@/lib/auth/lockout-email", () => ({
  sendLockoutEmail: sendLockoutEmailMock,
}));
```

Then add the describe block at the bottom:

```ts
describe("signInAction lockout integration", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    signInWithPasswordMock.mockReset();
    logAuditEventMock.mockReset();
    sendLockoutEmailMock.mockClear();
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
  });

  function makeForm(email: string, password: string): FormData {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", password);
    return fd;
  }

  it("blocks sign-in when account already locked, never calls Supabase auth", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lockout_status") {
        return {
          data: [
            {
              user_id: "u1",
              locked: true,
              locked_until: new Date(Date.now() + 60_000).toISOString(),
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const { signInAction } = await import("@/app/actions/auth");
    const result = await signInAction(null, makeForm("alice@example.com", "pw"));

    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error:
        "Too many failed attempts. Check your email for an unlock link or try again later.",
    });
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.lockout.blocked_attempt",
        outcome: "failure",
      }),
    );
  });

  it("records failed attempt and sends email when 5th failure triggers lockout", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lockout_status") {
        return { data: [{ user_id: "u1", locked: false, locked_until: null }], error: null };
      }
      if (name === "record_failed_attempt") {
        return {
          data: [{ locked_now: true, unlock_token: "tok123", user_id: "u1" }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid credentials", status: 400 },
    });

    const { signInAction } = await import("@/app/actions/auth");
    const result = await signInAction(null, makeForm("alice@example.com", "wrong"));

    expect(result).toEqual({
      success: false,
      error:
        "Too many failed attempts. Check your email for an unlock link or try again later.",
    });
    expect(sendLockoutEmailMock).toHaveBeenCalledWith(
      "alice@example.com",
      expect.stringContaining("https://example.test/api/auth/unlock?token=tok123"),
    );
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.lockout.triggered" }),
    );
  });

  it("records success and skips email when password correct", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lockout_status") {
        return { data: [{ user_id: "u1", locked: false, locked_until: null }], error: null };
      }
      return { data: null, error: null };
    });
    signInWithPasswordMock.mockResolvedValueOnce({
      data: {
        user: { id: "u1", user_metadata: { name: "Alice" } },
      },
      error: null,
    });

    const { signInAction } = await import("@/app/actions/auth");
    await expect(
      signInAction(null, makeForm("alice@example.com", "right")),
    ).rejects.toThrow(/REDIRECT:/);

    expect(sendLockoutEmailMock).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith("record_successful_attempt", {
      p_user_id: "u1",
    });
  });

  it("returns standard error and does not email when failure is below threshold", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "lockout_status") {
        return { data: [{ user_id: "u1", locked: false, locked_until: null }], error: null };
      }
      if (name === "record_failed_attempt") {
        return {
          data: [{ locked_now: false, unlock_token: null, user_id: "u1" }],
          error: null,
        };
      }
      return { data: null, error: null };
    });
    signInWithPasswordMock.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "Invalid credentials", status: 400 },
    });

    const { signInAction } = await import("@/app/actions/auth");
    const result = await signInAction(null, makeForm("alice@example.com", "wrong"));

    expect(result).toEqual({ success: false, error: "Invalid email or password" });
    expect(sendLockoutEmailMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: FAIL — `auth.lockout.blocked_attempt` and `record_successful_attempt` assertions fail because `signInAction` does not yet call the lockout layer.

---

## Task 8: Wire lockout into `signInAction` — implementation

**Files:**
- Modify: `src/app/actions/auth.ts`

- [ ] **Step 1: Add imports**

At the top of `src/app/actions/auth.ts`, add:

```ts
import {
  checkLockout,
  recordFailedAttempt,
  recordSuccessfulAttempt,
} from "@/lib/auth/lockout";
import { sendLockoutEmail } from "@/lib/auth/lockout-email";
```

- [ ] **Step 2: Add shared constants near the existing helpers**

After `getClientIp`, add:

```ts
const LOCKED_ERROR_MESSAGE =
  "Too many failed attempts. Check your email for an unlock link or try again later.";

function buildUnlockUrl(token: string): string {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${siteUrl}/api/auth/unlock?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 3: Modify `signInAction` to call the lockout layer**

Replace the existing body of `signInAction` (lines 57–123 in current file) with:

```ts
export async function signInAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "invalid_input" },
    });
    return { success: false, error: "Invalid email or password" };
  }

  const ip = await getClientIp();
  const rateKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  if (!(await checkRateLimit(rateKey, 5, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "rate_limited", email: parsed.data.email },
    });
    return {
      success: false,
      error: "Too many login attempts. Please try again later.",
    };
  }

  const lockout = await checkLockout(parsed.data.email);
  if (lockout.locked) {
    await logAuditEvent({
      action: "auth.lockout.blocked_attempt",
      outcome: "failure",
      userId: lockout.userId,
      detail: { email: parsed.data.email, ip, locked_until: lockout.lockedUntil },
    });
    return { success: false, error: LOCKED_ERROR_MESSAGE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    const attempt = await recordFailedAttempt(parsed.data.email, ip);

    if (attempt.lockedNow) {
      const unlockUrl = buildUnlockUrl(attempt.unlockToken);
      const emailResult = await sendLockoutEmail(parsed.data.email, unlockUrl);
      await logAuditEvent({
        action: "auth.lockout.triggered",
        outcome: "success",
        userId: attempt.userId,
        detail: { email: parsed.data.email, ip },
      });
      await logAuditEvent({
        action: emailResult.delivered
          ? "auth.lockout.email_sent"
          : "auth.lockout.email_skipped",
        outcome: emailResult.delivered ? "success" : "failure",
        userId: attempt.userId,
        detail: emailResult.delivered
          ? { email: parsed.data.email }
          : { email: parsed.data.email, reason: (emailResult as { reason: string }).reason },
      });
      return { success: false, error: LOCKED_ERROR_MESSAGE };
    }

    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "invalid_credentials", email: parsed.data.email },
    });
    if (error && error.status && error.status >= 500) {
      captureError(error, {
        action: "auth.signin",
        severity: "critical",
        reason: "supabase_5xx",
      });
    }
    return { success: false, error: "Invalid email or password" };
  }

  await recordSuccessfulAttempt(data.user.id);

  await logAuditEvent({
    action: "auth.signin",
    outcome: "success",
    userId: data.user.id,
    resourceId: data.user.id,
  });

  const userName =
    (data.user.user_metadata?.name as string | undefined) ??
    (data.user.user_metadata?.full_name as string | undefined) ??
    parsed.data.email.split("@")[0];

  await ensureUserProfile(data.user.id, parsed.data.email, userName);
  revalidatePath("/", "layout");
  redirect(safeRedirectPath(formData.get("next")?.toString()));
}
```

- [ ] **Step 4: Run the integration tests to verify they pass**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: PASS (all four `signInAction` cases + earlier suites green).

- [ ] **Step 5: Run the full security suite to check for regressions**

Run: `npm run test:security`
Expected: PASS. If any pre-existing test mocks `next/headers` or `@/lib/supabase/server` differently, address conflicts before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/auth.ts tests/security/account-lockout.test.ts
git commit -m "feat(auth): integrate account lockout into signInAction"
```

---

## Task 9: Unlock route — failing test first

**Files:**
- Modify: `tests/security/account-lockout.test.ts`
- Create: `src/app/api/auth/unlock/route.ts` (next task)

- [ ] **Step 1: Append the unlock route tests**

```ts
describe("GET /api/auth/unlock", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    logAuditEventMock.mockReset();
  });

  async function callRoute(url: string) {
    const { GET } = await import("@/app/api/auth/unlock/route");
    return GET(new Request(url));
  }

  it("redirects to /login?unlocked=1 on valid token", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ user_id: "u1", success: true }],
      error: null,
    });
    const res = await callRoute(
      "https://example.test/api/auth/unlock?token=" + "a".repeat(64),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?unlocked=1");
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.lockout.unlocked" }),
    );
  });

  it("redirects to /login?error=unlock_invalid on bad token", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const res = await callRoute(
      "https://example.test/api/auth/unlock?token=" + "b".repeat(64),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=unlock_invalid");
    expect(logAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.lockout.unlock_failed" }),
    );
  });

  it("redirects to /login?error=unlock_invalid when token missing", async () => {
    const res = await callRoute("https://example.test/api/auth/unlock");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?error=unlock_invalid");
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/auth/unlock/route'`.

---

## Task 10: Unlock route — implementation

**Files:**
- Create: `src/app/api/auth/unlock/route.ts`

- [ ] **Step 1: Implement the handler**

```ts
import { NextResponse } from "next/server";
import { consumeUnlockToken } from "@/lib/auth/lockout";
import { logAuditEvent } from "@/lib/audit";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token || token.length !== 64) {
    await logAuditEvent({
      action: "auth.lockout.unlock_failed",
      outcome: "failure",
      detail: { reason: "missing_or_malformed_token" },
    });
    return NextResponse.redirect(new URL("/login?error=unlock_invalid", url), 302);
  }

  const result = await consumeUnlockToken(token);
  if (!result.success) {
    await logAuditEvent({
      action: "auth.lockout.unlock_failed",
      outcome: "failure",
      detail: { reason: "invalid_or_expired" },
    });
    return NextResponse.redirect(new URL("/login?error=unlock_invalid", url), 302);
  }

  await logAuditEvent({
    action: "auth.lockout.unlocked",
    outcome: "success",
    userId: result.userId,
    detail: { via: "email_link" },
  });
  return NextResponse.redirect(new URL("/login?unlocked=1", url), 302);
}
```

Note: the redirect helper returns absolute URLs in production but the test assertions compare against the relative path. `NextResponse.redirect` sets the `location` header to the absolute URL. Adjust the test if your Next.js version emits absolute paths — replace `toBe("/login?unlocked=1")` with `toMatch(/\/login\?unlocked=1$/)`. Run the test and pick whichever assertion matches the actual output.

- [ ] **Step 2: Run the tests and verify they pass**

Run: `npm test -- tests/security/account-lockout.test.ts`
Expected: PASS. If the location-header assertions fail because the value is absolute, update them to `toMatch(/\/login\?unlocked=1$/)` and `toMatch(/\/login\?error=unlock_invalid$/)`, re-run.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/unlock/route.ts tests/security/account-lockout.test.ts
git commit -m "feat(auth): add /api/auth/unlock handler"
```

---

## Task 11: Login page flash messages

**Files:**
- Modify: the existing login page (locate via `grep -rl 'signInAction' src/app/login 2>/dev/null` — typically `src/app/login/page.tsx`)

- [ ] **Step 1: Find the login page**

Run: `grep -rl "signInAction" src/app/login 2>/dev/null`
Expected: one file path — open it.

- [ ] **Step 2: Render flash messages for `?unlocked=1` and `?error=unlock_invalid`**

Inside the page component, read `searchParams.unlocked` and `searchParams.error`. Above the form, render:

```tsx
{searchParams?.unlocked === "1" && (
  <div role="status" className="mb-4 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">
    Your account has been unlocked. You can sign in now.
  </div>
)}
{searchParams?.error === "unlock_invalid" && (
  <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
    That unlock link is invalid or has expired. Request a password reset to regain access.
  </div>
)}
```

Match the existing component's `searchParams` API (Next.js 16 server-component `searchParams` is a `Promise<Record<string, string | string[] | undefined>>` — `await` it if the rest of the file already does, otherwise read synchronously to match local conventions).

- [ ] **Step 3: Manual smoke test**

Start the dev server: `npm run dev`. Visit:
- `http://localhost:3000/login?unlocked=1` — expect green banner.
- `http://localhost:3000/login?error=unlock_invalid` — expect red banner.
- `http://localhost:3000/login` — expect no banner.

- [ ] **Step 4: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(login): show unlock success and failure flashes"
```

---

## Task 12: Add Resend dependency and env validation

**Files:**
- Modify: `package.json`
- Modify: `scripts/validate-config.mjs`

- [ ] **Step 1: Install Resend (optional dependency — sender uses raw `fetch`)**

Actually skip — the email helper uses `fetch` against `https://api.resend.com/emails` directly, no SDK needed. Confirm no install is required.

- [ ] **Step 2: Register env vars in `scripts/validate-config.mjs`**

Open `scripts/validate-config.mjs`. Find the existing list of production-required env vars (search for `NEXT_PUBLIC_SUPABASE_URL` to locate the pattern). Add entries for:

- `RESEND_API_KEY` — required in production, optional in development. Warning text: "Account lockout emails will not be delivered without RESEND_API_KEY."
- `EMAIL_FROM_ADDRESS` — required in production, optional in development. Warning text: "Account lockout emails will not be delivered without EMAIL_FROM_ADDRESS."

Follow the exact pattern already used for other production-only env vars in the file. If the existing validator distinguishes "missing in prod = error, missing in dev = warning," reuse it; do not invent a new shape.

- [ ] **Step 3: Run the validator in offline mode**

Run: `npm run validate:config:offline`
Expected: PASS in development (warnings only); FAIL in production simulation if vars unset.

- [ ] **Step 4: Commit**

```bash
git add scripts/validate-config.mjs
git commit -m "chore(config): require RESEND_API_KEY and EMAIL_FROM_ADDRESS in prod"
```

---

## Task 13: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 2: Lint and typecheck**

Run: `npm run lint && npm run typecheck`
Expected: zero errors, zero warnings.

- [ ] **Step 3: Manual end-to-end (against local Supabase with the migration applied)**

1. `npm run dev` and create a test user via the signup flow.
2. Submit 5 wrong passwords in succession at `/login`.
3. Verify the 5th response shows the generic "Too many failed attempts" message.
4. Check the `account_lockouts` table — row exists with `locked_until` ~30 min ahead.
5. Check the configured inbox (or audit log if env vars unset) — lockout email delivered with unlock URL.
6. Click the unlock URL — redirects to `/login?unlocked=1`, green banner shown.
7. Sign in with correct password — succeeds; `account_lockouts` row deleted.

- [ ] **Step 4: Audit log spot-check**

Query the audit log table (or run a script) for the test user and confirm events emitted in order:
`auth.signin` (failure × 4) → `auth.lockout.triggered` → `auth.lockout.email_sent` → `auth.lockout.unlocked` → `auth.signin` (success).

- [ ] **Step 5: Commit any remaining changes and merge**

```bash
git status
# If clean: feature complete.
# If any tracked changes remain (e.g., docs touched during manual testing), commit with a descriptive message.
```
