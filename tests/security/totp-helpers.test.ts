/**
 * Helpers in src/lib/totp.ts and src/lib/auth/require-fresh-totp.ts.
 *
 * Covers: secret generation entropy/format, otpauth URI shape, recovery code
 * format + hash stability, and the requireFreshTotp gate's pass/fail branches.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

beforeAll(() => {
  process.env.TOTP_COOKIE_SECRET = "test-totp-cookie-secret-32-bytes-min!";
});

const totp = await import("@/lib/totp");
const cookies = await import("@/lib/auth/totp-cookies.server");

describe("generateTotpSecret", () => {
  it("returns a 40-char hex and a 32-char base32 (20 bytes)", () => {
    const { secretHex, secretBase32 } = totp.generateTotpSecret();
    expect(secretHex).toMatch(/^[0-9a-f]{40}$/);
    // RFC 4648 base32 of 20 bytes = 32 chars
    expect(secretBase32).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("produces distinct secrets across calls", () => {
    const a = totp.generateTotpSecret();
    const b = totp.generateTotpSecret();
    expect(a.secretHex).not.toBe(b.secretHex);
  });
});

describe("buildOtpauthUri", () => {
  it("builds a Sohojatra-issued otpauth URI carrying the secret", () => {
    const { secretBase32 } = totp.generateTotpSecret();
    const uri = totp.buildOtpauthUri({
      secretBase32,
      accountLabel: "ivan@example.com",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain(`secret=${secretBase32}`);
    expect(uri).toContain("issuer=Sohojatra");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});

describe("generateRecoveryCodes", () => {
  it("produces 10 distinct 8-char codes using the no-ambiguity alphabet", () => {
    const codes = totp.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    }
    expect(new Set(codes).size).toBe(10);
  });
});

describe("hashRecoveryCode", () => {
  it("is stable and normalises case + whitespace", () => {
    const a = totp.hashRecoveryCode("ab12cd34");
    const b = totp.hashRecoveryCode(" AB12CD34 ");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("formatRecoveryCodeForDisplay", () => {
  it("groups 8-char code as XXXX-XXXX", () => {
    expect(totp.formatRecoveryCodeForDisplay("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});

// requireFreshTotp depends on next/headers cookies() which we mock.
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

describe("requireFreshTotp", () => {
  const baseUser = (extra: Partial<User> = {}): User =>
    ({
      id: "user-1",
      aud: "authenticated",
      role: "authenticated",
      email: "ivan@example.com",
      app_metadata: { totp_enabled: true },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      ...extra,
    }) as User;

  async function setCookie(value: string | undefined) {
    const headers = await import("next/headers");
    (headers.cookies as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      get: (name: string) =>
        name === cookies.TOTP_STEPUP_COOKIE && value !== undefined
          ? { value }
          : undefined,
    });
  }

  it("passes through users without 2FA enabled", async () => {
    const { requireFreshTotp } = await import("@/lib/auth/require-fresh-totp");
    await setCookie(undefined);
    const user = baseUser({ app_metadata: { totp_enabled: false } });
    expect(await requireFreshTotp(user)).toEqual({ ok: true });
  });

  it("requires stepup when 2FA enabled and cookie missing", async () => {
    const { requireFreshTotp } = await import("@/lib/auth/require-fresh-totp");
    await setCookie(undefined);
    expect(await requireFreshTotp(baseUser())).toEqual({
      ok: false,
      reason: "stepup_required",
    });
  });

  it("accepts a valid stepup cookie", async () => {
    const { requireFreshTotp } = await import("@/lib/auth/require-fresh-totp");
    const c = await cookies.buildTotpStepupCookie("user-1");
    await setCookie(c.value);
    expect(await requireFreshTotp(baseUser())).toEqual({ ok: true });
  });

  it("rejects a stepup cookie minted for a different user", async () => {
    const { requireFreshTotp } = await import("@/lib/auth/require-fresh-totp");
    const c = await cookies.buildTotpStepupCookie("attacker");
    await setCookie(c.value);
    expect(await requireFreshTotp(baseUser())).toEqual({
      ok: false,
      reason: "stepup_required",
    });
  });

  it("rejects a tampered stepup cookie", async () => {
    const { requireFreshTotp } = await import("@/lib/auth/require-fresh-totp");
    const c = await cookies.buildTotpStepupCookie("user-1");
    await setCookie(c.value.slice(0, -3) + "AAA");
    expect(await requireFreshTotp(baseUser())).toEqual({
      ok: false,
      reason: "stepup_required",
    });
  });
});
