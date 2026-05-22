# Performance Monitoring

## Targets

| Metric | Target | Source |
|--------|--------|--------|
| Page load (LCP) | < 3.0 s | Vercel Speed Insights |
| Page load (FCP) | < 1.8 s | Vercel Speed Insights |
| Interaction (INP) | < 200 ms | Vercel Speed Insights |
| API response (server-side) | < 200 ms | `withTiming` wrapper / `Server-Timing` |
| DB query (single call) | < 100 ms | `timedQuery` wrapper |

A response that exceeds its target is logged as `[perf] slow query …` or `[perf] api … (target <200ms)` to stderr — surfaces in Vercel runtime logs.

## What's instrumented

### Client (Vercel)

Mounted in `src/app/layout.tsx`:

- `@vercel/analytics` — page views, custom events, traffic
- `@vercel/speed-insights` — Core Web Vitals (LCP, FCP, INP, CLS, TTFB) per route

Dashboards: Vercel project → **Analytics** and **Speed Insights** tabs. Data appears in production deploys only; preview/local emit no traffic.

### Server (`src/lib/perf.ts`)

- `withTiming(name, handler)` — wraps a Next.js route handler. Measures wall time, logs duration + status, attaches `Server-Timing: <name>;dur=<ms>` header on the response. Threshold: 200 ms.
- `timedQuery(label, fn)` — wraps any async fn (typically a Supabase call). Logs duration. Threshold: 100 ms.

Currently wrapped:

| Route | Name | Notes |
|-------|------|-------|
| `GET /api/ably/token` | `api.ably.token` | Realtime token issuance |
| `DELETE /api/user/account` | `api.user.account.delete` | Account deletion request |
| `GET /api/user/data` | `api.user.data.export` | GDPR export; fan-out query also wrapped via `timedQuery("user.data.export.fanout", …)` |

Static routes (`/api/docs`, `/api/docs/openapi.json`) are `force-static` and not instrumented — cached by Vercel, not measured per request.

### How to read `Server-Timing` in the browser

DevTools → Network → pick the request → **Timing** tab → "Server Timing" section. Or:

```js
fetch("/api/ably/token").then(r => r.headers.get("Server-Timing"));
// → "api_ably_token;dur=42.3"
```

## Adding instrumentation to new routes

```ts
import { withTiming, timedQuery } from "@/lib/perf";

export const GET = withTiming("api.rides.list", async (req: Request) => {
  const supabase = await createClient();
  const { data } = await timedQuery("rides.list", () =>
    supabase.from("ride_requests").select("*").limit(50),
  );
  return NextResponse.json(data);
});
```

## When a slow log fires

1. Check the route logs in Vercel → Runtime Logs, filter for `[perf]`.
2. If `timedQuery` flagged the slow path, the bottleneck is the DB call — check Supabase → **Database** → **Query Performance** for missing indexes or N+1.
3. If only the outer `api.*` is slow but no inner query is flagged, the cost is in serialization, auth check, or external calls (Ably, fetch).
4. Recurring slowness → open an issue, attach the duration sample + endpoint, propose an index or a Promise.all rewrite.

## Out of scope (not built yet)

- Real User Monitoring beyond Vercel's defaults (no Sentry, no Datadog)
- Custom Vercel Analytics events (e.g., `track("ride_created")`) — add via `import { track } from "@vercel/analytics"` when needed
- Alerting on slow-log threshold breaches — currently console-only
