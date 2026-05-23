import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logDataAccess } from "@/lib/audit";
import { RETENTION_DAYS } from "@/lib/dataRetention";
import { withTiming } from "@/lib/perf";
import { captureError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withTiming("api.user.account.delete", async (req: Request) => {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  const userAgent = req.headers.get("user-agent");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    logDataAccess({
      event: "user.account.delete",
      userId: "anonymous",
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "unauthenticated" },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await checkRateLimit(`delete:${user.id}`, 3, 60 * 60 * 1000))) {
    logDataAccess({
      event: "user.account.delete",
      userId: user.id,
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "rate_limited" },
    });
    return NextResponse.json(
      { error: "Too many deletion attempts. Try again later." },
      { status: 429 },
    );
  }

  const { data: requestedAt, error: rpcError } = await supabase.rpc(
    "request_account_deletion",
  );

  if (rpcError) {
    logDataAccess({
      event: "user.account.delete",
      userId: user.id,
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "rpc_error", message: rpcError.message },
    });
    captureError(rpcError, {
      action: "user.account.delete",
      userId: user.id,
      route: "/api/user/account",
      severity: "critical",
      reason: "rpc_error",
    });
    return NextResponse.json(
      { error: "Failed to schedule deletion" },
      { status: 500 },
    );
  }

  const requested = new Date(requestedAt as string);
  const purgeAt = new Date(
    requested.getTime() + RETENTION_DAYS.DELETED_USER * 86_400_000,
  ).toISOString();

  await supabase.auth.signOut();

  logDataAccess({
    event: "user.account.delete",
    userId: user.id,
    ip,
    userAgent,
    resource: "users",
    outcome: "success",
    detail: { requestedAt: requested.toISOString(), purgeAt },
  });

  return NextResponse.json(
    {
      status: "scheduled",
      requestedAt: requested.toISOString(),
      scheduledPurgeAt: purgeAt,
      recoveryWindowDays: RETENTION_DAYS.DELETED_USER,
      message: `Account scheduled for deletion. Sign in within ${RETENTION_DAYS.DELETED_USER} days to cancel.`,
    },
    { status: 200 },
  );
});
