/**
 * API key generation / verification.
 *
 * Covers:
 *   - generate produces ck_live_ prefix + SHA-256 hash + display prefix
 *   - parse strips "Bearer ", rejects garbage / oversized input
 *   - hash matches across generate → parse → hash
 *   - verifyApiKey: not_found / revoked / expired / ok branches
 *   - hasPermission / isDueRotation / defaultExpiry
 */
import { describe, it, expect } from "vitest";
import {
  API_KEY_DEFAULT_TTL_DAYS,
  API_KEY_PREFIX,
  API_KEY_PREFIX_DISPLAY_CHARS,
  defaultExpiry,
  generateApiKey,
  hasPermission,
  hashApiKey,
  isDueRotation,
  parseApiKey,
  verifyApiKey,
  type ApiKeyRecord,
} from "@/lib/security/api-key";

function baseRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    permissions: ["rides:read"],
    rate_limit: 1000,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    revoked_at: null,
    ...overrides,
  };
}

describe("api-key generate / hash", () => {
  it("emits ck_live_ prefix, hash, and display prefix", async () => {
    const k = await generateApiKey();
    expect(k.plaintext.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(k.plaintext.length).toBeGreaterThan(40);
    expect(k.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.keyPrefix).toHaveLength(API_KEY_PREFIX_DISPLAY_CHARS);
    expect(k.keyPrefix).toBe(k.plaintext.slice(0, API_KEY_PREFIX_DISPLAY_CHARS));
  });

  it("hash is deterministic and re-derivable from plaintext", async () => {
    const k = await generateApiKey();
    const again = await hashApiKey(k.plaintext);
    expect(again).toBe(k.keyHash);
  });

  it("two generated keys differ", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe("parseApiKey", () => {
  it("accepts bare key", () => {
    expect(parseApiKey("ck_live_abcdefghijklmnop")).toBe("ck_live_abcdefghijklmnop");
  });
  it("strips Bearer prefix (case-insensitive)", () => {
    expect(parseApiKey("Bearer ck_live_abcdefghijklmnop")).toBe("ck_live_abcdefghijklmnop");
    expect(parseApiKey("bearer ck_live_abcdefghijklmnop")).toBe("ck_live_abcdefghijklmnop");
  });
  it("rejects null / wrong prefix / whitespace / too short / too long", () => {
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey("")).toBeNull();
    expect(parseApiKey("Bearer abc")).toBeNull();
    expect(parseApiKey("ck_live_with space")).toBeNull();
    expect(parseApiKey("ck_live_x")).toBeNull();
    expect(parseApiKey("ck_live_" + "x".repeat(300))).toBeNull();
  });
});

describe("verifyApiKey", () => {
  it("missing header → missing", async () => {
    const r = await verifyApiKey(undefined, async () => null);
    expect(r).toEqual({ ok: false, reason: "missing" });
  });
  it("garbage header → malformed", async () => {
    const r = await verifyApiKey("not-a-key", async () => null);
    expect(r).toEqual({ ok: false, reason: "malformed" });
  });
  it("unknown hash → not_found", async () => {
    const k = await generateApiKey();
    const r = await verifyApiKey(k.plaintext, async () => null);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });
  it("revoked → revoked", async () => {
    const k = await generateApiKey();
    const r = await verifyApiKey(k.plaintext, async () => baseRecord({ revoked_at: new Date().toISOString() }));
    expect(r).toEqual({ ok: false, reason: "revoked" });
  });
  it("expired → expired", async () => {
    const k = await generateApiKey();
    const r = await verifyApiKey(k.plaintext, async () => baseRecord({ expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(r).toEqual({ ok: false, reason: "expired" });
  });
  it("valid → ok", async () => {
    const k = await generateApiKey();
    let lookedUp = "";
    const rec = baseRecord();
    const r = await verifyApiKey(`Bearer ${k.plaintext}`, async (hash) => {
      lookedUp = hash;
      return rec;
    });
    expect(lookedUp).toBe(k.keyHash);
    expect(r).toEqual({ ok: true, record: rec });
  });
});

describe("permissions / rotation helpers", () => {
  it("hasPermission requires exact match", () => {
    const rec = baseRecord({ permissions: ["rides:read"] });
    expect(hasPermission(rec, "rides:read")).toBe(true);
    expect(hasPermission(rec, "rides:write")).toBe(false);
  });

  it("isDueRotation flags keys within 30 days of expiry", () => {
    const soon = baseRecord({ expires_at: new Date(Date.now() + 5 * 86_400_000).toISOString() });
    const far = baseRecord({ expires_at: new Date(Date.now() + 60 * 86_400_000).toISOString() });
    expect(isDueRotation(soon)).toBe(true);
    expect(isDueRotation(far)).toBe(false);
  });

  it("defaultExpiry is TTL days in the future", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const exp = defaultExpiry(now);
    const diffDays = (exp.getTime() - now.getTime()) / 86_400_000;
    expect(diffDays).toBe(API_KEY_DEFAULT_TTL_DAYS);
  });
});
