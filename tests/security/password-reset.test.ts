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
});

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
