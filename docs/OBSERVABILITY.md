# Observability — Sentry Error Tracking

## What ships

`@sentry/nextjs` SDK initialized on:

| Runtime | Config | DSN env |
|---|---|---|
| Browser | `instrumentation-client.ts` | `NEXT_PUBLIC_SENTRY_DSN` |
| Node server | `sentry.server.config.ts` (via `instrumentation.ts`) | `SENTRY_DSN` (falls back to public) |
| Edge runtime | `sentry.edge.config.ts` (via `instrumentation.ts`) | same |

Build wrapper: `next.config.ts` is wrapped with `withSentryConfig` (source-map upload + `/monitoring/sentry` tunnel route bypasses ad-blockers and same-origin CSP).

## What gets captured

1. **Unhandled errors** — App Router `onRequestError` hook (`instrumentation.ts`) plus React `global-error.tsx`.
2. **Server action failures** — `src/app/actions/*.ts` `catch` blocks call `captureError`.
3. **Server action DB errors** — every `if (error) return ...` on a critical path captures with `severity: "critical"`.
4. **API route errors** — `src/lib/perf.ts:withTiming` catches and forwards. Each route handler also captures specific DB/RPC failures.
5. **Unhandled rejections** — built into the SDK on both runtimes.

## Context

Every event carries:

| Tag | Source | Example |
|---|---|---|
| `action` | required arg to `captureError` | `ride.create`, `auth.signin`, `auth.totp.verify` |
| `severity` | `critical` \| `error` \| `warning` | drives alert filter |
| `ride_id` | optional, when known | UUID |
| `route` | optional, for API/edge events | `/api/user/account` |
| `reason` | optional, short slug | `db_error`, `rpc_error`, `metadata_update_failed` |
| `user.id` | scope user | UUID — **never email/IP** (scrubbed in `beforeSend`) |

PII scrub: `beforeSend` strips `email`, `ip_address`, `username`, request `cookies`, and `cookie`/`authorization`/`x-csrf-token` headers.

## Alert rules (set in Sentry UI)

Recommended Sentry → Alerts → "Issue Alert" rules:

1. **Critical auth failures**
   - Filter: `tag:severity equals critical` AND `tag:action starts with auth.`
   - Trigger: more than 5 events in 5 minutes
   - Notify: PagerDuty / on-call channel

2. **Critical database errors**
   - Filter: `tag:severity equals critical` AND `tag:reason in [db_error, rpc_error]`
   - Trigger: more than 10 events in 10 minutes
   - Notify: on-call channel

3. **Ride flow regressions**
   - Filter: `tag:action starts with ride.` AND `tag:severity equals critical`
   - Trigger: any new issue
   - Notify: product channel

4. **Spike detection (any error)**
   - Built-in "Number of errors > 2× baseline" alert
   - Notify: dev channel

## Env vars

Runtime (Vercel project settings):

```
NEXT_PUBLIC_SENTRY_DSN=...
SENTRY_DSN=...                 # optional, same value if not split
SENTRY_TRACES_SAMPLE_RATE=0.1  # tune per cost budget
NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0.1
```

Build-time (CI only, for source-map upload):

```
SENTRY_ORG=...
SENTRY_PROJECT=...
SENTRY_AUTH_TOKEN=...   # org-level auth token with project:releases scope
```

Source-map upload is skipped when `SENTRY_AUTH_TOKEN` is unset (local dev) or when `SENTRY_DISABLE_BUILD=true`.

## CSP

`next.config.ts` allows Sentry ingest hosts in `connect-src` (`https://*.sentry.io https://*.ingest.sentry.io`). The `/monitoring/sentry` tunnel route lets the SDK ship events through the same origin if the direct connection is blocked.

## Local testing

```bash
# 1. Set DSN in .env.local
echo 'NEXT_PUBLIC_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>' >> .env.local
echo 'SENTRY_DSN=...' >> .env.local

# 2. Throw a test error from a route or server action and verify the event in Sentry.
```

## Adding new captures

```ts
import { captureError } from "@/lib/observability/sentry";

try {
  // ...
} catch (err) {
  captureError(err, {
    action: "domain.operation",
    userId: user.id,
    rideId,
    severity: "critical",         // or "error"
    reason: "short_slug",
  });
  return { success: false, error: "User-facing message" };
}
```

Rules of thumb:
- Use `severity: "critical"` only for auth failures, database write failures, and security-relevant operations (TOTP, account deletion, OAuth).
- Use `severity: "error"` for read failures, validation surprises, third-party blips.
- Always pass `action` — it's the primary alert filter.
