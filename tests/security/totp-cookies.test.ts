/**
 * TOTP cookie sign/verify round-trip.
 *
 * Cookies bind userId + expiry in the HMAC payload so a cookie stolen from
 * user A cannot be replayed against user B's session. Tampering any byte
 * must invalidate the cookie. Expired cookies must be rejected.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

beforeAll(() => {
  process.env.TOTP_COOKIE_SECRET = "test-totp-cookie-secret-32-bytes-min!";
});

const cookies = await import("@/lib/auth/totp-cookies");

describe("totp-cookies — passed cookie", () => {
  it("round-trips a valid cookie for the same user", () => {
    const c = cookies.buildTotpPassedCookie("user-123");
    expect(cookies.verifyTotpPassedCookie(c.value, "user-123")).toBe(true);
  });

  it("rejects a cookie minted for a different user (replay across accounts)", () => {
    const c = cookies.buildTotpPassedCookie("user-A");
    expect(cookies.verifyTotpPassedCookie(c.value, "user-B")).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const c = cookies.buildTotpPassedCookie("user-1");
    const tampered = c.value.slice(0, -3) + "AAA";
    expect(cookies.verifyTotpPassedCookie(tampered, "user-1")).toBe(false);
  });

  it("rejects a tampered expiry segment", () => {
    const c = cookies.buildTotpPassedCookie("user-1");
    const parts = c.value.split(".");
    parts[1] = Buffer.from(String(Date.now() + 86_400_000), "utf8")
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(cookies.verifyTotpPassedCookie(parts.join("."), "user-1")).toBe(false);
  });

  it("rejects missing/empty values", () => {
    expect(cookies.verifyTotpPassedCookie(undefined, "user-1")).toBe(false);
    expect(cookies.verifyTotpPassedCookie("", "user-1")).toBe(false);
    expect(cookies.verifyTotpPassedCookie("a.b", "user-1")).toBe(false);
  });
});

describe("totp-cookies — stepup cookie", () => {
  it("round-trips for the same user", () => {
    const c = cookies.buildTotpStepupCookie("user-1");
    expect(cookies.verifyTotpStepupCookie(c.value, "user-1")).toBe(true);
  });

  it("rejects a passed-cookie value when verifying a stepup cookie has expired", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const c = cookies.buildTotpStepupCookie("user-1");
      vi.setSystemTime(new Date("2026-01-01T00:30:00Z")); // +30 min, past 15-min TTL
      expect(cookies.verifyTotpStepupCookie(c.value, "user-1")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("step-up MAX_AGE_SEC is 15 minutes", () => {
    expect(cookies.TOTP_STEPUP_MAX_AGE_SEC).toBe(15 * 60);
  });
});
