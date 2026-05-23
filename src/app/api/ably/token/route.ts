import { NextResponse } from "next/server";
import * as Ably from "ably/promises";
import { createClient } from "@/lib/supabase/server";
import { withTiming } from "@/lib/perf";
import { captureError } from "@/lib/observability/sentry";

export const runtime = "nodejs";

export const GET = withTiming("api.ably.token", async () => {
  const apiKey = process.env.ABLY_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Realtime service not configured" },
      { status: 503 },
    );
  }

  if (!apiKey.includes(":")) {
    return NextResponse.json(
      { error: "Invalid Ably API key format" },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId: user.id,
      // Channel name is "rides" (not "rides:foo") — "rides:*" would not grant access.
      capability: {
        rides: ["subscribe", "publish"],
      },
    });

    return NextResponse.json(tokenRequest);
  } catch (err) {
    console.error("[ably/token]", err);
    captureError(err, {
      action: "ably.token",
      route: "/api/ably/token",
      severity: "critical",
      reason: "token_issue_failed",
    });
    return NextResponse.json(
      { error: "Failed to issue realtime token" },
      { status: 500 },
    );
  }
});
