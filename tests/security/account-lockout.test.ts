import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock, createClientMock } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  const createClientMock = vi.fn(async () => ({ rpc: rpcMock }));
  return { rpcMock, createClientMock };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: createClientMock,
}));

import {
  checkLockout,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  consumeUnlockToken,
} from "@/lib/auth/lockout";

beforeEach(() => {
  rpcMock.mockReset();
  createClientMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("checkLockout", () => {
  it("returns locked=false when RPC returns no rows", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await checkLockout("unknown@example.com");
    expect(rpcMock).toHaveBeenCalledWith("lockout_status", {
      p_email: "unknown@example.com",
    });
    expect(result).toEqual({ locked: false });
  });

  it("returns locked=true with timestamp when RPC reports lock", async () => {
    const lockedUntil = "2026-05-23T12:00:00.000Z";
    rpcMock.mockResolvedValueOnce({
      data: [{ user_id: "u1", locked: true, locked_until: lockedUntil }],
      error: null,
    });
    const result = await checkLockout("alice@example.com");
    expect(result).toEqual({
      locked: true,
      userId: "u1",
      lockedUntil,
    });
  });

  it("treats RPC errors as locked=false (open-fail)", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await checkLockout("alice@example.com");
    expect(result).toEqual({ locked: false });
  });
});

describe("recordFailedAttempt", () => {
  it("forwards constants and returns no-token result", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ locked_now: false, unlock_token: null, user_id: "u1" }],
      error: null,
    });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(rpcMock).toHaveBeenCalledWith("record_failed_attempt", {
      p_email: "alice@example.com",
      p_ip: "1.2.3.4",
      p_window_seconds: 900,
      p_max_attempts: 5,
      p_lock_duration_seconds: 1800,
      p_unlock_ttl_seconds: 3600,
    });
    expect(result).toEqual({ lockedNow: false, userId: "u1" });
  });

  it("returns unlock token on transition to locked", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ locked_now: true, unlock_token: "abc123", user_id: "u1" }],
      error: null,
    });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(result).toEqual({
      lockedNow: true,
      userId: "u1",
      unlockToken: "abc123",
    });
  });

  it("returns lockedNow=false when RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const result = await recordFailedAttempt("alice@example.com", "1.2.3.4");
    expect(result).toEqual({ lockedNow: false });
  });

  it("returns lockedNow=false when email not found (empty data)", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await recordFailedAttempt("ghost@example.com", "1.2.3.4");
    expect(result).toEqual({ lockedNow: false });
  });
});

describe("recordSuccessfulAttempt", () => {
  it("calls RPC with user id and swallows errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await recordSuccessfulAttempt("u1");
    expect(rpcMock).toHaveBeenCalledWith("record_successful_attempt", {
      p_user_id: "u1",
    });
  });
});

describe("consumeUnlockToken", () => {
  it("returns success=false on empty data", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const result = await consumeUnlockToken("abc");
    expect(result).toEqual({ success: false });
  });

  it("returns success=true with user id on valid token", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ user_id: "u1", success: true }],
      error: null,
    });
    const result = await consumeUnlockToken("abc");
    expect(result).toEqual({ success: true, userId: "u1" });
  });
});
