/**
 * Idempotency key enforcement for ride mutations.
 *
 * Verifies duplicate calls with the same key replay the cached ActionResult
 * without re-invoking the underlying RPC, concurrent retries are serialized
 * by a pending lock, and malformed keys are rejected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/security/csrf", () => ({
  validateCsrfToken: vi.fn(async () => true),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: vi.fn(async () => ({
    id: "user-1",
    email_confirmed_at: "2026-01-01T00:00:00Z",
  })),
  getOptionalUser: vi.fn(async () => null),
}));

vi.mock("@/lib/auth/require-fresh-totp", () => ({
  requireFreshTotp: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/rate-limit/server", () => ({
  checkRateLimit: vi.fn(async () => true),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(async () => undefined),
  diffChanges: vi.fn(() => ({ before: null, after: null })),
}));

vi.mock("@/lib/observability/sentry", () => ({
  captureError: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const rpcMock = vi.fn();
const fromSelectChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(async () => ({
    data: { creator_id: "creator-1", seats_available: 3, status: "open" },
  })),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
    from: vi.fn(() => fromSelectChain),
  })),
}));

const VALID_INPUT_CREATE = {
  startingPoint: {
    coordinates: { lat: 23.81, lng: 90.41 },
    address: "Dhaka Origin",
  },
  destination: {
    coordinates: { lat: 23.7, lng: 90.4 },
    address: "Dhaka Destination",
  },
  totalSeats: 3,
  contactPhone: "+8801712345678",
  vehicle: "Car" as const,
};

const VALID_INPUT_JOIN = {
  rideId: "550e8400-e29b-41d4-a716-446655440000",
  contactPhone: "+8801712345678",
};

const VALID_KEY = "abcdef0123456789ABCDEF";
const VALID_KEY_B = "ZYXWVUTSRQPONMLKJIHGFE";

async function loadActions() {
  const mod = await import("@/app/actions/rides");
  const { __resetIdempotencyMemoryStoreForTests } = await import(
    "@/lib/idempotency/server"
  );
  __resetIdempotencyMemoryStoreForTests();
  return mod;
}

describe("idempotency — createRideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: "ride-new-1", error: null });
  });

  it("rejects malformed key", async () => {
    const { createRideAction } = await loadActions();
    const result = await createRideAction(VALID_INPUT_CREATE, "csrf", "short");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("IDEMPOTENCY_INVALID_KEY");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns cached success on duplicate key without re-invoking RPC", async () => {
    const { createRideAction } = await loadActions();
    const first = await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    expect(first.success).toBe(true);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    const second = await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    expect(second).toEqual(first);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("caches failure and replays it", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "boom", code: "P0001" },
    });
    const { createRideAction } = await loadActions();
    const first = await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    expect(first.success).toBe(false);

    const second = await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    expect(second).toEqual(first);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("different keys produce two RPC invocations", async () => {
    const { createRideAction } = await loadActions();
    await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY_B);
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent calls — second sees pending", async () => {
    let resolveRpc: ((v: { data: string; error: null }) => void) | null = null;
    let rpcCalledResolve: (() => void) | null = null;
    const rpcCalled = new Promise<void>((r) => {
      rpcCalledResolve = r;
    });
    rpcMock.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveRpc = res;
          rpcCalledResolve!();
        }),
    );
    const { createRideAction } = await loadActions();
    const inflight = createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    const concurrent = await createRideAction(VALID_INPUT_CREATE, "csrf", VALID_KEY);
    expect(concurrent.success).toBe(false);
    if (!concurrent.success) expect(concurrent.code).toBe("IDEMPOTENCY_IN_PROGRESS");

    await rpcCalled;
    resolveRpc!({ data: "ride-new-1", error: null });
    const first = await inflight;
    expect(first.success).toBe(true);
  });
});

describe("idempotency — joinRideAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("rejects malformed key", async () => {
    const { joinRideAction } = await loadActions();
    const result = await joinRideAction(VALID_INPUT_JOIN, "csrf", "!!!bad!!!");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("IDEMPOTENCY_INVALID_KEY");
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns cached success on duplicate key", async () => {
    const { joinRideAction } = await loadActions();
    const first = await joinRideAction(VALID_INPUT_JOIN, "csrf", VALID_KEY);
    expect(first.success).toBe(true);
    const second = await joinRideAction(VALID_INPUT_JOIN, "csrf", VALID_KEY);
    expect(second).toEqual(first);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });
});

describe("idempotency lib", () => {
  it("validates key format", async () => {
    const { isValidIdempotencyKey } = await import("@/lib/idempotency/server");
    expect(isValidIdempotencyKey("a".repeat(16))).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(128))).toBe(true);
    expect(isValidIdempotencyKey("a".repeat(15))).toBe(false);
    expect(isValidIdempotencyKey("a".repeat(129))).toBe(false);
    expect(isValidIdempotencyKey("has space here xxx")).toBe(false);
    expect(isValidIdempotencyKey("has/slash/here/xx")).toBe(false);
    expect(isValidIdempotencyKey(123)).toBe(false);
    expect(isValidIdempotencyKey(null)).toBe(false);
  });

  it("exports 24h result TTL", async () => {
    const { IDEMPOTENCY_RESULT_TTL_SECONDS } = await import(
      "@/lib/idempotency/server"
    );
    expect(IDEMPOTENCY_RESULT_TTL_SECONDS).toBe(86_400);
  });
});
