/**
 * OWASP A07: Identification and Authentication Failures —
 *   rate-limit enforcement on auth + sensitive endpoints.
 *
 * - checkRateLimit returns false on the (max+1)th call in window.
 * - Window expiry resets counter.
 * - /api/user/account DELETE returns 429 once rate-limited.
 * - /api/user/data GET returns 429 once rate-limited.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Real implementation under test; reset module between cases to clear in-memory map.
async function freshRateLimit() {
  vi.resetModules();
  return (await import("@/lib/rate-limit/server")).checkRateLimit;
}

describe("A07 rate-limit primitive", () => {
  it("allows up to maxAttempts then rejects", async () => {
    const checkRateLimit = await freshRateLimit();
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit("k1", 5, 60_000)).toBe(true);
    }
    expect(await checkRateLimit("k1", 5, 60_000)).toBe(false);
    expect(await checkRateLimit("k1", 5, 60_000)).toBe(false);
  });

  it("keys are isolated (one IP rate-limited does not block another)", async () => {
    const checkRateLimit = await freshRateLimit();
    for (let i = 0; i < 5; i++) await checkRateLimit("ip:a", 5, 60_000);
    expect(await checkRateLimit("ip:a", 5, 60_000)).toBe(false);
    expect(await checkRateLimit("ip:b", 5, 60_000)).toBe(true);
  });

  it("resets after window elapses", async () => {
    vi.useFakeTimers();
    const checkRateLimit = await freshRateLimit();
    for (let i = 0; i < 3; i++) await checkRateLimit("k2", 3, 1000);
    expect(await checkRateLimit("k2", 3, 1000)).toBe(false);
    vi.advanceTimersByTime(1500);
    expect(await checkRateLimit("k2", 3, 1000)).toBe(true);
    vi.useRealTimers();
  });
});

describe("A07 rate-limit — /api/user/account DELETE", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("returns 429 when rate limiter rejects", async () => {
    vi.doMock("@/lib/rate-limit/server", () => ({ checkRateLimit: () => false }));
    vi.doMock("@/lib/audit", () => ({ logDataAccess: vi.fn() }));
    vi.doMock("@/lib/perf", () => ({
      withTiming: (_n: string, h: unknown) => h,
      timedQuery: async (_n: string, fn: () => unknown) => fn(),
    }));
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ getAll: () => [], set: () => {} }),
    }));
    const { buildSupabaseMock } = await import("../helpers/supabase-mock");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        buildSupabaseMock({
          user: {
            id: "11111111-1111-1111-1111-111111111111",
            email: "x@y.z",
            email_confirmed_at: new Date().toISOString(),
          },
        }),
    }));

    const { DELETE } = await import("@/app/api/user/account/route");
    const res = await DELETE(
      new Request("https://sohojatra.test/api/user/account", { method: "DELETE" }),
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/too many/i);
  });
});

describe("A07 rate-limit — /api/user/data GET", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("returns 429 when rate limiter rejects", async () => {
    vi.doMock("@/lib/rate-limit/server", () => ({ checkRateLimit: () => false }));
    vi.doMock("@/lib/audit", () => ({ logDataAccess: vi.fn() }));
    vi.doMock("@/lib/perf", () => ({
      withTiming: (_n: string, h: unknown) => h,
      timedQuery: async (_n: string, fn: () => unknown) => fn(),
    }));
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ getAll: () => [], set: () => {} }),
    }));
    const { buildSupabaseMock } = await import("../helpers/supabase-mock");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () =>
        buildSupabaseMock({
          user: { id: "11111111-1111-1111-1111-111111111111", email: "x@y.z" },
        }),
    }));

    const { GET } = await import("@/app/api/user/data/route");
    const res = await GET(new Request("https://sohojatra.test/api/user/data"));
    expect(res.status).toBe(429);
  });
});
