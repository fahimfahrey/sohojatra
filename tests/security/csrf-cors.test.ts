/**
 * OWASP A05: Security Misconfiguration + CSRF defense.
 *
 * Middleware must:
 *   - reject cross-origin POST/PUT/PATCH/DELETE from disallowed Origin (403)
 *   - honour Access-Control-Allow-Origin only for ALLOWED_ORIGIN
 *   - emit security headers (X-Frame-Options, HSTS, X-Content-Type-Options)
 *   - reject body POST without Content-Length (411) or with wrong Content-Type (415)
 *   - reject oversize payloads (413)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/middleware", () => ({
  updateSession: vi.fn(async (req: NextRequest) => NextResponse.next({ request: req })),
}));

const { middleware } = await import("@/middleware");

const ALLOWED = "https://sohojatra.test";
const EVIL = "https://attacker.example";

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new NextRequest(new URL(url), init as RequestInit);
}

describe("A05 CORS / CSRF — middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects cross-origin POST with 403", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/account", {
        method: "POST",
        headers: { origin: EVIL, "content-type": "application/json", "content-length": "2" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects cross-origin DELETE with 403 (no state-change reachable)", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/account", {
        method: "DELETE",
        headers: { origin: EVIL },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows same-origin DELETE", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/account", {
        method: "DELETE",
        headers: { origin: ALLOWED },
      }),
    );
    expect(res.status).not.toBe(403);
  });

  it("returns 204 for OPTIONS preflight from allowed origin with CORS headers", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/data", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED,
          "access-control-request-method": "GET",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("rejects OPTIONS preflight from disallowed origin", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/data", {
        method: "OPTIONS",
        headers: { origin: EVIL },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("does NOT echo arbitrary Origin into Access-Control-Allow-Origin", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/data", {
        method: "OPTIONS",
        headers: { origin: EVIL },
      }),
    );
    const acao = res.headers.get("access-control-allow-origin");
    expect(acao).not.toBe(EVIL);
  });

  it("emits required security headers on every response", async () => {
    const res = await middleware(
      req("https://sohojatra.test/dashboard", { method: "GET" }),
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("strict-transport-security")).toMatch(/max-age/);
  });
});

describe("A05 body validation — middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects POST without Content-Length (411)", async () => {
    const r = new NextRequest(new URL("https://sohojatra.test/api/user/data"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    r.headers.delete("content-length");
    const res = await middleware(r);
    expect(res.status).toBe(411);
  });

  it("rejects oversized payload (413)", async () => {
    const big = "x".repeat(10);
    const res = await middleware(
      req("https://sohojatra.test/api/user/data", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(2 * 1024 * 1024),
        },
        body: big,
      }),
    );
    expect(res.status).toBe(413);
  });

  it("rejects wrong Content-Type (415)", async () => {
    const res = await middleware(
      req("https://sohojatra.test/api/user/data", {
        method: "POST",
        headers: {
          "content-type": "text/html",
          "content-length": "5",
        },
        body: "<xss>",
      }),
    );
    expect(res.status).toBe(415);
  });
});
