import * as Sentry from "@sentry/nextjs";
import type { PostgrestError } from "@supabase/supabase-js";

export type ErrorSeverity = "critical" | "error" | "warning";

export type ErrorContext = {
  action: string;
  userId?: string | null;
  rideId?: string | null;
  route?: string | null;
  severity?: ErrorSeverity;
  reason?: string | null;
  extra?: Record<string, unknown>;
};

const SEVERITY_TO_LEVEL: Record<ErrorSeverity, Sentry.SeverityLevel> = {
  critical: "fatal",
  error: "error",
  warning: "warning",
};

function isPostgrestError(err: unknown): err is PostgrestError {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    "message" in err &&
    "details" in err
  );
}

function normalize(err: unknown): Error {
  if (err instanceof Error) return err;
  if (isPostgrestError(err)) {
    const wrapped = new Error(`PostgrestError: ${err.message}`);
    wrapped.name = `PostgrestError(${err.code ?? "unknown"})`;
    return wrapped;
  }
  if (typeof err === "string") return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error("Non-serializable error");
  }
}

export function captureError(err: unknown, ctx: ErrorContext): void {
  const severity = ctx.severity ?? "error";
  Sentry.withScope((scope) => {
    scope.setLevel(SEVERITY_TO_LEVEL[severity]);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    scope.setTag("action", ctx.action);
    scope.setTag("severity", severity);
    if (ctx.rideId) scope.setTag("ride_id", ctx.rideId);
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.reason) scope.setTag("reason", ctx.reason);
    if (isPostgrestError(err)) {
      scope.setTag("error.kind", "postgrest");
      scope.setContext("postgrest", {
        code: err.code,
        details: err.details,
        hint: err.hint,
        message: err.message,
      });
    }
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    Sentry.captureException(normalize(err));
  });
}

export function captureMessage(message: string, ctx: ErrorContext): void {
  const severity = ctx.severity ?? "warning";
  Sentry.withScope((scope) => {
    scope.setLevel(SEVERITY_TO_LEVEL[severity]);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    scope.setTag("action", ctx.action);
    scope.setTag("severity", severity);
    if (ctx.rideId) scope.setTag("ride_id", ctx.rideId);
    if (ctx.route) scope.setTag("route", ctx.route);
    if (ctx.reason) scope.setTag("reason", ctx.reason);
    if (ctx.extra) scope.setContext("extra", ctx.extra);
    Sentry.captureMessage(message);
  });
}
