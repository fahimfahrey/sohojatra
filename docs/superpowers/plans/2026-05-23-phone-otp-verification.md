# Phone OTP Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SMS OTP verification of user phone numbers via Twilio Verify, store a single `phone_verified_at` timestamp per user, and gate phone disclosure to ride co-participants on verified-and-fresh status.

**Architecture:** New `users.phone_encrypted` / `phone_verified_at` columns reuse the existing pgcrypto+Vault trigger pattern (`SUPABASE_PHONE_ENCRYPTION.sql`). Two new server actions (`requestPhoneOtpAction`, `verifyPhoneOtpAction`) call Twilio Verify and hold session state in Upstash Redis (10-min TTL). Existing `get_ride_creator_phone` RPC is extended to prefer the verified user record and return a `reason` code when unverified/stale. Per-ride `contact_phone[_encrypted]` columns remain as a fallback for in-flight rides created before the migration.

**Tech Stack:** Next.js 16 (App Router, Server Actions), TypeScript, Supabase (PostgREST + RPC), Upstash Redis (`@upstash/ratelimit`, `@upstash/redis`), Zod, Twilio Verify API (REST, fetch-based), vitest.

**Spec:** [docs/superpowers/specs/2026-05-23-phone-otp-verification-design.md](../specs/2026-05-23-phone-otp-verification-design.md)

---

## File Structure

**New files:**
- `SUPABASE_PHONE_VERIFICATION.sql` — additive migration (users columns, encryption trigger, RPC update, vault pepper note)
- `src/lib/twilio.ts` — fetch wrapper around Twilio Verify start + check
- `src/lib/phone/server.ts` — `validateE164`, `hashPhone`, `maskPhone`, Redis state store
- `src/lib/phone/constants.ts` — TTLs and rate-limit constants
- `src/app/actions/phone.ts` — `requestPhoneOtpAction`, `verifyPhoneOtpAction`, `removePhoneAction`
- `src/app/dashboard/profile/page.tsx` — server component hosting the verification card
- `src/components/profile/PhoneVerificationCard.tsx` — verified-status display + change/verify CTAs
- `src/components/profile/PhoneRequestForm.tsx` — country code + phone input
- `src/components/profile/PhoneOtpForm.tsx` — 6-digit code entry
- `tests/security/phone-otp.test.ts` — server action + RPC gating tests
- `tests/security/twilio-wrapper.test.ts` — fetch wrapper behavior

**Modified files:**
- `src/lib/validation/schemas.ts` — add `phoneE164Schema`, `otpCodeSchema`; drop `contactPhone` from `createRideSchema`/`joinRideSchema`
- `src/types/supabase.ts` — add new `users` columns
- `src/types/index.ts` — extend `UserType` with verified-phone fields
- `src/lib/audit.ts` — extend `AuditAction` union
- `src/app/actions/rides.ts` — auto-populate per-ride `contact_phone` from user record; update `getCreatorPhoneAction` for new RPC shape
- `src/lib/data/rides.ts` — same per-ride change if `contact_phone` write happens here
- `src/components/layout/FloatingCallButton.tsx` — surface reason codes from RPC
- `src/components/rides/CreateRideForm.tsx` (and `JoinRideForm.tsx` equivalents) — remove phone input, add unverified-phone banner
- `.env.example` — add Twilio + freshness env vars

---

## Task 1: Database migration — users phone columns + encryption trigger

**Files:**
- Create: `SUPABASE_PHONE_VERIFICATION.sql`

- [ ] **Step 1: Write the migration**

Create `SUPABASE_PHONE_VERIFICATION.sql` with the following content (parallels `SUPABASE_PHONE_ENCRYPTION.sql`):

```sql
-- ============================================================================
-- USER PHONE VERIFICATION SCHEMA
-- ============================================================================
-- Adds verified, encrypted phone to public.users. Reuses the existing
-- private.phone_encryption_key() and Vault-managed pgcrypto secret created
-- in SUPABASE_PHONE_ENCRYPTION.sql — that file MUST be applied first.
-- ============================================================================

-- 1. COLUMNS
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone               text,
  ADD COLUMN IF NOT EXISTS phone_encrypted     bytea,
  ADD COLUMN IF NOT EXISTS phone_country_code  text,
  ADD COLUMN IF NOT EXISTS phone_hash          text,
  ADD COLUMN IF NOT EXISTS phone_verified_at   timestamptz;

CREATE INDEX IF NOT EXISTS users_phone_hash_idx ON public.users(phone_hash);

-- 2. ENCRYPTION TRIGGER
CREATE OR REPLACE FUNCTION private.encrypt_user_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  IF NEW.phone IS NULL OR length(NEW.phone) = 0 THEN
    NEW.phone := NULL;
    RETURN NEW;
  END IF;

  v_key := private.phone_encryption_key();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'phone_encryption_key missing from vault';
  END IF;

  NEW.phone_encrypted := extensions.pgp_sym_encrypt(NEW.phone, v_key);
  NEW.phone := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.encrypt_user_phone() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS encrypt_user_phone_trg ON public.users;
CREATE TRIGGER encrypt_user_phone_trg
  BEFORE INSERT OR UPDATE OF phone ON public.users
  FOR EACH ROW EXECUTE FUNCTION private.encrypt_user_phone();

-- 3. VERIFICATION
-- After applying:
--   UPDATE public.users SET phone = '+15005550006' WHERE id = '<some-uid>';
--   SELECT phone, encode(phone_encrypted, 'hex') FROM public.users WHERE id = '<some-uid>';
--   -- expect phone IS NULL, phone_encrypted non-null
```

- [ ] **Step 2: Apply migration in Supabase**

Run the SQL above in the Supabase SQL Editor against your dev project. Then verify with the round-trip in section 3.

Expected: `phone` is NULL after the UPDATE; `phone_encrypted` contains hex-encoded ciphertext.

- [ ] **Step 3: Update TypeScript types**

Modify `src/types/supabase.ts` — extend the `users.Row`, `users.Insert`, and `users.Update` types with:

```ts
phone?: string | null;
phone_encrypted?: string | null;       // bytea surfaced as base64 by postgrest, treat as opaque
phone_country_code?: string | null;
phone_hash?: string | null;
phone_verified_at?: string | null;
```

Add the same five fields to each of `Row`, `Insert`, and `Update` (all optional/nullable).

- [ ] **Step 4: Commit**

```bash
git add SUPABASE_PHONE_VERIFICATION.sql src/types/supabase.ts
git commit -m "feat(db): add encrypted phone + verified_at columns to users"
```

---

## Task 2: Phone validation + hash utilities

**Files:**
- Create: `src/lib/phone/constants.ts`
- Create: `src/lib/phone/server.ts`
- Test: `tests/security/phone-utils.test.ts`

- [ ] **Step 1: Write the constants file**

Create `src/lib/phone/constants.ts`:

```ts
// OTP session lifetime in Redis (matches Twilio Verify default code TTL).
export const OTP_TTL_SECONDS = 600;

// Freshness window for a verified phone before we treat it as stale.
const DAYS = Number(process.env.PHONE_VERIFICATION_FRESHNESS_DAYS ?? "180");
export const FRESHNESS_WINDOW_MS = Math.max(1, DAYS) * 24 * 60 * 60 * 1000;

// Rate-limit windows
export const OTP_SEND_PER_USER = { max: 3, windowMs: 60 * 60 * 1000 };          // 3 / hour
export const OTP_SEND_PER_PHONE = { max: 5, windowMs: 24 * 60 * 60 * 1000 };    // 5 / day
export const OTP_VERIFY_PER_USER = { max: 5, windowMs: 15 * 60 * 1000 };        // 5 / 15min
export const OTP_REMOVE_PER_USER = { max: 3, windowMs: 60 * 60 * 1000 };        // 3 / hour

// Hard requirement: caller must set PHONE_HASH_PEPPER (32+ chars).
export function getPhoneHashPepper(): string {
  const pepper = process.env.PHONE_HASH_PEPPER;
  if (!pepper || pepper.length < 32) {
    throw new Error("PHONE_HASH_PEPPER must be set to a 32+ character secret");
  }
  return pepper;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/security/phone-utils.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { validateE164, hashPhone, maskPhone } from "@/lib/phone/server";

beforeAll(() => {
  process.env.PHONE_HASH_PEPPER = "x".repeat(48);
});

describe("validateE164", () => {
  it.each([
    "+8801711000000",
    "+15005550006",
    "+447911123456",
  ])("accepts %s", (n) => {
    expect(validateE164(n)).toBe(n);
  });

  it.each([
    "8801711000000",   // missing +
    "+1",              // too short
    "+1234567890123456", // too long
    "+1 555 5550006",  // spaces
    "+1abc5550006",
    "",
  ])("rejects %s", (bad) => {
    expect(() => validateE164(bad)).toThrow(/E\.164/);
  });
});

describe("hashPhone", () => {
  it("is deterministic for the same input + pepper", async () => {
    const a = await hashPhone("+15005550006");
    const b = await hashPhone("+15005550006");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for different phones", async () => {
    expect(await hashPhone("+15005550006")).not.toBe(
      await hashPhone("+15005550007"),
    );
  });

  it("changes when the pepper changes", async () => {
    const a = await hashPhone("+15005550006");
    process.env.PHONE_HASH_PEPPER = "y".repeat(48);
    const b = await hashPhone("+15005550006");
    process.env.PHONE_HASH_PEPPER = "x".repeat(48); // restore
    expect(a).not.toBe(b);
  });
});

describe("maskPhone", () => {
  it("keeps country code and last 4 digits", () => {
    expect(maskPhone("+8801711123456")).toBe("+880*****3456");
    expect(maskPhone("+15005550006")).toBe("+1*****0006");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/security/phone-utils.test.ts`
