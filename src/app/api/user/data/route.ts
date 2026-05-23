import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logDataAccess } from "@/lib/audit";
import { withTiming, timedQuery } from "@/lib/perf";
import { captureError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withTiming("api.user.data.export", async (req: Request) => {
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
      event: "user.data.export",
      userId: "anonymous",
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "unauthenticated" },
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await checkRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000))) {
    logDataAccess({
      event: "user.data.export",
      userId: user.id,
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "rate_limited" },
    });
    return NextResponse.json(
      { error: "Too many export requests. Try again later." },
      { status: 429 },
    );
  }

  const [profile, ridesCreated, ridesJoined, notifications] = await timedQuery(
    "user.data.export.fanout",
    () =>
      Promise.all([
        supabase.from("users").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("ride_requests").select("*").eq("creator_id", user.id),
        supabase.from("ride_passengers").select("*").eq("user_id", user.id),
        supabase.from("notifications").select("*").eq("user_id", user.id),
      ]),
  );

  const firstError =
    profile.error || ridesCreated.error || ridesJoined.error || notifications.error;
  if (firstError) {
    logDataAccess({
      event: "user.data.export",
      userId: user.id,
      ip,
      userAgent,
      outcome: "failure",
      detail: { reason: "db_error", message: firstError.message },
    });
    captureError(firstError, {
      action: "user.data.export",
      userId: user.id,
      route: "/api/user/data",
      severity: "critical",
      reason: "db_error",
    });
    return NextResponse.json(
      { error: "Failed to export data" },
      { status: 500 },
    );
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: 1,
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      metadata: user.user_metadata,
    },
    profile: profile.data ?? null,
    ridesCreated: ridesCreated.data ?? [],
    ridesJoined: ridesJoined.data ?? [],
    notifications: notifications.data ?? [],
  };

  logDataAccess({
    event: "user.data.export",
    userId: user.id,
    ip,
    userAgent,
    resource: "users,ride_requests,ride_passengers,notifications",
    outcome: "success",
    detail: {
      ridesCreated: payload.ridesCreated.length,
      ridesJoined: payload.ridesJoined.length,
      notifications: payload.notifications.length,
    },
  });

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="sohojatra-export-${user.id}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
