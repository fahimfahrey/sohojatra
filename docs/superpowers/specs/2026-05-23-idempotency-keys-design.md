# Idempotency Keys for Ride Mutations

## Goal
Stop retry-driven duplicate writes from `createRideAction` and `joinRideAction`. A client that retries the same request (refresh, double-tap, network hiccup) must produce one ride row, not two.

## Approach
Caller passes an idempotency key alongside the existing CSRF token. Server stores the action's `ActionResult` keyed by `(userId, action, idempotencyKey)` with 24h TTL. On a duplicate call with the same key, the cached result is returned and the underlying RPC is skipped. Concurrent retries are serialized by a short-lived pending lock.

Server actions in Next 16 do not expose HTTP headers, so the key is passed as a function argument rather than a header. Spirit of the requirement (client-supplied dedupe key, server-enforced single execution) is preserved.

## Components

### `src/lib/idempotency/server.ts` (new)
Upstash Redis primary, in-memory `Map` fallback — same pattern as `src/lib/rate-limit/server.ts`.

```ts
type Acquire<T> =
  | { state: "hit"; result: ActionResult<T> }
  | { state: "pending" }
  | { state: "acquired" };

isValidKey(key: string): boolean        // 16-128 chars [A-Za-z0-9_-]
tryAcquire<T>(scope, userId, key): Promise<Acquire<T>>
storeResult<T>(scope, userId, key, result): Promise<void>
releaseLock(scope, userId, key): Promise<void>
```

Storage key: `idem:<scope>:<userId>:<key>` (scope = action name, e.g. `ride.create`).
Pending sentinel: `{"__pending__":true}` with 60s TTL via `SET NX EX 60`.
Result write: `SET key value EX 86400` (overwrites pending).

### Action wiring
- `createRideAction(input, csrfToken, idempotencyKey)`
- `joinRideAction(input, csrfToken, idempotencyKey)`

Flow inside each action:
1. CSRF validate (uncached — token rotates).
2. `requireUser()` (uncached — caches are per-user).
3. `isValidKey(idempotencyKey)` else return `{success:false, error:"Invalid idempotency key", code:"IDEMPOTENCY_INVALID_KEY"}`.
4. `tryAcquire` → `hit` returns cached result; `pending` returns `{success:false, error:"Request in progress, retry shortly", code:"IDEMPOTENCY_IN_PROGRESS"}`.
5. Run existing body (rate limit, 2FA, validation, RPC, audit log).
6. `storeResult` with final `ActionResult`.
7. Thrown exception → `releaseLock` then rethrow (caught by outer try).

### Type change
`ActionResult.code` widens to `TotpStepUpErrorCode | "IDEMPOTENCY_IN_PROGRESS" | "IDEMPOTENCY_INVALID_KEY"`.

### Client wiring (`src/contexts/RideContext.tsx`)
Generate `crypto.randomUUID()` once per logical user action; pass to action call. On `IDEMPOTENCY_IN_PROGRESS`, surface a retryable error (existing `throw new Error(result.error)` is fine).

## Tests (`tests/security/idempotency.test.ts`)
- valid key, second call returns cached result, RPC mock invoked once
- cached failure replayed verbatim
- concurrent calls — first acquires, second sees `pending`
- invalid key format rejected (too short, bad chars)
- distinct keys → two RPC invocations
- TTL == 86400 on stored result
- Redis unavailable → memory fallback works

## Out of Scope
- `cancelRideAction`, `completeRideAction` — same pattern, easy follow-up.
- True HTTP-header support — would require route handlers, not server actions.
- Cross-region replication of idempotency state — Upstash global Redis handles it.