Expected: FAIL — `Cannot find module '@/lib/phone/server'`.

- [ ] **Step 4: Implement the utilities**

Create `src/lib/phone/server.ts`:

```ts
import "server-only";
import { getPhoneHashPepper } from "./constants";

const E164 = /^\+[1-9]\d{6,14}$/;

export function validateE164(input: string): string {
  if (!E164.test(input)) {
    throw new Error("Invalid E.164 phone number");
  }
  return input;
}

export async function hashPhone(phoneE164: string): Promise<string> {
  const pepper = getPhoneHashPepper();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(phoneE164),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function maskPhone(phoneE164: string): string {
  // Country code = leading '+' through first 1-3 digits; cheap heuristic OK for display.
  const m = phoneE164.match(/^(\+\d{1,3})\d+(\d{4})$/);
  if (!m) return phoneE164.slice(0, 2) + "*****" + phoneE164.slice(-4);
  return `${m[1]}*****${m[2]}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-utils.test.ts`
Expected: PASS (3 describes, 9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/phone tests/security/phone-utils.test.ts
git commit -m "feat(phone): add E.164 validator, peppered HMAC hash, mask util"
```

---

## Task 3: Twilio Verify wrapper

**Files:**
- Create: `src/lib/twilio.ts`
- Test: `tests/security/twilio-wrapper.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/security/twilio-wrapper.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test_sid";
  process.env.TWILIO_AUTH_TOKEN = "test_token";
  process.env.TWILIO_VERIFY_SERVICE_SID = "VA_test_service";
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe("twilio.startVerification", () => {
  it("posts To + Channel and returns sid", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sid: "VE123", status: "pending" }), {
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { startVerification } = await import("@/lib/twilio");
    const res = await startVerification("+15005550006");

    expect(res.sid).toBe("VE123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/Services\/VA_test_service\/Verifications$/);
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      "Content-Type": "application/x-www-form-urlencoded",
    });
    expect(String((init as RequestInit).body)).toBe("To=%2B15005550006&Channel=sms");
  });

  it("throws TwilioError on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ code: 60200, message: "Invalid parameter" }),
          { status: 400 },
        ),
      ),
    );

    const { startVerification, TwilioError } = await import("@/lib/twilio");
    await expect(startVerification("+1")).rejects.toBeInstanceOf(TwilioError);
  });
});

describe("twilio.checkVerification", () => {
  it("returns status when Twilio approves", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "approved" }), { status: 200 }),
      ),
    );

    const { checkVerification } = await import("@/lib/twilio");
    const res = await checkVerification("+15005550006", "123456");
    expect(res.status).toBe("approved");
  });

  it("returns status='pending' when code wrong (Twilio 200)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status: "pending" }), { status: 200 }),
      ),
    );
    const { checkVerification } = await import("@/lib/twilio");
    expect((await checkVerification("+15005550006", "000000")).status).toBe("pending");
  });

  it("maps Twilio 404 (no pending verification) to status='expired'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ code: 20404, message: "not found" }),
          { status: 404 },
        ),
      ),
    );
    const { checkVerification } = await import("@/lib/twilio");
    expect((await checkVerification("+15005550006", "000000")).status).toBe("expired");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/security/twilio-wrapper.test.ts`
Expected: FAIL — `Cannot find module '@/lib/twilio'`.

- [ ] **Step 3: Implement the wrapper**

Create `src/lib/twilio.ts`:

```ts
import "server-only";

export class TwilioError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly twilioCode?: number,
  ) {
    super(message);
    this.name = "TwilioError";
  }
}

export type VerificationStatus = "pending" | "approved" | "canceled" | "expired";

interface StartResponse {
  sid: string;
  status: VerificationStatus;
}

interface CheckResponse {
  status: VerificationStatus;
}

function authHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }
  return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

function serviceSid(): string {
  const s = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!s) throw new Error("TWILIO_VERIFY_SERVICE_SID must be set");
  return s;
}

async function parseError(res: Response): Promise<TwilioError> {
  let twilioCode: number | undefined;
  let message = `Twilio ${res.status}`;
  try {
    const body = (await res.json()) as { code?: number; message?: string };
    twilioCode = body.code;
    if (body.message) message = body.message;
  } catch {
    // ignore JSON parse errors
  }
  return new TwilioError(message, res.status, twilioCode);
}

export async function startVerification(
  phoneE164: string,
  channel: "sms" = "sms",
): Promise<StartResponse> {
  const body = new URLSearchParams({ To: phoneE164, Channel: channel });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid()}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  if (!res.ok) throw await parseError(res);
  const json = (await res.json()) as StartResponse;
  return { sid: json.sid, status: json.status };
}

export async function checkVerification(
  phoneE164: string,
  code: string,
): Promise<CheckResponse> {
  const body = new URLSearchParams({ To: phoneE164, Code: code });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid()}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  );
  if (res.status === 404) {
    // No pending verification (expired or never started).
    return { status: "expired" };
  }
  if (!res.ok) throw await parseError(res);
  const json = (await res.json()) as CheckResponse;
  return { status: json.status };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/twilio-wrapper.test.ts`
