# Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-service password reset flow using Supabase's native recovery primitives, exposed via two server actions and two pages.

**Architecture:** `requestPasswordResetAction` calls `supabase.auth.resetPasswordForEmail` and returns `{ success: true }` unconditionally (enumeration resistance). Supabase emails a magic link to `/auth/callback?next=/reset-password`. The existing callback route exchanges the code for a recovery session; user lands on `/reset-password` and submits a new password through `confirmPasswordResetAction`, which calls `supabase.auth.updateUser({ password })` and revokes other sessions.

**Tech Stack:** Next.js 16 App Router, `@supabase/ssr`, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-23-password-reset-design.md`

---

## File Structure

**Create:**
- `src/components/auth/ForgotPasswordForm.tsx` — email entry form
- `src/components/auth/ResetPasswordForm.tsx` — new-password form
- `src/app/forgot-password/page.tsx` — page hosting `ForgotPasswordForm`
- `src/app/reset-password/page.tsx` — page hosting `ResetPasswordForm`
- `tests/security/password-reset.test.ts` — integration + enumeration-resistance tests

**Modify:**
- `src/lib/audit.ts` — extend `AuditAction` union
- `src/app/actions/auth.ts` — add two new server actions
- `src/components/auth/LoginForm.tsx` — add "Forgot password?" link
- `tests/helpers/supabase-mock.ts` — extend mock with `resetPasswordForEmail` + `updateUser`

---

## Task 1: Extend audit + Supabase mock

**Files:**
- Modify: `src/lib/audit.ts`
- Modify: `tests/helpers/supabase-mock.ts`

- [ ] **Step 1: Extend `AuditAction` union**

Edit `src/lib/audit.ts`, replace the union:

```ts
export type AuditAction =
  | "auth.signin"
  | "auth.signin.oauth"
  | "auth.signup"
  | "auth.signout"
  | "auth.callback"
  | "auth.reset.request"
  | "auth.reset.confirm"
  | "auth.reset.rate_limited"
  | "ride.create"
  | "ride.join"
  | "ride.cancel"
  | "ride.complete"
  | "phone.access"
  | "user.data.export"
  | "user.account.delete";
