/**
 * HTTPS upgrade: middleware must 308-redirect HTTP→HTTPS in production so
 * that a first-time visitor (before HSTS is cached) cannot send sensitive
 * data over plaintext. Dev and direct (no proxy) requests are exempt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async (req: NextRequest) => ({
    response: NextResponse.next({ request: req }),
    userId: null,
  })),
}));

const { middleware } = await import("@/middleware");

function req(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(url), { headers });
}

describe("HTTPS enforcement — middleware", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("308-redirects HTTP to HTTPS in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await middleware(
      req("https://sohojatra.test/profile?ref=x", {
        "x-forwarded-proto": "http",
      }),
    );
    expect(res.status).toBe(308);
    const location = res.headers.get("location");
    expect(location).toMatch(/^https:\/\//);
    expect(location).toContain("/profile");
    expect(location).toContain("ref=x");
  });

  it("does not redirect when forwarded proto is https", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await middleware(
      req("https://sohojatra.test/profile", {
        "x-forwarded-proto": "https",
      }),
    );
    expect(res.status).not.toBe(308);
  });

  it("does not redirect in development even when proto is http", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await middleware(
      req("https://sohojatra.test/profile", {
        "x-forwarded-proto": "http",
      }),
    );
    expect(res.status).not.toBe(308);
  });

  it("does not redirect when no x-forwarded-proto header is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await middleware(req("https://sohojatra.test/profile"));
    expect(res.status).not.toBe(308);
  });
});
