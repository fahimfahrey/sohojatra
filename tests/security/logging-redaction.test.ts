/**
 * Sensitive-data redaction in logs. Passwords, tokens, JWTs, phone numbers,
 * and email addresses must never appear verbatim in log output or any field
 * forwarded to a downstream sink (Sentry, audit fallback console).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { redact, redactArgs, REDACTED } from "@/lib/observability/redact";
import { logger } from "@/lib/observability/logger";

describe("redact()", () => {
  it("redacts sensitive object keys regardless of value type", () => {
    const out = redact({
      password: "hunter2",
      token: "abc",
      api_key: "xyz",
      apiKey: "xyz",
      Authorization: "Bearer secret",
      session: { id: "sess_123" },
      email: "alice@example.com",
      phone: "+8801712345678",
      safe: "ok",
    }) as Record<string, unknown>;

    expect(out.password).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
    expect(out.api_key).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.Authorization).toBe(REDACTED);
    expect(out.session).toBe(REDACTED);
    expect(out.email).toBe(REDACTED);
    expect(out.phone).toBe(REDACTED);
    expect(out.safe).toBe("ok");
  });

  it("redacts emails inside free-form strings", () => {
    const out = redact("user signed in: alice@example.com");
    expect(out).toBe(`user signed in: ${REDACTED}`);
  });

  it("redacts phone numbers inside free-form strings", () => {
    expect(redact("call +8801712345678 now")).toBe(`call ${REDACTED} now`);
    expect(redact("call (555) 123-4567 now")).toBe(`call ${REDACTED} now`);
    // Short numbers (IDs, timestamps) are preserved.
    expect(redact("status=200 id=42")).toBe("status=200 id=42");
  });

  it("redacts JWTs", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFsaWNlIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redact(`bearer=${jwt}`)).toContain(REDACTED);
    expect(redact(`bearer=${jwt}`)).not.toContain("eyJhbGciOi");
  });

  it("redacts kv-form secrets in messages", () => {
    expect(redact('password="hunter2"')).toContain(REDACTED);
    expect(redact("Authorization: Bearer abc123")).toContain(REDACTED);
    expect(redact("token=abc.def.ghi")).toContain(REDACTED);
  });

  it("redacts Supabase / Stripe-style prefixed keys", () => {
    expect(redact("sk_live_4eC39HqLyjWDarjtT1zdp7dc")).toBe(REDACTED);
    expect(redact("sbp_abc123def456ghi789jkl000")).toBe(REDACTED);
  });

  it("walks nested objects and arrays", () => {
    const out = redact({
      user: { email: "a@b.com", phone: "+8801712345678" },
      items: [
        { token: "t1" },
        { note: "ping +14155551234" },
      ],
    }) as Record<string, unknown>;
    const user = out.user as Record<string, unknown>;
    expect(user.email).toBe(REDACTED);
    expect(user.phone).toBe(REDACTED);
    const items = out.items as Record<string, unknown>[];
    expect(items[0].token).toBe(REDACTED);
    expect(items[1].note).toContain(REDACTED);
  });

  it("handles Error objects without leaking PII in message/stack", () => {
    const err = new Error("login failed for user alice@example.com");
    const out = redact(err) as { message: string; stack?: string };
    expect(out.message).not.toContain("alice@example.com");
    expect(out.message).toContain(REDACTED);
  });

  it("caps depth and string length", () => {
    type Nest = { a?: Nest };
    const deep: Nest = {};
    let cur: Nest = deep;
    for (let i = 0; i < 20; i++) {
      cur.a = {};
      cur = cur.a;
    }
    const out = JSON.stringify(redact(deep));
    expect(out).toContain("depth-limit");

    const huge = "a".repeat(10_000);
    const r = redact(huge) as string;
    expect(r.length).toBeLessThan(huge.length);
    expect(r).toContain("truncated");
  });

  it("ignores null / undefined / primitives", () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
  });
});

describe("redactArgs()", () => {
  it("returns string args redacted and stringifies objects", () => {
    const out = redactArgs([
      "email=alice@example.com",
      { password: "p", note: "hi" },
    ]);
    expect(out[0]).toContain(REDACTED);
    expect(out[0]).not.toContain("alice@example.com");
    expect(String(out[1])).toContain(REDACTED);
    expect(String(out[1])).toContain("hi");
  });
});

describe("logger", () => {
  const spies = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
    debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
  };

  afterEach(() => {
    for (const s of Object.values(spies)) s.mockClear();
  });

  it("redacts email arg through info()", () => {
    logger.info("hello alice@example.com");
    const arg = spies.log.mock.calls[0]?.[0] as string;
    expect(arg).toContain(REDACTED);
    expect(arg).not.toContain("alice@example.com");
  });

  it("redacts password key in object passed to error()", () => {
    logger.error("creds:", { password: "hunter2", user: "alice" });
    const args = spies.error.mock.calls[0];
    const joined = args?.map(String).join(" ") ?? "";
    expect(joined).toContain(REDACTED);
    expect(joined).not.toContain("hunter2");
  });

  it("redacts Error message containing phone numbers", () => {
    logger.error(new Error("could not dial +8801712345678"));
    const args = spies.error.mock.calls[0];
    const joined = args?.map(String).join(" ") ?? "";
    expect(joined).toContain(REDACTED);
    expect(joined).not.toContain("+8801712345678");
  });
});
