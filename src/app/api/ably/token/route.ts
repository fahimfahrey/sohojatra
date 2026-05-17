import { NextResponse } from "next/server";
import * as Ably from "ably/promises";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
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
      capability: {
        "rides:*": ["subscribe", "publish"],
      },
    });

    return NextResponse.json(tokenRequest);
  } catch (err) {
    console.error("[ably/token]", err);
    return NextResponse.json(
      { error: "Failed to issue realtime token" },
      { status: 500 },
    );
  }
}