Expected: PASS (5 tests across 2 describes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/twilio.ts tests/security/twilio-wrapper.test.ts
git commit -m "feat(twilio): add Verify start/check wrapper with TwilioError"
```

---

## Task 4: Redis verification state store

**Files:**
- Modify: `src/lib/phone/server.ts`
- Test: `tests/security/phone-otp-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/security/phone-otp-state.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const setMock = vi.fn(async () => "OK");
const getMock = vi.fn(async () => null as string | null);
const delMock = vi.fn(async () => 1);

vi.mock("@upstash/redis", () => ({
  Redis: vi.fn(() => ({ set: setMock, get: getMock, del: delMock })),
}));

beforeEach(() => {
  process.env.UPSTASH_REDIS_REST_URL = "https://test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "tok";
  process.env.PHONE_HASH_PEPPER = "x".repeat(48);
  vi.resetModules();
  setMock.mockClear();
  getMock.mockClear();
  delMock.mockClear();
});

describe("phone verification state", () => {
  it("saves with 10-minute TTL keyed by user id", async () => {
    const { savePhoneVerifyState } = await import("@/lib/phone/server");
    await savePhoneVerifyState("user-1", {
      phoneE164: "+15005550006",
      countryCode: "US",
      twilioSid: "VE1",
      createdAt: 1700000000000,
    });
    expect(setMock).toHaveBeenCalledTimes(1);
    const [key, value, opts] = setMock.mock.calls[0];
    expect(key).toBe("otpv:user-1");
    expect(JSON.parse(value as string)).toMatchObject({
      phoneE164: "+15005550006",
      twilioSid: "VE1",
    });
    expect(opts).toEqual({ ex: 600 });
  });

  it("returns null when no state", async () => {
    getMock.mockResolvedValueOnce(null);
    const { loadPhoneVerifyState } = await import("@/lib/phone/server");
    expect(await loadPhoneVerifyState("user-1")).toBeNull();
  });

  it("parses stored JSON", async () => {
    getMock.mockResolvedValueOnce(
      JSON.stringify({
        phoneE164: "+15005550006",
        countryCode: "US",
        twilioSid: "VE2",
        createdAt: 123,
      }),
    );
    const { loadPhoneVerifyState } = await import("@/lib/phone/server");
    const s = await loadPhoneVerifyState("user-1");
    expect(s?.twilioSid).toBe("VE2");
  });

  it("deletes by key", async () => {
    const { deletePhoneVerifyState } = await import("@/lib/phone/server");
    await deletePhoneVerifyState("user-1");
    expect(delMock).toHaveBeenCalledWith("otpv:user-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/security/phone-otp-state.test.ts`
Expected: FAIL — `savePhoneVerifyState` not exported.

- [ ] **Step 3: Add the store to `src/lib/phone/server.ts`**

Append to `src/lib/phone/server.ts`:

```ts
import { Redis } from "@upstash/redis";
import { OTP_TTL_SECONDS } from "./constants";

export interface PhoneVerifyState {
  phoneE164: string;
  countryCode: string;
  twilioSid: string;
  createdAt: number;
}

let redis: Redis | null = null;
function getRedis(): Redis {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set for phone verification",
    );
  }
  redis = new Redis({ url, token });
  return redis;
}

function key(userId: string) {
  return `otpv:${userId}`;
}

export async function savePhoneVerifyState(
  userId: string,
  state: PhoneVerifyState,
): Promise<void> {
  await getRedis().set(key(userId), JSON.stringify(state), { ex: OTP_TTL_SECONDS });
}

export async function loadPhoneVerifyState(
  userId: string,
): Promise<PhoneVerifyState | null> {
  const raw = await getRedis().get<string>(key(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PhoneVerifyState;
  } catch {
    return null;
  }
}

export async function deletePhoneVerifyState(userId: string): Promise<void> {
  await getRedis().del(key(userId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-otp-state.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/phone/server.ts tests/security/phone-otp-state.test.ts
git commit -m "feat(phone): add Redis-backed OTP session state store"
```

---

## Task 5: Extend audit action union

**Files:**
- Modify: `src/lib/audit.ts:5-17`

- [ ] **Step 1: Extend the union**

Open `src/lib/audit.ts`. Locate `export type AuditAction = ...` (around line 5). Add the new actions:

```ts
export type AuditAction =
  | "auth.signin"
  | "auth.signin.oauth"
  | "auth.signup"
  | "auth.signout"
  | "auth.callback"
  | "ride.create"
  | "ride.join"
  | "ride.cancel"
  | "ride.complete"
  | "phone.access"
  | "phone.verify.start"
  | "phone.verify.success"
  | "phone.verify.failure"
  | "phone.verify.rate_limited"
  | "phone.remove"
  | "phone.reassignment"
  | "user.data.export"
  | "user.account.delete";
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). If callers exhaustively switch on `AuditAction`, fix them — there are none today.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit.ts
git commit -m "feat(audit): add phone.verify.* and phone.remove actions"
```

---

## Task 6: Add zod schemas for phone actions

**Files:**
- Modify: `src/lib/validation/schemas.ts`

- [ ] **Step 1: Add the schemas**

Open `src/lib/validation/schemas.ts`. After the existing `phoneSchema` (line 15-17), add:

```ts
export const phoneE164Schema = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in E.164 format (e.g. +8801711000000)");

export const countryCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code (e.g. BD)");

export const otpCodeSchema = z
  .string()
  .regex(/^\d{6}$/, "Code must be 6 digits");

export const requestPhoneOtpSchema = z.object({
  phone: phoneE164Schema,
  countryCode: countryCodeSchema,
});

export const verifyPhoneOtpSchema = z.object({
  code: otpCodeSchema,
});
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/validation/schemas.ts
git commit -m "feat(validation): add E.164 + OTP code schemas for phone actions"
```

---

## Task 7: requestPhoneOtpAction

**Files:**
- Create: `src/app/actions/phone.ts`
- Test: `tests/security/phone-otp.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/security/phone-otp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireUserMock = vi.fn();
const validateCsrfMock = vi.fn(async () => true);
const consumeMock = vi.fn(async () => ({ allowed: true }));
const auditMock = vi.fn(async () => {});
const startVerifyMock = vi.fn(async () => ({ sid: "VE1", status: "pending" }));
const saveStateMock = vi.fn(async () => {});

vi.mock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock }));
vi.mock("@/lib/security/csrf", () => ({ validateCsrfToken: validateCsrfMock }));
vi.mock("@/lib/rate-limit/server", () => ({
  consumeRateLimit: consumeMock,
  checkRateLimit: async (...args: unknown[]) => (await consumeMock(...(args as []))).allowed,
}));
vi.mock("@/lib/audit", () => ({ logAuditEvent: auditMock, getRequestContext: async () => ({ ip: null, userAgent: null }) }));
vi.mock("@/lib/twilio", () => ({
  startVerification: startVerifyMock,
  checkVerification: vi.fn(),
  TwilioError: class extends Error {},
}));
vi.mock("@/lib/phone/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/phone/server")>("@/lib/phone/server");
  return { ...actual, savePhoneVerifyState: saveStateMock };
});

beforeEach(() => {
  process.env.PHONE_HASH_PEPPER = "x".repeat(48);
  requireUserMock.mockResolvedValue({ id: "user-1", email: "u@e" });
  validateCsrfMock.mockResolvedValue(true);
  consumeMock.mockResolvedValue({ allowed: true });
  auditMock.mockClear();
  startVerifyMock.mockClear();
  saveStateMock.mockClear();
});

describe("requestPhoneOtpAction", () => {
  it("rejects bad CSRF", async () => {
    validateCsrfMock.mockResolvedValueOnce(false);
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "+15005550006", countryCode: "US" }, "bad");
    expect(r).toEqual({ success: false, error: "Invalid or missing CSRF token" });
    expect(startVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects non-E.164 phone", async () => {
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "555-0006", countryCode: "US" }, "tok");
    expect(r.success).toBe(false);
    expect(startVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects when per-user rate limit exhausted", async () => {
    consumeMock.mockResolvedValueOnce({ allowed: false });
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "+15005550006", countryCode: "US" }, "tok");
    expect(r.success).toBe(false);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "phone.verify.rate_limited" }));
    expect(startVerifyMock).not.toHaveBeenCalled();
  });

  it("rejects when per-phone rate limit exhausted", async () => {
    consumeMock
      .mockResolvedValueOnce({ allowed: true })     // per-user pass
      .mockResolvedValueOnce({ allowed: false });   // per-phone fail
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "+15005550006", countryCode: "US" }, "tok");
    expect(r.success).toBe(false);
    expect(startVerifyMock).not.toHaveBeenCalled();
  });

  it("happy path: calls Twilio, saves state, audits start, returns expiresAt", async () => {
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "+15005550006", countryCode: "US" }, "tok");
    expect(r.success).toBe(true);
    expect(startVerifyMock).toHaveBeenCalledWith("+15005550006");
    expect(saveStateMock).toHaveBeenCalledTimes(1);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "phone.verify.start", outcome: "success" }));
    if (r.success) expect(typeof r.data?.expiresAt).toBe("string");
  });

  it("audits failure when Twilio throws", async () => {
    startVerifyMock.mockRejectedValueOnce(new Error("network"));
    const { requestPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await requestPhoneOtpAction({ phone: "+15005550006", countryCode: "US" }, "tok");
    expect(r.success).toBe(false);
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "phone.verify.start", outcome: "failure" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/security/phone-otp.test.ts`
Expected: FAIL — `Cannot find module '@/app/actions/phone'`.

- [ ] **Step 3: Implement the action**

Create `src/app/actions/phone.ts`:

```ts
"use server";

import { requireUser } from "@/lib/auth/require-user";
import { validateCsrfToken } from "@/lib/security/csrf";
import { consumeRateLimit } from "@/lib/rate-limit/server";
import { logAuditEvent } from "@/lib/audit";
import { startVerification, checkVerification, TwilioError } from "@/lib/twilio";
import {
  hashPhone,
  maskPhone,
  savePhoneVerifyState,
  loadPhoneVerifyState,
  deletePhoneVerifyState,
} from "@/lib/phone/server";
import {
  OTP_SEND_PER_USER,
  OTP_SEND_PER_PHONE,
  OTP_VERIFY_PER_USER,
  OTP_REMOVE_PER_USER,
  OTP_TTL_SECONDS,
} from "@/lib/phone/constants";
import {
  requestPhoneOtpSchema,
  verifyPhoneOtpSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import { createClient } from "@/lib/supabase/server";

const CSRF_ERROR: ActionResult<never> = {
  success: false,
  error: "Invalid or missing CSRF token",
};

export async function requestPhoneOtpAction(
  input: unknown,
  csrfToken: string,
): Promise<ActionResult<{ expiresAt: string }>> {
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = requestPhoneOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Invalid phone or country code" };
  }
  const { phone, countryCode } = parsed.data;

  // Per-user limit
  if (!(await consumeRateLimit(
    `otp:send:user:${user.id}`,
    OTP_SEND_PER_USER.max,
    OTP_SEND_PER_USER.windowMs,
  )).allowed) {
    await logAuditEvent({
      action: "phone.verify.rate_limited",
      outcome: "failure",
      userId: user.id,
      detail: { stage: "send", scope: "user" },
    });
    return { success: false, error: "Too many code requests. Try again later." };
  }

  // Per-phone limit
  const phoneHashHex = await hashPhone(phone);
  if (!(await consumeRateLimit(
    `otp:send:phone:${phoneHashHex}`,
    OTP_SEND_PER_PHONE.max,
    OTP_SEND_PER_PHONE.windowMs,
  )).allowed) {
    await logAuditEvent({
      action: "phone.verify.rate_limited",
      outcome: "failure",
      userId: user.id,
      detail: { stage: "send", scope: "phone" },
    });
    return { success: false, error: "Too many code requests for this number. Try again later." };
  }

  try {
    const { sid } = await startVerification(phone);
    await savePhoneVerifyState(user.id, {
      phoneE164: phone,
      countryCode,
      twilioSid: sid,
      createdAt: Date.now(),
    });
    await logAuditEvent({
      action: "phone.verify.start",
      outcome: "success",
      userId: user.id,
      detail: { phoneCountryCode: countryCode, phoneSuffix: phone.slice(-4) },
    });
    return {
      success: true,
      data: { expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString() },
    };
  } catch (err) {
    const twilioCode = err instanceof TwilioError ? err.twilioCode ?? null : null;
    await logAuditEvent({
      action: "phone.verify.start",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "twilio_error", twilioCode },
    });
    return { success: false, error: "Could not send verification code. Try again." };
  }
}

// Other actions (verifyPhoneOtpAction, removePhoneAction) added in Tasks 8 and 9.
```

Also add `requestPhoneOtpSchema` import path is already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-otp.test.ts`
Expected: PASS (6 tests in the `requestPhoneOtpAction` describe).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/phone.ts tests/security/phone-otp.test.ts
git commit -m "feat(actions): add requestPhoneOtpAction with CSRF, rate limits, audit"
```

---

## Task 8: verifyPhoneOtpAction

**Files:**
- Modify: `src/app/actions/phone.ts`
- Test: `tests/security/phone-otp.test.ts` (extend)

- [ ] **Step 1: Add failing tests**

Append to `tests/security/phone-otp.test.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

const checkVerifyMock = vi.fn(async () => ({ status: "approved" }));
const loadStateMock = vi.fn();
const delStateMock = vi.fn(async () => {});
const supabaseTxnMock = vi.fn();

vi.mock("@/lib/twilio", () => ({
  startVerification: startVerifyMock,
  checkVerification: checkVerifyMock,
  TwilioError: class extends Error {},
}));

vi.mock("@/lib/phone/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/phone/server")>("@/lib/phone/server");
  return {
    ...actual,
    savePhoneVerifyState: saveStateMock,
    loadPhoneVerifyState: loadStateMock,
    deletePhoneVerifyState: delStateMock,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseTxnMock(),
}));

function fakeSupabase(): SupabaseClient {
  // Minimal shape for verify path: rpc returns the previous-owner row (or null).
  const rpcMock = vi.fn(async () => ({ data: null, error: null }));
  return { rpc: rpcMock } as unknown as SupabaseClient;
}

describe("verifyPhoneOtpAction", () => {
  beforeEach(() => {
    checkVerifyMock.mockResolvedValue({ status: "approved" });
    loadStateMock.mockResolvedValue({
      phoneE164: "+15005550006",
      countryCode: "US",
      twilioSid: "VE1",
      createdAt: Date.now(),
    });
    delStateMock.mockClear();
    supabaseTxnMock.mockImplementation(() => fakeSupabase());
  });

  it("rejects bad CSRF", async () => {
    validateCsrfMock.mockResolvedValueOnce(false);
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await verifyPhoneOtpAction({ code: "123456" }, "bad");
    expect(r.success).toBe(false);
  });

  it("rejects non-6-digit code", async () => {
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    expect((await verifyPhoneOtpAction({ code: "12" }, "tok")).success).toBe(false);
  });

  it("rejects when no Redis state exists", async () => {
    loadStateMock.mockResolvedValueOnce(null);
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await verifyPhoneOtpAction({ code: "123456" }, "tok");
    expect(r).toEqual({ success: false, error: "No pending verification. Request a new code." });
  });

  it("on approved: writes user row via verify_user_phone RPC, deletes state, audits success", async () => {
    const sb = fakeSupabase();
    supabaseTxnMock.mockImplementationOnce(() => sb);
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await verifyPhoneOtpAction({ code: "123456" }, "tok");
    expect(r.success).toBe(true);
    expect((sb.rpc as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "verify_user_phone",
      expect.objectContaining({
        p_phone: "+15005550006",
        p_country_code: "US",
        p_phone_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
    expect(delStateMock).toHaveBeenCalledWith("user-1");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "phone.verify.success", outcome: "success" }),
    );
  });

  it("on pending: keeps Redis state, audits failure", async () => {
    checkVerifyMock.mockResolvedValueOnce({ status: "pending" });
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await verifyPhoneOtpAction({ code: "000000" }, "tok");
    expect(r.success).toBe(false);
    expect(delStateMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "phone.verify.failure", outcome: "failure" }),
    );
  });

  it("on expired: deletes Redis state, audits failure", async () => {
    checkVerifyMock.mockResolvedValueOnce({ status: "expired" });
    const { verifyPhoneOtpAction } = await import("@/app/actions/phone");
    const r = await verifyPhoneOtpAction({ code: "000000" }, "tok");
    expect(r.success).toBe(false);
    expect(delStateMock).toHaveBeenCalledWith("user-1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/security/phone-otp.test.ts -t verifyPhoneOtpAction`
Expected: FAIL — `verifyPhoneOtpAction` not exported.

- [ ] **Step 3: Add the SQL helper RPC**

Append to `SUPABASE_PHONE_VERIFICATION.sql` (and apply in Supabase):

```sql
-- ----------------------------------------------------------------------------
-- VERIFY_USER_PHONE RPC
-- Atomically reassigns phone ownership (revokes prior verified holder) and
-- stamps the caller's row as verified.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_user_phone(
  p_phone text,
  p_country_code text,
  p_phone_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_loser  uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Revoke any other user currently holding the same hash.
  UPDATE public.users
  SET phone               = NULL,
      phone_encrypted     = NULL,
      phone_country_code  = NULL,
      phone_hash          = NULL,
      phone_verified_at   = NULL
  WHERE phone_hash = p_phone_hash
    AND id <> v_caller
  RETURNING id INTO v_loser;

  -- Write the new owner row. Trigger encrypts p_phone and NULLs the plaintext.
  UPDATE public.users
  SET phone               = p_phone,
      phone_country_code  = p_country_code,
      phone_hash          = p_phone_hash,
      phone_verified_at   = now()
  WHERE id = v_caller;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_user_phone(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_user_phone(text, text, text) TO authenticated;
```

- [ ] **Step 4: Implement verifyPhoneOtpAction**

Append to `src/app/actions/phone.ts`:

```ts
export async function verifyPhoneOtpAction(
  input: unknown,
  csrfToken: string,
): Promise<ActionResult<{ phoneMasked: string; verifiedAt: string }>> {
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  const parsed = verifyPhoneOtpSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Code must be 6 digits" };
  }
  const { code } = parsed.data;

  if (!(await consumeRateLimit(
    `otp:verify:user:${user.id}`,
    OTP_VERIFY_PER_USER.max,
    OTP_VERIFY_PER_USER.windowMs,
  )).allowed) {
    await logAuditEvent({
      action: "phone.verify.rate_limited",
      outcome: "failure",
      userId: user.id,
      detail: { stage: "verify" },
    });
    return { success: false, error: "Too many verification attempts. Try again later." };
  }

  const state = await loadPhoneVerifyState(user.id);
  if (!state) {
    return { success: false, error: "No pending verification. Request a new code." };
  }

  let status: string;
  try {
    ({ status } = await checkVerification(state.phoneE164, code));
  } catch (err) {
    const twilioCode = err instanceof TwilioError ? err.twilioCode ?? null : null;
    await logAuditEvent({
      action: "phone.verify.failure",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "twilio_error", twilioCode },
    });
    return { success: false, error: "Could not verify code. Try again." };
  }

  if (status === "approved") {
    const supabase = await createClient();
    const phoneHashHex = await hashPhone(state.phoneE164);
    const { error } = await supabase.rpc("verify_user_phone", {
      p_phone: state.phoneE164,
      p_country_code: state.countryCode,
      p_phone_hash: phoneHashHex,
    });
    if (error) {
      await logAuditEvent({
        action: "phone.verify.failure",
        outcome: "failure",
        userId: user.id,
        detail: { reason: "db_error", code: error.code ?? null },
      });
      return { success: false, error: "Could not save verification. Try again." };
    }
    await deletePhoneVerifyState(user.id);
    const verifiedAt = new Date().toISOString();
    await logAuditEvent({
      action: "phone.verify.success",
      outcome: "success",
      userId: user.id,
      detail: { phoneCountryCode: state.countryCode, phoneSuffix: state.phoneE164.slice(-4) },
    });
    return {
      success: true,
      data: { phoneMasked: maskPhone(state.phoneE164), verifiedAt },
    };
  }

  // pending = wrong code; expired/canceled = session over.
  if (status === "pending") {
    await logAuditEvent({
      action: "phone.verify.failure",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "wrong_code" },
    });
    return { success: false, error: "Incorrect code. Try again." };
  }

  // expired or canceled
  await deletePhoneVerifyState(user.id);
  await logAuditEvent({
    action: "phone.verify.failure",
    outcome: "failure",
    userId: user.id,
    detail: { reason: status },
  });
  return { success: false, error: "Code expired. Request a new one." };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-otp.test.ts -t verifyPhoneOtpAction`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/phone.ts SUPABASE_PHONE_VERIFICATION.sql tests/security/phone-otp.test.ts
git commit -m "feat(actions): add verifyPhoneOtpAction + verify_user_phone RPC"
```

---

## Task 9: removePhoneAction

**Files:**
- Modify: `src/app/actions/phone.ts`
- Test: `tests/security/phone-otp.test.ts` (extend)

- [ ] **Step 1: Add failing test**

Append to `tests/security/phone-otp.test.ts`:

```ts
describe("removePhoneAction", () => {
  beforeEach(() => {
    supabaseTxnMock.mockImplementation(() => {
      const fromMock = vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      }));
      return { from: fromMock } as unknown as SupabaseClient;
    });
  });

  it("rejects bad CSRF", async () => {
    validateCsrfMock.mockResolvedValueOnce(false);
    const { removePhoneAction } = await import("@/app/actions/phone");
    expect((await removePhoneAction("bad")).success).toBe(false);
  });

  it("happy path: nulls columns, audits phone.remove", async () => {
    const { removePhoneAction } = await import("@/app/actions/phone");
    const r = await removePhoneAction("tok");
    expect(r.success).toBe(true);
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "phone.remove", outcome: "success" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/security/phone-otp.test.ts -t removePhoneAction`
Expected: FAIL — `removePhoneAction` not exported.

- [ ] **Step 3: Implement removePhoneAction**

Append to `src/app/actions/phone.ts`:

```ts
export async function removePhoneAction(
  csrfToken: string,
): Promise<ActionResult<void>> {
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (!(await consumeRateLimit(
    `otp:remove:user:${user.id}`,
    OTP_REMOVE_PER_USER.max,
    OTP_REMOVE_PER_USER.windowMs,
  )).allowed) {
    return { success: false, error: "Too many requests. Try again later." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("users")
    .update({
      phone: null,
      phone_encrypted: null,
      phone_country_code: null,
      phone_hash: null,
      phone_verified_at: null,
    })
    .eq("id", user.id);

  if (error) {
    await logAuditEvent({
      action: "phone.remove",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "db_error", code: error.code ?? null },
    });
    return { success: false, error: "Could not remove phone." };
  }

  await deletePhoneVerifyState(user.id);
  await logAuditEvent({ action: "phone.remove", outcome: "success", userId: user.id });
  return { success: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-otp.test.ts -t removePhoneAction`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/phone.ts tests/security/phone-otp.test.ts
git commit -m "feat(actions): add removePhoneAction"
```

---

## Task 10: Update get_ride_creator_phone RPC (gate on verified)

**Files:**
- Modify: `SUPABASE_PHONE_VERIFICATION.sql`
- Modify: `src/app/actions/rides.ts:106-160`
- Test: `tests/security/phone-otp.test.ts` (extend)

- [ ] **Step 1: Append the updated RPC to the migration**

Append to `SUPABASE_PHONE_VERIFICATION.sql`:

```sql
-- ----------------------------------------------------------------------------
-- UPDATED get_ride_creator_phone — verified-and-fresh gate, returns reason
-- ----------------------------------------------------------------------------
-- Drop the old single-text version and recreate returning (phone, reason).
DROP FUNCTION IF EXISTS public.get_ride_creator_phone(uuid);

CREATE OR REPLACE FUNCTION public.get_ride_creator_phone(p_ride_id uuid)
RETURNS TABLE(phone text, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_creator uuid;
  v_status text;
  v_ride_cipher bytea;
  v_user_cipher bytea;
  v_verified_at timestamptz;
  v_key text;
  v_freshness_days int := COALESCE(
    NULLIF(current_setting('app.phone_freshness_days', true), '')::int,
    180
  );
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT creator_id, status, contact_phone_encrypted
  INTO v_creator, v_status, v_ride_cipher
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

  SELECT phone_encrypted, phone_verified_at
  INTO v_user_cipher, v_verified_at
  FROM public.users
  WHERE id = v_creator;

  -- Prefer verified-and-fresh user record.
  IF v_user_cipher IS NOT NULL
     AND v_verified_at IS NOT NULL
     AND v_verified_at >= now() - make_interval(days => v_freshness_days) THEN
    v_key := private.phone_encryption_key();
    phone := extensions.pgp_sym_decrypt(v_user_cipher, v_key);
    reason := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Stale-but-present verified record: refuse with reason.
  IF v_user_cipher IS NOT NULL AND v_verified_at IS NOT NULL THEN
    phone := NULL;
    reason := 'stale';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Unverified user; fall back to legacy per-ride snapshot (back-compat).
  IF v_ride_cipher IS NULL THEN
    SELECT contact_phone_encrypted INTO v_ride_cipher
    FROM public.ride_passengers
    WHERE ride_id = p_ride_id AND user_id = v_creator
    LIMIT 1;
  END IF;

  IF v_ride_cipher IS NOT NULL THEN
    v_key := private.phone_encryption_key();
    phone := extensions.pgp_sym_decrypt(v_ride_cipher, v_key);
    -- Phone exists but creator is unverified — surface that to the UI.
    reason := CASE WHEN v_user_cipher IS NULL THEN 'unverified' ELSE NULL END;
    RETURN NEXT;
    RETURN;
  END IF;

  phone := NULL;
  reason := 'missing';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ride_creator_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_creator_phone(uuid) TO authenticated;
```

Apply in the Supabase SQL Editor.

- [ ] **Step 2: Add failing test for the new RPC shape**

Append to `tests/security/phone-otp.test.ts`:

```ts
describe("getCreatorPhoneAction — new RPC shape", () => {
  it("returns reason when verified-but-stale", async () => {
    vi.resetModules();
    const requireUserMock2 = vi.fn(async () => ({ id: "passenger-1", email: "p@e" }));
    const auditMock2 = vi.fn(async () => {});
    const rpcMock = vi.fn(async () => ({
      data: [{ phone: null, reason: "stale" }],
      error: null,
    }));
    vi.doMock("@/lib/auth/require-user", () => ({ requireUser: requireUserMock2, getOptionalUser: vi.fn() }));
    vi.doMock("@/lib/audit", () => ({ logAuditEvent: auditMock2, getRequestContext: async () => ({ ip: null, userAgent: null }) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({ rpc: rpcMock } as unknown as SupabaseClient),
    }));

    const { getCreatorPhoneAction } = await import("@/app/actions/rides");
    const r = await getCreatorPhoneAction("00000000-0000-0000-0000-000000000001");
    expect(r).toEqual({ success: false, error: "Creator's phone is out of date — ask them to re-verify." });
  });

  it("returns success when verified-and-fresh", async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/require-user", () => ({
      requireUser: async () => ({ id: "passenger-1", email: "p@e" }),
      getOptionalUser: vi.fn(),
    }));
    vi.doMock("@/lib/audit", () => ({ logAuditEvent: vi.fn(), getRequestContext: async () => ({ ip: null, userAgent: null }) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        rpc: vi.fn(async () => ({ data: [{ phone: "+15005550006", reason: null }], error: null })),
      } as unknown as SupabaseClient),
    }));

    const { getCreatorPhoneAction } = await import("@/app/actions/rides");
    const r = await getCreatorPhoneAction("00000000-0000-0000-0000-000000000001");
    expect(r).toEqual({ success: true, data: { phone: "+15005550006" } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/security/phone-otp.test.ts -t "new RPC shape"`
Expected: FAIL — current action returns a generic "Creator phone not available" string and does not destructure the new array shape.

- [ ] **Step 4: Update `getCreatorPhoneAction`**

In `src/app/actions/rides.ts`, replace the body of `getCreatorPhoneAction` (lines 106-160) with:

```ts
export async function getCreatorPhoneAction(
  rideId: string,
): Promise<ActionResult<{ phone: string }>> {
  try {
    const user = await requireUser();
    const parsed = rideIdSchema.safeParse({ rideId });
    if (!parsed.success) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "failure",
        userId: user.id,
        detail: { reason: "invalid_ride_id" },
      });
      return { success: false, error: "Invalid ride" };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_ride_creator_phone", {
      p_ride_id: parsed.data.rideId,
    });

    if (error) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "failure",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason: "rpc_error", code: error.code ?? null },
      });
      return { success: false, error: "Access denied" };
    }

    const row = Array.isArray(data) ? data[0] : null;
    const phone = row?.phone ?? null;
    const reason = row?.reason ?? null;

    if (phone) {
      await logAuditEvent({
        action: "phone.access",
        outcome: "success",
        userId: user.id,
        resourceId: parsed.data.rideId,
        detail: { reason },
      });
      return { success: true, data: { phone: phone as string } };
    }

    await logAuditEvent({
      action: "phone.access",
      outcome: "failure",
      userId: user.id,
      resourceId: parsed.data.rideId,
      detail: { reason: reason ?? "no_phone" },
    });

    const msg =
      reason === "stale"
        ? "Creator's phone is out of date — ask them to re-verify."
        : reason === "unverified"
        ? "Creator has not verified their phone."
        : "Creator phone not available";
    return { success: false, error: msg };
  } catch {
    return { success: false, error: "Unauthorized" };
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/security/phone-otp.test.ts -t "new RPC shape"`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add SUPABASE_PHONE_VERIFICATION.sql src/app/actions/rides.ts tests/security/phone-otp.test.ts
git commit -m "feat(rpc): gate phone disclosure on verified+fresh, surface reason codes"
```

---

## Task 11: Auto-populate per-ride contact_phone from verified user record

**Files:**
- Modify: `src/lib/validation/schemas.ts:90-137`
- Modify: `src/app/actions/rides.ts`
- Test: `tests/security/phone-otp.test.ts` (extend)

- [ ] **Step 1: Remove `contactPhone` from ride schemas**

In `src/lib/validation/schemas.ts`, in `createRideSchema` remove the `contactPhone: phoneSchema,` line (line ~95). In `joinRideSchema` remove the same field (line ~136).

The resulting `createRideSchema` object should be:

```ts
export const createRideSchema = z
  .object({
    startingPoint: locationSchema,
    destination: locationSchema,
    totalSeats: z.number().int().min(2).max(5),
    vehicle: vehicleTypeSchema,
  })
  .refine(/* … unchanged BD bounds + distance refinements … */);

export const joinRideSchema = z.object({
  rideId: z.string().uuid(),
});
```

Leave `phoneSchema` exported (other call sites may still use it) — and leave `phoneE164Schema` from Task 6 alone.

- [ ] **Step 2: Add a helper that fetches the caller's verified phone**

Add to `src/lib/phone/server.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { FRESHNESS_WINDOW_MS } from "./constants";

export async function getCallerVerifiedPhone(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ encrypted: string | null; verifiedAt: Date | null; fresh: boolean }> {
  const { data, error } = await supabase
    .from("users")
    .select("phone_encrypted, phone_verified_at")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return { encrypted: null, verifiedAt: null, fresh: false };
  const verifiedAt = data.phone_verified_at ? new Date(data.phone_verified_at) : null;
  const fresh =
    verifiedAt !== null && Date.now() - verifiedAt.getTime() <= FRESHNESS_WINDOW_MS;
  return { encrypted: data.phone_encrypted ?? null, verifiedAt, fresh };
}
```

- [ ] **Step 3: Update `createRideAction` to omit per-ride contact_phone**

In `src/app/actions/rides.ts`, the `createRideAction` insert call currently writes `contact_phone: parsed.data.contactPhone`. Drop that field from BOTH `ride_requests.insert(...)` and the subsequent `ride_passengers.insert(...)`. The triggers on those columns are no-ops when the column is absent; the per-ride snapshot is no longer written.

Result (the relevant insert chunks):

```ts
const { data, error } = await supabase
  .from("ride_requests")
  .insert({
    creator_id: user.id,
    starting_point: parsed.data.startingPoint,
    destination: parsed.data.destination,
    seats_available: parsed.data.totalSeats - 1,
    total_seats: parsed.data.totalSeats,
    vehicle: parsed.data.vehicle,
    status: "open",
  })
  .select("id")
  .single();

// …

const { error: passengerError } = await supabase
  .from("ride_passengers")
  .insert({
    ride_id: data.id,
    user_id: user.id,
  });
```

Apply the same removal to the `joinRideAction` insert.

- [ ] **Step 4: Add Phase-2 gate (env-flagged)**

At the top of `createRideAction` (after `requireUser`) and `joinRideAction`, add:

```ts
import { getCallerVerifiedPhone } from "@/lib/phone/server";

// …inside the action, after requireUser/email check:
if (process.env.PHONE_VERIFICATION_REQUIRED === "true") {
  const supabase = await createClient();
  const v = await getCallerVerifiedPhone(supabase, user.id);
  if (!v.fresh) {
    return { success: false, error: "Verify your phone before creating a ride." };
  }
}
```

Hoist `supabase = await createClient()` so it's reused with the rest of the action body (don't call twice).

- [ ] **Step 5: Add tests for the Phase-2 gate**

Append to `tests/security/phone-otp.test.ts`:

```ts
describe("createRideAction phone gate (PHONE_VERIFICATION_REQUIRED)", () => {
  it("rejects when env=true and caller has no verified phone", async () => {
    vi.resetModules();
    process.env.PHONE_VERIFICATION_REQUIRED = "true";
    vi.doMock("@/lib/auth/require-user", () => ({
      requireUser: async () => ({ id: "user-1", email: "u@e", email_confirmed_at: "2026-01-01" }),
      getOptionalUser: vi.fn(),
    }));
    vi.doMock("@/lib/security/csrf", () => ({ validateCsrfToken: async () => true }));
    vi.doMock("@/lib/rate-limit/server", () => ({
      consumeRateLimit: async () => ({ allowed: true }),
      checkRateLimit: async () => true,
    }));
    vi.doMock("@/lib/audit", () => ({ logAuditEvent: vi.fn(), getRequestContext: async () => ({ ip: null, userAgent: null }) }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { phone_encrypted: null, phone_verified_at: null },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }));
    const { createRideAction } = await import("@/app/actions/rides");
    const r = await createRideAction({}, "tok");
    expect(r).toEqual({ success: false, error: "Verify your phone before creating a ride." });
    delete process.env.PHONE_VERIFICATION_REQUIRED;
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/security/phone-otp.test.ts -t "phone gate"`
Expected: PASS.

Run the full file: `npx vitest run tests/security/phone-otp.test.ts`
Expected: all phone tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/schemas.ts src/app/actions/rides.ts src/lib/phone/server.ts tests/security/phone-otp.test.ts
git commit -m "feat(rides): drop per-ride contact_phone input; add Phase-2 verify gate"
```

---

## Task 12: Profile page + verification card (server component shell)

**Files:**
- Create: `src/app/dashboard/profile/page.tsx`
- Create: `src/components/profile/PhoneVerificationCard.tsx`

- [ ] **Step 1: Server page that loads current verification status**

Create `src/app/dashboard/profile/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { PhoneVerificationCard } from "@/components/profile/PhoneVerificationCard";
import { readCsrfCookie } from "@/lib/security/csrf";
import { FRESHNESS_WINDOW_MS } from "@/lib/phone/constants";

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("phone_country_code, phone_verified_at")
    .eq("id", user.id)
    .maybeSingle();

  const verifiedAt = data?.phone_verified_at ?? null;
  const stale =
    verifiedAt !== null &&
    Date.now() - new Date(verifiedAt).getTime() > FRESHNESS_WINDOW_MS;

  const csrf = (await readCsrfCookie()) ?? "";

  return (
    <main className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Profile</h1>
      <PhoneVerificationCard
        verifiedAt={verifiedAt}
        countryCode={data?.phone_country_code ?? null}
        stale={stale}
        csrfToken={csrf}
      />
    </main>
  );
}
```

- [ ] **Step 2: Card component (client) wiring forms**

Create `src/components/profile/PhoneVerificationCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PhoneRequestForm } from "./PhoneRequestForm";
import { PhoneOtpForm } from "./PhoneOtpForm";
import { removePhoneAction } from "@/app/actions/phone";
import { toast } from "react-hot-toast";

type Props = {
  verifiedAt: string | null;
  countryCode: string | null;
  stale: boolean;
  csrfToken: string;
};

export function PhoneVerificationCard({ verifiedAt, countryCode, stale, csrfToken }: Props) {
  const [stage, setStage] = useState<"idle" | "code">(verifiedAt && !stale ? "idle" : "idle");

  return (
    <section className="rounded-2xl border p-5 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="font-medium">Phone verification</h2>
        {verifiedAt && !stale ? (
          <span className="text-sm text-green-700">Verified ({countryCode})</span>
        ) : verifiedAt && stale ? (
          <span className="text-sm text-amber-700">Verification stale — re-verify</span>
        ) : (
          <span className="text-sm text-gray-600">Not verified</span>
        )}
      </header>

      {stage === "idle" && (
        <PhoneRequestForm csrfToken={csrfToken} onSent={() => setStage("code")} />
      )}

      {stage === "code" && (
        <PhoneOtpForm
          csrfToken={csrfToken}
          onVerified={() => {
            toast.success("Phone verified");
            // Hard reload so server-rendered status updates.
            window.location.reload();
          }}
          onBack={() => setStage("idle")}
        />
      )}

      {verifiedAt && (
        <button
          type="button"
          className="text-sm text-red-600 underline"
          onClick={async () => {
            if (!confirm("Remove your verified phone? You won't be reachable on rides.")) return;
            const r = await removePhoneAction(csrfToken);
            if (r.success) {
              toast.success("Phone removed");
              window.location.reload();
            } else {
              toast.error(r.error);
            }
          }}
        >
          Remove phone
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: FAIL on missing `PhoneRequestForm`/`PhoneOtpForm` modules — fixed in Task 13.

- [ ] **Step 4: Commit (no PASS expected yet — Task 13 follows)**

Stage but don't commit yet. Or commit with the next task. Choose commit-with-next-task to keep the tree green.

---

## Task 13: PhoneRequestForm + PhoneOtpForm (client components)

**Files:**
- Create: `src/components/profile/PhoneRequestForm.tsx`
- Create: `src/components/profile/PhoneOtpForm.tsx`

- [ ] **Step 1: Implement the request form**

Create `src/components/profile/PhoneRequestForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { requestPhoneOtpAction } from "@/app/actions/phone";
import { toast } from "react-hot-toast";

const COUNTRIES = [
  { code: "BD", dial: "+880", label: "Bangladesh (+880)" },
  { code: "IN", dial: "+91", label: "India (+91)" },
  { code: "US", dial: "+1", label: "United States (+1)" },
  { code: "GB", dial: "+44", label: "United Kingdom (+44)" },
];

export function PhoneRequestForm({
  csrfToken,
  onSent,
}: {
  csrfToken: string;
  onSent: () => void;
}) {
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const digits = local.replace(/\D/g, "");
        if (digits.length < 6) {
          toast.error("Enter a valid phone number");
          return;
        }
        setBusy(true);
        const r = await requestPhoneOtpAction(
          { phone: `${country.dial}${digits}`, countryCode: country.code },
          csrfToken,
        );
        setBusy(false);
        if (r.success) {
          toast.success("Code sent");
          onSent();
        } else {
          toast.error(r.error);
        }
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        Country
        <select
          className="block mt-1 w-full rounded border-gray-300"
          value={country.code}
          onChange={(e) => setCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? COUNTRIES[0])}
          disabled={busy}
        >
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Phone number
        <div className="mt-1 flex">
          <span className="inline-flex items-center px-3 rounded-l border border-r-0 bg-gray-50 text-gray-700">
            {country.dial}
          </span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            className="flex-1 rounded-r border-gray-300"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            disabled={busy}
            placeholder="1711000000"
          />
        </div>
      </label>
      <button
        type="submit"
        disabled={busy}
        className="px-4 py-2 rounded bg-accent-600 text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send code"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Implement the OTP form**

Create `src/components/profile/PhoneOtpForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { verifyPhoneOtpAction } from "@/app/actions/phone";
import { toast } from "react-hot-toast";

export function PhoneOtpForm({
  csrfToken,
  onVerified,
  onBack,
}: {
  csrfToken: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(code)) {
          toast.error("Enter the 6-digit code");
          return;
        }
        setBusy(true);
        const r = await verifyPhoneOtpAction({ code }, csrfToken);
        setBusy(false);
        if (r.success) onVerified();
        else toast.error(r.error);
      }}
      className="space-y-3"
    >
      <label className="block text-sm">
        6-digit code
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          pattern="\d{6}"
          className="block mt-1 w-40 tracking-widest text-lg rounded border-gray-300"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          disabled={busy}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-4 py-2 rounded bg-accent-600 text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Verify"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="px-4 py-2 rounded border"
        >
          Back
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run dev server and walk the flow**

Run: `npm run dev`
Navigate to `/dashboard/profile`. Confirm: status displays, sending a code with a Twilio test number works locally if env is set (otherwise the action returns an error toast — acceptable for this step). Cancel the server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/profile/page.tsx src/components/profile
git commit -m "feat(profile): add phone verification UI (card + request + OTP forms)"
```

---

## Task 14: Unverified-phone banner on ride forms

**Files:**
- Modify: ride create / join form components
- Create: `src/components/profile/UnverifiedPhoneBanner.tsx`

- [ ] **Step 1: Locate the ride forms**

Run: `npx grep -rn "createRideSchema\\|joinRideSchema\\|createRideAction\\|joinRideAction" src/components src/app | grep -v test`
Note the file path(s) for the Create Ride and Join Ride forms (likely `src/components/rides/CreateRideForm.tsx`, `JoinRideForm.tsx`, or `src/app/create-ride/page.tsx`).

- [ ] **Step 2: Add the banner component**

Create `src/components/profile/UnverifiedPhoneBanner.tsx`:

```tsx
"use client";

import Link from "next/link";

export function UnverifiedPhoneBanner({ stale = false }: { stale?: boolean }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        {stale ? "Your phone verification is out of date." : "Your phone is not verified."}
      </p>
      <p className="text-amber-800 mt-1">
        Other riders won&apos;t be able to call you until you verify.{" "}
        <Link href="/dashboard/profile" className="underline">
          Verify now
        </Link>
        .
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Show the banner above the ride form when caller is unverified**

In the ride form's containing server component (the page or layout that wraps the form), add:

```tsx
import { requireUser } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { FRESHNESS_WINDOW_MS } from "@/lib/phone/constants";
import { UnverifiedPhoneBanner } from "@/components/profile/UnverifiedPhoneBanner";

// inside the server component:
const user = await requireUser();
const supabase = await createClient();
const { data } = await supabase
  .from("users")
  .select("phone_verified_at")
  .eq("id", user.id)
  .maybeSingle();

const verifiedAt = data?.phone_verified_at ?? null;
const stale = verifiedAt !== null && Date.now() - new Date(verifiedAt).getTime() > FRESHNESS_WINDOW_MS;
const showBanner = verifiedAt === null || stale;

return (
  <>
    {showBanner && <UnverifiedPhoneBanner stale={stale && verifiedAt !== null} />}
    {/* existing form here */}
  </>
);
```

- [ ] **Step 4: Manually verify in dev**

Run: `npm run dev`. Visit `/create-ride` (or the join flow) signed in as a user without a verified phone. Confirm the banner shows and links to `/dashboard/profile`. Sign in as a verified user — banner should disappear.

- [ ] **Step 5: Commit**

```bash
git add src/components/profile/UnverifiedPhoneBanner.tsx <modified ride form file(s)>
git commit -m "feat(rides): show unverified-phone banner on create/join forms"
```

---

## Task 15: Update FloatingCallButton to surface reason codes

**Files:**
- Modify: `src/components/layout/FloatingCallButton.tsx:250-268`

- [ ] **Step 1: Replace `fetchCreatorPhone` failure handling**

In `src/components/layout/FloatingCallButton.tsx`, the existing `fetchCreatorPhone` swallows the action's error message. Update the button's render path so when the action fails, the user sees a meaningful toast and the button is hidden.

Find:

```ts
const fetchCreatorPhone = async (targetRideId: string) => {
  try {
    addDebugInfo(`Fetching creator phone via server action for ride ${targetRideId}`);
    const result = await getCreatorPhoneAction(targetRideId);
    if (!result.success) {
      addDebugInfo(`Server denied phone: ${result.error}`);
      return null;
    }
    addDebugInfo(`Found creator phone via server`);
    return result.data?.phone ?? null;
  } catch (err) {
    addDebugInfo(`Exception fetching creator phone: ${err}`);
    return null;
  }
};
```

Replace with:

```ts
const [lastError, setLastError] = useState<string | null>(null);

const fetchCreatorPhone = async (targetRideId: string) => {
  try {
    const result = await getCreatorPhoneAction(targetRideId);
    if (!result.success) {
      setLastError(result.error);
      addDebugInfo(`Server denied phone: ${result.error}`);
      return null;
    }
    setLastError(null);
    return result.data?.phone ?? null;
  } catch (err) {
    addDebugInfo(`Exception fetching creator phone: ${err}`);
    return null;
  }
};
```

And update `handleCallCreator` to fall back to the error toast when no phone:

```ts
const handleCallCreator = () => {
  if (creatorPhone) {
    window.location.href = `tel:${creatorPhone}`;
    return;
  }
  toast.error(lastError ?? "Creator's phone number is not available");
};
```

(Imports already include `toast`.)

- [ ] **Step 2: Typecheck and dev-test**

Run: `npm run typecheck` → PASS.
Run dev server, simulate an unverified creator (manually clear their `phone_verified_at` in Supabase): tapping Call Creator should toast "Creator has not verified their phone."

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/FloatingCallButton.tsx
git commit -m "feat(call-button): surface RPC reason codes in toast"
```

---

## Task 16: Environment + documentation

**Files:**
- Modify: `.env.example`
- Modify: `SECURITY.md` (add phone OTP section)

- [ ] **Step 1: Add Twilio + phone env vars to `.env.example`**

Append to `.env.example`:

```bash
# Twilio Verify (https://console.twilio.com/us1/develop/verify/services)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=

# HMAC pepper for users.phone_hash. 32+ chars. Generate with `openssl rand -base64 48`.
PHONE_HASH_PEPPER=

# How many days a verified phone remains "fresh" before re-verification is required.
PHONE_VERIFICATION_FRESHNESS_DAYS=180

# Phase 2: when "true", ride create/join requires a verified-and-fresh phone.
PHONE_VERIFICATION_REQUIRED=false
```

- [ ] **Step 2: Document in SECURITY.md**

Add this section under the existing phone-encryption notes:

```md
### Phone OTP verification

Phone numbers are verified via Twilio Verify before being eligible for
disclosure to ride co-participants. Verification state lives on
`public.users.phone_verified_at`; the disclosure RPC
`public.get_ride_creator_phone` returns NULL with a `reason` code
(`unverified` | `stale` | `missing`) when verification is missing or
older than `PHONE_VERIFICATION_FRESHNESS_DAYS` (default 180).

OTP session state lives in Upstash Redis under key `otpv:<user_id>`
with a 10-minute TTL. The Twilio Verify SID is the only server-side
handle; codes themselves never leave Twilio.

See `docs/superpowers/specs/2026-05-23-phone-otp-verification-design.md`
for the full design.
```

- [ ] **Step 3: Commit**

```bash
git add .env.example SECURITY.md
git commit -m "docs(phone): document Twilio + verification env vars"
```

---

## Task 17: End-to-end smoke test

**Files:**
- No code changes — verification only

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: both PASS.

- [ ] **Step 3: Run dev server and walk the user flow**

Run: `npm run dev`.

In Supabase SQL editor (one-off):
- Confirm `users.phone_encrypted` column exists.
- Confirm `phone_hash_pepper` env is set.
- Confirm Twilio test credentials in `.env.local`.

In the browser:
1. Sign in as a user with no verified phone.
2. Visit `/dashboard/profile`. Status reads "Not verified".
3. Submit `+1 5005550006` (Twilio magic test number). Toast: "Code sent."
4. Enter code `123456`. Toast: "Phone verified." Page reloads, status now "Verified (US)".
5. Visit `/create-ride` — banner gone.
6. With another account, join one of this user's rides; tap Call Creator. Confirm phone modal/tel link.
7. From the SQL editor: `UPDATE public.users SET phone_verified_at = NULL WHERE id = '<creator>'`. Re-tap Call Creator on the other account. Toast: "Creator has not verified their phone."
8. Restore the verification via the profile UI (or in SQL). Confirm phone flows again.

- [ ] **Step 4: Final commit if any tweaks were needed**

```bash
git status                       # verify clean
# no commit unless flow uncovered issues
```

---

## Self-Review

Run through the checklist against the spec:

1. **Spec coverage:**
   - Twilio Verify provider — Task 3.
   - User-level schema migration (`phone`, `phone_encrypted`, `phone_country_code`, `phone_hash`, `phone_verified_at`) — Task 1.
   - `requestPhoneOtpAction` / `verifyPhoneOtpAction` / `removePhoneAction` — Tasks 7, 8, 9.
   - Redis state store — Task 4.
   - Rate-limit table (per-user send, per-phone send, per-user verify, per-user remove) — encoded in constants.ts (Task 2) and applied in Tasks 7/8/9.
   - Disclosure RPC update (verified+fresh gate, `reason` column, fallback to per-ride snapshot) — Task 10.
   - `getCreatorPhoneAction` updated for new RPC shape — Task 10.
   - Per-ride contact_phone removed from schemas, auto-populated... — actually we now skip writing it entirely (relies on user-level phone). Updated Task 11.
   - Phase 1 / Phase 2 rollout — Task 11 implements both. Phase 1 = `PHONE_VERIFICATION_REQUIRED=false` (default); Phase 2 = flip env var.
   - Phone reassignment (revoke prior owner) — `verify_user_phone` RPC in Task 8.
   - Audit actions added — Task 5.
   - Profile UI — Tasks 12-13.
   - Unverified banner on ride forms — Task 14.
   - Call button reason surfacing — Task 15.
   - Env vars + docs — Task 16.
   - E2E smoke — Task 17.
   - Tests for: validator, hasher, mask (Task 2); twilio wrapper (Task 3); state store (Task 4); each action (Tasks 7-9); new RPC shape (Task 10); Phase-2 gate (Task 11). Spec also calls for a security test that stale verification returns `reason='stale'` — covered by Task 10's first new test.

2. **Placeholder scan:** No TBDs, no "implement later", no "add appropriate error handling." Each step has the actual code or command. The single Task 14 path discovery uses a real grep command and the engineer is expected to wire the banner into whichever file the grep returns — this is honest decomposition, not a placeholder.

3. **Type consistency:**
   - `PhoneVerifyState` defined in Task 4 used in Tasks 7/8.
   - `verify_user_phone` RPC arg names (`p_phone`, `p_country_code`, `p_phone_hash`) match exactly between Task 8 SQL and Task 8 action call.
   - `getCreatorPhoneAction` returns `{ phone: string }` on success in Task 10; matches the existing call sites (`FloatingCallButton`).
   - `consumeRateLimit` returns `{ allowed }` — matches signature in `src/lib/rate-limit/server.ts`.
   - `requestPhoneOtpAction`/`verifyPhoneOtpAction`/`removePhoneAction` signatures consistent across tests, action body, and UI callers.
