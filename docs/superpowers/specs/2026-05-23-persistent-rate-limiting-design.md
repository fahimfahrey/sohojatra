# Persistent Rate Limiting — Design

**Date:** 2026-05-23
**Status:** Approved (autonomous mode)

## Goal

Replace in-memory rate limiting with persistent storage shared across all serverless instances. Apply tier-based limits to every `/api/*` route to prevent abuse and DoS.

## Background

Two rate-limit primitives exist today:

- `src/lib/rateLimit.ts` — pure in-memory Map. Per-instance only. Bypassed by serverless cold starts and horizontal scaling. Used by `src/lib/auth.ts` only.
- `src/lib/rate-limit/server.ts` — `checkRateLimit()` wraps `@upstash/ratelimit` with sliding-window limiter, falls back to in-memory if Upstash env vars missing. Used by server actions (`actions/auth`, `actions/rides`) and two API routes (`/api/user/account`, `/api/user/data`).

Most `/api/*` routes (`/api/ably/token`, `/api/docs/*`) have no rate limiting. The Next.js middleware (`src/middleware.ts`) handles CORS, CSRF cookie issuance, body-size guard, security headers — but no rate limit.

## Approach

Upstash Redis (already a dependency) as backing store. Tier on caller identity at the middleware layer.

**Tiers:**
- Anonymous: 100 requests/min keyed by client IP
- Authenticated: 1000 requests/min keyed by user id

Sliding-window limiter (matches existing usage). Stricter per-endpoint limits (login, signup, search, join, export, delete) remain in place inside their handlers — middleware adds a global ceiling.

## Architecture

```
src/lib/rate-limit/
  server.ts            # checkRateLimit() (back-compat) + applyApiRateLimit()
  index.ts             # public exports
```

**`applyApiRateLimit(request, userId)`** returns `{ allowed, limit, remaining, reset, retryAfter }`. Pure async function; no NextResponse coupling so it stays unit-testable.

**Middleware integration** — in `src/middleware.ts`, after Supabase session resolution gives us `user`, call `applyApiRateLimit` for any `/api/*` path. On `allowed === false`, return `429` with body `{ error: "Rate limit exceeded", retryAfter }` plus headers:

- `Retry-After: <seconds>`
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset` (unix ms)

On allowed, attach the same `X-RateLimit-*` headers to the success response (informational).

## Data Flow

```
Request → middleware
  → attachClientContext (extract IP)
  → handleCors (unchanged)
  → validateApiRequest (unchanged: body size, content-type)
  → updateSession → user
  → if /api/* → applyApiRateLimit(request, user?.id)
       allowed=false → 429 response (CORS + security headers applied)
       allowed=true  → attach X-RateLimit-* and continue
  → response
```

## Configuration

Env vars (already wired):
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If unset, falls back to in-memory (current behavior). Acceptable for local dev; production deploy must set both.

Limits live as constants in `server.ts`:
```
PUBLIC_LIMIT  = 100   // per minute
AUTH_LIMIT    = 1000  // per minute
WINDOW_MS     = 60_000
```

## Error Handling

- Upstash transient errors: fall back to in-memory check (current behavior, preserved).
- Missing IP: key as `ip:unknown` (matches `resolveClientIp` fallback). Acceptable — server-to-server callers without forwarding headers share a bucket.

## Testing

- Unit: tier selection (anon vs auth picks correct key + limit), 429 body shape, headers populated, window reset.
- Existing `tests/security/rate-limit.test.ts` continues passing (back-compat).
- Integration: middleware test that simulates 101 anon hits → 101st returns 429.

## Cleanup

Delete `src/lib/rateLimit.ts`. Migrate the single caller `src/lib/auth.ts` to `checkRateLimit()`.

## Out of Scope

- Distinct quotas per route group (admin, public, ably). One global ceiling is sufficient for now; per-endpoint guards exist where needed.
- User-facing rate-limit dashboards or quota self-service.
- Vercel KV (Upstash is already wired; KV is the same backend rebranded).
