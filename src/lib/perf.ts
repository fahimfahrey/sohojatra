import { NextResponse } from "next/server";
// import { captureError } from "@/lib/observability/sentry";

const API_WARN_MS = 200;
const QUERY_WARN_MS = 100;

type RouteHandler<Args extends unknown[]> = (
  ...args: Args
) => Promise<Response> | Response;

export function withTiming<Args extends unknown[]>(
  name: string,
  handler: RouteHandler<Args>,
): RouteHandler<Args> {
  return async (...args: Args) => {
    const start = performance.now();
    let status = 0;
    try {
      const res = await handler(...args);
      status = res.status;
      const elapsed = performance.now() - start;
      logApi(name, status, elapsed);
      return appendServerTiming(res, name, elapsed);
    } catch (err) {
      const elapsed = performance.now() - start;
      logApi(name, 500, elapsed, err);
      // captureError(err, {
      //   action: name,
      //   route: name,
      //   severity: "critical",
      //   reason: "unhandled_route_error",
      // });
      throw err;
    }
  };
}

export async function timedQuery<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const elapsed = performance.now() - start;
    if (elapsed >= QUERY_WARN_MS) {
      console.warn(
        `[perf] slow query "${label}" took ${elapsed.toFixed(1)}ms (target <${QUERY_WARN_MS}ms)`,
      );
    } else if (process.env.NODE_ENV !== "production") {
      console.debug(`[perf] query "${label}" ${elapsed.toFixed(1)}ms`);
    }
  }
}

function logApi(name: string, status: number, ms: number, err?: unknown) {
  const line = `[perf] api "${name}" status=${status} ${ms.toFixed(1)}ms`;
  if (err) {
    console.error(`${line} (threw)`, err);
  } else if (ms >= API_WARN_MS) {
    console.warn(`${line} (target <${API_WARN_MS}ms)`);
  } else if (process.env.NODE_ENV !== "production") {
    console.debug(line);
  }
}

function appendServerTiming(res: Response, name: string, ms: number): Response {
  const header = `${sanitize(name)};dur=${ms.toFixed(1)}`;
  if (res instanceof NextResponse || typeof res.headers.append === "function") {
    const existing = res.headers.get("Server-Timing");
    res.headers.set(
      "Server-Timing",
      existing ? `${existing}, ${header}` : header,
    );
    return res;
  }
  return res;
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}
