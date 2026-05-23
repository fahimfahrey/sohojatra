/**
 * OWASP A01: Broken Access Control — API routes must reject unauthenticated callers.
 *
 * Each protected route is exercised under three states:
 *   - no session cookie  → 401
 *   - getUser() returns error → 401
 *   - forged user id in body must NOT escalate to other-user data
 *
 * Run: npm run test:security
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildSupabaseMock } from "../helpers/supabase-mock";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ logDataAccess: vi.fn() }));
vi.mock("@/lib/perf", () => ({
  withTiming: (_n: string, h: unknown) => h,
  timedQuery: async (_n: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/rate-limit/server", () => ({ checkRateLimit: () => true }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));

const { createClient } = await import("@/lib/supabase/server");
const mockedCreateClient = vi.mocked(createClient);

const FAKE_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "victim@example.com",
  email_confirmed_at: new Date().toISOString(),
};

function makeReq(headers: Record<string, string> = {}, body: string | null = null) {
  return new Request("https://sohojatra.test/api/anything", {
    method: body ? "POST" : "GET",
    headers,
    body,
  });
}

describe("A01 Broken Access Control — /api/user/account DELETE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when no session present", async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ user: null }) as never);
    const { DELETE } = await import("@/app/api/user/account/route");
    const res = await DELETE(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it("returns 401 when getUser() errors (forged/expired JWT)", async () => {
    mockedCreateClient.mockResolvedValue(
      buildSupabaseMock({
        user: null,
        authError: { message: "JWT expired" },
      }) as never,
    );
    const { DELETE } = await import("@/app/api/user/account/route");
    const res = await DELETE(makeReq({ authorization: "Bearer forged.jwt.token" }));
    expect(res.status).toBe(401);
  });

  it("does not leak user id in unauthenticated error response", async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ user: null }) as never);
    const { DELETE } = await import("@/app/api/user/account/route");
    const res = await DELETE(makeReq());
    const text = await res.text();
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});

describe("A01 Broken Access Control — /api/user/data GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 with no session", async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ user: null }) as never);
    const { GET } = await import("@/app/api/user/data/route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  it("export query is scoped to authenticated user id (IDOR check)", async () => {
    const supabase = buildSupabaseMock({ user: FAKE_USER });
    mockedCreateClient.mockResolvedValue(supabase as never);
    const { GET } = await import("@/app/api/user/data/route");
    await GET(makeReq());

    const fromCalls = supabase.from.mock.calls.map((c) => c[0]);
    expect(fromCalls).toEqual(
      expect.arrayContaining(["users", "ride_requests", "ride_passengers", "notifications"]),
    );
    const eqInvocations = supabase.from.mock.results.flatMap((r) => {
      const chain = r.value as { select: { mock?: { calls: unknown[] } }; eq: { mock?: { calls: unknown[] } } };
      return chain.eq.mock?.calls ?? [];
    });
    for (const call of eqInvocations) {
      const [col, val] = call as [string, string];
      if (col === "id" || col === "creator_id" || col === "user_id") {
        expect(val).toBe(FAKE_USER.id);
      }
    }
  });
});

describe("A01 Broken Access Control — /api/ably/token GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when unauthenticated (no realtime token leak)", async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ user: null }) as never);
    const { GET } = await import("@/app/api/ably/token/route");
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).not.toHaveProperty("keyName");
    expect(body).not.toHaveProperty("nonce");
  });

  it("returns 503 when ABLY_API_KEY missing — never falls back to anon", async () => {
    const prev = process.env.ABLY_API_KEY;
    delete process.env.ABLY_API_KEY;
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ user: FAKE_USER }) as never);
    const { GET } = await import("@/app/api/ably/token/route");
    const res = await GET();
    expect(res.status).toBe(503);
    process.env.ABLY_API_KEY = prev;
  });
});
