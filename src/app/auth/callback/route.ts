import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logAuditEvent } from "@/lib/audit";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const userName =
          (user.user_metadata?.name as string | undefined) ??
          (user.user_metadata?.full_name as string | undefined) ??
          user.email?.split("@")[0] ??
          "User";

        await supabase.from("users").upsert({
          id: user.id,
          email: user.email ?? "",
          name: userName,
        });
      }

      await logAuditEvent({
        action: "auth.callback",
        outcome: "success",
        userId: user?.id ?? null,
        resourceId: user?.id ?? null,
      });

      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNext}`);
    }

    await logAuditEvent({
      action: "auth.callback",
      outcome: "failure",
      detail: { reason: "code_exchange_failed" },
    });
  } else {
    await logAuditEvent({
      action: "auth.callback",
      outcome: "failure",
      detail: { reason: "missing_code" },
    });
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback`);
}
