/**
 * Tier-based API rate limiting:
 *   - Anonymous: keyed by IP, 100/min
 *   - Authenticated: keyed by user id, 1000/min
 *   - 429 response carries Retry-After + X-RateLimit-* headers
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

async function freshLib() {
  vi.resetModules();
  return await import("@/lib/rate-limit/server");
}

describe("applyApiRateLimit — tier selection", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("anonymous tier rejects 101st request from same IP", async () => {
    const { applyApiRateLimit, PUBLIC_API_LIMIT } = await freshLib();
    const headers = new Headers({ "x-client-ip": "203.0.113.5" });

    let last;
    for (let i = 0; i < PUBLIC_API_LIMIT; i++) {
      last = await applyApiRateLimit({ headers, userId: null });
      expect(last.allowed).toBe(true);
    }
    const rejected = await applyApiRateLimit({ headers, userId: null });
    expect(rejected.allowed).toBe(false);
    expect(rejected.limit).toBe(PUBLIC_API_LIMIT);
    expect(rejected.retryAfter).toBeGreaterThan(0);
    expect(rejected.remaining).toBe(0);
  });

  it("different IPs have isolated buckets", async () => {
    const { applyApiRateLimit, PUBLIC_API_LIMIT } = await freshLib();
    const a = new Headers({ "x-client-ip": "203.0.113.10" });
    const b = new Headers({ "x-client-ip": "203.0.113.11" });

    for (let i = 0; i < PUBLIC_API_LIMIT; i++) {
      await applyApiRateLimit({ headers: a, userId: null });
    }
    const aRejected = await applyApiRateLimit({ headers: a, userId: null });
    const bAllowed = await applyApiRateLimit({ headers: b, userId: null });
    expect(aRejected.allowed).toBe(false);
    expect(bAllowed.allowed).toBe(true);
  });

  it("auth tier has 1000/min and is keyed by user id, not IP", async () => {
    const { applyApiRateLimit, AUTH_API_LIMIT, PUBLIC_API_LIMIT } = await freshLib();
    const headers = new Headers({ "x-client-ip": "203.0.113.50" });
    expect(AUTH_API_LIMIT).toBeGreaterThan(PUBLIC_API_LIMIT);

    // Consume past the public limit while authenticated — auth tier should allow.
    for (let i = 0; i < PUBLIC_API_LIMIT + 10; i++) {
      const r = await applyApiRateLimit({ headers, userId: "user-A" });
      expect(r.allowed).toBe(true);
    }
    // A second user should start fresh.
    const userB = await applyApiRateLimit({ headers, userId: "user-B" });
    expect(userB.allowed).toBe(true);
    expect(userB.remaining).toBe(AUTH_API_LIMIT - 1);
  });

  it("falls back to ip:unknown when no IP headers present", async () => {
    const { applyApiRateLimit, PUBLIC_API_LIMIT } = await freshLib();
    const headers = new Headers();
    const r = await applyApiRateLimit({ headers, userId: null });
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(PUBLIC_API_LIMIT);
  });
});

describe("consumeRateLimit — result metadata", () => {
  it("populates limit, remaining, reset on allow", async () => {
    const { consumeRateLimit } = await freshLib();
    const r = await consumeRateLimit("test:meta:allow", 5, 60_000);
    expect(r.allowed).toBe(true);
    expect(r.limit).toBe(5);
    expect(r.remaining).toBe(4);
    expect(r.reset).toBeGreaterThan(Date.now());
    expect(r.retryAfter).toBe(0);
  });

  it("retryAfter > 0 on reject", async () => {
    const { consumeRateLimit } = await freshLib();
    for (let i = 0; i < 3; i++) await consumeRateLimit("test:meta:reject", 3, 60_000);
    const r = await consumeRateLimit("test:meta:reject", 3, 60_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
  });
});
