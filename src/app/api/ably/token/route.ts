import { NextResponse } from "next/server";
import Ably from "ably";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Realtime service not configured" },
      { status: 503 },
    );
  }

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
    capability: JSON.stringify({
      "rides:*": ["subscribe", "publish"],
    }),
  });

  return NextResponse.json(tokenRequest);
}