```

- [ ] **Step 2: Extend Supabase mock**

Edit `tests/helpers/supabase-mock.ts`, change the `auth` block to:

```ts
auth: {
  getUser: vi.fn(async () => ({
    data: { user: opts.user ?? null },
    error: opts.authError ?? null,
  })),
  signOut: vi.fn(async () => ({ error: null })),
  signInWithPassword: vi.fn(async () => ({
    data: { user: opts.user ?? null },
    error: opts.authError ?? null,
  })),
  resetPasswordForEmail: vi.fn(async () => ({
    data: {},
    error: opts.authError ?? null,
  })),
  updateUser: vi.fn(async () => ({
    data: { user: opts.user ?? null },
    error: opts.authError ?? null,
  })),
},
```

- [ ] **Step 3: Run existing test suite to confirm no regression**

Run: `npm run test`
Expected: PASS (all existing tests still green).

- [ ] **Step 4: Commit**

```bash
git add src/lib/audit.ts tests/helpers/supabase-mock.ts
git commit -m "chore(auth): extend audit + mock for password reset"
```

---

## Task 2: `requestPasswordResetAction` — failing test

**Files:**
- Create: `tests/security/password-reset.test.ts`

- [ ] **Step 1: Write failing test file**

Create `tests/security/password-reset.test.ts`:

```ts
/**
 * Password reset flow tests.
 * Run: npm run test:security
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSupabaseMock } from "../helpers/supabase-mock";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
  logDataAccess: vi.fn(),
}));
vi.mock("@/lib/rate-limit/server", () => ({
  checkRateLimit: vi.fn(async () => true),
}));
vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) =>
      name === "x-forwarded-for" ? "203.0.113.7" : null,
  }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`__redirect:${path}`);
  }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const { createClient } = await import("@/lib/supabase/server");
const { checkRateLimit } = await import("@/lib/rate-limit/server");
const { logAuditEvent } = await import("@/lib/audit");
const mockedCreateClient = vi.mocked(createClient);
const mockedRateLimit = vi.mocked(checkRateLimit);
const mockedAudit = vi.mocked(logAuditEvent);

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

describe("requestPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRateLimit.mockResolvedValue(true);
  });

  it("returns success and calls resetPasswordForEmail with a valid email", async () => {
    const supa = buildSupabaseMock({});
    mockedCreateClient.mockResolvedValue(supa as never);

    const { requestPasswordResetAction } = await import("@/app/actions/auth");
    const result = await requestPasswordResetAction(
      null,
      fd({ email: "user@example.com" }),
    );

    expect(result).toEqual({ success: true });
    expect(supa.auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "user@example.com",
      expect.objectContaining({
        redirectTo: expect.stringContaining("/auth/callback?next=/reset-password"),
      }),
    );
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.reset.request",
        outcome: "success",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npx vitest run tests/security/password-reset.test.ts`
Expected: FAIL — `requestPasswordResetAction` is not exported from `@/app/actions/auth`.

---

## Task 3: `requestPasswordResetAction` — implementation

**Files:**
- Modify: `src/app/actions/auth.ts`

- [ ] **Step 1: Add import for `emailSchema`**

In `src/app/actions/auth.ts`, change the validation import to include `emailSchema`:

```ts
import {
  signInSchema,
  signUpSchema,
  emailSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
```

- [ ] **Step 2: Add helper for email hashing (used in rate-limit + audit detail)**

Add this near the top of `src/app/actions/auth.ts`, after the existing helpers:

```ts
async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
```

- [ ] **Step 3: Add `requestPasswordResetAction`**

Append to `src/app/actions/auth.ts`:

```ts
export async function requestPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.reset.request",
      outcome: "failure",
      detail: { reason: "invalid_input" },
    });
    return { success: true };
  }

  const email = parsed.data.toLowerCase();
  const emailHash = await sha256Hex(email);
  const ip = await getClientIp();

  const ipOk = await checkRateLimit(`reset:req:ip:${ip}`, 3, 60 * 60 * 1000);
  const emailOk = await checkRateLimit(
    `reset:req:email:${emailHash}`,
    3,
    24 * 60 * 60 * 1000,
  );

  if (!ipOk || !emailOk) {
    await logAuditEvent({
      action: "auth.reset.rate_limited",
      outcome: "failure",
      detail: { reason: "rate_limited", emailHash },
    });
    return { success: true };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  await logAuditEvent({
    action: "auth.reset.request",
    outcome: error ? "failure" : "success",
    detail: error
      ? { reason: "supabase_error", emailHash }
      : { emailHash },
  });

  return { success: true };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `npx vitest run tests/security/password-reset.test.ts`
Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/auth.ts tests/security/password-reset.test.ts
git commit -m "feat(auth): add requestPasswordResetAction"
```

---

## Task 4: Enumeration resistance + rate-limit tests

**Files:**
- Modify: `tests/security/password-reset.test.ts`

- [ ] **Step 1: Append enumeration test**

Add to `tests/security/password-reset.test.ts`, inside the `requestPasswordResetAction` describe block:

```ts
it("returns identical result whether email exists or not", async () => {
  const supaExists = buildSupabaseMock({});
  const supaMissing = buildSupabaseMock({});
  mockedCreateClient
    .mockResolvedValueOnce(supaExists as never)
    .mockResolvedValueOnce(supaMissing as never);

  const { requestPasswordResetAction } = await import("@/app/actions/auth");
  const r1 = await requestPasswordResetAction(
    null,
    fd({ email: "real@example.com" }),
  );
  const r2 = await requestPasswordResetAction(
    null,
    fd({ email: "fake@example.com" }),
  );

  expect(r1).toEqual(r2);
  expect(r1).toEqual({ success: true });
});

it("returns success without calling Supabase when rate limit exceeded", async () => {
  mockedRateLimit.mockResolvedValueOnce(false);
  const supa = buildSupabaseMock({});
  mockedCreateClient.mockResolvedValue(supa as never);

  const { requestPasswordResetAction } = await import("@/app/actions/auth");
  const result = await requestPasswordResetAction(
    null,
    fd({ email: "user@example.com" }),
  );

  expect(result).toEqual({ success: true });
  expect(supa.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  expect(mockedAudit).toHaveBeenCalledWith(
    expect.objectContaining({ action: "auth.reset.rate_limited" }),
  );
});

it("returns success even when email shape is invalid (no enumeration via 4xx)", async () => {
  const supa = buildSupabaseMock({});
  mockedCreateClient.mockResolvedValue(supa as never);

  const { requestPasswordResetAction } = await import("@/app/actions/auth");
  const result = await requestPasswordResetAction(
    null,
    fd({ email: "not-an-email" }),
  );

  expect(result).toEqual({ success: true });
  expect(supa.auth.resetPasswordForEmail).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests, expect all passing**

Run: `npx vitest run tests/security/password-reset.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 3: Commit**

```bash
git add tests/security/password-reset.test.ts
git commit -m "test(auth): enumeration + rate-limit coverage for reset"
```

---

## Task 5: `confirmPasswordResetAction` — failing tests

**Files:**
- Modify: `tests/security/password-reset.test.ts`

- [ ] **Step 1: Append confirm-action describe block**

Add to `tests/security/password-reset.test.ts` (outside the existing describe, at file end):

```ts
describe("confirmPasswordResetAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedRateLimit.mockResolvedValue(true);
  });

  const FAKE_USER = {
    id: "22222222-2222-2222-2222-222222222222",
    email: "user@example.com",
  };

  it("updates password and signs out other sessions on success", async () => {
    const supa = buildSupabaseMock({ user: FAKE_USER });
    mockedCreateClient.mockResolvedValue(supa as never);

    const { confirmPasswordResetAction } = await import("@/app/actions/auth");
    await expect(
      confirmPasswordResetAction(null, fd({ password: "newP@ssw0rd!" })),
    ).rejects.toThrow("__redirect:/login?reset=ok");

    expect(supa.auth.updateUser).toHaveBeenCalledWith({
      password: "newP@ssw0rd!",
    });
    expect(supa.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.reset.confirm",
        outcome: "success",
        userId: FAKE_USER.id,
      }),
    );
  });

  it("returns generic error when no recovery session", async () => {
    const supa = buildSupabaseMock({ user: null });
    mockedCreateClient.mockResolvedValue(supa as never);

    const { confirmPasswordResetAction } = await import("@/app/actions/auth");
    const result = await confirmPasswordResetAction(
      null,
      fd({ password: "newP@ssw0rd!" }),
    );

    expect(result).toEqual({
      success: false,
      error: "Reset link expired. Request a new one.",
    });
    expect(supa.auth.updateUser).not.toHaveBeenCalled();
  });

  it("returns generic error when password fails validation", async () => {
    const supa = buildSupabaseMock({ user: FAKE_USER });
    mockedCreateClient.mockResolvedValue(supa as never);

    const { confirmPasswordResetAction } = await import("@/app/actions/auth");
    const result = await confirmPasswordResetAction(
      null,
      fd({ password: "short" }),
    );

    expect(result).toEqual({
      success: false,
      error: "Password must be at least 8 characters.",
    });
    expect(supa.auth.updateUser).not.toHaveBeenCalled();
  });

  it("returns rate-limited error after too many confirm attempts", async () => {
    mockedRateLimit.mockResolvedValueOnce(false);
    const supa = buildSupabaseMock({ user: FAKE_USER });
    mockedCreateClient.mockResolvedValue(supa as never);

    const { confirmPasswordResetAction } = await import("@/app/actions/auth");
    const result = await confirmPasswordResetAction(
      null,
      fd({ password: "newP@ssw0rd!" }),
    );

    expect(result).toEqual({
      success: false,
      error: "Too many attempts. Try again later.",
    });
    expect(supa.auth.updateUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, expect failures**

Run: `npx vitest run tests/security/password-reset.test.ts`
Expected: 4 new tests FAIL — `confirmPasswordResetAction` is not exported.

---

## Task 6: `confirmPasswordResetAction` — implementation

**Files:**
- Modify: `src/app/actions/auth.ts`

- [ ] **Step 1: Add the action**

Append to `src/app/actions/auth.ts`:

```ts
const resetPasswordSchema = signUpSchema.shape.password;

export async function confirmPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      detail: { reason: "no_session" },
    });
    return {
      success: false,
      error: "Reset link expired. Request a new one.",
    };
  }

  const parsed = resetPasswordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "invalid_input" },
    });
    return {
      success: false,
      error: "Password must be at least 8 characters.",
    };
  }

  const limitKey = `reset:confirm:user:${user.id}`;
  if (!(await checkRateLimit(limitKey, 5, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return {
      success: false,
      error: "Too many attempts. Try again later.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "update_failed" },
    });
    return {
      success: false,
      error: "Could not update password. Please request a new reset link.",
    };
  }

  await supabase.auth.signOut({ scope: "others" });

  await logAuditEvent({
    action: "auth.reset.confirm",
    outcome: "success",
    userId: user.id,
    resourceId: user.id,
  });

  revalidatePath("/", "layout");
  redirect("/login?reset=ok");
}
```

- [ ] **Step 2: Run tests, expect all passing**

Run: `npx vitest run tests/security/password-reset.test.ts`
Expected: PASS — 8 tests passing total.

- [ ] **Step 3: Run full test suite for regression**

Run: `npm run test`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/auth.ts tests/security/password-reset.test.ts
git commit -m "feat(auth): add confirmPasswordResetAction"
```

---

## Task 7: `ForgotPasswordForm` client component

**Files:**
- Create: `src/components/auth/ForgotPasswordForm.tsx`

- [ ] **Step 1: Create component**

Create `src/components/auth/ForgotPasswordForm.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { requestPasswordResetAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-large rounded-3xl px-6 sm:px-8 pt-8 pb-8 border border-gray-100">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2 text-center text-gray-900">
          Forgot your password?
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Enter your email and we&apos;ll send a reset link.
        </p>

        {state?.success && (
          <p
            className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3 mb-4"
            role="status"
          >
            If an account exists for that address, we&apos;ve sent a reset
            link. Check your inbox.
          </p>
        )}

        <form action={formAction} className="space-y-5">
          <div>
            <label
              className="block text-gray-700 text-sm font-semibold mb-2"
              htmlFor="email"
            >
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full py-3.5 pl-12 pr-4 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Send className="h-5 w-5" />
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-gray-600">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-semibold text-accent-600 hover:text-accent-500"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/auth/ForgotPasswordForm.tsx
git commit -m "feat(auth): add ForgotPasswordForm component"
```

---

## Task 8: `ResetPasswordForm` client component

**Files:**
- Create: `src/components/auth/ResetPasswordForm.tsx`

- [ ] **Step 1: Create component**

Create `src/components/auth/ResetPasswordForm.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { Lock, Eye, EyeOff, Check } from "lucide-react";
import { confirmPasswordResetAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    confirmPasswordResetAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-large rounded-3xl px-6 sm:px-8 pt-8 pb-8 border border-gray-100">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2 text-center text-gray-900">
          Set a new password
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Must be at least 8 characters.
        </p>

        <form action={formAction} className="space-y-5">
          {state && !state.success && (
            <p
              className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
              role="alert"
            >
              {state.error}
            </p>
          )}

          <div>
            <label
              className="block text-gray-700 text-sm font-semibold mb-2"
              htmlFor="password"
            >
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
                className="w-full py-3.5 pl-12 pr-12 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Check className="h-5 w-5" />
            {pending ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/auth/ResetPasswordForm.tsx
git commit -m "feat(auth): add ResetPasswordForm component"
```

---

## Task 9: Pages

**Files:**
- Create: `src/app/forgot-password/page.tsx`
- Create: `src/app/reset-password/page.tsx`

- [ ] **Step 1: Create forgot-password page**

Create `src/app/forgot-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <ForgotPasswordForm />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 2: Create reset-password page**

Create `src/app/reset-password/page.tsx`:

```tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { getOptionalUser } from "@/lib/auth/require-user";

export const metadata: Metadata = {
  title: "Reset password",
};

export default async function ResetPasswordPage() {
  const user = await getOptionalUser();
  if (!user) {
    redirect("/forgot-password?expired=1");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <ResetPasswordForm />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/forgot-password/page.tsx src/app/reset-password/page.tsx
git commit -m "feat(auth): add forgot-password and reset-password pages"
```

---

## Task 10: Wire "Forgot password?" into LoginForm

**Files:**
- Modify: `src/components/auth/LoginForm.tsx`

- [ ] **Step 1: Add forgot-password link under the password field**

In `src/components/auth/LoginForm.tsx`, locate the closing `</div>` of the password field block (after the show/hide button's wrapper, around the `<div>` containing `<Lock ... />`). Replace the password-field block with:

```tsx
          <div>
            <div className="flex items-center justify-between mb-2">
              <label
                className="block text-gray-700 text-sm font-semibold"
                htmlFor="password"
              >
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs font-semibold text-accent-600 hover:text-accent-500"
              >
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                className="w-full py-3.5 pl-12 pr-12 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
```

- [ ] **Step 2: Show success banner after `/login?reset=ok` redirect**

In the same file, accept and use a `searchParams`-driven prop. Change the component signature to accept `reset?: boolean`:

```tsx
export default function LoginForm({
  nextPath,
  reset,
}: {
  nextPath?: string;
  reset?: boolean;
}) {
```

Then, immediately before the existing `<form action={formAction}` block, render:

```tsx
{reset && (
  <p
    className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3 mb-5"
    role="status"
  >
    Password updated. Sign in with your new password.
  </p>
)}
```

- [ ] **Step 3: Pass the prop through from the login page**

Edit `src/app/login/page.tsx`:

```tsx
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reset?: string }>;
}) {
  const { next, reset } = await searchParams;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <LoginForm nextPath={next} reset={reset === "ok"} />
      </main>
      <Footer />
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/LoginForm.tsx src/app/login/page.tsx
git commit -m "feat(auth): link forgot-password from login + reset success banner"
```

---

## Task 11: Full verification

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no warnings.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: PASS.

- [ ] **Step 4: Run security test suite**

Run: `npm run test:security`
Expected: PASS including new password-reset tests.

- [ ] **Step 5: Manual smoke (dev server)**

Run: `npm run dev`

1. Visit `/login`. Click "Forgot password?". URL becomes `/forgot-password`.
2. Submit a registered email. Expect success banner: "If an account exists…".
3. Submit again immediately three more times. Fourth submission still returns success banner (rate-limited silently). Check server logs for `auth.reset.rate_limited` audit.
4. Submit an unregistered email. Expect identical success banner.
5. Submit `not-an-email`. Expect identical success banner (no validation error surfaced).
6. From the email link, land on `/reset-password`. Enter a new 8+ char password. Expect redirect to `/login?reset=ok` with "Password updated" banner.
7. Visit `/reset-password` directly without a recovery session. Expect redirect to `/forgot-password?expired=1`.

- [ ] **Step 6: Verify Supabase project config**

Confirm in Supabase dashboard:
- Auth → URL Configuration → Redirect URLs allowlist includes `${NEXT_PUBLIC_SITE_URL}/auth/callback`.
- Auth → Email Templates → "Reset Password" is enabled.
- Auth → SMTP Settings → custom SMTP configured (for prod; shared sender OK for dev).

If any are missing, set them before deploying.

- [ ] **Step 7: Final commit (if anything tweaked during verification)**

```bash
git status
# if dirty:
git add -p
git commit -m "fix(auth): address verification findings"
```

---

## Self-Review Notes

**Spec coverage check:**
- `requestPasswordResetAction` — Task 3 ✓
- `confirmPasswordResetAction` — Task 6 ✓
- Enumeration resistance — Task 4 ✓
- Rate limits (3 keys) — Tasks 3 + 6 ✓
- Audit extensions — Task 1 ✓
- Callback route change — none needed; existing `safeNext` already accepts `/reset-password` (verified in spec Background)
- Pages — Task 9 ✓
- Login link + success banner — Task 10 ✓
- Tests (integration + enumeration + security) — Tasks 2/4/5 ✓
- Manual staging verification — Task 11 ✓

**Type consistency:** `ActionResult`, `requestPasswordResetAction`, `confirmPasswordResetAction`, `resetPasswordSchema` all consistent across tasks. `getOptionalUser` reused from `src/lib/auth/require-user.ts`. `sha256Hex` helper used in `requestPasswordResetAction` only.

**Out-of-scope items kept out:** No `reset_tokens` table, no API routes, no SMTP code (Supabase-configured), no CSRF wrapping (existing actions in this file don't wrap; matching the established pattern).
